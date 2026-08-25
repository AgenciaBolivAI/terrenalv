'use client';

// Planes de pago: la cartera financiada, plan por plan y cuota por cuota.
//
// Ventas contesta "qué se vendió y cuánto deben". Esto contesta la otra mitad:
// CUÁNDO entra esa plata y quién dejó de pagar. Hasta acá el cronograma solo
// existía dentro de un diálogo de Contabilidad → Por cobrar, uno por cliente,
// así que nadie podía mirar la cartera entera ni sacarla en papel.
//
// La lista llega ordenada por monto vencido y después por próxima cuota: esta
// pantalla es una cola de cobranza, no un archivo. Lo que hay que perseguir hoy
// tiene que estar arriba sin que nadie ordene nada.
//
// Ni una cifra se recalcula acá. Cuotas vencidas, saldo y días de atraso salen
// de v_planes, que los mide contra CURRENT_DATE en la base; si esta pantalla los
// dedujera por su cuenta, el navegador de una máquina con la fecha corrida
// diría una cosa y el libro otra.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FichaClienteDialog } from '@/features/admin/clientes/FichaClienteDialog';
import { formatMoney, waLink } from '@/lib/format';
import { Badge, EmptyState, Kpi, Spinner, inputClass } from '@/features/admin/ui/bits';
import { IconSearch, IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel, monthLabel, todayIso } from '@/features/admin/contabilidad/types';
import type { Currency, Installment } from '@/features/admin/contabilidad/types';
import {
  ScopeBar,
  scopeCurrency,
  scopeLabel,
  type ProjectScope,
} from '@/features/admin/ui/scope';
import type { AdminProject } from '@/features/admin/lib/project-types';

/** Una fila de v_planes, tal como la define la vista. */
interface Plan {
  plan_id: string;
  project_id: string;
  reservation_id: string;
  proyecto: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  buyer_ci: string;
  manzana: string | null;
  lote: string | null;
  estado: 'activo' | 'completado' | 'cancelado';
  total_price: number;
  down_payment: number;
  financed_amount: number;
  months: number;
  monthly_amount: number;
  /** Null en los planes sin interés, que son la mayoría. */
  annual_interest_pct: number | null;
  /** Interés MENSUAL sobre saldo — el que se pacta acá. */
  monthly_interest_pct: number | null;
  first_due_date: string;
  currency: Currency;
  cuotas_totales: number;
  cuotas_pagadas: number;
  cuotas_vencidas: number;
  pagado: number;
  saldo: number;
  monto_vencido: number;
  /** La cuota impaga más vieja: la que sigue en la cola de cobro. */
  proxima_cuota: string | null;
  /** Días desde esa cuota si ya venció; null cuando el plan está al día. */
  dias_atraso: number | null;
  avance_pct: number;
}

const ESTADO_LABEL: Record<Plan['estado'], string> = {
  activo: 'Activo',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

/**
 * 'activos' es el filtro por defecto: un plan completado o cancelado ya no se
 * cobra y solo estorba la cola. 'con_saldo' y 'mes' no tienen chip fijo — se
 * llega desde su KPI y aparecen como chip descartable, igual que el filtro por
 * forma de pago en el libro.
 */
type Filtro = 'activos' | 'atraso' | 'aldia' | 'completados' | 'todos' | 'con_saldo' | 'mes';

const CHIPS: { id: Exclude<Filtro, 'con_saldo' | 'mes'>; label: string }[] = [
  { id: 'activos', label: 'Activos' },
  { id: 'atraso', label: 'Con atraso' },
  { id: 'aldia', label: 'Al día' },
  { id: 'completados', label: 'Completados' },
  { id: 'todos', label: 'Todos' },
];

export default function PlanesClient({
  projectId,
  projects,
  open,
}: {
  /** La urbanización activa en la barra: valor inicial del filtro. */
  projectId: string;
  projects: AdminProject[];
  /** plan_id a expandir al cargar (enlace desde Contabilidad o desde un aviso). */
  open: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);

  // Con varias urbanizaciones arranca consolidado: "cuánto tenemos por cobrar"
  // es una pregunta de la empresa, no de un plano.
  const [scope, setScope] = useState<ProjectScope>(projects.length > 1 ? null : projectId);
  const projectName = scopeLabel(scope, projects);
  // Los totales de los KPI van en la moneda del alcance; cada fila, en la suya.
  // Consolidado siempre en bolivianos — es la regla de scope-core, y es lo que
  // impide que un total sume dólares con bolivianos sin que nada falle a la vista.
  const moneda = scopeCurrency(scope, projects);

  const [rows, setRows] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('activos');

  const [selected, setSelected] = useState<string | null>(null);
  // El nombre del comprador abre su ficha sin salir de Planes.
  const [ficha, setFicha] = useState<{ ci: string; nombre: string } | null>(null);
  const [cuotas, setCuotas] = useState<Installment[] | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  // Hoy y el mes corriente en el mismo huso que la base (v_planes compara contra
  // CURRENT_DATE), para que "vencida" y "cuotas de este mes" signifiquen lo
  // mismo en la pantalla y en la vista.
  const hoy = todayIso();
  const mesActual = hoy.slice(0, 7);

  /**
   * Hoy hay pocos planes, pero cada venta migrada que reciba cronograma suma
   * uno y son más de mil cuatrocientas: PostgREST corta en 1.000 filas por
   * respuesta, así que se pagina desde el primer día en lugar de descubrirlo
   * el día en que la lista empiece a mentir por lo bajo.
   */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    setCuotas(null);
    const PAGINA = 1000;
    const todos: Plan[] = [];
    for (let desde = 0; desde < 20 * PAGINA; desde += PAGINA) {
      let q = supabase.from('v_planes').select('*');
      if (scope !== null) q = q.eq('project_id', scope);
      const { data, error } = await q
        // El orden de cobranza se le pide a la base, no se rehace acá: así las
        // páginas son estables, y el desempate por plan_id impide que dos
        // planes con el mismo vencido salten de página entre consultas.
        .order('monto_vencido', { ascending: false })
        .order('proxima_cuota', { ascending: true, nullsFirst: false })
        .order('plan_id')
        .range(desde, desde + PAGINA - 1);
      if (error) break;
      const pagina = (data ?? []) as unknown as Plan[];
      todos.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    setRows(todos);
    setLoading(false);
  }, [supabase, scope]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /** Detalle inline: el cronograma completo del plan, cuota por cuota. */
  const toggleDetail = useCallback(
    async (planId: string) => {
      if (selectedRef.current === planId) {
        setSelected(null);
        return;
      }
      setSelected(planId);
      setCuotas(null);
      const { data } = await supabase
        .from('installments')
        .select('id, number, due_date, amount, amount_paid, status, paid_at')
        .eq('plan_id', planId)
        .order('number');
      // Si mientras cargaba el usuario abrió otra fila, esta respuesta ya no es
      // la del detalle visible y se descarta.
      if (selectedRef.current === planId) setCuotas((data ?? []) as unknown as Installment[]);
    },
    [supabase],
  );

  // ---- Enlace profundo ?open=<plan_id> ----
  // Contabilidad y los avisos de mora llegan acá con ese parámetro; se expande
  // ese plan apenas carga la lista, una sola vez, y después se navega normal.
  const pendingOpenRef = useRef<string | null>(open);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (open) pendingOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    const target = pendingOpenRef.current;
    if (!target || loading) return;
    pendingOpenRef.current = null;
    if (rows.some((r) => r.plan_id === target)) {
      // 'todos' y no 'activos': el plan enlazado puede estar completado o
      // cancelado, y el filtro por defecto lo escondería sin explicar por qué.
      setFiltro('todos');
      void toggleDetail(target);
      setScrollTo(target);
    }
  }, [loading, rows, toggleDetail]);

  const detailRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (scrollTo && selected === scrollTo && detailRef.current) {
      detailRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setScrollTo(null);
    }
  }, [scrollTo, selected]);

  // ---- Derivados. Sumas de filas de la vista, nunca lógica rehecha acá. ----
  // Todos los KPI cuentan solo planes activos: uno completado no tiene saldo que
  // cobrar y uno cancelado no se cobra, así que sumarlos inflaría la cartera con
  // plata que nadie va a perseguir.
  const totals = useMemo(() => {
    const activos = rows.filter((r) => r.estado === 'activo');
    const delMes = activos.filter((r) => (r.proxima_cuota ?? '').slice(0, 7) === mesActual);
    return {
      activos: activos.length,
      porCobrar: activos.reduce((s, r) => s + Number(r.saldo), 0),
      conSaldo: activos.filter((r) => Number(r.saldo) > 0).length,
      vencido: activos.reduce((s, r) => s + Number(r.monto_vencido), 0),
      atrasados: activos.filter((r) => Number(r.cuotas_vencidas) > 0).length,
      delMes: delMes.length,
      montoDelMes: delMes.reduce((s, r) => s + Number(r.monthly_amount), 0),
    };
  }, [rows, mesActual]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      // Salvo 'todos' y 'completados', cada chip describe un subconjunto de los
      // planes ACTIVOS: así la cifra de un KPI y la lista que abre coinciden.
      if (filtro === 'completados') {
        if (r.estado !== 'completado') return false;
      } else if (filtro !== 'todos' && r.estado !== 'activo') {
        return false;
      }
      if (filtro === 'atraso' && !(Number(r.cuotas_vencidas) > 0)) return false;
      if (filtro === 'aldia' && Number(r.cuotas_vencidas) > 0) return false;
      if (filtro === 'con_saldo' && !(Number(r.saldo) > 0)) return false;
      if (filtro === 'mes' && (r.proxima_cuota ?? '').slice(0, 7) !== mesActual) return false;
      if (!q) return true;
      const lote = `${r.manzana ?? ''}-${r.lote ?? ''}`.toLowerCase();
      return (
        r.tracking_code.toLowerCase().includes(q) ||
        r.buyer_full_name.toLowerCase().includes(q) ||
        (r.buyer_ci ?? '').toLowerCase().includes(q) ||
        lote.includes(q) ||
        lote.replace('-', ' ').includes(q)
      );
    });
  }, [rows, query, filtro, mesActual]);

  /** Un KPI abre la lista YA filtrada: la cifra y la lista deben coincidir. */
  function verFiltrado(f: Filtro) {
    setQuery('');
    setFiltro(f);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-stone-900">Planes de pago</h1>
          <p className="text-xs text-stone-500">{projectName} · cronogramas y cobranza</p>
        </div>
      </div>

      <ScopeBar projects={projects} scope={scope} onScope={setScope} />

      {rows.length === 0 ? (
        <EmptyState
          title="Todavía no hay planes de pago"
          hint="Un plan se crea desde Contabilidad → Por cobrar, sobre una venta que todavía no tiene cronograma: ahí se fijan la cuota inicial, la cantidad de cuotas y el vencimiento de la primera."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Planes activos"
              value={fnum(totals.activos, 0)}
              hint="con cronograma en curso — ver"
              onClick={() => verFiltrado('activos')}
            />
            <Kpi
              label="Por cobrar"
              value={formatMoney(totals.porCobrar, moneda)}
              hint={`${totals.conSaldo} plan(es) con saldo — ver`}
              onClick={() => verFiltrado('con_saldo')}
            />
            <Kpi
              label="Vencido"
              value={formatMoney(totals.vencido, moneda)}
              hint="cuotas impagas que ya pasaron su fecha — ver"
              tone={totals.vencido > 0 ? 'bad' : 'normal'}
              onClick={() => verFiltrado('atraso')}
            />
            <Kpi
              label="Planes con atraso"
              value={fnum(totals.atrasados, 0)}
              hint="al menos una cuota vencida sin pagar — ver"
              tone={totals.atrasados > 0 ? 'bad' : 'normal'}
              onClick={() => verFiltrado('atraso')}
            />
            <Kpi
              label="Cuotas del mes"
              value={fnum(totals.delMes, 0)}
              hint={`${formatMoney(totals.montoDelMes, moneda)} en ${monthLabel(`${mesActual}-01`)} — ver`}
              onClick={() => verFiltrado('mes')}
            />
          </div>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {CHIPS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={filtro === c.id}
                    onClick={() => setFiltro(c.id)}
                    className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors
                                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light ${
                                  filtro === c.id
                                    ? c.id === 'atraso'
                                      ? 'bg-red-600 text-white'
                                      : 'bg-brand text-white'
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                                }`}
                  >
                    {c.label}
                  </button>
                ))}
                {filtro === 'con_saldo' || filtro === 'mes' ? (
                  <button
                    type="button"
                    onClick={() => setFiltro('activos')}
                    className="cursor-pointer rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800
                               hover:bg-green-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                  >
                    {filtro === 'con_saldo'
                      ? 'Con saldo'
                      : `Vencen en ${monthLabel(`${mesActual}-01`)}`}{' '}
                    ✕
                  </button>
                ) : null}
              </div>
              <div className="relative w-full sm:ml-auto sm:w-64">
                <IconSearch className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-stone-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar código, nombre, CI o lote…"
                  className={`${inputClass} pl-9`}
                />
              </div>
              <ExportButtons
                disabled={!visibles.length}
                orientation="landscape"
                meta={{
                  title: 'Planes de pago',
                  subtitle: scopeLabel(scope, projects),
                  filename: `planes-${new Date().toISOString().slice(0, 10)}`,
                  footnote:
                    'Saldo: cuotas pendientes o parciales del plan. Vencido: la parte impaga de las cuotas cuya fecha ya pasó.',
                }}
                columns={[
                  { header: 'Código' },
                  { header: 'Comprador' },
                  { header: 'CI' },
                  { header: 'Proyecto' },
                  { header: 'Lote' },
                  { header: 'Estado' },
                  { header: 'Meses', align: 'right' },
                  { header: 'Cuota mensual', align: 'right' },
                  { header: 'Cuotas pagadas', align: 'right' },
                  { header: 'Cuotas vencidas', align: 'right' },
                  { header: 'Pagado', align: 'right' },
                  { header: 'Saldo', align: 'right' },
                  { header: 'Vencido', align: 'right' },
                  { header: 'Próxima cuota' },
                ]}
                rows={() =>
                  visibles.map((r) => [
                    r.tracking_code,
                    r.buyer_full_name,
                    r.buyer_ci,
                    r.proyecto,
                    `Mz ${r.manzana ?? '—'}-${r.lote ?? '—'}`,
                    ESTADO_LABEL[r.estado],
                    r.months,
                    fnum(Number(r.monthly_amount)),
                    `${r.cuotas_pagadas}/${r.cuotas_totales}`,
                    Number(r.cuotas_vencidas),
                    fnum(Number(r.pagado)),
                    fnum(Number(r.saldo)),
                    fnum(Number(r.monto_vencido)),
                    dateLabel(r.proxima_cuota),
                  ]) as XCell[][]
                }
              />
            </div>

            {visibles.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">
                Sin resultados con este filtro o búsqueda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-240 text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-stone-500">Código</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Comprador</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                        Cuota mensual
                      </th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Avance</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                        Pagado
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                        Saldo
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                        Vencido
                      </th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">
                        Próxima cuota
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((r) => (
                      <Fragment key={r.plan_id}>
                        <tr
                          onClick={() => void toggleDetail(r.plan_id)}
                          className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                            selected === r.plan_id ? 'bg-green-50/70' : ''
                          }`}
                        >
                          <td className="px-4 py-2 align-top">
                            <p className="font-mono text-xs font-semibold text-stone-700">
                              {r.tracking_code}
                            </p>
                            {r.estado !== 'activo' ? (
                              <Badge
                                className={`mt-1 ${
                                  r.estado === 'completado'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-stone-100 text-stone-500'
                                }`}
                              >
                                {ESTADO_LABEL[r.estado]}
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-left font-medium text-stone-900 hover:text-brand hover:underline"
                              title="Ver el perfil de este cliente"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFicha({ ci: r.buyer_ci, nombre: r.buyer_full_name });
                              }}
                            >
                              {r.buyer_full_name}
                            </button>
                            <p className="text-xs text-stone-400">CI {r.buyer_ci}</p>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                            Mz {r.manzana ?? '—'}-{r.lote ?? '—'}
                            {scope === null ? (
                              <span className="text-xs text-stone-400"> · {r.proyecto}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-stone-900">
                            {formatMoney(Number(r.monthly_amount), r.currency)}
                          </td>
                          <td className="px-3 py-2">
                            <Avance
                              pct={Number(r.avance_pct)}
                              pagadas={Number(r.cuotas_pagadas)}
                              totales={Number(r.cuotas_totales)}
                              atrasado={Number(r.cuotas_vencidas) > 0}
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                            {formatMoney(Number(r.pagado), r.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-900">
                            {formatMoney(Number(r.saldo), r.currency)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold tabular-nums ${
                              Number(r.monto_vencido) > 0 ? 'text-red-600' : 'text-stone-400'
                            }`}
                          >
                            {Number(r.monto_vencido) > 0
                              ? formatMoney(Number(r.monto_vencido), r.currency)
                              : '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                            {dateLabel(r.proxima_cuota)}
                            {r.dias_atraso !== null && Number(r.dias_atraso) > 0 ? (
                              <span className="block text-xs font-semibold text-red-600">
                                {r.dias_atraso} día(s) de atraso
                              </span>
                            ) : null}
                          </td>
                        </tr>

                        {selected === r.plan_id ? (
                          <tr
                            ref={detailRef}
                            className="border-b border-stone-100 bg-stone-50/70 last:border-0"
                          >
                            <td colSpan={9} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      Condiciones del plan
                                    </p>
                                    <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                                      <Dato
                                        label="Precio total"
                                        valor={formatMoney(Number(r.total_price), r.currency)}
                                      />
                                      <Dato
                                        label="Cuota inicial"
                                        valor={formatMoney(Number(r.down_payment), r.currency)}
                                      />
                                      <Dato
                                        label="Financiado"
                                        valor={formatMoney(Number(r.financed_amount), r.currency)}
                                      />
                                      <Dato label="Cuotas" valor={`${r.months} mensuales`} />
                                      <Dato
                                        label="Cuota mensual"
                                        valor={formatMoney(Number(r.monthly_amount), r.currency)}
                                      />
                                      <Dato
                                        label="Interés mensual"
                                        valor={
                                          Number(r.monthly_interest_pct) > 0
                                            ? `${fnum(Number(r.monthly_interest_pct), 2)} % sobre saldo`
                                            : 'Sin interés'
                                        }
                                      />
                                      <Dato
                                        label="Primera cuota"
                                        valor={dateLabel(r.first_due_date)}
                                      />
                                      <Dato label="Estado" valor={ESTADO_LABEL[r.estado]} />
                                    </dl>
                                  </div>
                                  <div>
                                    <p className="text-xs text-stone-500">
                                      {r.buyer_full_name} · CI {r.buyer_ci} · {r.buyer_phone}
                                    </p>
                                    <a
                                      href={waLink(
                                        r.buyer_phone,
                                        `Hola ${r.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv por su plan de pagos ${r.tracking_code} (Mz ${r.manzana ?? '—'}, Lote ${r.lote ?? '—'}). Su saldo es de ${formatMoney(Number(r.saldo), r.currency)}${
                                          r.proxima_cuota
                                            ? ` y su próxima cuota vence el ${dateLabel(r.proxima_cuota)}`
                                            : ''
                                        }.`,
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                                    >
                                      <IconWhatsapp className="h-4 w-4" /> WhatsApp
                                    </a>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                    Cronograma
                                  </p>
                                  {cuotas === null ? (
                                    <div className="mt-3">
                                      <Spinner />
                                    </div>
                                  ) : cuotas.length === 0 ? (
                                    <p className="mt-2 text-sm text-stone-500">
                                      Este plan no tiene cuotas generadas.
                                    </p>
                                  ) : (
                                    <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-stone-200 bg-white">
                                      <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-stone-50">
                                          <tr className="border-b border-stone-200 text-left">
                                            <th className="px-3 py-2 text-xs font-semibold text-stone-500">
                                              #
                                            </th>
                                            <th className="px-3 py-2 text-xs font-semibold text-stone-500">
                                              Vence
                                            </th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                                              Importe
                                            </th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                                              Pagado
                                            </th>
                                            <th className="px-3 py-2 text-xs font-semibold text-stone-500">
                                              Estado
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {cuotas.map((c) => {
                                            // Misma regla que la vista: una cuota impaga con fecha
                                            // pasada está vencida aunque su columna `status` siga
                                            // diciendo 'pendiente' — el status no se mueve solo al
                                            // pasar la medianoche, la comparación de fecha sí.
                                            const vencida =
                                              c.status !== 'pagada' &&
                                              c.status !== 'anulada' &&
                                              c.due_date < hoy;
                                            return (
                                              <tr
                                                key={c.id}
                                                className="border-b border-stone-100 last:border-0"
                                              >
                                                <td className="px-3 py-1.5 tabular-nums text-stone-500">
                                                  {c.number}
                                                </td>
                                                <td
                                                  className={`px-3 py-1.5 whitespace-nowrap ${
                                                    vencida
                                                      ? 'font-semibold text-red-600'
                                                      : 'text-stone-600'
                                                  }`}
                                                >
                                                  {dateLabel(c.due_date)}
                                                </td>
                                                <td className="px-3 py-1.5 text-right tabular-nums text-stone-900">
                                                  {formatMoney(Number(c.amount), r.currency)}
                                                </td>
                                                <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">
                                                  {Number(c.amount_paid) > 0
                                                    ? formatMoney(Number(c.amount_paid), r.currency)
                                                    : '—'}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  <Badge
                                                    className={
                                                      c.status === 'pagada'
                                                        ? 'bg-green-100 text-green-700'
                                                        : c.status === 'parcial'
                                                          ? 'bg-amber-100 text-amber-800'
                                                          : c.status === 'anulada'
                                                            ? 'bg-stone-100 text-stone-500'
                                                            : vencida
                                                              ? 'bg-red-100 text-red-700'
                                                              : 'bg-stone-100 text-stone-600'
                                                    }
                                                  >
                                                    {c.status === 'pendiente' && vencida
                                                      ? 'vencida'
                                                      : c.status}
                                                  </Badge>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
              El saldo son las cuotas pendientes o parciales del plan; lo vencido, la parte impaga de
              las que ya pasaron su fecha. Una cuota se salda registrando el cobro en Contabilidad,
              no editando el cronograma.
            </p>
          </section>
        </>
      )}

      {ficha ? (
        <FichaClienteDialog ci={ficha.ci} nombre={ficha.nombre} onClose={() => setFicha(null)} />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

/**
 * Avance del plan.
 *
 * La barra es lo que se lee de un vistazo, pero sola engaña: «80 %» no dice si
 * lo que falta está al día o vencido. Por eso se tiñe de rojo cuando el plan
 * debe algo — un avance alto con cuotas impagas es peor noticia que uno bajo y
 * puntual, y con una sola barra verde las dos se verían igual.
 */
function Avance({
  pct,
  pagadas,
  totales,
  atrasado,
}: {
  pct: number;
  pagadas: number;
  totales: number;
  atrasado: boolean;
}) {
  const ancho = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return (
    <div className="min-w-28">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200"
        role="img"
        aria-label={`${fnum(ancho, 1)} % del plan pagado`}
      >
        <div
          className={`h-full rounded-full ${atrasado ? 'bg-red-500' : 'bg-brand'}`}
          style={{ width: `${ancho}%` }}
        />
      </div>
      <p className="mt-1 text-xs whitespace-nowrap text-stone-500 tabular-nums">
        {fnum(ancho, 0)} % · {pagadas}/{totales} cuotas
      </p>
    </div>
  );
}

/** Un dato del plan: etiqueta chica arriba, cifra legible abajo. */
function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-stone-900">{valor}</dd>
    </div>
  );
}
