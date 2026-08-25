'use client';

// Ventas confirmadas: el registro de lo vendido y de la plata que falta cobrar.
//
// Reservas y Ventas se parecen pero son cosas distintas: Reservas es la cola de
// trabajo (comprobantes por revisar, esperas, reintentos) y se vacía; esto es
// el archivo de lo ya vendido, que solo crece. Mezclarlos en una pestaña hacía
// que las 1.463 ventas migradas taparan la cola que el equipo sí debe atender.
//
// Ojo con "confirmada": una reserva confirmada cuyo comprador nunca pagó una
// cuota ni un abono todavía NO es una venta — es alguien a quien hay que
// perseguir. La vista lo marca con `compra_iniciada` y acá esa fila se aparta
// en su propio filtro y su propio indicador, en vez de inflar los totales.
//
// Cada cifra sale de la vista v_ventas, nunca de aritmética hecha acá: el
// saldo de una venta migrada se calcula contra la deuda reportada del sistema
// anterior, no contra el precio, y esa regla vive en la base para que todas
// las pantallas digan lo mismo.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatDateTime, formatMoney, waLink } from '@/lib/format';
import { Badge, EmptyState, Kpi, Spinner, btnDanger, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { IconSearch, IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import RegistrarCobroDialog from '@/features/admin/contabilidad/RegistrarCobro';
import type { CobroTarget } from '@/features/admin/contabilidad/types';
import { ScopeBar, scopeLabel, type ProjectScope } from '@/features/admin/ui/scope';
import type { AdminProject } from '@/features/admin/lib/project-types';

/** Una fila de v_ventas, tal como la define la vista. */
interface Venta {
  project_id: string;
  reservation_id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  fecha_venta: string;
  price_agreed: number;
  currency: 'BOB' | 'USD';
  manzana: string | null;
  lote: string | null;
  proyecto: string;
  migrada: boolean;
  deuda_migrada: number | null;
  cobrado_aqui: number;
  pagos_cuota: number;
  pagos_abono: number;
  saldo: number;
  con_plan: boolean;
  ultimo_pago: string | null;
  compra_iniciada: boolean;
  abonado_migrado: number;
  /** Pagado en total: en el sistema anterior más lo cobrado acá. */
  pagado_total: number;
}

/** Un pago aprobado de esa venta, para listar y abrir su recibo. */
interface Pago {
  id: string;
  reference_code: string;
  purpose: string;
  provider: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  verified_at: string | null;
}

// Mismas etiquetas que usa contabilidad, para que un pago se llame igual en
// todas las pantallas y en la glosa del libro.
const PURPOSE_LABEL: Record<string, string> = {
  reserva: 'Seña',
  cuota: 'Cuota',
  abono: 'Abono',
};
const PROVIDER_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  manual_qr: 'QR / transferencia',
  banco_ganadero: 'Banco Ganadero',
  bnb: 'BNB',
};

/**
 * 'ventas' es el filtro por defecto: solo compras iniciadas. 'sin_inicial' es
 * el bucket contrario — confirmadas que nadie empezó a pagar. 'cobradas' no
 * tiene chip propio: solo se llega desde el KPI "Pagado" y aparece como chip
 * descartable, igual que el filtro por forma de pago en el libro.
 */
type Filtro = 'ventas' | 'todas' | 'saldo' | 'migradas' | 'plan' | 'sin_inicial' | 'cobradas';

const CHIPS: { id: Exclude<Filtro, 'cobradas'>; label: string }[] = [
  { id: 'ventas', label: 'Ventas' },
  { id: 'todas', label: 'Todas' },
  { id: 'saldo', label: 'Con saldo' },
  { id: 'migradas', label: 'Migradas' },
  { id: 'plan', label: 'Con plan' },
  { id: 'sin_inicial', label: 'Sin cuota inicial' },
];

export default function VentasClient({
  projectId,
  projects,
  open,
}: {
  /** La urbanización activa en la barra: valor inicial del filtro. */
  projectId: string;
  projects: AdminProject[];
  /** reservation_id a expandir al cargar (enlace desde Lotes o Reservas). */
  open: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);

  // Igual que en contabilidad: con varias urbanizaciones arranca consolidado,
  // porque "cuánto vendimos" es una pregunta de la empresa, no de un plano.
  const [scope, setScope] = useState<ProjectScope>(projects.length > 1 ? null : projectId);
  const projectName = scopeLabel(scope, projects);

  const [rows, setRows] = useState<Venta[]>([]);
  // Acciones sobre una venta: cobrar, corregir sus datos, o anularla.
  const [cobrar, setCobrar] = useState<CobroTarget | null>(null);
  const [editar, setEditar] = useState<Venta | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('ventas');

  const [selected, setSelected] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  /**
   * v_ventas ya pasa de mil filas (la migración trajo 1.463) y PostgREST corta
   * cada respuesta en 1.000, así que se pagina con range() hasta que venga una
   * página corta. Sin esto la pantalla mostraría "todas" las ventas… menos las
   * últimas cuatrocientas, y ningún total cuadraría con la base.
   */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    setPagos(null);
    const PAGINA = 1000;
    const todas: Venta[] = [];
    for (let desde = 0; desde < 20 * PAGINA; desde += PAGINA) {
      let q = supabase.from('v_ventas').select('*');
      if (scope !== null) q = q.eq('project_id', scope);
      const { data, error } = await q
        // El desempate por reservation_id hace estables las páginas: dos
        // ventas del mismo día no pueden saltar de página entre consultas.
        .order('fecha_venta', { ascending: false })
        .order('reservation_id')
        .range(desde, desde + PAGINA - 1);
      if (error) break;
      const pagina = (data ?? []) as unknown as Venta[];
      todas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    setRows(todas);
    setLoading(false);
  }, [supabase, scope]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  /** Detalle inline: los pagos aprobados de la venta, con su recibo. */
  const toggleDetail = useCallback(
    async (rid: string) => {
      if (selectedRef.current === rid) {
        setSelected(null);
        return;
      }
      setSelected(rid);
      setPagos(null);
      const { data } = await supabase
        .from('payments')
        .select('id, reference_code, purpose, provider, amount, currency, amount_bob, verified_at')
        .eq('reservation_id', rid)
        .eq('status', 'aprobado')
        .order('verified_at', { ascending: false });
      // Si mientras cargaba el usuario abrió otra fila, esta respuesta ya no
      // es la del detalle visible y se descarta.
      if (selectedRef.current === rid) setPagos((data ?? []) as unknown as Pago[]);
    },
    [supabase],
  );

  // ---- Enlace profundo ?open=<reservation_id> ----
  // Los lotes vendidos en /admin/lotes y las reservas recién confirmadas llegan
  // acá con ese parámetro; se expande esa venta apenas carga la lista, una sola
  // vez, y después el usuario navega normal.
  const pendingOpenRef = useRef<string | null>(open);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (open) pendingOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    const target = pendingOpenRef.current;
    if (!target || loading) return;
    pendingOpenRef.current = null;
    if (rows.some((r) => r.reservation_id === target)) {
      // 'todas' y no 'ventas': la fila buscada puede ser justo una confirmada
      // sin inicio de compra, y el filtro por defecto la escondería.
      setFiltro('todas');
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

  // ---- Derivados. Sumas de filas de la vista, no lógica re-derivada acá. ----
  // Los KPI cuentan solo compras iniciadas: una confirmada sin cuota inicial
  // no es plata vendida ni saldo por cobrar — es una gestión pendiente, y por
  // eso tiene su propio indicador en vez de inflar los totales.
  // Todo en bolivianos: la vista ya viene así.
  const totals = useMemo(() => {
    const ventas = rows.filter((r) => r.compra_iniciada);
    return {
      ventas: ventas.length,
      valor: ventas.reduce((s, r) => s + Number(r.price_agreed), 0),
      pagado: ventas.reduce((s, r) => s + Number(r.pagado_total), 0),
      saldo: ventas.reduce((s, r) => s + Number(r.saldo), 0),
      conSaldo: ventas.filter((r) => Number(r.saldo) > 0).length,
      sinInicial: rows.length - ventas.length,
    };
  }, [rows]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      // Salvo 'todas' y 'sin_inicial', cada chip describe un subconjunto de
      // las VENTAS: así el número de un KPI y la lista que abre coinciden.
      if (filtro !== 'todas' && filtro !== 'sin_inicial' && !r.compra_iniciada) return false;
      if (filtro === 'sin_inicial' && r.compra_iniciada) return false;
      if (filtro === 'saldo' && !(Number(r.saldo) > 0)) return false;
      if (filtro === 'migradas' && !r.migrada) return false;
      if (filtro === 'plan' && !r.con_plan) return false;
      if (filtro === 'cobradas' && !(Number(r.cobrado_aqui) > 0)) return false;
      if (!q) return true;
      const lote = `${r.manzana ?? ''}-${r.lote ?? ''}`.toLowerCase();
      return (
        r.tracking_code.toLowerCase().includes(q) ||
        r.buyer_full_name.toLowerCase().includes(q) ||
        r.buyer_ci.toLowerCase().includes(q) ||
        lote.includes(q) ||
        lote.replace('-', ' ').includes(q)
      );
    });
  }, [rows, query, filtro]);

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
          <h1 className="text-lg font-bold text-stone-900">Ventas</h1>
          <p className="text-xs text-stone-500">{projectName} · lotes vendidos y su saldo</p>
        </div>
      </div>

      <ScopeBar projects={projects} scope={scope} onScope={setScope} />

      {rows.length === 0 ? (
        <EmptyState
          title="Todavía no hay ventas confirmadas"
          hint="Cuando una reserva se apruebe en la cola de Reservas aparecerá acá."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Ventas"
              value={fnum(totals.ventas, 0)}
              hint="compras iniciadas — ver"
              onClick={() => verFiltrado('ventas')}
            />
            <Kpi
              label="Valor vendido"
              value={formatMoney(totals.valor, 'BOB')}
              hint="precio pactado de esas ventas"
              onClick={() => verFiltrado('ventas')}
            />
            <Kpi
              label="Pagado"
              value={formatMoney(totals.pagado, 'BOB')}
              hint="en el sistema anterior y acá — ver"
              tone="good"
              onClick={() => verFiltrado('cobradas')}
            />
            <Kpi
              label="Saldo por cobrar"
              value={formatMoney(totals.saldo, 'BOB')}
              hint={`${totals.conSaldo} venta(s) con saldo — ver`}
              tone={totals.saldo > 0 ? 'bad' : 'normal'}
              onClick={() => verFiltrado('saldo')}
            />
            <Kpi
              label="Sin cuota inicial"
              value={fnum(totals.sinInicial, 0)}
              hint="confirmadas sin inicio de compra — ver"
              tone={totals.sinInicial > 0 ? 'bad' : 'normal'}
              onClick={() => verFiltrado('sin_inicial')}
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
                                    ? c.id === 'sin_inicial'
                                      ? 'bg-amber-500 text-white'
                                      : 'bg-brand text-white'
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                                }`}
                  >
                    {c.label}
                  </button>
                ))}
                {filtro === 'cobradas' ? (
                  <button
                    type="button"
                    onClick={() => setFiltro('ventas')}
                    className="cursor-pointer rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800
                               hover:bg-green-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                  >
                    Con cobros ✕
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
                  title: 'Ventas',
                  subtitle: projectName,
                  filename: `ventas-${new Date().toISOString().slice(0, 10)}`,
                  footnote:
                    'Saldo: deuda migrada (si la hay) o precio pactado, menos cuotas y abonos aprobados en este sistema.',
                }}
                columns={[
                  { header: 'Código' },
                  { header: 'Comprador' },
                  { header: 'CI' },
                  { header: 'Proyecto' },
                  { header: 'Manzana' },
                  { header: 'Lote' },
                  { header: 'Fecha' },
                  { header: 'Precio', align: 'right' },
                  { header: 'Pagado', align: 'right' },
                  { header: 'Saldo', align: 'right' },
                  { header: 'Estado' },
                  { header: 'Origen' },
                ]}
                rows={() =>
                  visibles.map((r) => [
                    r.tracking_code,
                    r.buyer_full_name,
                    r.buyer_ci,
                    r.proyecto,
                    r.manzana ?? '',
                    r.lote ?? '',
                    dateLabel(r.fecha_venta),
                    fnum(Number(r.price_agreed)),
                    fnum(Number(r.pagado_total)),
                    fnum(Number(r.saldo)),
                    r.compra_iniciada ? 'Venta' : 'Confirmada sin inicial',
                    r.migrada ? 'Sistema anterior' : 'Sistema',
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
                <table className="w-full min-w-200 text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-stone-500">Código</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Comprador</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Precio</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Pagado</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Saldo</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Último pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((r) => (
                      <Fragment key={r.reservation_id}>
                        <tr
                          onClick={() => void toggleDetail(r.reservation_id)}
                          className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                            selected === r.reservation_id ? 'bg-green-50/70' : ''
                          }`}
                        >
                          <td className="px-4 py-2 align-top">
                            <p className="font-mono text-xs font-semibold text-stone-700">{r.tracking_code}</p>
                            {!r.compra_iniciada ? (
                              <Badge className="mt-1 bg-amber-100 text-amber-800">
                                Sin inicio de compra
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-stone-900">{r.buyer_full_name}</p>
                            <p className="text-xs text-stone-400">CI {r.buyer_ci}</p>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                            Mz {r.manzana ?? '—'}-{r.lote ?? '—'}
                            {scope === null ? (
                              <span className="text-xs text-stone-400"> · {r.proyecto}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                            {dateLabel(r.fecha_venta)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-stone-900">
                            {formatMoney(Number(r.price_agreed), 'BOB')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                            {formatMoney(Number(r.pagado_total), 'BOB')}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold tabular-nums ${
                              Number(r.saldo) > 0 ? 'text-red-600' : 'text-stone-900'
                            }`}
                          >
                            {formatMoney(Number(r.saldo), 'BOB')}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                            {dateLabel(r.ultimo_pago)}
                          </td>
                        </tr>

                        {selected === r.reservation_id ? (
                          <tr ref={detailRef} className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                            <td colSpan={8} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      Comprador
                                    </p>
                                    <p className="mt-1 text-sm font-medium text-stone-900">{r.buyer_full_name}</p>
                                    <p className="text-xs text-stone-500">
                                      CI {r.buyer_ci} · {r.buyer_phone}
                                      {r.buyer_email ? ` · ${r.buyer_email}` : ''}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <a
                                        href={waLink(
                                          r.buyer_phone,
                                          `Hola ${r.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv por su compra ${r.tracking_code} (Mz ${r.manzana ?? '—'}, Lote ${r.lote ?? '—'}).`,
                                        )}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                                      >
                                        <IconWhatsapp className="h-4 w-4" /> WhatsApp
                                      </a>
                                      <button
                                        type="button"
                                        className={btnPrimary}
                                        onClick={() =>
                                          setCobrar({
                                            reservation_id: r.reservation_id,
                                            project_id: r.project_id,
                                            tracking_code: r.tracking_code,
                                            buyer_full_name: r.buyer_full_name,
                                            buyer_phone: r.buyer_phone,
                                            saldo: Number(r.saldo),
                                            currency: 'BOB',
                                            monto_sugerido: null,
                                            tiene_plan: r.con_plan,
                                          })
                                        }
                                      >
                                        Registrar cobro
                                      </button>
                                      <button
                                        type="button"
                                        className={btnSecondary}
                                        onClick={() => setEditar(r)}
                                      >
                                        Editar datos
                                      </button>
                                      <button
                                        type="button"
                                        className={btnSecondary}
                                        onClick={() => setAnular(r)}
                                      >
                                        Anular venta
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-500">
                                    <span>
                                      Precio{' '}
                                      <strong className="tabular-nums text-stone-900">
                                        {formatMoney(Number(r.price_agreed), 'BOB')}
                                      </strong>
                                    </span>
                                    <span>
                                      Pagado{' '}
                                      <strong className="tabular-nums text-stone-900">
                                        {formatMoney(Number(r.pagado_total), 'BOB')}
                                      </strong>
                                      {r.migrada && Number(r.abonado_migrado) > 0 ? (
                                        <span className="text-xs text-stone-400">
                                          {' '}
                                          ({formatMoney(Number(r.abonado_migrado), 'BOB')} antes +{' '}
                                          {formatMoney(Number(r.cobrado_aqui), 'BOB')} acá)
                                        </span>
                                      ) : null}
                                    </span>
                                    <span>
                                      Saldo{' '}
                                      <strong
                                        className={`tabular-nums ${
                                          Number(r.saldo) > 0 ? 'text-red-600' : 'text-stone-900'
                                        }`}
                                      >
                                        {formatMoney(Number(r.saldo), 'BOB')}
                                      </strong>
                                    </span>
                                  </div>
                                  {!r.compra_iniciada ? (
                                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                      Confirmada, sin inicio de compra: el comprador todavía no pagó
                                      ninguna cuota ni abono. Hay que contactarlo para que arranque.
                                    </p>
                                  ) : null}
                                  {r.migrada ? (
                                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                      Venta migrada del sistema anterior
                                      {r.deuda_migrada !== null
                                        ? ` con una deuda reportada de ${formatMoney(Number(r.deuda_migrada), 'BOB')}. El saldo se calcula contra esa deuda, no contra el precio.`
                                        : '. Los cobros de aquel sistema no están pago por pago acá.'}
                                    </p>
                                  ) : null}
                                </div>

                                <div>
                                  <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                    Pagos aprobados en este sistema
                                  </p>
                                  {pagos === null ? (
                                    <div className="mt-3">
                                      <Spinner />
                                    </div>
                                  ) : pagos.length === 0 ? (
                                    <p className="mt-2 text-sm text-stone-500">
                                      Todavía no hay pagos registrados acá
                                      {r.migrada ? ' (los del sistema anterior no se migraron pago por pago)' : ''}
                                      .
                                    </p>
                                  ) : (
                                    <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                      {pagos.map((p) => (
                                        <li
                                          key={p.id}
                                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                                        >
                                          <span className="whitespace-nowrap text-xs text-stone-500">
                                            {p.verified_at ? formatDateTime(p.verified_at) : '—'}
                                          </span>
                                          <span className="text-stone-700">
                                            {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                                          </span>
                                          <span className="text-xs text-stone-400">
                                            {PROVIDER_LABEL[p.provider] ?? p.provider}
                                          </span>
                                          <span className="ml-auto font-semibold tabular-nums text-stone-900">
                                            {formatMoney(Number(p.amount), p.currency)}
                                          </span>
                                          <a
                                            href={`/admin/recibo/${p.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-semibold text-brand hover:underline"
                                          >
                                            Recibo
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
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
              Pagado suma lo que el comprador pagó en el sistema anterior más las cuotas y abonos
              aprobados acá. En las ventas migradas el saldo parte de la deuda reportada por el
              sistema anterior; en las nativas, del precio menos lo pagado.
            </p>
          </section>
        </>
      )}

      {cobrar ? (
        <RegistrarCobroDialog
          cobro={cobrar}
          onClose={() => setCobrar(null)}
          onPaid={() => void fetchAll()}
        />
      ) : null}

      {editar ? (
        <EditarVentaDialog
          venta={editar}
          onClose={() => setEditar(null)}
          onSaved={() => {
            setEditar(null);
            void fetchAll();
          }}
        />
      ) : null}

      {anular ? (
        <AnularVentaDialog
          venta={anular}
          onClose={() => setAnular(null)}
          onDone={() => {
            setAnular(null);
            setSelected(null);
            void fetchAll();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

/**
 * Corregir los datos de una venta.
 *
 * Hace falta sobre todo por las migradas: llegaron con CI «MIGRADO-...» y sin
 * teléfono porque la fuente no traía documento y no se inventan datos. La
 * oficina los completa con el contrato delante.
 *
 * La deuda migrada también se corrige acá: es la cifra contra la que se calcula
 * el saldo de esas ventas, y si el sistema anterior la reportó mal, hoy no
 * había forma de arreglarla.
 */
function EditarVentaDialog({
  venta,
  onClose,
  onSaved,
}: {
  venta: Venta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [nombre, setNombre] = useState(venta.buyer_full_name);
  const [ci, setCi] = useState(venta.buyer_ci);
  const [tel, setTel] = useState(venta.buyer_phone);
  const [correo, setCorreo] = useState(venta.buyer_email ?? '');
  const [precio, setPrecio] = useState(String(venta.price_agreed));
  const [deuda, setDeuda] = useState(
    venta.deuda_migrada !== null ? String(venta.deuda_migrada) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (nombre.trim().length < 3) {
      setError('El nombre del comprador no puede quedar vacío.');
      return;
    }
    if (!(Number(precio) > 0)) {
      setError('El precio debe ser mayor a cero.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_editar_venta', {
      p_reservation_id: venta.reservation_id,
      p_full_name: nombre.trim(),
      p_ci: ci.trim() || null,
      p_phone: tel.trim() || null,
      p_email: correo.trim() || null,
      p_price: Number(precio),
      p_deuda_migrada: venta.migrada && deuda.trim() !== '' ? Number(deuda) : null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Venta actualizada.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={`Editar venta — ${venta.tracking_code}`}>
      <div className="space-y-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre completo"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">CI</label>
            <input value={ci} onChange={(e) => setCi(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Celular</label>
            <input value={tel} onChange={(e) => setTel(e.target.value)} className={inputClass} />
          </div>
        </div>
        <input
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="Correo"
          inputMode="email"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Precio pactado (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className={inputClass}
            />
          </div>
          {venta.migrada ? (
            <div>
              <label className="mb-1 block text-xs text-stone-500">Deuda reportada (Bs)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={deuda}
                onChange={(e) => setDeuda(e.target.value)}
                className={inputClass}
              />
            </div>
          ) : null}
        </div>
        {venta.migrada ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            El saldo de esta venta se calcula contra la deuda reportada, no contra el precio. Si el
            sistema anterior la informó mal, corregila acá.
          </p>
        ) : null}
        {venta.buyer_ci.startsWith('MIGRADO') ? (
          <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
            El CI dice «{venta.buyer_ci}» porque la fuente no traía documento del comprador y no se
            inventó ninguno. Completalo con el contrato delante.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}

/* ========================================================================== */

/**
 * Anular una venta cargada por error: el lote vuelve a la vitrina.
 *
 * Los pagos NO se borran — son historia contable y siguen en el libro. Por eso
 * el motivo es obligatorio: dentro de un mes nadie va a recordar por qué esta
 * venta desapareció.
 */
function AnularVentaDialog({
  venta,
  onClose,
  onDone,
}: {
  venta: Venta;
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function anular() {
    setError(null);
    if (motivo.trim().length < 5) {
      setError('Escribí por qué se anula: queda en la auditoría.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_anular_venta', {
      p_reservation_id: venta.reservation_id,
      p_note: motivo.trim(),
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Venta anulada. El lote volvió a disponible.', 'success');
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={`Anular venta — ${venta.tracking_code}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          Se anula la venta de <strong>{venta.buyer_full_name}</strong> (Mz {venta.manzana ?? '—'},
          Lote {venta.lote ?? '—'}) y el lote vuelve a estar disponible.{' '}
          {Number(venta.pagado_total) > 0 ? (
            <>
              Ya tiene {formatMoney(Number(venta.pagado_total), 'BOB')} pagados: esos pagos siguen
              en el libro, así que habrá que resolver la devolución aparte.
            </>
          ) : null}
        </p>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Motivo (queda en la auditoría)"
          className={inputClass}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnDanger} disabled={busy} onClick={() => void anular()}>
          {busy ? 'Anulando…' : 'Anular venta'}
        </button>
      </div>
    </Dialog>
  );
}
