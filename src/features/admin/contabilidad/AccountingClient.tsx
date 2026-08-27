'use client';

// Contabilidad del proyecto.
//
// Three tabs, in the order the office actually works:
//   Resumen   what came in, what went out, what is owed.
//   Por cobrar who owes money, how much, and how late — plus the sales that
//              still have no payment plan, because that gap is invisible
//              everywhere else and silently means "nobody is billing them".
//   Egresos   the other side of the ledger.
//
// Every figure comes from the database views, never from arithmetic done here,
// so a number on screen can always be traced back to rows.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { cuotaDelPlan } from '@/lib/financing';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Kpi, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import Estados from './Estados';
import Comprobantes, { type Account } from './Comprobantes';
import Gestion from './Gestion';
import RegistrarCobroDialog from './RegistrarCobro';
import Tesoreria, {
  CuentaSelect,
  Directorio,
  useTesoreria,
  type ContactKind,
  type TreasuryAccount,
} from './Tesoreria';
import { GroupedBars, Legend, SERIES } from '@/features/admin/analitica/Charts';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import {
  ScopeBar,
  scopeCurrency,
  scopeLabel,
  type ProjectScope,
} from '@/features/admin/ui/scope';
import type { AdminProject } from '@/features/admin/lib/project-types';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { useToast } from '@/features/admin/ui/toast';
import {
  ACCOUNT_KIND_LABEL,
  EXPENSE_ACCOUNT,
  EXPENSE_CATEGORIES,
  EXPENSE_LABEL,
  dateLabel,
  downloadCsv,
  mesFin,
  monthLabel,
  monthStartIso,
  toCsv,
  todayIso,
  type AccountStatus,
  type Currency,
  type Expense,
  type ExpenseCategory,
  type Installment,
  type LedgerAccount,
  type LedgerLine,
  type MonthlyCashflow,
  type CobroPorVia,
  type CobroTarget,
  type PaymentRow,
  type SaleWithoutPlan,
} from './types';

type Tab =
  | 'resumen'
  | 'cobrar'
  | 'egresos'
  | 'bancos'
  | 'directorio'
  | 'libro'
  | 'estados'
  | 'comprobantes'
  | 'gestion';

/**
 * Cómo se llama cada vía de cobro en pantalla.
 *
 * Son las mismas etiquetas que `private.forma_de_pago()` escribe en la glosa
 * del libro, para que el filtro por forma encuentre lo que el asiento dice.
 */
const FORMA_DE_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  manual_qr: 'QR / transferencia',
  banco_ganadero: 'Banco Ganadero',
  bnb: 'BNB',
};

/** Quién puede aparecer como contraparte de un egreso: un cliente no. */
const EXPENSE_CONTACT_KINDS: { contactKinds: ContactKind[] } = {
  contactKinds: ['proveedor', 'empleado', 'otro'],
};

/** Filas de «sin plan» que se muestran sin buscar. */
const SIN_PLAN_VISIBLES = 25;

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'cobrar', label: 'Por cobrar' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'bancos', label: 'Bancos y caja' },
  { id: 'directorio', label: 'Directorio' },
  { id: 'libro', label: 'Libro' },
  { id: 'estados', label: 'Estados' },
  { id: 'comprobantes', label: 'Comprobantes' },
  { id: 'gestion', label: 'Gestión' },
];

export default function AccountingClient({
  projectId,
  projects,
  initialTab,
}: {
  /** La urbanización activa en la barra: valor inicial del filtro. */
  projectId: string;
  projects: AdminProject[];
  initialTab: Tab;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  // Terrenalv S.R.L. es UNA empresa con varias urbanizaciones, así que sus
  // libros son los de la empresa entera. Por eso arranca consolidado: mostrar
  // solo una urbanización daría un balance que no es el de la sociedad.
  const [scope, setScope] = useState<ProjectScope>(projects.length > 1 ? null : projectId);
  const currency: Currency = scopeCurrency(scope, projects);
  const projectName = scopeLabel(scope, projects);
  const consolidado = scope === null && projects.length > 1;

  /** Los comprobantes y el cierre escriben en UNA gestión: no existe un
   *  comprobante "de todas las urbanizaciones". */
  const escrituraBloqueada = scope === null && projects.length > 1;

  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [cashflow, setCashflow] = useState<MonthlyCashflow[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [noPlan, setNoPlan] = useState<SaleWithoutPlan[]>([]);
  const [tesoreria, setTesoreria] = useState<TreasuryAccount[]>([]);

  const [onlyLate, setOnlyLate] = useState(false);
  const [detail, setDetail] = useState<AccountStatus | null>(null);
  const [cuotas, setCuotas] = useState<Installment[] | null>(null);
  const [pagos, setPagos] = useState<PaymentRow[] | null>(null);
  const [planFor, setPlanFor] = useState<SaleWithoutPlan | null>(null);
  const [payFor, setPayFor] = useState<CobroTarget | null>(null);
  const [buscarSinPlan, setBuscarSinPlan] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(false);

  // Libro: the contador works in periods, so this has its own date range and
  // loads on demand rather than dragging every journal line into the page.
  const [desde, setDesde] = useState(monthStartIso);
  const [hasta, setHasta] = useState(todayIso);
  const [mayor, setMayor] = useState<LedgerAccount[] | null>(null);
  const [diario, setDiario] = useState<LedgerLine[] | null>(null);
  // Segregar el libro por cliente y por centro de costos. '__sin__' en el
  // centro trae lo que no carga a ninguno, que es justo lo que hay que
  // repartir cuando se cierra el mes.
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [centroFiltro, setCentroFiltro] = useState('');
  const [libroBusy, setLibroBusy] = useState(false);
  /** Set by clicking a row of the libro mayor: shows only that account. */
  const [cuentaFiltro, setCuentaFiltro] = useState<string | null>(null);
  // Filtro por forma de pago. Va sobre la glosa porque el libro ya la lleva
  // escrita ("Cobro de cuota por Efectivo — ..."): filtrar por ahí es leer lo
  // mismo que el contador ve en el asiento, no una condición aparte que
  // podría contradecirlo.
  const [formaFiltro, setFormaFiltro] = useState<string | null>(null);
  const [cobros, setCobros] = useState<CobroPorVia[]>([]);

  // El plan de cuentas lo usan el editor de comprobantes y la pestaña de
  // gestión, así que se carga una vez acá y no dos veces abajo. Se llama
  // `plan` y no `accounts` porque `accounts` ya son las cuentas por cobrar.
  const [plan, setPlan] = useState<Account[]>([]);
  const loadPlan = useCallback(async () => {
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('code, name, kind, is_active, is_system')
      .order('sort_order');
    setPlan((data ?? []) as unknown as Account[]);
  }, [supabase]);
  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  /** Un solo lugar decide el alcance de TODAS las consultas de la pantalla: si
   *  una vista se filtrara y otra no, los totales no cuadrarían entre sí. */
  const alcance = useCallback(
    <T,>(q: T): T => {
      if (scope === null) return q;
      return (q as unknown as { eq: (c: string, v: string) => T }).eq('project_id', scope);
    },
    [scope],
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [accRes, cfRes, expRes, resRes, tesRes, viaRes] = await Promise.all([
      alcance(supabase.from('v_account_status').select('*')),
      alcance(supabase.from('v_monthly_cashflow').select('*'))
        .order('mes', { ascending: false })
        .limit(24),
      alcance(
        supabase
          .from('expenses')
          .select('id, incurred_on, category, description, supplier, amount, currency, amount_bob, note, created_at, project_id'),
      )
        .is('deleted_at', null)
        .order('incurred_on', { ascending: false })
        .limit(1000),
      // Ventas sin plan, desde v_ventas y PAGINADO: son 1.400+ filas migradas y
      // PostgREST corta en 1.000 — sin paginar, un tercio desaparecía en
      // silencio de esta lista.
      (async () => {
        const filas: Record<string, unknown>[] = [];
        for (let desde = 0; ; desde += 1000) {
          const { data: pagina } = await alcance(
            supabase.from('v_ventas').select('*').eq('con_plan', false),
          )
            .order('saldo', { ascending: false })
            .range(desde, desde + 999);
          filas.push(...((pagina ?? []) as Record<string, unknown>[]));
          if (!pagina || pagina.length < 1000) break;
        }
        return { data: filas };
      })(),
      supabase.from('v_tesoreria_saldos').select('*').eq('is_active', true).order('name'),
      alcance(supabase.from('v_an_cobros_por_via').select('*')),
    ]);

    const acc = (accRes.data ?? []) as unknown as AccountStatus[];
    setAccounts(acc);
    setCashflow((cfRes.data ?? []) as unknown as MonthlyCashflow[]);
    setExpenses((expRes.data ?? []) as unknown as Expense[]);
    setTesoreria((tesRes.data ?? []) as unknown as TreasuryAccount[]);
    setCobros((viaRes.data ?? []) as unknown as CobroPorVia[]);

    const sales = ((resRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.reservation_id as string,
      project_id: r.project_id as string,
      tracking_code: r.tracking_code as string,
      buyer_full_name: r.buyer_full_name as string,
      buyer_phone: (r.buyer_phone as string) ?? '',
      price_agreed: Number(r.price_agreed),
      currency: (r.currency as Currency) ?? 'BOB',
      confirmed_at: (r.fecha_venta as string) ?? null,
      manzana: (r.manzana as string) ?? '—',
      lote: (r.lote as string) ?? '—',
      saldo: Number(r.saldo ?? 0),
      migrada: Boolean(r.migrada),
    } satisfies SaleWithoutPlan));
    setNoPlan(sales);
    setLoading(false);
  }, [supabase, alcance]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // ---- Derived totals. Sums of view rows, not re-derived business logic. ----
  const active = accounts.filter((a) => a.plan_status === 'activo');
  const totals = {
    porCobrar: active.reduce((s, a) => s + Number(a.saldo), 0),
    vencido: active.reduce((s, a) => s + Number(a.monto_vencido), 0),
    morosos: active.filter((a) => Number(a.cuotas_vencidas) > 0).length,
    planes: active.length,
  };
  const thisMonth = cashflow[0];

  // Donde esta la plata hoy y en que se esta yendo. Se calcula aca y no en la
  // base porque son sumas de filas que la pagina ya tiene cargadas.
  const disponible = tesoreria.reduce((s, t) => s + Number(t.saldo), 0);

  // Las cifras de arriba son acumuladas de toda la vida del proyecto, asi que
  // el libro que abren tiene que arrancar donde arrancaron los movimientos: si
  // abriera en el mes corriente, la lista no sumaria lo que dice el tile.
  // Indicadores que un dueno mira antes que cualquier tabla.
  //
  // Cobertura de caja: cuantos meses aguanta la operacion con lo que hay en el
  // banco, al ritmo de gasto de los ultimos meses. Es la pregunta que de verdad
  // importa cuando se decide si arrancar una obra o esperar.
  const indicadores = useMemo(() => {
    const meses = cashflow.slice(0, 6);
    const egresoMedio = meses.length
      ? meses.reduce((a, m) => a + Number(m.egresos_bob), 0) / meses.length
      : 0;
    const ingresoMes = Number(cashflow[0]?.ingresos_bob ?? 0);
    const egresoMes = Number(cashflow[0]?.egresos_bob ?? 0);
    return {
      egresoMedio,
      // Null en dos casos, y los dos importan: sin gasto conocido no hay ritmo
      // que proyectar, y sin bancos cargados el disponible es 0 — mostrar
      // "0 meses" en rojo ahi seria una alarma falsa por un dato que falta,
      // no por plata que falta.
      cobertura: egresoMedio > 0 && tesoreria.length > 0 ? disponible / egresoMedio : null,
      sinCuentas: tesoreria.length === 0,
      margen: ingresoMes > 0 ? ((ingresoMes - egresoMes) / ingresoMes) * 100 : null,
      moraPct: totals.porCobrar > 0 ? (totals.vencido / totals.porCobrar) * 100 : 0,
    };
  }, [cashflow, disponible, tesoreria.length, totals.porCobrar, totals.vencido]);

  // Egresos de los ultimos meses, abiertos por categoria: sirve para ver si una
  // categoria se esta disparando, cosa que el total acumulado esconde.
  const tendencia = useMemo(() => {
    const porMes = new Map<string, Record<string, number>>();
    for (const e of expenses) {
      const mes = `${e.incurred_on.slice(0, 7)}-01`;
      const fila = porMes.get(mes) ?? {};
      fila[e.category] = (fila[e.category] ?? 0) + Number(e.amount_bob);
      porMes.set(mes, fila);
    }
    const meses = [...porMes.keys()].sort().slice(-6);
    // Solo las categorias con movimiento, y como mucho seis: la paleta tiene
    // seis colores y mas series en un grafico agrupado no se leen.
    const usadas = EXPENSE_CATEGORIES.filter((c) =>
      meses.some((m) => (porMes.get(m)?.[c] ?? 0) > 0),
    ).slice(0, SERIES.length);
    return {
      data: meses.map((m) => ({ label: monthLabel(m), values: porMes.get(m) ?? {} })),
      series: usadas.map((c, i) => ({ key: c, label: EXPENSE_LABEL[c], color: SERIES[i] })),
    };
  }, [expenses]);

  // Cómo entró la plata. El efectivo hay que arquearlo y depositarlo; el QR
  // tiene que aparecer en el extracto del banco. Sin separarlos no se puede
  // cuadrar la caja.
  const porForma = useMemo(() => {
    const m = new Map<string, { total: number; cobros: number }>();
    for (const c of cobros) {
      const a = m.get(c.forma) ?? { total: 0, cobros: 0 };
      a.total += Number(c.total_bob);
      a.cobros += Number(c.cobros);
      m.set(c.forma, a);
    }
    const rows = [...m.entries()]
      .map(([forma, v]) => ({ forma, ...v }))
      .sort((a, b) => b.total - a.total);
    return { rows, total: rows.reduce((a, r) => a + r.total, 0) };
  }, [cobros]);

  const desdeTodo =
    [
      ...expenses.map((e) => e.incurred_on),
      ...cashflow.map((m) => m.mes),
      ...tesoreria.map((t) => t.opening_date).filter((d): d is string => !!d),
    ].sort()[0] ?? monthStartIso();
  const porCategoria = useMemo(() => {
    const m = new Map<ExpenseCategory, number>();
    for (const e of expenses) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount_bob));
    const rows = [...m.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => r.total));
    return { rows, max };
  }, [expenses]);

  // 1.400+ filas sin plan: se listan las de mayor saldo y el resto por
  // búsqueda — una lista completa acá sería scroll infinito sin uso.
  const sinPlanFiltradas = useMemo(() => {
    const q = buscarSinPlan.trim().toLowerCase();
    if (!q) return noPlan;
    return noPlan.filter(
      (s) =>
        s.buyer_full_name.toLowerCase().includes(q) ||
        s.tracking_code.toLowerCase().includes(q) ||
        `${s.manzana}-${s.lote}`.toLowerCase().includes(q),
    );
  }, [noPlan, buscarSinPlan]);
  const sinPlanVisibles = sinPlanFiltradas.slice(0, SIN_PLAN_VISIBLES);

  const cobrarRows = (onlyLate ? active.filter((a) => Number(a.cuotas_vencidas) > 0) : active).sort(
    (a, b) => Number(b.monto_vencido) - Number(a.monto_vencido) || Number(b.saldo) - Number(a.saldo),
  );

  async function openDetail(a: AccountStatus) {
    setDetail(a);
    setCuotas(null);
    setPagos(null);
    const [cRes, pRes] = await Promise.all([
      supabase
        .from('installments')
        .select('id, number, due_date, amount, amount_paid, status, paid_at')
        .eq('plan_id', a.plan_id)
        .order('number'),
      supabase
        .from('payments')
        .select('id, reference_code, amount, currency, purpose, provider, verified_at, status')
        .eq('reservation_id', a.reservation_id)
        .eq('status', 'aprobado')
        .order('verified_at', { ascending: false }),
    ]);
    setCuotas((cRes.data ?? []) as unknown as Installment[]);
    setPagos((pRes.data ?? []) as unknown as PaymentRow[]);
  }




  const loadLibro = useCallback(async () => {
    setLibroBusy(true);
    const [mRes, dRes] = await Promise.all([
      alcance(supabase.from('v_libro_mayor').select('*')).order('sort_order'),
      alcance(
        supabase
          .from('v_libro_diario')
          .select(
            'fecha, comprobante, glosa, cuenta, debe, haber, origen, origen_id, ' +
              'cliente_ci, cliente, centro_costo_id, centro_costo, titular, titular_nombre',
          ),
      )
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha')
        .limit(5000),
    ]);
    setMayor((mRes.data ?? []) as unknown as LedgerAccount[]);
    setDiario((dRes.data ?? []) as unknown as LedgerLine[]);
    setLibroBusy(false);
  }, [supabase, alcance, desde, hasta]);

  useEffect(() => {
    if (tab === 'libro') void loadLibro();
  }, [tab, loadLibro]);

  /** Open the libro on a given period, optionally narrowed to one account. */
  function abrirLibro(
    desdeIso?: string,
    hastaIso?: string,
    cuenta?: string | null,
    forma?: string | null,
  ) {
    if (desdeIso) setDesde(desdeIso);
    if (hastaIso) setHasta(hastaIso);
    setCuentaFiltro(cuenta ?? null);
    setFormaFiltro(forma ?? null);
    setTab('libro');
  }

  // The libro mayor row you clicked narrows the diario below it, so the two
  // halves of the screen always agree.
  // Coincidencia por prefijo, no exacta: filtrar por 1111 tiene que traer
  // tambien 1111.01 y 1111.02, que son las cuentas de cada banco y cada caja.
  // Con igualdad estricta, el KPI de caja abriria un libro vacio.
  const diarioFiltrado = (diario ?? []).filter(
    (l) =>
      (!cuentaFiltro || l.cuenta === cuentaFiltro || l.cuenta.startsWith(`${cuentaFiltro}.`)) &&
      (!formaFiltro || l.glosa.includes(`por ${formaFiltro}`)) &&
      (!clienteFiltro || l.cliente_ci === clienteFiltro) &&
      (!centroFiltro ||
        (centroFiltro === '__sin__' ? !l.centro_costo_id : l.centro_costo_id === centroFiltro)),
  );

  // Con que se puede segregar el libro, sacado de lo que el libro mismo trae:
  // si manana hay un centro nuevo aparece solo, sin tocar codigo.
  const clientesDelLibro = Array.from(
    new Map(
      (diario ?? [])
        .filter((l) => l.cliente_ci)
        .map((l) => [l.cliente_ci as string, l.cliente ?? l.cliente_ci] as [string, string]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const centrosDelLibro = Array.from(
    new Map(
      (diario ?? [])
        .filter((l) => l.centro_costo_id)
        .map((l) => [l.centro_costo_id as string, l.centro_costo ?? '—'] as [string, string]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1]));



  async function deleteExpense(e: Expense) {
    const note = window.prompt(`Motivo para eliminar "${e.description}":`);
    if (!note?.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_delete_expense', {
      p_expense_id: e.id,
      p_note: note.trim(),
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Egreso eliminado.', 'success');
    void fetchAll();
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
          <h1 className="text-lg font-bold text-stone-900">Contabilidad</h1>
          <p className="text-xs text-stone-500">
            {projectName}
            {consolidado ? ' · libros de la empresa' : ''}
          </p>
        </div>
        <div className="ml-auto flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-brand text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ScopeBar projects={projects} scope={scope} onScope={setScope} />

      {/* ------------------------------- RESUMEN ------------------------------ */}
      {tab === 'resumen' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Por cobrar"
              value={formatMoney(totals.porCobrar, currency)}
              hint={`${totals.planes} plan(es) activo(s) — ver`}
              onClick={() => {
                setOnlyLate(false);
                setTab('cobrar');
              }}
            />
            <Kpi
              label="Vencido"
              value={formatMoney(totals.vencido, currency)}
              hint={`${totals.morosos} cliente(s) atrasado(s) — ver`}
              tone={totals.vencido > 0 ? 'bad' : 'normal'}
              onClick={() => {
                // Opens the list ALREADY filtered to who is late: the tile's
                // number and the list have to agree.
                setOnlyLate(true);
                setTab('cobrar');
              }}
            />
            <Kpi
              label="Ingresos del mes"
              value={formatMoney(Number(thisMonth?.ingresos_bob ?? 0), 'BOB')}
              hint={`${thisMonth ? monthLabel(thisMonth.mes) : 'sin movimientos'} — ver detalle`}
              tone="good"
              onClick={() => abrirLibro(monthStartIso(), todayIso(), '1111')}
            />
            <Kpi
              label="Resultado del mes"
              value={formatMoney(Number(thisMonth?.resultado_bob ?? 0), 'BOB')}
              hint="ingresos menos egresos — ver detalle"
              tone={Number(thisMonth?.resultado_bob ?? 0) < 0 ? 'bad' : 'good'}
              onClick={() => abrirLibro(monthStartIso(), todayIso(), null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Cobertura de caja"
              value={
                indicadores.cobertura === null
                  ? '—'
                  : `${indicadores.cobertura.toFixed(1)} meses`
              }
              hint={
                indicadores.sinCuentas
                  ? 'cargá los bancos y cajas para verlo'
                  : indicadores.cobertura === null
                    ? 'sin egresos para proyectar'
                    : `al ritmo de ${formatMoney(Math.round(indicadores.egresoMedio), 'BOB')}/mes`
              }
              tone={
                indicadores.cobertura !== null && indicadores.cobertura < 3 ? 'bad' : 'normal'
              }
              onClick={() => setTab('bancos')}
            />
            <Kpi
              label="Margen del mes"
              value={indicadores.margen === null ? '—' : `${indicadores.margen.toFixed(0)}%`}
              hint={
                indicadores.margen === null
                  ? 'sin ingresos este mes'
                  : 'de cada Bs cobrado, lo que queda'
              }
              tone={
                indicadores.margen === null ? 'normal' : indicadores.margen < 0 ? 'bad' : 'good'
              }
              onClick={() => abrirLibro(monthStartIso(), todayIso(), null)}
            />
            <Kpi
              label="Cartera vencida"
              value={`${indicadores.moraPct.toFixed(0)}%`}
              hint="del total por cobrar"
              tone={indicadores.moraPct > 15 ? 'bad' : 'normal'}
              onClick={() => {
                setOnlyLate(true);
                setTab('cobrar');
              }}
            />
            <Kpi
              label="Egresos del mes"
              value={formatMoney(Number(cashflow[0]?.egresos_bob ?? 0), 'BOB')}
              hint={
                indicadores.egresoMedio > 0
                  ? `promedio ${formatMoney(Math.round(indicadores.egresoMedio), 'BOB')}`
                  : 'sin historial para comparar'
              }
              tone={
                Number(cashflow[0]?.egresos_bob ?? 0) > indicadores.egresoMedio * 1.5 &&
                indicadores.egresoMedio > 0
                  ? 'bad'
                  : 'normal'
              }
              onClick={() => setTab('egresos')}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  Donde esta la plata
                </h2>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-stone-500 hover:text-brand hover:underline
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                  onClick={() => setTab('bancos')}
                >
                  Bancos y caja &rsaquo;
                </button>
              </div>
              {tesoreria.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">
                  Todavia no hay bancos ni cajas cargados, asi que todo el efectivo aparece junto en
                  una sola cuenta.{' '}
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-brand hover:underline
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                    onClick={() => setTab('bancos')}
                  >
                    Cargalos aca
                  </button>{' '}
                  y cada cobro y cada egreso va a decir por donde paso.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900">
                    {formatMoney(disponible, currency)}
                  </p>
                  <p className="mb-3 text-xs text-stone-400">
                    disponible en {tesoreria.length} cuenta(s)
                  </p>
                  <ul className="space-y-1">
                    {tesoreria.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => abrirLibro(t.opening_date ?? desdeTodo, todayIso(), t.account_code)}
                          className="flex w-full cursor-pointer items-center justify-between gap-3
                                     rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-50
                                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                        >
                          <span className="truncate text-stone-700">{t.name}</span>
                          <span
                            className={`shrink-0 font-semibold tabular-nums ${
                              Number(t.saldo) < 0 ? 'text-red-600' : 'text-stone-900'
                            }`}
                          >
                            {formatMoney(Number(t.saldo), t.currency)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  Cómo entró la plata
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">
                    {formatMoney(porForma.total, 'BOB')}
                  </span>
                  <ExportButtons
                    disabled={!cobros.length}
                    meta={{
                      title: 'Cobros por Vía y Tipo',
                      subtitle: projectName,
                      filename: `cobros-clasificados-${new Date().toISOString().slice(0, 10)}`,
                      footnote:
                        'Cada cobro aprobado, clasificado por mes, tipo (seña / cuota / abono) y forma de pago. Bolivianos.',
                    }}
                    columns={[
                      { header: 'Mes' },
                      { header: 'Tipo' },
                      { header: 'Forma de pago' },
                      { header: 'Cobros', align: 'right' },
                      { header: 'Total', align: 'right' },
                    ]}
                    rows={() =>
                      [...cobros]
                        .sort((a, b) => b.mes.localeCompare(a.mes) || b.total_bob - a.total_bob)
                        .map((c) => [
                          monthLabel(c.mes),
                          c.purpose === 'cuota' ? 'Cuota' : c.purpose === 'abono' ? 'Abono' : c.purpose === 'comision' ? 'Comisión' : 'Seña',
                          c.forma,
                          fnum(Number(c.cobros), 0),
                          fnum(Number(c.total_bob)),
                        ]) as XCell[][]
                    }
                  />
                </div>
              </div>
              <p className="mt-1 mb-3 text-xs text-stone-400">
                El efectivo hay que arquearlo y depositarlo; el QR tiene que aparecer en el
                extracto. Clic para ver esos cobros en el libro.
              </p>
              {porForma.rows.length === 0 ? (
                <p className="text-sm text-stone-500">Todavía no hay cobros aprobados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {porForma.rows.map((f) => (
                    <li key={f.forma}>
                      <button
                        type="button"
                        onClick={() => abrirLibro(desdeTodo, todayIso(), null, f.forma)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1
                                   text-left text-sm hover:bg-stone-50
                                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                      >
                        <span className="w-36 shrink-0 truncate text-stone-600">{f.forma}</span>
                        <span className="relative h-4 flex-1 overflow-hidden rounded bg-stone-100">
                          <span
                            className="absolute inset-y-0 left-0 rounded bg-brand"
                            style={{
                              width: `${Math.max(1.5, (f.total / Math.max(1, porForma.total)) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="w-16 shrink-0 text-right text-xs text-stone-400">
                          {f.cobros} cobro{f.cobros === 1 ? '' : 's'}
                        </span>
                        <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-stone-800">
                          {formatMoney(f.total, 'BOB')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  En que se va la plata
                </h2>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-stone-500 hover:text-brand hover:underline
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                  onClick={() => setTab('egresos')}
                >
                  Egresos &rsaquo;
                </button>
              </div>
              <p className="mt-1 mb-3 text-xs text-stone-400">
                Total acumulado por categoria. Clic para ver los asientos.
              </p>
              {porCategoria.rows.length === 0 ? (
                <p className="text-sm text-stone-500">Todavia no hay egresos registrados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {porCategoria.rows.map((c) => (
                    <li key={c.category}>
                      <button
                        type="button"
                        onClick={() => abrirLibro(desdeTodo, todayIso(), EXPENSE_ACCOUNT[c.category])}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1
                                   text-left text-sm hover:bg-stone-50
                                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                      >
                        <span className="w-28 shrink-0 truncate text-stone-600">
                          {EXPENSE_LABEL[c.category]}
                        </span>
                        <span className="relative h-4 flex-1 overflow-hidden rounded bg-stone-100">
                          <span
                            className="absolute inset-y-0 left-0 rounded bg-brand-light"
                            style={{ width: `${Math.max(1.5, (c.total / porCategoria.max) * 100)}%` }}
                          />
                        </span>
                        <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-stone-800">
                          {formatMoney(c.total, 'BOB')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Ingresos y egresos por mes
              </h2>
              <ExportButtons
                disabled={!cashflow.length}
                meta={{
                  title: 'Ingresos y Egresos por Mes',
                  subtitle: projectName,
                  filename: `ingresos-egresos-${new Date().toISOString().slice(0, 10)}`,
                  footnote: 'Ingresos: solo pagos aprobados, fechados al verificarse. Bolivianos.',
                }}
                columns={[
                  { header: 'Mes' },
                  { header: 'Ingresos', align: 'right' },
                  { header: 'Egresos', align: 'right' },
                  { header: 'Resultado', align: 'right' },
                ]}
                rows={() =>
                  cashflow.map((m) => [
                    monthLabel(m.mes),
                    fnum(Number(m.ingresos_bob)),
                    fnum(Number(m.egresos_bob)),
                    fnum(Number(m.resultado_bob)),
                  ]) as XCell[][]
                }
              />
            </div>
            {cashflow.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">
                Todavía no hay movimientos registrados.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-150 text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-stone-500">Mes</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-stone-500">Ingresos</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-stone-500">Egresos</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-stone-500">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.map((m) => (
                      <tr
                        key={m.mes}
                        onClick={() => abrirLibro(m.mes, mesFin(m.mes), null)}
                        className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50"
                      >
                        <td className="px-4 py-2 font-medium text-stone-800">
                          <button
                            type="button"
                            className="cursor-pointer text-left hover:text-brand hover:underline
                                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                          >
                            {monthLabel(m.mes)}
                          </button>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-brand">
                          {formatMoney(Number(m.ingresos_bob), 'BOB')}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-600">
                          {formatMoney(Number(m.egresos_bob), 'BOB')}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold tabular-nums ${
                            Number(m.resultado_bob) < 0 ? 'text-red-600' : 'text-stone-900'
                          }`}
                        >
                          {formatMoney(Number(m.resultado_bob), 'BOB')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
              Los ingresos cuentan solo pagos aprobados, en la fecha en que se verificaron (hora de
              Bolivia). Un comprobante sin revisar todavía no es ingreso.
            </p>
          </section>
        </div>
      ) : null}

      {/* ------------------------------ POR COBRAR ---------------------------- */}
      {tab === 'cobrar' ? (
        <div className="space-y-5">
          {noPlan.length > 0 ? (
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-bold text-stone-900">
                  {noPlan.length} venta(s) sin plan de cuotas
                </h2>
                <input
                  value={buscarSinPlan}
                  onChange={(e) => setBuscarSinPlan(e.target.value)}
                  placeholder="Buscar por nombre, código o lote"
                  className={`${inputClass} ml-auto w-auto min-w-60`}
                />
              </div>
              <p className="mt-1 text-xs text-stone-500">
                En su mayoría migradas del sistema anterior: su cronograma vive allá, pero acá se
                les puede <strong>registrar abonos</strong> (bajan el saldo) o crearles un plan de
                cuotas propio. Ordenadas por saldo.
              </p>
              <ul className="mt-3 space-y-2">
                {sinPlanVisibles.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2"
                  >
                    <span className="font-mono text-xs font-semibold text-stone-700">{s.tracking_code}</span>
                    <span className="text-sm text-stone-800">{s.buyer_full_name}</span>
                    <span className="text-xs text-stone-500">
                      Mz {s.manzana}, Lote {s.lote}
                      {s.migrada ? ' · migrada' : ''}
                    </span>
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        s.saldo > 0 ? 'text-red-600' : 'text-brand'
                      }`}
                    >
                      {s.saldo > 0 ? `Debe ${formatMoney(s.saldo, s.currency)}` : 'Al día'}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() =>
                          setPayFor({
                            reservation_id: s.id,
                            project_id: s.project_id,
                            tracking_code: s.tracking_code,
                            buyer_full_name: s.buyer_full_name,
                            buyer_phone: s.buyer_phone,
                            saldo: s.saldo,
                            currency: s.currency,
                            monto_sugerido: null,
                            tiene_plan: false,
                          })
                        }
                      >
                        Registrar abono
                      </button>
                      <button type="button" className={btnSecondary} onClick={() => setPlanFor(s)}>
                        Crear plan
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {sinPlanFiltradas.length > SIN_PLAN_VISIBLES ? (
                <p className="mt-2 text-xs text-stone-400">
                  Mostrando {SIN_PLAN_VISIBLES} de {sinPlanFiltradas.length} — refiná la búsqueda
                  para ver el resto. El total y el CSV de ventas los tiene la pantalla de Ventas.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Cuentas por cobrar
              </h2>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={onlyLate}
                  onChange={(e) => setOnlyLate(e.target.checked)}
                  className="accent-brand"
                />
                Solo atrasados
              </label>
              <div className="ml-auto">
                <ExportButtons
                  disabled={!cobrarRows.length}
                  orientation="landscape"
                  meta={{
                    title: onlyLate ? 'Clientes Atrasados' : 'Cuentas por Cobrar',
                    subtitle: projectName,
                    filename: `por-cobrar-${new Date().toISOString().slice(0, 10)}`,
                    footnote: 'Saldo = cuotas pendientes. Días de atraso desde la cuota más vieja impaga.',
                  }}
                  columns={[
                    { header: 'Código' },
                    { header: 'Cliente' },
                    { header: 'CI' },
                    { header: 'Teléfono' },
                    { header: 'Lote' },
                    { header: 'Saldo', align: 'right' },
                    { header: 'Cuotas' },
                    { header: 'Vencidas', align: 'right' },
                    { header: 'Atraso', align: 'right' },
                  ]}
                  rows={() =>
                    cobrarRows.map((a) => [
                      a.tracking_code,
                      a.buyer_full_name,
                      a.buyer_ci,
                      a.buyer_phone,
                      `Mz ${a.manzana}-${a.lote}`,
                      fnum(Number(a.saldo)),
                      `${a.cuotas_pagadas}/${a.cuotas_totales}`,
                      fnum(Number(a.monto_vencido)),
                      a.dias_atraso ? `${a.dias_atraso} d` : '—',
                    ]) as XCell[][]
                  }
                />
              </div>
            </div>

            {cobrarRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-400">
                {onlyLate ? 'Nadie está atrasado. Todo al día.' : 'Todavía no hay planes de pago activos.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-200 text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cliente</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Saldo</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-stone-500">Cuotas</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Próxima</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Atraso</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {cobrarRows.map((a) => (
                      <tr key={a.plan_id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                        <td className="px-4 py-2">
                          <p className="font-medium text-stone-900">{a.buyer_full_name}</p>
                          <p className="font-mono text-xs text-stone-400">{a.tracking_code}</p>
                        </td>
                        <td className="px-3 py-2 text-stone-600">
                          Mz {a.manzana}, {a.lote}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-900">
                          {formatMoney(Number(a.saldo), a.currency)}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-stone-600">
                          {a.cuotas_pagadas}/{a.cuotas_totales}
                        </td>
                        <td className="px-3 py-2 text-stone-600">{dateLabel(a.proxima_cuota)}</td>
                        <td className="px-3 py-2">
                          {Number(a.cuotas_vencidas) > 0 ? (
                            <Badge className="bg-red-100 text-red-700">
                              {a.cuotas_vencidas} · {formatMoney(Number(a.monto_vencido), a.currency)} ·{' '}
                              {a.dias_atraso}d
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-700">Al día</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button type="button" className={btnSecondary} onClick={() => void openDetail(a)}>
                              Estado de cuenta
                            </button>
                            <button
                              type="button"
                              className={btnPrimary}
                              onClick={() =>
                                setPayFor({
                                  reservation_id: a.reservation_id,
                                  project_id: a.project_id,
                                  tracking_code: a.tracking_code,
                                  buyer_full_name: a.buyer_full_name,
                                  buyer_phone: a.buyer_phone,
                                  saldo: Number(a.saldo),
                                  currency: a.currency,
                                  monto_sugerido: Number(a.monthly_amount),
                                  tiene_plan: true,
                                })
                              }
                            >
                              Registrar pago
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* -------------------------------- EGRESOS ----------------------------- */}
      {tab === 'egresos' ? (
        <div className="space-y-5">
        {tendencia.series.length ? (
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Egresos por mes y categoría
            </h2>
            <p className="mt-1 mb-3 text-xs text-stone-400">
              Últimos {tendencia.data.length} mes(es). El total acumulado esconde una categoría que
              se dispara; acá se ve.
            </p>
            <Legend items={tendencia.series.map((x) => ({ label: x.label, color: x.color }))} />
            <GroupedBars
              data={tendencia.data}
              series={tendencia.series}
              format={(n) => formatMoney(n, 'BOB')}
            />
          </section>
        ) : null}

        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Egresos</h2>
            <div className="ml-auto">
              <ExportButtons
                disabled={!expenses.length}
                meta={{
                  title: 'Egresos',
                  subtitle: projectName,
                  filename: `egresos-${new Date().toISOString().slice(0, 10)}`,
                }}
                columns={[
                  { header: 'Fecha' },
                  { header: 'Categoría' },
                  { header: 'Detalle' },
                  { header: 'Proveedor' },
                  { header: 'Monto', align: 'right' },
                ]}
                rows={() =>
                  expenses.map((e) => [
                    dateLabel(e.incurred_on),
                    EXPENSE_LABEL[e.category],
                    e.description,
                    e.supplier ?? '',
                    fnum(Number(e.amount)),
                  ]) as XCell[][]
                }
              />
            </div>
            <button type="button" className={btnPrimary} onClick={() => setExpenseOpen(true)}>
              Nuevo egreso
            </button>
          </div>
          {expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-400">Todavía no hay egresos cargados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-175 text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Categoría</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Detalle</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Proveedor</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                      <td className="px-4 py-2 text-stone-600">{dateLabel(e.incurred_on)}</td>
                      <td className="px-3 py-2">
                        <Badge className="bg-stone-100 text-stone-700">{EXPENSE_LABEL[e.category]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-stone-800">{e.description}</td>
                      <td className="px-3 py-2 text-stone-500">{e.supplier ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-900">
                        {formatMoney(Number(e.amount), e.currency)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {/* Un egreso sin comprobante es plata que salió y nadie
                            firmó. Se emite desde acá, con las firmas al pie. */}
                        <a
                          href={`/admin/egreso/${e.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mr-2 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                        >
                          Comprobante
                        </a>
                        <button
                          type="button"
                          className={btnSecondary}
                          disabled={busy}
                          onClick={() => void deleteExpense(e)}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </div>
      ) : null}

      {/* --------------------------------- LIBRO ------------------------------ */}
      {tab === 'libro' ? (
        <div className="space-y-5">
          <p className="rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-500">
            Libro diario y mayor. Cada venta confirmada, cada cobro aprobado y cada egreso se
            proyecta solo en dos líneas que suman cero, y a eso se suman los comprobantes que se
            cargan a mano en la pestaña <strong>Comprobantes</strong>. Cada banco y cada caja tiene
            su propia cuenta, así que el saldo de una cuenta acá es el que se compara contra el
            extracto.
          </p>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Libro mayor — saldos por cuenta
              </h2>
              <div className="ml-auto">
                <ExportButtons
                  disabled={!mayor?.length}
                  meta={{
                    title: 'Libro Mayor',
                    subtitle: projectName,
                    filename: `libro-mayor-${new Date().toISOString().slice(0, 10)}`,
                    footnote: 'Saldos: activo y gasto por el debe; pasivo, patrimonio e ingreso por el haber.',
                  }}
                  columns={[
                    { header: 'Cuenta' },
                    { header: 'Nombre' },
                    { header: 'Tipo' },
                    { header: 'Debe', align: 'right' },
                    { header: 'Haber', align: 'right' },
                    { header: 'Saldo', align: 'right' },
                  ]}
                  rows={() =>
                    (mayor ?? []).map((a) => [
                      a.cuenta,
                      a.cuenta_nombre,
                      ACCOUNT_KIND_LABEL[a.tipo],
                      fnum(Number(a.debe)),
                      fnum(Number(a.haber)),
                      fnum(Number(a.saldo)),
                    ]) as XCell[][]
                  }
                />
              </div>
            </div>
            {libroBusy && !mayor ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !mayor?.length ? (
              <p className="py-8 text-center text-sm text-stone-400">
                Todavia no hay movimientos que registrar en el libro.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-175 text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left">
                      <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cuenta</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Nombre</th>
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Tipo</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Debe</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Haber</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mayor.map((a) => (
                      <tr
                        key={a.cuenta}
                        onClick={() => setCuentaFiltro(a.cuenta)}
                        className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                          cuentaFiltro === a.cuenta ? 'bg-green-50' : ''
                        }`}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-stone-600">{a.cuenta}</td>
                        <td className="px-3 py-2 text-stone-800">{a.cuenta_nombre}</td>
                        <td className="px-3 py-2">
                          <Badge className="bg-stone-100 text-stone-600">{ACCOUNT_KIND_LABEL[a.tipo]}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                          {formatMoney(Number(a.debe), 'BOB')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                          {formatMoney(Number(a.haber), 'BOB')}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          Number(a.saldo) < 0 ? 'text-red-600' : 'text-stone-900'
                        }`}>
                          {formatMoney(Number(a.saldo), 'BOB')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Libro diario
              </h2>
              {/* Segregar por cliente y por centro de costos: las dos preguntas
                  que el libro no sabia contestar. */}
              {clientesDelLibro.length ? (
                <select
                  value={clienteFiltro}
                  onChange={(e) => setClienteFiltro(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  aria-label="Filtrar por cliente"
                >
                  <option value="">Todos los clientes</option>
                  {clientesDelLibro.map(([ci, nombre]) => (
                    <option key={ci} value={ci}>
                      {nombre}
                    </option>
                  ))}
                </select>
              ) : null}
              {centrosDelLibro.length ? (
                <select
                  value={centroFiltro}
                  onChange={(e) => setCentroFiltro(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  aria-label="Filtrar por centro de costos"
                >
                  <option value="">Todos los centros</option>
                  <option value="__sin__">— sin centro asignado —</option>
                  {centrosDelLibro.map(([id, nombre]) => (
                    <option key={id} value={id}>
                      {nombre}
                    </option>
                  ))}
                </select>
              ) : null}
              {formaFiltro ? (
                <button
                  type="button"
                  onClick={() => setFormaFiltro(null)}
                  className="cursor-pointer rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800
                             hover:bg-green-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
                >
                  {formaFiltro} ✕
                </button>
              ) : null}
              {cuentaFiltro ? (
                <button
                  type="button"
                  onClick={() => setCuentaFiltro(null)}
                  className="cursor-pointer rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand
                             transition-colors hover:bg-brand/20
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  cuenta {cuentaFiltro} ✕
                </button>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-stone-500">
                Desde
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-xs text-stone-500">
                Hasta
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-sm" />
              </label>
              <div className="ml-auto">
                <ExportButtons
                  disabled={!diarioFiltrado.length}
                  orientation="landscape"
                  meta={{
                    title: 'Libro Diario',
                    subtitle: `${projectName} · ${dateLabel(desde)} a ${dateLabel(hasta)}`
                      + (cuentaFiltro ? ` · cuenta ${cuentaFiltro}` : '')
                      + (formaFiltro ? ` · ${formaFiltro}` : ''),
                    filename: `libro-diario-${desde}-a-${hasta}`,
                    footnote: 'Partida doble: cada transacción son dos líneas que suman cero.',
                  }}
                  columns={[
                    { header: 'Fecha' },
                    { header: 'Comprobante' },
                    { header: 'Glosa' },
                    { header: 'Cuenta' },
                    { header: 'Debe', align: 'right' },
                    { header: 'Haber', align: 'right' },
                  ]}
                  rows={() =>
                    [
                      ...diarioFiltrado.map((l) => [
                        dateLabel(l.fecha),
                        l.comprobante,
                        l.glosa,
                        l.cuenta,
                        Number(l.debe) > 0 ? fnum(Number(l.debe)) : '',
                        Number(l.haber) > 0 ? fnum(Number(l.haber)) : '',
                      ]),
                      [
                        '', '', 'TOTALES', '',
                        fnum(diarioFiltrado.reduce((a, l) => a + Number(l.debe), 0)),
                        fnum(diarioFiltrado.reduce((a, l) => a + Number(l.haber), 0)),
                      ],
                    ] as XCell[][]
                  }
                />
              </div>
            </div>
            {libroBusy && !diario ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !diarioFiltrado.length ? (
              <p className="py-8 text-center text-sm text-stone-400">
                {cuentaFiltro
                  ? `Sin movimientos de la cuenta ${cuentaFiltro} en el periodo elegido.`
                  : 'Sin movimientos en el periodo elegido.'}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-200 text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 bg-stone-50 text-left">
                        <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                        <th className="px-3 py-2 text-xs font-semibold text-stone-500">Comprobante</th>
                        <th className="px-3 py-2 text-xs font-semibold text-stone-500">Glosa</th>
                        <th className="px-3 py-2 text-xs font-semibold text-stone-500">Cuenta</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Debe</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Haber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diarioFiltrado.map((l, i) => (
                        <tr key={`${l.origen_id}-${l.cuenta}-${i}`} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                          <td className="px-4 py-1.5 whitespace-nowrap text-stone-600">{dateLabel(l.fecha)}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-stone-500">{l.comprobante}</td>
                          <td className="px-3 py-1.5 text-stone-800">{l.glosa}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-stone-600">{l.cuenta}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {Number(l.debe) > 0 ? formatMoney(Number(l.debe), 'BOB') : ''}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {Number(l.haber) > 0 ? formatMoney(Number(l.haber), 'BOB') : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                        <td className="px-4 py-2 text-xs text-stone-500" colSpan={4}>
                          Totales del periodo — deben coincidir
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(diarioFiltrado.reduce((acc, l) => acc + Number(l.debe), 0), 'BOB')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(diarioFiltrado.reduce((acc, l) => acc + Number(l.haber), 0), 'BOB')}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {diarioFiltrado.length >= 5000 ? (
                  <p className="border-t border-stone-100 px-4 py-2 text-xs text-amber-700">
                    Se muestran las primeras 5.000 lineas del periodo. Acorta el rango para verlo completo.
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'bancos' ? (
        <Tesoreria
          projectId={scope ?? projectId}
          projectName={projectName}
          currency={currency}
          onVerLibro={(code, desdeCuenta) => abrirLibro(desdeCuenta ?? desdeTodo, todayIso(), code)}
        />
      ) : null}

      {tab === 'directorio' ? (
        <Directorio projectId={scope} projectName={projectName} currency={currency} />
      ) : null}

      {tab === 'estados' ? <Estados projectId={scope} projectName={projectName} /> : null}

      {escrituraBloqueada && (tab === 'comprobantes' || tab === 'gestion') ? (
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <EmptyState
            title="Elegí una urbanización"
            hint={
              tab === 'comprobantes'
                ? 'Un comprobante se asienta en la gestión de UNA urbanización — no existe un asiento "de todas". Elegila arriba y volvé a esta pestaña.'
                : 'El cierre de gestión y la reexpresión se hacen por urbanización, porque cada una tiene su propio ejercicio. Elegí cuál arriba.'
            }
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {projects.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className={btnSecondary}
                onClick={() => setScope(pr.id)}
              >
                {pr.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!escrituraBloqueada && tab === 'comprobantes' ? (
        <Comprobantes projectId={scope ?? projectId} projectName={projectName} accounts={plan} />
      ) : null}

      {!escrituraBloqueada && tab === 'gestion' ? (
        <Gestion
          projectId={projectId}
          projectName={projectName}
          accounts={plan}
          onAccountsChanged={() => void loadPlan()}
        />
      ) : null}

      {/* ------------------------------- Dialogs ------------------------------ */}
      <StatementDialog
        account={detail}
        cuotas={cuotas}
        pagos={pagos}
        onClose={() => setDetail(null)}
        currency={currency}
      />

      {planFor ? (
        <CreatePlanDialog
          sale={planFor}
          onClose={() => setPlanFor(null)}
          onCreated={() => {
            setPlanFor(null);
            void fetchAll();
          }}
        />
      ) : null}

      {payFor ? (
        <RegistrarCobroDialog
          cobro={payFor}
          onClose={() => setPayFor(null)}
          // Solo refresca: cerrar lo decide el diálogo, que tras registrar se
          // queda mostrando el recibo — el comprador está en el mostrador
          // esperándolo, y cerrarle la ventana en ese momento lo dejaba sin
          // papel y a la cajera buscándolo por Contabilidad.
          onPaid={() => void fetchAll()}
        />
      ) : null}

      {expenseOpen ? (
        <ExpenseDialog
          projectId={projectId}
          currency={currency}
          onClose={() => setExpenseOpen(false)}
          onSaved={() => {
            setExpenseOpen(false);
            void fetchAll();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

function StatementDialog({
  account,
  cuotas,
  pagos,
  onClose,
  currency,
}: {
  account: AccountStatus | null;
  cuotas: Installment[] | null;
  pagos: PaymentRow[] | null;
  onClose: () => void;
  currency: Currency;
}) {
  if (!account) return null;
  const today = new Date().toISOString().slice(0, 10);

  function exportStatement() {
    if (!account || !cuotas) return;
    downloadCsv(
      `estado-cuenta-${account.tracking_code}.csv`,
      toCsv(
        ['Cuota', 'Vence', 'Monto', 'Pagado', 'Estado'],
        cuotas.map((c) => [c.number, dateLabel(c.due_date), Number(c.amount), Number(c.amount_paid), c.status]),
      ),
    );
  }

  return (
    <Dialog open onClose={onClose} title={`Estado de cuenta — ${account.buyer_full_name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-stone-500">Precio</p>
            <p className="font-semibold tabular-nums">{formatMoney(Number(account.total_price), currency)}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Cuota inicial</p>
            <p className="font-semibold tabular-nums">{formatMoney(Number(account.down_payment), currency)}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Pagado</p>
            <p className="font-semibold tabular-nums text-brand">{formatMoney(Number(account.pagado), currency)}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Saldo</p>
            <p className="font-semibold tabular-nums">{formatMoney(Number(account.saldo), currency)}</p>
          </div>
        </div>

        <p className="text-xs text-stone-500">
          Mz {account.manzana}, Lote {account.lote} · {account.months} cuotas de{' '}
          {formatMoney(Number(account.monthly_amount), currency)} · código{' '}
          <span className="font-mono">{account.tracking_code}</span>
        </p>

        {cuotas === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-stone-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50">
                <tr className="border-b border-stone-200 text-left">
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">#</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Vence</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Monto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Pagado</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Estado</th>
                </tr>
              </thead>
              <tbody>
                {cuotas.map((c) => {
                  const late = c.status !== 'pagada' && c.status !== 'anulada' && c.due_date < today;
                  return (
                    <tr key={c.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums text-stone-500">{c.number}</td>
                      <td className={`px-3 py-1.5 ${late ? 'font-semibold text-red-600' : 'text-stone-600'}`}>
                        {dateLabel(c.due_date)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(Number(c.amount), currency)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">
                        {Number(c.amount_paid) > 0 ? formatMoney(Number(c.amount_paid), currency) : '—'}
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
                                  : late
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-stone-100 text-stone-600'
                          }
                        >
                          {c.status === 'pendiente' && late ? 'vencida' : c.status}
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

      {pagos?.length ? (
        <section className="mt-4">
          <p className="annot mb-2 text-stone-400">Pagos recibidos</p>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {pagos.map((pg) => (
              <li key={pg.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-stone-500">{pg.reference_code}</span>
                <span className="text-stone-600">{dateLabel(pg.verified_at)}</span>
                <span className="text-xs text-stone-400">
                  {pg.purpose === 'cuota' ? 'cuota' : pg.purpose === 'abono' ? 'abono' : pg.purpose === 'comision' ? 'comisión' : 'seña'}
                </span>
                <Badge className="bg-stone-100 text-stone-600">
                  {FORMA_DE_PAGO[pg.provider] ?? pg.provider}
                </Badge>
                <span className="ml-auto font-semibold tabular-nums">
                  {formatMoney(Number(pg.amount), pg.currency)}
                </span>
                <Link
                  href={`/admin/recibo/${pg.id}`}
                  target="_blank"
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Recibo
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <a
          href={waLink(
            account.buyer_phone,
            `Hola ${account.buyer_full_name.split(' ')[0] ?? ''}, te escribimos de Terrenalv por tu lote ${account.manzana}-${account.lote}. Tu saldo es de ${formatMoney(Number(account.saldo), currency)}.`,
          )}
          target="_blank"
          rel="noopener noreferrer"
          className={btnSecondary}
        >
          <IconWhatsapp className="h-4 w-4" /> WhatsApp
        </a>
        <Link href={`/admin/reservas?open=${account.reservation_id}`} className={btnSecondary}>
          Ver reserva
        </Link>
        <button type="button" className={btnSecondary} onClick={exportStatement} disabled={!cuotas?.length}>
          Exportar CSV
        </button>
        <button type="button" className={btnPrimary} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  );
}

/* ========================================================================== */

function CreatePlanDialog({
  sale,
  onClose,
  onCreated,
}: {
  sale: SaleWithoutPlan;
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [down, setDown] = useState('');
  const [months, setMonths] = useState('36');
  const [monthly, setMonthly] = useState('');
  const [first, setFirst] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [interest, setInterest] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const financed = Math.max(0, sale.saldo - (Number(down) || 0));
  // La cuota la manda la fórmula, no el teclado: con interés, una cuota
  // escrita a mano deja la última cuota absurda. Misma función que usa la
  // venta y que replica a la base.
  const suggested = cuotaDelPlan(financed, Number(interest) || 0, Number(months) || 0);

  async function create() {
    setError(null);
    const m = Number(months);
    const q = Number(monthly) || suggested;
    if (!Number.isInteger(m) || m < 1 || m > 480) {
      setError('Cantidad de cuotas inválida (1 a 480).');
      return;
    }
    if (!(q > 0)) {
      setError('El monto de la cuota debe ser mayor a cero.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_create_installment_plan', {
      p_reservation_id: sale.id,
      p_months: m,
      p_monthly_amount: q,
      p_down_payment: Number(down) || 0,
      p_first_due_date: first,
      p_annual_interest_pct: 0,
      p_note: note.trim() || null,
      p_monthly_interest_pct: Number(interest) || 0,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(`Plan creado: ${m} cuotas.`, 'success');
    onCreated();
  }

  return (
    <Dialog open onClose={onClose} title={`Plan de pago — ${sale.buyer_full_name}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          Lote {sale.manzana}-{sale.lote} · precio {formatMoney(sale.price_agreed, sale.currency)}.
          {/* Sobre el SALDO, no sobre el precio: lo que ya pagó —seña incluida—
              no se vuelve a cronogramar. */}
          {sale.saldo !== sale.price_agreed ? (
            <>
              {' '}
              Debe <strong>{formatMoney(sale.saldo, sale.currency)}</strong>.
            </>
          ) : null}{' '}
          Se financian <strong>{formatMoney(financed, sale.currency)}</strong>
          {suggested > 0 && Number(months) > 0 ? (
            <>
              {' '}
              en {months} cuotas de{' '}
              <strong className="tabular-nums">{formatMoney(suggested, sale.currency)}</strong>
              {Number(interest) > 0 ? (
                <>
                  {' '}
                  ({formatMoney(
                    Math.round((suggested * Number(months) - financed) * 100) / 100,
                    sale.currency,
                  )}{' '}
                  de interés)
                </>
              ) : null}
            </>
          ) : null}
          .
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Cuota inicial</label>
            <input type="number" min={0} step="0.01" value={down} onChange={(e) => setDown(e.target.value)} placeholder="0" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Cantidad de cuotas</label>
            <input type="number" min={1} max={480} step={1} value={months} onChange={(e) => setMonths(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Cuota mensual{Number(interest) > 0 ? ' · calculada' : ''}
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={Number(interest) > 0 ? (suggested || '') : monthly}
              onChange={(e) => setMonthly(e.target.value)}
              readOnly={Number(interest) > 0}
              placeholder={String(suggested)}
              className={`${inputClass} ${
                Number(interest) > 0 ? 'bg-stone-100 font-semibold text-stone-800' : ''
              }`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Primer vencimiento</label>
            <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Interés mensual %</label>
            <input type="number" min={0} step="0.01" value={interest} onChange={(e) => setInterest(e.target.value)} className={inputClass} />
          </div>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota (opcional)" className={inputClass} />
        <p className="text-xs text-stone-400">
          El interés es <strong>mensual sobre saldo</strong>. Sin interés, las cuotas suman
          exactamente lo financiado y la última absorbe el redondeo; con interés, la cuota se
          calcula sola y cada una lleva su parte de capital y su parte de interés.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>
          {busy ? 'Creando…' : 'Crear plan'}
        </button>
      </div>
    </Dialog>
  );
}

/* ========================================================================== */

/* ========================================================================== */

function ExpenseDialog({
  projectId,
  currency,
  onClose,
  onSaved,
}: {
  projectId: string;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory>('obra');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // De qué cuenta salió y a quién se le pagó. Ambos opcionales: un egreso que
  // ya ocurrió tiene que poder registrarse aunque nadie haya cargado todavía
  // los bancos ni el directorio.
  const { cuentas, contactos: proveedores } = useTesoreria(EXPENSE_CONTACT_KINDS);
  const [cuentaId, setCuentaId] = useState('');
  const [contactId, setContactId] = useState('');

  // A que centro carga y a nombre de quien esta. El titular es un dato del
  // negocio —saber de quien es la factura sirve igual— y ademas es lo que
  // despues decide si esto se declara o no.
  const [centros, setCentros] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [centroId, setCentroId] = useState('');
  // El catálogo de conceptos: «Uniformes», «Luz», «Combustible». Cada uno sabe
  // en qué cuenta del plan cae, así que agregar uno no toca el libro.
  const [conceptos, setConceptos] = useState<{ id: string; nombre: string }[]>([]);
  const [conceptId, setConceptId] = useState('');
  const [titular, setTitular] = useState<'empresa' | 'tercero'>('empresa');
  const [titularNombre, setTitularNombre] = useState('');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('centros_costo')
        .select('id, codigo, nombre, project_id')
        .eq('is_active', true)
        .or(`project_id.eq.${projectId},project_id.is.null`)
        .order('codigo');
      setCentros((data ?? []) as { id: string; codigo: string; nombre: string }[]);
      const { data: cs } = await supabase
        .from('expense_concepts')
        .select('id, nombre, sort_order')
        .eq('is_active', true)
        .order('sort_order');
      setConceptos((cs ?? []) as { id: string; nombre: string }[]);
    })();
  }, [supabase, projectId]);

  async function save() {
    setError(null);
    if (!description.trim()) {
      setError('Escribe un detalle del egreso.');
      return;
    }
    const a = Number(amount);
    if (!(a > 0)) {
      setError('El monto debe ser mayor a cero.');
      return;
    }
    if (titular === 'tercero' && !titularNombre.trim()) {
      setError('Si el gasto esta a nombre de un tercero, decinos de quien.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_record_expense', {
      p_project_id: projectId,
      p_incurred_on: date,
      p_category: category,
      p_description: description.trim(),
      p_amount: a,
      p_currency: currency,
      p_supplier: supplier.trim() || null,
      p_receipt_storage_path: null,
      p_note: note.trim() || null,
      p_treasury_account_id: cuentaId || null,
      p_contact_id: contactId || null,
      p_centro_costo_id: centroId || null,
      p_titular: titular,
      p_titular_nombre: titular === 'tercero' ? titularNombre.trim() : null,
      p_reservation_id: null,
      p_concept_id: conceptId || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Egreso registrado.', 'success');
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title="Nuevo egreso">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputClass}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle (ej. cemento para calles)" className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Proveedor</label>
            {proveedores.length ? (
              <select
                value={contactId}
                onChange={(e) => {
                  setContactId(e.target.value);
                  if (e.target.value) setSupplier('');
                }}
                className={inputClass}
              >
                <option value="">— sin proveedor —</option>
                {proveedores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.tax_id ? ` · ${c.tax_id}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Proveedor (opcional)"
                className={inputClass}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Monto en {currency === 'BOB' ? 'Bs' : '$us'}
            </label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
        </div>

        {proveedores.length && !contactId ? (
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="…o escribí el proveedor a mano si no está en el directorio"
            className={inputClass}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Concepto</label>
            <select
              value={conceptId}
              onChange={(e) => setConceptId(e.target.value)}
              className={inputClass}
            >
              <option value="">— sin concepto —</option>
              {conceptos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-400">
              El concepto decide en qué cuenta contable cae el gasto. Sin concepto manda la
              categoría, que es más gruesa.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-500">Centro de costos</label>
            <select
              value={centroId}
              onChange={(e) => setCentroId(e.target.value)}
              className={inputClass}
            >
              <option value="">— sin centro —</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">A nombre de</label>
            <select
              value={titular}
              onChange={(e) => setTitular(e.target.value as 'empresa' | 'tercero')}
              className={inputClass}
            >
              <option value="empresa">La empresa</option>
              <option value="tercero">Un tercero</option>
            </select>
          </div>
        </div>

        {titular === 'tercero' ? (
          <div>
            <input
              value={titularNombre}
              onChange={(e) => setTitularNombre(e.target.value)}
              placeholder="¿A nombre de quién? (ej. Juan Pérez, socio)"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-stone-400">
              Queda registrado en el gerencial igual que cualquier gasto. No entra solo a la
              contabilidad fiscal: ahí hay que decidirlo a mano.
            </p>
          </div>
        ) : null}

        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="Pagado desde"
          monto={Number(amount)}
          signo={-1}
        />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota (opcional)" className={inputClass} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar egreso'}
        </button>
      </div>
    </Dialog>
  );
}
