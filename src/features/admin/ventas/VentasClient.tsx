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
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import type { PaymentStatus, RejectionReason } from '@/lib/db-types';
import { PAYMENT_STATUS_LABEL, REJECTION_REASON_LABEL } from '@/features/admin/lib/labels';
import { laPazDateOf } from '@/features/admin/lib/lapaz';
import { Badge, EmptyState, Kpi, Spinner, btnDanger, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { IconSearch, IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import RegistrarCobroDialog from '@/features/admin/contabilidad/RegistrarCobro';
import AnularPagoDialog, { type PagoAnulable } from '@/features/admin/contabilidad/AnularPago';
import { HistorialCliente } from '@/features/admin/clientes/HistorialCliente';
import { ElegirLoteDialog, type LoteElegible } from './ElegirLote';
import { SellOfflineDialog } from './VenderLoteDialogs';
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
  traspaso: boolean;
  traspaso_de_tracking: string | null;
  traspaso_de_comprador: string | null;
  traspaso_pagado: number | null;
  en_mercado: boolean;
  mercado_listing_id: string | null;
  mercado_pide: number | null;
  mercado_fee_pct: number | null;
  source: 'web' | 'oficina';
  /**
   * Cómo nació la venta. Ojo con `origen_declarado`: cuando es false la vista
   * NO leyó el origen de la reserva —no está guardado— sino que lo dedujo de
   * cómo se creó. Vale para ordenar la lista; no vale para afirmarle a nadie
   * que esa venta se cerró en oficina.
   */
  origen: Origen;
  origen_label: string;
  /** A nombre de quien esta la venta: define si entra a la contabilidad fiscal. */
  titular: string | null;
  titular_nombre: string | null;
  origen_declarado: boolean;
  /** Seña aprobada, en Bs. 0 = no reservó: entró directo con la cuota inicial. */
  sena_pagada: number;
  sena_fecha: string | null;
  /** Ya viene etiquetada ('Efectivo', 'QR / transferencia', …); '' si no hubo seña. */
  sena_forma: string;
}

/**
 * Los orígenes que hoy produce `private.origen_de_venta`. NO es un enum de la
 * base: cuando la reserva trae `client_meta->>'origen'` la función lo devuelve
 * tal cual, y ese jsonb no tiene CHECK que lo cierre. Por eso las tablas de
 * abajo se indexan por string y con salida por defecto.
 */
type Origen =
  | 'app'
  | 'oficina_reserva'
  | 'oficina_directa'
  | 'migrada'
  /** Lote que cambió de comprador: la vista trae además las columnas traspaso_*. */
  | 'traspaso';

/**
 * Una fila de v_historial_pagos: TODO pago de la venta, aprobado o no.
 *
 * La vista ya trae `tipo` y `forma` en español, así que acá no se vuelve a
 * traducir nada: si mañana entra otro proveedor de cobro, la etiqueta la pone
 * la base y todas las pantallas la dicen igual, sin tocar este archivo.
 */
interface PagoHist {
  payment_id: string;
  purpose: 'reserva' | 'cuota' | 'abono' | 'comision';
  /** Quién hizo el pago: en un lote traspasado puede ser el comprador anterior. */
  buyer_full_name: string;
  tracking_code: string;
  /** true si el pago es de un eslabón anterior de la cadena (otro comprador). */
  de_comprador_anterior: boolean;
  buyer_phone: string | null;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  exchange_rate_used: number | null;
  estado: PaymentStatus;
  /** Fecha de aprobación: la vista la saca de verified_at, así que es null mientras el pago no se apruebe. */
  fecha: string | null;
  /**
   * Cuándo se cargó. Ojo: `fecha` es un `date` que la vista ya convirtió a
   * La_Paz, pero esto es un `timestamptz` crudo — hay que convertirlo antes de
   * mostrarlo (`laPazDateOf`), o el pago de las nueve de la noche se fecha
   * mañana.
   */
  created_at: string;
  motivo_rechazo: RejectionReason | null;
  /** Solo los aprobados tienen recibo: no se imprime papel de un pago que no entró. */
  tiene_recibo: boolean;
}

// El color del estado tiene que leerse antes que el texto: verde lo que entró,
// rojo lo que se rechazó, ámbar lo que sigue en el aire. Un pago cancelado no
// es una alarma —el comprador reintentó y el intento quedó registrado— así que
// va en gris para no competir con lo que sí hay que mirar.
const ESTADO_BADGE: Record<PaymentStatus, string> = {
  aprobado: 'bg-green-100 text-green-800',
  rechazado: 'bg-red-100 text-red-700',
  pendiente: 'bg-amber-100 text-amber-800',
  comprobante_subido: 'bg-amber-100 text-amber-800',
  cancelado: 'bg-stone-200 text-stone-600',
};

// La seña se destaca porque es el pago que explica cómo empezó todo; cuotas y
// abonos son el goteo de siempre y no necesitan color propio.
const TIPO_BADGE: Record<PagoHist['purpose'], string> = {
  reserva: 'bg-sky-100 text-sky-800',
  cuota: 'bg-stone-200 text-stone-700',
  abono: 'bg-stone-100 text-stone-600',
  // La comisión del mercado no es plata del lote: color propio para que nadie
  // la sume con lo que paga el terreno.
  comision: 'bg-violet-100 text-violet-800',
};

// En la tabla el origen entra en una columna angosta, así que va abreviado; el
// texto completo ('Reservó por la app', …) lo pone la vista y se muestra en el
// detalle y en el export, donde sí hay lugar para leerlo.
//
// El tipo del índice es `string` y el valor `string | undefined` a propósito: un
// origen que estas tablas no conozcan dejaba la celda MUDA —Badge sin color y
// sin texto— porque el Record cerrado devolvía undefined y nadie lo miraba. Se
// cae a `origen_label`, que la base calcula para todos los casos y en el peor
// dice 'Otro', pero nunca queda en blanco.
const ORIGEN_CORTO: Record<string, string | undefined> = {
  app: 'App',
  oficina_reserva: 'Oficina',
  oficina_directa: 'Directa',
  migrada: 'Migrada',
  traspaso: 'Traspaso',
};

const ORIGEN_BADGE: Record<string, string | undefined> = {
  app: 'bg-sky-100 text-sky-800',
  oficina_reserva: 'bg-stone-100 text-stone-600',
  oficina_directa: 'bg-stone-100 text-stone-600',
  migrada: 'bg-stone-200 text-stone-500',
  traspaso: 'bg-violet-100 text-violet-800',
};

/** Gris neutro para el origen que no está en las tablas de arriba. */
const ORIGEN_BADGE_OTRO = 'bg-stone-100 text-stone-600';

/**
 * 'ventas' es el filtro por defecto: solo compras iniciadas. 'sin_inicial' es
 * el bucket contrario — confirmadas que nadie empezó a pagar. 'cobradas' no
 * tiene chip propio: solo se llega desde el KPI "Pagado" y aparece como chip
 * descartable, igual que el filtro por forma de pago en el libro.
 */
type Filtro =
  | 'ventas'
  | 'todas'
  | 'saldo'
  | 'migradas'
  | 'plan'
  | 'sin_inicial'
  | 'cobradas'
  | 'app'
  | 'oficina'
  | 'directa'
  | 'traspasos';

const CHIPS: { id: Exclude<Filtro, 'cobradas'>; label: string }[] = [
  { id: 'ventas', label: 'Ventas' },
  { id: 'todas', label: 'Todas' },
  { id: 'saldo', label: 'Con saldo' },
  { id: 'migradas', label: 'Migradas' },
  { id: 'plan', label: 'Con plan' },
  { id: 'sin_inicial', label: 'Sin cuota inicial' },
  // Por origen: separan lo que cerró la web de lo que cerró el mostrador, que
  // es la pregunta que hace la gerencia cuando discute comisiones.
  { id: 'app', label: 'App' },
  { id: 'oficina', label: 'Oficina' },
  { id: 'directa', label: 'Directa' },
  { id: 'traspasos', label: 'Traspasos' },
];

/** Los filtros que pueden llegar por la URL desde una casilla del tablero. */
const FILTROS_VALIDOS = new Set<string>([
  'ventas', 'todas', 'saldo', 'migradas', 'plan', 'sin_inicial', 'cobradas',
  'app', 'oficina', 'directa', 'traspasos',
]);

export default function VentasClient({
  projectId,
  projects,
  open,
  scopeInicial = null,
  filtroInicial = null,
}: {
  /** La urbanización activa en la barra: valor inicial del filtro. */
  projectId: string;
  projects: AdminProject[];
  /** reservation_id a expandir al cargar (enlace desde Lotes o Reservas). */
  open: string | null;
  /**
   * Alcance y filtro pedidos por la URL. Vienen de las casillas del tablero,
   * que muestran UNA urbanización: sin esto la pantalla abriría consolidada y
   * el número de la casilla no coincidiría con la lista que abre.
   */
  scopeInicial?: string | null;
  filtroInicial?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);

  // Igual que en contabilidad: con varias urbanizaciones arranca consolidado,
  // porque "cuánto vendimos" es una pregunta de la empresa, no de un plano.
  const [scope, setScope] = useState<ProjectScope>(
    scopeInicial ?? (projects.length > 1 ? null : projectId),
  );
  const projectName = scopeLabel(scope, projects);

  const [rows, setRows] = useState<Venta[]>([]);
  // Acciones sobre una venta: cobrar, corregir sus datos, o anularla.
  const [cobrar, setCobrar] = useState<CobroTarget | null>(null);
  const [editar, setEditar] = useState<Venta | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  // Anular UN pago suelto (una cuota, un abono), no la venta entera.
  const [anularPago, setAnularPago] = useState<PagoAnulable | null>(null);
  const [traspasar, setTraspasar] = useState<Venta | null>(null);
  const [titularDe, setTitularDe] = useState<Venta | null>(null);
  // Elegir a un comprador cambia el MODO de la pantalla: se deja de ver la
  // lista de todas las ventas y se ve SOLO a esa persona — todo lo que compró,
  // reservó, cedió o recibió, con sus pagos y recibos. Volver es un clic.
  const [cliente, setCliente] = useState<{ ci: string; nombre: string } | null>(null);
  // Vender en oficina DESDE Ventas: es la pantalla donde está parada la
  // vendedora cuando entra un comprador, no la de Lotes.
  const [eligiendo, setEligiendo] = useState(false);
  const [vendiendo, setVendiendo] = useState<LoteElegible | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<Filtro>(
    filtroInicial && FILTROS_VALIDOS.has(filtroInicial) ? (filtroInicial as Filtro) : 'ventas',
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [pagos, setPagos] = useState<PagoHist[] | null>(null);
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

  /**
   * Detalle inline: el historial COMPLETO de pagos de la venta.
   *
   * Incluye los que no se aprobaron a propósito. Antes esta lista mostraba solo
   * los aprobados y la oficina quedaba muda cuando el comprador juraba haber
   * pagado: el comprobante estaba, pero rechazado por ilegible o por monto, y
   * en pantalla no había ni rastro de él — solo un saldo que no bajaba. Un
   * intento rechazado explica esa conversación; esconderlo la vuelve imposible.
   *
   * Ordena por created_at y no por `fecha`: `fecha` sale de verified_at y es
   * null hasta que alguien aprueba el pago, así que ordenar por ella amontonaría
   * justamente lo pendiente en una punta de la lista, fuera de su lugar
   * cronológico.
   */
  /** Recarga el historial de la venta expandida sin colapsarla. */
  const refrescarPagos = useCallback(
    async (rid: string) => {
      if (selectedRef.current !== rid) return;
      // La CADENA, no la reserva: un lote traspasado arrastra los pagos de
      // su comprador anterior, y esa plata es historia de este lote.
      const { data } = await supabase
        .from('v_historial_pagos_cadena')
        .select('*')
        .eq('venta_id', rid)
        .order('created_at', { ascending: false });
      setPagos((data ?? []) as unknown as PagoHist[]);
    },
    [supabase],
  );

  const toggleDetail = useCallback(
    async (rid: string) => {
      if (selectedRef.current === rid) {
        setSelected(null);
        return;
      }
      setSelected(rid);
      setPagos(null);
      const { data } = await supabase
        .from('v_historial_pagos_cadena')
        .select('*')
        .eq('venta_id', rid)
        .order('created_at', { ascending: false });
      // Si mientras cargaba el usuario abrió otra fila, esta respuesta ya no
      // es la del detalle visible y se descarta.
      if (selectedRef.current === rid) setPagos((data ?? []) as unknown as PagoHist[]);
    },
    [supabase],
  );

  /**
   * Resumen del historial abierto.
   *
   * Suma en Bs (amount_bob) y no en la moneda de cada pago: un historial puede
   * mezclar dólares y bolivianos, y sumar cifras de dos monedas da un número
   * que no significa nada. Solo los aprobados entran al total —un comprobante
   * rechazado no es plata— pero los otros se cuentan aparte para que el
   * "N pagos" no se lea como si todo hubiera entrado.
   */
  const resumen = useMemo(() => {
    if (!pagos) return null;
    const ok = pagos.filter((p) => p.estado === 'aprobado');
    const porTipo = (purpose: PagoHist['purpose']) => {
      const del = ok.filter((p) => p.purpose === purpose);
      return { total: del.reduce((s, p) => s + Number(p.amount_bob), 0), n: del.length };
    };
    return {
      total: ok.reduce((s, p) => s + Number(p.amount_bob), 0),
      aprobados: ok.length,
      otros: pagos.length - ok.length,
      sena: porTipo('reserva'),
      cuotas: porTipo('cuota'),
      abonos: porTipo('abono'),
    };
  }, [pagos]);

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
      // 'oficina' es la venta que empezó como reserva en el mostrador;
      // 'directa' es la que nunca pasó por una reserva. Son dos maneras
      // distintas de vender y la oficina las trabaja distinto.
      if (filtro === 'app' && r.origen !== 'app') return false;
      if (filtro === 'oficina' && r.origen !== 'oficina_reserva') return false;
      if (filtro === 'directa' && r.origen !== 'oficina_directa') return false;
      if (filtro === 'traspasos' && !r.traspaso) return false;
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

  // MODO CLIENTE: elegido un comprador, la pantalla es SUYA — nada del resto
  // del mundo estorba. Todo lo que hizo con Terrenalv, con sus recibos.
  if (cliente) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setCliente(null)}
            className="text-sm font-semibold text-brand hover:underline"
          >
            ← Volver a todas las ventas
          </button>
          <p className="text-xs text-stone-500">
            Viendo solo a <strong className="text-stone-700">{cliente.nombre}</strong>
          </p>
        </div>
        <HistorialCliente ci={cliente.ci} />
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
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() => setEligiendo(true)}
        >
          Vender en oficina
        </button>
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
                  title: 'Cartera de ventas',
                  subtitle: projectName,
                  filename: `cartera-${new Date().toISOString().slice(0, 10)}`,
                  footnote:
                    'Estado: Pagado = sin deuda · Vigente = al día · Atrasado = 1 o 2 cuotas vencidas · Vencido = 3 o más. ' +
                    'Pago inicial: la cuota inicial del plan, o lo pagado si es al contado. ' +
                    'Saldo: deuda migrada (si la hay) o precio pactado, menos capital cobrado en este sistema.',
                }}
                columns={[
                  { header: 'Código' },
                  { header: 'Cliente' },
                  { header: 'CI' },
                  { header: 'Teléfono' },
                  { header: 'Proyecto' },
                  { header: 'Manzana' },
                  { header: 'Lote' },
                  { header: 'Sup. m²', align: 'right' },
                  { header: 'Fecha compra' },
                  { header: 'Fecha últ. pago' },
                  { header: 'Modalidad' },
                  { header: 'Monto venta', align: 'right' },
                  { header: 'Moneda' },
                  { header: 'Pago inicial', align: 'right' },
                  { header: 'Plazo', align: 'right' },
                  { header: 'Cuota', align: 'right' },
                  { header: 'Interés %', align: 'right' },
                  { header: 'Pagado', align: 'right' },
                  { header: 'Saldo', align: 'right' },
                  { header: 'Cuotas pag.', align: 'right' },
                  { header: 'Día de pago', align: 'right' },
                  { header: 'Cobro del mes', align: 'right' },
                  { header: 'Próx. vence' },
                  { header: 'Cuotas venc.', align: 'right' },
                  { header: 'Estado' },
                  { header: 'Promotor' },
                  { header: 'Origen' },
                ]}
                rows={async () => {
                  // La cartera completa sale de la base al momento de exportar,
                  // no de lo que la tabla tiene en pantalla: el reporte lleva
                  // columnas (teléfono, plazo, cuota, promotor, superficie)
                  // que la pantalla no carga.
                  let q = supabase.from('v_cartera').select('*');
                  if (scope !== null) q = q.eq('project_id', scope);
                  const { data } = await q.order('fecha_venta', { ascending: false }).limit(5000);
                  interface FilaCartera {
                    codigo: string;
                    cliente: string;
                    ci: string;
                    telefono: string | null;
                    proyecto: string;
                    manzana: string | null;
                    lote: string | null;
                    sup_m2: number | null;
                    fecha_venta: string;
                    fecha_ultimo_pago: string | null;
                    modalidad: string;
                    monto_venta: number;
                    moneda: string;
                    pago_inicial: number | null;
                    plazo_meses: number | null;
                    monto_cuota: number | null;
                    interes_mensual_pct: number;
                    pagado: number;
                    saldo: number;
                    cuotas_pagadas: number;
                    dia_de_pago: number | null;
                    proxima_cuota: string | null;
                    proximo_cobro: number | null;
                    cuotas_vencidas: number;
                    estado_cartera: string;
                    promotor: string | null;
                    origen: string;
                  }
                  return ((data ?? []) as unknown as FilaCartera[]).map((r) => [
                    r.codigo,
                    r.cliente,
                    r.ci,
                    r.telefono ?? '',
                    r.proyecto,
                    r.manzana ?? '',
                    r.lote ?? '',
                    r.sup_m2 == null ? '' : Number(r.sup_m2),
                    dateLabel(r.fecha_venta),
                    r.fecha_ultimo_pago ? dateLabel(r.fecha_ultimo_pago) : '',
                    r.modalidad,
                    Number(r.monto_venta),
                    r.moneda,
                    r.pago_inicial == null ? '' : Number(r.pago_inicial),
                    r.plazo_meses ?? '',
                    r.monto_cuota == null ? '' : Number(r.monto_cuota),
                    Number(r.interes_mensual_pct),
                    Number(r.pagado),
                    Number(r.saldo),
                    Number(r.cuotas_pagadas),
                    r.dia_de_pago ?? '',
                    r.proximo_cobro == null ? '' : Number(r.proximo_cobro),
                    r.proxima_cuota ? dateLabel(r.proxima_cuota) : '',
                    Number(r.cuotas_vencidas),
                    r.estado_cartera,
                    r.promotor ?? '',
                    r.origen,
                  ]) as XCell[][];
                }}
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
                      <th className="px-3 py-2 text-xs font-semibold text-stone-500">Origen</th>
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
                            <button
                              type="button"
                              className="text-left font-medium text-stone-900 hover:text-brand hover:underline"
                              title="Ver el perfil de este cliente"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCliente({ ci: r.buyer_ci, nombre: r.buyer_full_name });
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
                          <td className="px-3 py-2">
                            <Badge className={ORIGEN_BADGE[r.origen] ?? ORIGEN_BADGE_OTRO}>
                              {ORIGEN_CORTO[r.origen] ?? r.origen_label}
                            </Badge>
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
                            <td colSpan={9} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3">
                                  <div>
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      Comprador
                                    </p>
                                    <p className="mt-1 text-sm font-medium text-stone-900">
                                      <button
                                        type="button"
                                        className="hover:text-brand hover:underline"
                                        title="Ver el perfil de este cliente"
                                        onClick={() =>
                                          setCliente({ ci: r.buyer_ci, nombre: r.buyer_full_name })
                                        }
                                      >
                                        {r.buyer_full_name}
                                      </button>
                                    </p>
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
                                      <a
                                        href={`/admin/contrato/${r.reservation_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={btnSecondary}
                                      >
                                        Contrato
                                      </a>
                                      <button
                                        type="button"
                                        className={btnSecondary}
                                        onClick={() => setTraspasar(r)}
                                      >
                                        Traspasar
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
                                      {(r.migrada || r.traspaso) && Number(r.abonado_migrado) > 0 ? (
                                        <span className="text-xs text-stone-400">
                                          {' '}
                                          ({formatMoney(Number(r.abonado_migrado), 'BOB')}
                                          {r.traspaso ? ' del comprador anterior' : ' antes'} +{' '}
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
                                  {/* Cómo llegó esta venta: la primera pregunta
                                      que hace cualquiera al abrir una ficha, y
                                      hasta ahora había que reconstruirla mirando
                                      si existía un pago de reserva. */}
                                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      Cómo llegó esta venta
                                    </p>
                                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-stone-700">
                                      <Badge className={ORIGEN_BADGE[r.origen] ?? ORIGEN_BADGE_OTRO}>
                                        {ORIGEN_CORTO[r.origen] ?? r.origen_label}
                                      </Badge>
                                      {r.origen_label}
                                    </p>
                                    <p className="mt-1 text-sm text-stone-600">
                                      {Number(r.sena_pagada) > 0
                                        ? `Reservó con ${formatMoney(Number(r.sena_pagada), 'BOB')}${
                                            r.sena_fecha ? ` el ${dateLabel(r.sena_fecha)}` : ''
                                          }${r.sena_forma ? ` por ${r.sena_forma}` : ''}.`
                                        : 'Sin seña: compró directo con la cuota inicial.'}
                                    </p>
                                    {!r.origen_declarado ? (
                                      <p className="mt-1.5 text-xs text-stone-400">
                                        El origen no quedó guardado en esta venta —las viejas no lo
                                        traen— así que se dedujo de cómo nació: si vino del sistema
                                        anterior, si hubo una reserva por la app o si se cargó en
                                        oficina. Es una lectura, no un dato del contrato.
                                      </p>
                                    ) : null}
                                  </div>

                                  {/* A nombre de quien esta la venta. No es un
                                      detalle: decide si entra o no al libro que
                                      se declara. */}
                                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      A nombre de
                                    </p>
                                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-stone-700">
                                      {r.titular === 'tercero' ? (
                                        <>
                                          <Badge className="bg-amber-100 text-amber-800">
                                            un tercero
                                          </Badge>
                                          <strong>{r.titular_nombre}</strong>
                                        </>
                                      ) : (
                                        <>
                                          <Badge className="bg-stone-100 text-stone-600">
                                            la empresa
                                          </Badge>
                                          Terrenalv S.R.L.
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setTitularDe(r)}
                                        className="ml-auto rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                                      >
                                        Cambiar
                                      </button>
                                    </p>
                                    <p className="mt-1 text-xs text-stone-400">
                                      {r.titular === 'tercero'
                                        ? 'No entra sola a la contabilidad fiscal: hay que declararla a mano.'
                                        : 'Entra normalmente a la contabilidad fiscal cuando se importe el período.'}
                                    </p>
                                  </div>
                                  {r.traspaso ? (
                                    <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
                                      Recibida por traspaso de{' '}
                                      <strong>{r.traspaso_de_comprador ?? '—'}</strong> (
                                      {r.traspaso_de_tracking ?? '—'}), que llevaba pagados{' '}
                                      {formatMoney(Number(r.traspaso_pagado ?? 0), 'BOB')}. Los
                                      recibos de esos pagos siguen a nombre de quien los hizo.
                                    </p>
                                  ) : null}
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
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                      Historial de pagos de este lote
                                    </p>
                                    <a
                                      href={`/admin/lote/${r.reservation_id}`}
                                      className="ml-auto rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                                    >
                                      Abrir Mz {r.manzana ?? '—'}, Lote {r.lote ?? '—'} en pantalla completa →
                                    </a>
                                  </div>
                                  {pagos === null || resumen === null ? (
                                    <div className="mt-3">
                                      <Spinner />
                                    </div>
                                  ) : pagos.length === 0 ? (
                                    <p className="mt-2 text-sm text-stone-500">
                                      Todavía no hay pagos registrados acá
                                      {r.migrada ? ' (los del sistema anterior no se migraron pago por pago)' : ''}
                                      .
                                    </p>
                                  ) : false ? (
                                    <p />
                                  ) : (
                                    <>
                                      <div className="mt-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-stone-500">
                                          Aprobado
                                          <strong className="text-base tabular-nums text-stone-900">
                                            {formatMoney(resumen.total, 'BOB')}
                                          </strong>
                                          <span className="text-xs">
                                            en {resumen.aprobados} pago(s)
                                            {resumen.otros > 0
                                              ? ` · ${resumen.otros} intento(s) sin aprobar`
                                              : ''}
                                          </span>
                                        </p>
                                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                                          <span>
                                            Seña{' '}
                                            <strong className="tabular-nums text-stone-700">
                                              {formatMoney(resumen.sena.total, 'BOB')}
                                            </strong>
                                          </span>
                                          <span>
                                            Cuotas ({resumen.cuotas.n}){' '}
                                            <strong className="tabular-nums text-stone-700">
                                              {formatMoney(resumen.cuotas.total, 'BOB')}
                                            </strong>
                                          </span>
                                          <span>
                                            Abonos ({resumen.abonos.n}){' '}
                                            <strong className="tabular-nums text-stone-700">
                                              {formatMoney(resumen.abonos.total, 'BOB')}
                                            </strong>
                                          </span>
                                        </div>
                                      </div>
                                      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                        {pagos.map((p) => {
                                          const entro = p.estado === 'aprobado';
                                          return (
                                            <li key={p.payment_id} className="px-3 py-2">
                                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                                <span
                                                  className="whitespace-nowrap text-xs text-stone-500"
                                                  title={
                                                    p.fecha
                                                      ? 'Fecha de aprobación'
                                                      : 'Fecha en que se cargó: este pago todavía no se aprobó'
                                                  }
                                                >
                                                  {dateLabel(p.fecha ?? laPazDateOf(p.created_at))}
                                                </span>
                                                <Badge className={TIPO_BADGE[p.purpose] ?? 'bg-stone-100 text-stone-600'}>
                                                  {p.tipo}
                                                </Badge>
                                                <span className="text-xs text-stone-400">{p.forma}</span>
                                                {p.de_comprador_anterior ? (
                                                  <span
                                                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                                                    title={`Pago de ${p.buyer_full_name} bajo el contrato ${p.tracking_code}, antes del traspaso. Su recibo sigue a su nombre.`}
                                                  >
                                                    {p.buyer_full_name.split(' ')[0]} (antes)
                                                  </span>
                                                ) : null}
                                                <Badge className={ESTADO_BADGE[p.estado]}>
                                                  {PAYMENT_STATUS_LABEL[p.estado]}
                                                </Badge>
                                                {/* El importe de un pago que no entró se apaga: en
                                                    gris nadie lo suma de un vistazo con los demás. */}
                                                <span
                                                  className={`ml-auto font-semibold tabular-nums ${
                                                    entro ? 'text-stone-900' : 'text-stone-400 line-through'
                                                  }`}
                                                >
                                                  {formatMoney(Number(p.amount), p.currency)}
                                                </span>
                                                {p.tiene_recibo ? (
                                                  <a
                                                    href={`/admin/recibo/${p.payment_id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs font-semibold text-brand hover:underline"
                                                  >
                                                    Recibo
                                                  </a>
                                                ) : null}
                                                {/* Mandarle ESTE recibo, sea de hoy o del mes
                                                    pasado, sin buscar el enlace a mano. */}
                                                {p.tiene_recibo && p.buyer_phone ? (
                                                  <a
                                                    href={waLink(
                                                      p.buyer_phone,
                                                      `Hola ${p.buyer_full_name.split(' ')[0] ?? ''}, aquí está tu recibo de ${p.tipo.toLowerCase()} por ${formatMoney(Number(p.amount), p.currency)}: ${
                                                        typeof window === 'undefined'
                                                          ? ''
                                                          : window.location.origin
                                                      }/reserva/${encodeURIComponent(p.tracking_code)}/recibo/${p.payment_id}`,
                                                    )}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Mandarle este recibo por WhatsApp"
                                                    className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-green-700"
                                                  >
                                                    <IconWhatsapp className="h-3.5 w-3.5" /> Enviar
                                                  </a>
                                                ) : null}
                                                {entro ? (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setAnularPago({
                                                        payment_id: p.payment_id,
                                                        monto_bob: Number(p.amount_bob),
                                                        etiqueta: `${p.tipo} · ${dateLabel(p.fecha ?? laPazDateOf(p.created_at))}`,
                                                      })
                                                    }
                                                    className="text-xs font-semibold text-red-700 hover:underline"
                                                  >
                                                    Anular
                                                  </button>
                                                ) : null}
                                              </div>
                                              {/* Un pago en dólares se cobró en dólares pero el libro
                                                  vive en bolivianos: van los dos, con el tipo de cambio
                                                  con el que se convirtió ese día, o el comprador y la
                                                  contadora nunca cuadran la misma cifra. */}
                                              {p.currency !== 'BOB' ? (
                                                <p className="mt-0.5 text-xs text-stone-400">
                                                  = {formatMoney(Number(p.amount_bob), 'BOB')}
                                                  {p.exchange_rate_used
                                                    ? ` · t/c ${fnum(Number(p.exchange_rate_used))}`
                                                    : ''}
                                                </p>
                                              ) : null}
                                              {p.motivo_rechazo ? (
                                                <p className="mt-0.5 text-xs text-red-700">
                                                  Motivo: {REJECTION_REASON_LABEL[p.motivo_rechazo]}
                                                </p>
                                              ) : null}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                      <p className="mt-2 text-xs text-stone-400">
                                        Se listan también los intentos rechazados y cancelados: no suman
                                        al saldo, pero son la explicación cuando el comprador dice que ya
                                        pagó.
                                      </p>
                                    </>
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

      <AnularPagoDialog
        pago={anularPago}
        onClose={() => setAnularPago(null)}
        // Refresca la tabla Y el historial abierto: el pago anulado se apaga
        // en la lista y la deuda de la fila cambia en el acto.
        onDone={() => {
          void fetchAll();
          if (selected) void refrescarPagos(selected);
        }}
      />

      {cobrar ? (
        <RegistrarCobroDialog
          cobro={cobrar}
          onClose={() => setCobrar(null)}
          // Refresca la tabla Y el historial del detalle abierto: sin lo
          // segundo, el cobro recién registrado —y su recibo— no aparecían
          // hasta cerrar y reabrir la fila, que es exactamente donde la cajera
          // lo va a buscar.
          onPaid={() => {
            void fetchAll();
            void refrescarPagos(cobrar.reservation_id);
          }}
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

      {eligiendo ? (
        <ElegirLoteDialog
          projectId={scope ?? projectId}
          titulo="Vender en oficina — elegí el lote"
          onClose={() => setEligiendo(false)}
          onElegido={(l) => {
            setEligiendo(false);
            setVendiendo(l);
          }}
        />
      ) : null}

      {vendiendo ? (
        <SellOfflineDialog
          lot={vendiendo}
          mzCode={vendiendo.manzana}
          defaultPrice={vendiendo.precio}
          currency="BOB"
          onClose={() => setVendiendo(null)}
          onSold={() => {
            setVendiendo(null);
            void fetchAll();
          }}
        />
      ) : null}

      <TitularDialog
        venta={titularDe}
        onClose={() => setTitularDe(null)}
        onSaved={() => {
          setTitularDe(null);
          void fetchAll();
        }}
      />

      {traspasar ? (
        <TraspasarVentaDialog
          venta={traspasar}
          onClose={() => setTraspasar(null)}
          onDone={() => {
            setTraspasar(null);
            setSelected(null);
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

/* ========================================================================== */

/**
 * Traspasar la compra a otra persona.
 *
 * Terrenalv es dueña del lote hasta que se termina de pagar, así que esto no
 * es un cambio de nombre: la venta vieja se cierra conservando sus pagos y
 * recibos a nombre de quien los hizo, y nace una venta nueva que ARRASTRA lo
 * pagado y el saldo del momento. Todo queda enlazado y en auditoría.
 */
function TraspasarVentaDialog({
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
  const [nombre, setNombre] = useState('');
  const [ci, setCi] = useState('');
  const [tel, setTel] = useState('');
  const [correo, setCorreo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{
    codigo: string;
    comision: number;
    reciboId: string | null;
    reservationId: string | null;
  } | null>(null);
  // Venta publicada en el mercado: el precio pactado y por donde entra la
  // comision. Prefijado con lo que pedia el aviso; la oficina lo corrige al
  // numero que las partes cerraron de verdad.
  const [precioMercado, setPrecioMercado] = useState(
    venta.en_mercado ? String(venta.mercado_pide ?? '') : '',
  );
  const [medio, setMedio] = useState<'efectivo' | 'manual_qr'>('efectivo');
  const feePct = Number(venta.mercado_fee_pct ?? 0);
  const comisionPrevista = venta.en_mercado
    ? Math.round((Number(precioMercado) || 0) * feePct) / 100
    : 0;

  async function traspasar() {
    setError(null);
    if (nombre.trim().length < 5) {
      setError('Escribe el nombre completo del comprador nuevo.');
      return;
    }
    if (motivo.trim().length < 5) {
      setError('Escribe el motivo del traspaso: queda en la auditoría.');
      return;
    }
    if (venta.en_mercado && !(Number(precioMercado) > 0)) {
      setError('Escribe el precio de venta que pactaron: sobre eso se cobra la comisión.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('admin_traspasar_venta', {
      p_reservation_id: venta.reservation_id,
      p_full_name: nombre.trim(),
      p_ci: ci.trim(),
      p_phone: tel.trim(),
      p_email: correo.trim(),
      p_note: motivo.trim(),
      p_precio_mercado: venta.en_mercado ? Number(precioMercado) : null,
      p_medio: venta.en_mercado ? medio : null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const r = data as {
      tracking_code?: string;
      reservation_id?: string;
      comision_bob?: number;
      comision_payment_id?: string;
    } | null;
    push('Traspaso registrado.', 'success');
    setHecho({
      codigo: r?.tracking_code ?? '',
      comision: Number(r?.comision_bob ?? 0),
      reciboId: r?.comision_payment_id ?? null,
      reservationId: r?.reservation_id ?? null,
    });
  }

  if (hecho) {
    return (
      <Dialog open onClose={onDone} title="Traspaso registrado">
        <div className="space-y-3">
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
            La compra pasó de <strong>{venta.buyer_full_name}</strong> a{' '}
            <strong>{nombre.trim()}</strong> con el código nuevo{' '}
            <strong className="font-mono">{hecho.codigo}</strong>. Arrastra{' '}
            {formatMoney(Number(venta.pagado_total), 'BOB')} pagados y{' '}
            {formatMoney(Number(venta.saldo), 'BOB')} de saldo.
          </p>
          {hecho.comision > 0 ? (
            <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
              Venta por el mercado: se cobró la comisión de{' '}
              <strong>{formatMoney(hecho.comision, 'BOB')}</strong> al vendedor.
              {hecho.reciboId ? (
                <>
                  {' '}
                  <Link
                    href={`/admin/recibo/${hecho.reciboId}`}
                    className="font-semibold text-brand hover:underline"
                  >
                    Imprimir su recibo
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
          <p className="text-xs text-stone-500">
            La venta anterior quedó cerrada con sus recibos intactos y su contrato marcado
            anulado. El contrato del comprador nuevo ya está listo para imprimir y firmar. Si va
            en cuotas, creale su plan desde Contabilidad → Por cobrar.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {hecho.reservationId ? (
            <a
              href={`/admin/contrato/${hecho.reservationId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnSecondary}
            >
              Imprimir contrato nuevo
            </a>
          ) : null}
          <button type="button" className={btnPrimary} onClick={onDone}>
            Listo
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={`Traspasar — ${venta.tracking_code}`}>
      <div className="space-y-3">
        {/* Qué se está traspasando, con todos los números a la vista: quien
            firma esto tiene que ver el lote, la plata y qué pasa con el plan
            sin abrir otra pantalla. */}
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 uppercase">
              {Number(venta.saldo) > 0 ? 'Traspaso — compra en curso' : 'Traspaso — lote pagado'}
            </span>
            <span className="text-sm font-semibold text-stone-900">
              Mz {venta.manzana ?? '—'}, Lote {venta.lote ?? '—'}
            </span>
            <span className="text-xs text-stone-400">{venta.proyecto}</span>
            <span className="ml-auto font-mono text-xs text-stone-400">{venta.tracking_code}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-stone-500">Precio del lote</p>
              <p className="font-semibold tabular-nums">
                {formatMoney(Number(venta.price_agreed), 'BOB')}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Ya pagado</p>
              <p className="font-semibold tabular-nums text-brand">
                {formatMoney(Number(venta.pagado_total), 'BOB')}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Saldo que se cede</p>
              <p
                className={`font-semibold tabular-nums ${
                  Number(venta.saldo) > 0 ? 'text-red-600' : 'text-stone-900'
                }`}
              >
                {formatMoney(Number(venta.saldo), 'BOB')}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Plan de cuotas</p>
              <p className="font-semibold">{venta.con_plan ? 'Vigente' : 'Sin plan'}</p>
            </div>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          <p>
            <strong>Cede:</strong> {venta.buyer_full_name} · CI {venta.buyer_ci} ·{' '}
            {venta.buyer_phone}
          </p>
          <p>
            El comprador nuevo recibe{' '}
            <strong>{formatMoney(Number(venta.pagado_total), 'BOB')}</strong> ya pagados a su favor
            y asume <strong>{formatMoney(Number(venta.saldo), 'BOB')}</strong> con Terrenalv.
          </p>
          <p className="text-xs">
            La venta anterior se cierra conservando sus recibos a nombre de quien pagó, y su
            contrato queda anulado apuntando al nuevo. El contrato del comprador nuevo se genera
            solo, listo para firmar.
            {venta.con_plan
              ? ' El plan vigente se cancela con sus cuotas: las condiciones se pactan de nuevo.'
              : ''}
          </p>
        </div>
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Comprador nuevo
        </p>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre completo del comprador nuevo"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <input value={ci} onChange={(e) => setCi(e.target.value)} placeholder="CI" className={inputClass} />
          <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Celular" inputMode="tel" className={inputClass} />
        </div>
        <input
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="Correo del comprador nuevo"
          inputMode="email"
          className={inputClass}
        />
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Motivo del traspaso (queda en la auditoría)"
          className={inputClass}
        />
        {venta.en_mercado ? (
          <div className="space-y-3 rounded-lg border border-brand/30 bg-green-50/50 p-3">
            <p className="text-sm font-semibold text-stone-800">
              Esta venta está publicada en el mercado (pedía{' '}
              {formatMoney(Number(venta.mercado_pide ?? 0), 'BOB')}). La venta por el mercado paga
              a Terrenalv el <strong>{feePct}%</strong> del precio pactado; la cubre el vendedor.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-stone-500">
                  Precio de venta pactado (Bs)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={precioMercado}
                  onChange={(e) => setPrecioMercado(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">La comisión entra por</label>
                <select
                  value={medio}
                  onChange={(e) => setMedio(e.target.value as typeof medio)}
                  className={inputClass}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="manual_qr">QR / transferencia</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-stone-600">
              Comisión a cobrar:{' '}
              <strong className="tabular-nums">{formatMoney(comisionPrevista, 'BOB')}</strong> — se
              registra con recibo a nombre del vendedor y el aviso se cierra solo.
            </p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void traspasar()}>
          {busy ? 'Traspasando…' : 'Traspasar'}
        </button>
      </div>
    </Dialog>
  );
}

/* ========================================================================== */

/**
 * A nombre de quien esta una venta.
 *
 * No es cosmetico: la contabilidad fiscal importa por defecto solo lo que esta
 * a nombre de la empresa. Marcar una venta como de un tercero la deja fuera de
 * la importacion automatica — sigue entera en el gerencial, que es la verdad
 * del negocio.
 */
function TitularDialog({
  venta,
  onClose,
  onSaved,
}: {
  venta: Venta | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [titular, setTitular] = useState<'empresa' | 'tercero'>('empresa');
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!venta) return;
    setTitular(venta.titular === 'tercero' ? 'tercero' : 'empresa');
    setNombre(venta.titular_nombre ?? '');
  }, [venta]);

  if (!venta) return null;

  return (
    <Dialog open onClose={onClose} title={`A nombre de — ${venta.tracking_code}`}>
      <p className="text-sm text-stone-600">
        Cambia a nombre de quien figura esta venta. El movimiento no se toca: sigue igual en la
        contabilidad gerencial. Lo que cambia es si entra sola al libro fiscal.
      </p>

      <label className="mt-3 mb-1 block text-xs text-stone-500">Titular</label>
      <select
        value={titular}
        onChange={(e) => setTitular(e.target.value as 'empresa' | 'tercero')}
        className={inputClass}
      >
        <option value="empresa">La empresa (Terrenalv S.R.L.)</option>
        <option value="tercero">Un tercero</option>
      </select>

      {titular === 'tercero' ? (
        <div className="mt-3">
          <label className="mb-1 block text-xs text-stone-500">¿A nombre de quién?</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="ej. Juan Pérez, socio"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-stone-400">
            Queda escrito. Sin nombre no se guarda: «de un tercero» a secas no le sirve a nadie
            el día que haya que explicarlo.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await supabase.rpc('admin_asignar_titular', {
              p_reservation_id: venta.reservation_id,
              p_titular: titular,
              p_titular_nombre: titular === 'tercero' ? nombre.trim() : null,
            });
            setBusy(false);
            if (error) {
              push(adminErrorCopy(error.message), 'error');
              return;
            }
            push('Titular actualizado.', 'success');
            onSaved();
          }}
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}
