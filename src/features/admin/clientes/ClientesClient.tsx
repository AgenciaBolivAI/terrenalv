'use client';

// Perfil de cliente: una persona, todos sus lotes, toda su plata.
//
// Todo lo demás del panel gira alrededor de la venta; esta pantalla gira
// alrededor de la PERSONA, que es como llama la gente a la oficina: «soy
// Fulano, ¿cuánto debo?». El cliente se arma agrupando por carnet normalizado
// (v_clientes) — no hay tabla de clientes, y no hace falta: la llave ya existe.
//
// Sin filtro de urbanización a propósito: un cliente es de la EMPRESA. Sus
// lotes pueden estar repartidos en tres urbanizaciones y la pregunta «¿cuánto
// debe?» es una sola. El desglose por proyecto se ve en su actividad.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import {
  Badge,
  EmptyState,
  Kpi,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import RegistrarCobroDialog from '@/features/admin/contabilidad/RegistrarCobro';
import type { CobroTarget } from '@/features/admin/contabilidad/types';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { etiquetaDeMovimiento } from './etiquetas';

interface Cliente {
  ci_norm: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  reservas_totales: number;
  lotes_comprados: number;
  lotes_reservados: number;
  reservas_expiradas: number;
  reservas_canceladas: number;
  traspasos_cedidos: number;
  traspasos_recibidos: number;
  proyectos: number;
  /** Valor de venta acordado de los lotes que compro. */
  comprado_total: number;
  pagado_total: number;
  saldo_total: number;
  con_plan: number;
  cuotas_vencidas: number;
  monto_vencido: number;
  primera_actividad: string;
  ultima_actividad: string | null;
  comisiones_pagadas: number;
  avisos_mercado: number;
  avisos_activos: number;
  vendidos_mercado: number;
  vendido_mercado_bob: number;
  /** Nombres distintos bajo el mismo carnet: >1 huele a perfiles fusionados. */
  nombres_distintos: number;
  nombres_vistos: string;
}

interface Actividad {
  reservation_id: string;
  tracking_code: string;
  estado: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  price_agreed: number;
  created_at: string;
  fecha_confirmada: string | null;
  fecha_cancelada: string | null;
  cancel_reason: string | null;
  recibida_por_traspaso: boolean;
  cedida_por_traspaso: boolean;
  cedida_a_tracking: string | null;
  origen_label: string;
  pagado_total: number | null;
  saldo: number | null;
  con_plan: boolean | null;
  comprada_en_mercado: boolean;
  precio_mercado: number | null;
  vendida_en_mercado: boolean;
  project_id: string;
  lot_id: string | null;
  area_m2: number | null;
  frontage_m: number | null;
  depth_m: number | null;
  es_esquina: boolean | null;
  lot_status: string | null;
  precio_lista: number | null;
  cobrado_aqui: number | null;
  abonado_migrado: number | null;
  deuda_migrada: number | null;
  sena_pagada: number | null;
  sena_forma: string | null;
  traspaso_de_tracking: string | null;
  traspaso_de_comprador: string | null;
  cedida_a_comprador: string | null;
  buyer_full_name: string;
  buyer_phone: string;
}

interface PlanResumen {
  plan_id: string;
  estado: string;
  total_price: number;
  down_payment: number;
  financed_amount: number;
  months: number;
  monthly_amount: number;
  first_due_date: string;
  cuotas_totales: number;
  cuotas_pagadas: number;
  cuotas_vencidas: number;
  pagado: number;
  saldo: number;
  monto_vencido: number;
  proxima_cuota: string | null;
  dias_atraso: number | null;
  avance_pct: number;
}

interface PagoCadena {
  payment_id: string;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  estado: string;
  fecha: string | null;
  created_at: string;
  tiene_recibo: boolean;
  buyer_full_name: string;
  tracking_code: string;
  de_comprador_anterior: boolean;
}

interface Cuota {
  id: string;
  number: number;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: string;
}

interface AvisoCliente {
  listing_id: string;
  status: 'activa' | 'pausada' | 'cerrada';
  asking_price_bob: number;
  note: string | null;
  publicada: string;
  closed_reason: string | null;
  sale_price_bob: number | null;
  fee_pct: number;
  fee_bob: number | null;
  fee_payment_id: string | null;
  tracking_code: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  consultas: number;
  vendido_a: string | null;
  vendido_a_tracking: string | null;
}

interface Pago {
  payment_id: string;
  tracking_code: string;
  proyecto: string;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  estado: string;
  fecha: string | null;
  created_at: string;
  tiene_recibo: boolean;
  motivo_rechazo: string | null;
}

const ESTADO_BADGE: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  en_verificacion: 'bg-amber-100 text-amber-800',
  rechazo_reintento: 'bg-amber-100 text-amber-800',
  expirada: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-stone-200 text-stone-600',
};

const ESTADO_LABEL: Record<string, string> = {
  confirmada: 'Comprado',
  pendiente_pago: 'Reservado',
  en_verificacion: 'En verificación',
  rechazo_reintento: 'Reintento',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

const PAGO_BADGE: Record<string, string> = {
  aprobado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
  cancelado: 'bg-stone-200 text-stone-600',
};

type Filtro = 'todos' | 'con_saldo' | 'en_mora' | 'con_reservas' | 'varios_lotes' | 'en_mercado';

const CHIPS: { id: Filtro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'con_saldo', label: 'Con saldo' },
  { id: 'en_mora', label: 'En mora' },
  { id: 'con_reservas', label: 'Con reservas en curso' },
  { id: 'varios_lotes', label: 'Varios lotes' },
  { id: 'en_mercado', label: 'En el mercado' },
];

export default function ClientesClient({ abrirCi }: { abrirCi: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const { push } = useToast();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [actividad, setActividad] = useState<Actividad[] | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const [mercado, setMercado] = useState<AvisoCliente[] | null>(null);
  const [editar, setEditar] = useState<Cliente | null>(null);
  const [ficha, setFicha] = useState<Actividad | null>(null);
  const abiertoRef = useRef<string | null>(null);
  abiertoRef.current = abierto;
  const detailRef = useRef<HTMLTableRowElement | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(abrirCi);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    // Paginado: son ~1.400 clientes migrados y PostgREST corta en 1.000.
    const todos: Cliente[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data } = await supabase
        .from('v_clientes')
        .select('*')
        .order('ultima_actividad', { ascending: false })
        .order('ci_norm')
        .range(desde, desde + 999);
      todos.push(...((data ?? []) as Cliente[]));
      if (!data || data.length < 1000) break;
    }
    setRows(todos);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const abrirPerfil = useCallback(
    async (ci: string) => {
      if (abiertoRef.current === ci) {
        setAbierto(null);
        return;
      }
      setAbierto(ci);
      setActividad(null);
      setPagos(null);
      setMercado(null);
      const [a, p, m] = await Promise.all([
        supabase
          .from('v_cliente_actividad')
          .select('*')
          .eq('ci_norm', ci)
          .order('created_at', { ascending: false }),
        supabase
          .from('v_historial_pagos')
          .select('*')
          .eq('ci_norm', ci)
          .order('created_at', { ascending: false }),
        supabase
          .from('v_cliente_mercado')
          .select('*')
          .eq('ci_norm', ci)
          .order('publicada', { ascending: false }),
      ]);
      if (abiertoRef.current !== ci) return;
      setActividad((a.data ?? []) as Actividad[]);
      setPagos((p.data ?? []) as unknown as Pago[]);
      setMercado((m.data ?? []) as AvisoCliente[]);
    },
    [supabase],
  );

  // Enlace profundo ?ci= — el perfil se abre solo al llegar desde otra pantalla.
  useEffect(() => {
    if (loading || !scrollTo) return;
    // El enlace puede traer el CI crudo (7896541-1E) o el normalizado: se
    // acepta cualquiera de los dos, porque quien enlaza no tiene por qué saber
    // cómo normaliza la base.
    const destino = rows.find((r) => r.ci_norm === scrollTo || r.buyer_ci === scrollTo);
    if (destino) {
      void abrirPerfil(destino.ci_norm);
    }
    setScrollTo(null);
  }, [loading, rows, scrollTo, abrirPerfil]);

  useEffect(() => {
    if (abierto && detailRef.current) {
      detailRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [abierto, actividad]);

  const totals = useMemo(
    () => ({
      clientes: rows.length,
      conSaldo: rows.filter((r) => Number(r.saldo_total) > 0).length,
      enMora: rows.filter((r) => Number(r.cuotas_vencidas) > 0).length,
      conReservas: rows.filter((r) => Number(r.lotes_reservados) > 0).length,
      comprado: rows.reduce((s, r) => s + Number(r.comprado_total ?? 0), 0),
      pagado: rows.reduce((s, r) => s + Number(r.pagado_total), 0),
      saldo: rows.reduce((s, r) => s + Number(r.saldo_total), 0),
    }),
    [rows],
  );

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === 'con_saldo' && !(Number(r.saldo_total) > 0)) return false;
      if (filtro === 'en_mora' && !(Number(r.cuotas_vencidas) > 0)) return false;
      if (filtro === 'con_reservas' && !(Number(r.lotes_reservados) > 0)) return false;
      if (filtro === 'varios_lotes' && !(Number(r.lotes_comprados) > 1)) return false;
      if (
        filtro === 'en_mercado' &&
        !(Number(r.avisos_activos) > 0 || Number(r.vendidos_mercado) > 0)
      )
        return false;
      if (!q) return true;
      return (
        r.buyer_full_name.toLowerCase().includes(q) ||
        r.buyer_ci.toLowerCase().includes(q) ||
        (r.buyer_phone ?? '').includes(q) ||
        (r.buyer_email ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, filtro]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Clientes</h1>
        <p className="text-xs text-stone-500">
          Toda la empresa: un cliente puede tener lotes en varias urbanizaciones.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Clientes"
          value={String(totals.clientes)}
          hint={`${totals.conReservas} con reservas en curso — ver`}
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Nos han pagado"
          value={formatMoney(totals.pagado, 'BOB')}
          hint="todo lo aprobado, de todas sus compras"
          tone="good"
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Nos deben"
          value={formatMoney(totals.saldo, 'BOB')}
          hint={`${totals.conSaldo} cliente(s) con saldo — ver`}
          onClick={() => setFiltro('con_saldo')}
        />
        <Kpi
          label="En mora"
          value={String(totals.enMora)}
          hint="con cuotas vencidas — ver"
          tone={totals.enMora > 0 ? 'bad' : 'normal'}
          onClick={() => setFiltro('en_mora')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={filtro === c.id}
              onClick={() => setFiltro(c.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filtro === c.id
                  ? 'bg-brand text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {c.label}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, CI, teléfono o correo"
            className={`${inputClass} ml-auto w-auto min-w-64`}
          />
          <ExportButtons
            disabled={!visibles.length}
            orientation="landscape"
            meta={{
              title: 'Clientes',
              subtitle: 'Terrenalv S.R.L. — todas las urbanizaciones',
              filename: `clientes-${new Date().toISOString().slice(0, 10)}`,
              footnote:
                'Valor acordado: el precio de los lotes que conserva. Pagado incluye lo abonado en el sistema anterior y lo pagado en lotes que despu\u00e9s cedi\u00f3 por traspaso \u2014 por eso en esos casos pagado puede superar al valor acordado. Saldo y mora, de las ventas vivas.',
            }}
            columns={[
              { header: 'Cliente' },
              { header: 'CI' },
              { header: 'Teléfono' },
              { header: 'Comprados', align: 'right' },
              { header: 'Valor acordado', align: 'right' },
              { header: 'Reservados', align: 'right' },
              { header: 'Pagado', align: 'right' },
              { header: 'Saldo', align: 'right' },
              { header: 'Cuotas vencidas', align: 'right' },
              { header: 'Última actividad' },
            ]}
            rows={() =>
              visibles.map((r) => [
                r.buyer_full_name,
                r.buyer_ci,
                r.buyer_phone,
                fnum(Number(r.lotes_comprados), 0),
                fnum(Number(r.comprado_total ?? 0)),
                fnum(Number(r.lotes_reservados), 0),
                fnum(Number(r.pagado_total)),
                fnum(Number(r.saldo_total)),
                fnum(Number(r.cuotas_vencidas), 0),
                r.ultima_actividad ? dateLabel(r.ultima_actividad) : '—',
              ]) as XCell[][]
            }
          />
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}
              hint={
                rows.length
                  ? 'Probá con otro filtro o limpiá la búsqueda.'
                  : 'Los clientes aparecen solos con la primera reserva o venta.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cliente</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Comprados
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Reservados
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Valor acordado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Pagado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Saldo
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Mora</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Últ. actividad</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <Fragment key={r.ci_norm}>
                    <tr
                      onClick={() => void abrirPerfil(r.ci_norm)}
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        abierto === r.ci_norm ? 'bg-green-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-stone-900">{r.buyer_full_name}</p>
                        <p className="text-xs text-stone-400">
                          CI {r.buyer_ci} · {r.buyer_phone}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.lotes_comprados}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(r.lotes_reservados) > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800">{r.lotes_reservados}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-stone-800">
                        {Number(r.comprado_total ?? 0) > 0
                          ? formatMoney(Number(r.comprado_total), 'BOB')
                          : '\u2014'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(r.pagado_total), 'BOB')}
                        {/* Si cedio un lote, lo que pago incluye plata de un
                            lote que ya no es suyo: sin esta marca, la fila
                            parece un sobrepago. */}
                        {Number(r.traspasos_cedidos) > 0 ? (
                          <span
                            className="ml-1 cursor-help text-[11px] text-amber-700"
                            title={`Incluye lo pagado en ${r.traspasos_cedidos} lote(s) que despu\u00e9s cedi\u00f3 por traspaso.`}
                          >
                            +ced.
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          Number(r.saldo_total) > 0 ? 'text-red-600' : 'text-stone-900'
                        }`}
                      >
                        {formatMoney(Number(r.saldo_total), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {Number(r.cuotas_vencidas) > 0 ? (
                          <Badge className="bg-red-100 text-red-700">
                            {r.cuotas_vencidas} · {formatMoney(Number(r.monto_vencido), 'BOB')}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-400">
                        {r.ultima_actividad ? dateLabel(r.ultima_actividad) : '—'}
                      </td>
                    </tr>

                    {abierto === r.ci_norm ? (
                      <tr ref={detailRef} className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="mb-3 flex flex-wrap items-center gap-3">
                            <div>
                              <p className="text-sm font-bold text-stone-900">{r.buyer_full_name}</p>
                              <p className="text-xs text-stone-500">
                                CI {r.buyer_ci} · {r.buyer_phone}
                                {r.buyer_email ? ` · ${r.buyer_email}` : ''}
                                {Number(r.proyectos) > 1
                                  ? ` · en ${r.proyectos} urbanizaciones`
                                  : ''}
                              </p>
                            </div>
                            <a
                              href={waLink(
                                r.buyer_phone,
                                `Hola ${r.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv.`,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                            >
                              <IconWhatsapp className="h-4 w-4" /> WhatsApp
                            </a>
                            <button
                              type="button"
                              className={btnSecondary}
                              onClick={() => setEditar(r)}
                            >
                              Editar perfil
                            </button>
                            {Number(r.nombres_distintos) > 1 ? (
                              <span
                                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800"
                                title={`Este carnet aparece con nombres distintos: ${r.nombres_vistos}. Puede que sean DOS personas con el mismo CI mal tecleado — un perfil es una persona. Corregí el CI en la venta equivocada desde Ventas.`}
                              >
                                ¿Dos personas en un perfil?
                              </span>
                            ) : null}
                            {(r.traspasos_cedidos > 0 || r.traspasos_recibidos > 0) && (
                              <span className="text-xs text-stone-500">
                                {r.traspasos_recibidos > 0
                                  ? `${r.traspasos_recibidos} lote(s) recibidos por traspaso. `
                                  : ''}
                                {r.traspasos_cedidos > 0
                                  ? `${r.traspasos_cedidos} lote(s) cedidos.`
                                  : ''}
                              </span>
                            )}
                            {Number(r.avisos_activos) > 0 ? (
                              <Badge className="bg-green-100 text-green-800">
                                {r.avisos_activos} aviso(s) en el mercado
                              </Badge>
                            ) : null}
                            {Number(r.vendidos_mercado) > 0 ? (
                              <span className="text-xs text-stone-500">
                                Vendió {r.vendidos_mercado} lote(s) por el mercado por{' '}
                                {formatMoney(Number(r.vendido_mercado_bob), 'BOB')} · comisiones
                                pagadas {formatMoney(Number(r.comisiones_pagadas), 'BOB')}.
                              </span>
                            ) : null}
                          </div>

                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Sus lotes y reservas
                              </p>
                              {actividad === null ? (
                                <div className="mt-3">
                                  <Spinner />
                                </div>
                              ) : actividad.length === 0 ? (
                                <p className="mt-2 text-sm text-stone-500">Sin actividad.</p>
                              ) : (
                                <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                  {actividad.map((a) => (
                                    <li
                                      key={a.reservation_id}
                                      className="cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-green-50/60"
                                      onClick={() => setFicha(a)}
                                      title="Abrir la ficha del lote"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        {/* La MISMA etiqueta que usa el
                                            historial: un lote recibido por
                                            traspaso no se «compró», y decirlo
                                            distinto en cada pantalla confunde
                                            a quien atiende. */}
                                        {(() => {
                                          const et = etiquetaDeMovimiento(a);
                                          return <Badge className={et.clase}>{et.texto}</Badge>;
                                        })()}
                                        <span className="text-stone-800">
                                          Mz {a.manzana ?? '—'}, Lote {a.lote ?? '—'}
                                        </span>
                                        <span className="text-xs text-stone-400">{a.proyecto}</span>
                                        {a.estado === 'confirmada' ? (
                                          <Link
                                            href={`/admin/ventas?open=${a.reservation_id}`}
                                            className="ml-auto font-mono text-xs font-semibold text-brand hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {a.tracking_code}
                                          </Link>
                                        ) : (
                                          <span className="ml-auto font-mono text-xs text-stone-400">
                                            {a.tracking_code}
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-xs text-stone-500">
                                        {a.origen_label} · {dateLabel(a.fecha_confirmada ?? a.created_at)}
                                        {a.estado === 'confirmada' && a.saldo !== null ? (
                                          <>
                                            {' '}
                                            · pagado {formatMoney(Number(a.pagado_total ?? 0), 'BOB')} ·{' '}
                                            <span
                                              className={
                                                Number(a.saldo) > 0 ? 'font-semibold text-red-600' : ''
                                              }
                                            >
                                              saldo {formatMoney(Number(a.saldo), 'BOB')}
                                            </span>
                                            {a.con_plan ? ' · con plan' : ''}
                                          </>
                                        ) : null}
                                        {a.cedida_por_traspaso
                                          ? ` · ${
                                              a.vendida_en_mercado
                                                ? 'vendida por el mercado'
                                                : 'cedida'
                                            } (${a.cedida_a_tracking ?? '—'})`
                                          : ''}
                                        {a.recibida_por_traspaso
                                          ? a.comprada_en_mercado
                                            ? ` · comprada en el mercado${
                                                a.precio_mercado !== null
                                                  ? ` por ${formatMoney(Number(a.precio_mercado), 'BOB')}`
                                                  : ''
                                              }`
                                            : ' · recibida por traspaso'
                                          : ''}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            <div>
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Todos sus pagos
                              </p>
                              {pagos === null ? (
                                <div className="mt-3">
                                  <Spinner />
                                </div>
                              ) : pagos.length === 0 ? (
                                <p className="mt-2 text-sm text-stone-500">
                                  Sin pagos registrados acá
                                  {Number(r.pagado_total) > 0
                                    ? ' (lo pagado viene del sistema anterior)'
                                    : ''}
                                  .
                                </p>
                              ) : (
                                <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                  {pagos.map((p) => (
                                    <li
                                      key={p.payment_id}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                                    >
                                      <span className="whitespace-nowrap text-xs text-stone-500">
                                        {dateLabel(p.fecha ?? p.created_at)}
                                      </span>
                                      <Badge className="bg-stone-100 text-stone-600">{p.tipo}</Badge>
                                      <span className="text-xs text-stone-400">{p.forma}</span>
                                      <span className="text-xs text-stone-400">{p.proyecto}</span>
                                      {p.estado !== 'aprobado' ? (
                                        <Badge
                                          className={PAGO_BADGE[p.estado] ?? 'bg-amber-100 text-amber-800'}
                                        >
                                          {p.estado}
                                        </Badge>
                                      ) : null}
                                      <span
                                        className={`ml-auto font-semibold tabular-nums ${
                                          p.estado === 'aprobado'
                                            ? 'text-stone-900'
                                            : 'text-stone-400 line-through'
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
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>

                          {mercado !== null && mercado.length > 0 ? (
                            <div className="mt-4">
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Su actividad en el mercado de traspasos
                              </p>
                              <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                {mercado.map((av) => (
                                  <li key={av.listing_id} className="px-3 py-2 text-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge
                                        className={
                                          av.fee_payment_id
                                            ? 'bg-green-100 text-green-800'
                                            : av.status === 'activa'
                                              ? 'bg-green-100 text-green-700'
                                              : av.status === 'pausada'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-stone-200 text-stone-600'
                                        }
                                      >
                                        {av.fee_payment_id
                                          ? 'Vendido por el mercado'
                                          : av.status === 'activa'
                                            ? 'En la vidriera'
                                            : av.status === 'pausada'
                                              ? 'Pausado'
                                              : 'Cerrado'}
                                      </Badge>
                                      <span className="text-stone-800">
                                        Mz {av.manzana ?? '—'}, Lote {av.lote ?? '—'}
                                      </span>
                                      <span className="text-xs text-stone-400">{av.proyecto}</span>
                                      <span className="ml-auto text-xs text-stone-500">
                                        publicado {dateLabel(av.publicada)}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-stone-500">
                                      {av.fee_payment_id ? (
                                        <>
                                          Vendido a <strong>{av.vendido_a ?? '—'}</strong> en{' '}
                                          {formatMoney(Number(av.sale_price_bob ?? 0), 'BOB')} —
                                          comisión del {Number(av.fee_pct)}%:{' '}
                                          {formatMoney(Number(av.fee_bob ?? 0), 'BOB')} ·{' '}
                                          <a
                                            href={`/admin/recibo/${av.fee_payment_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-semibold text-brand hover:underline"
                                          >
                                            recibo
                                          </a>
                                        </>
                                      ) : (
                                        <>
                                          Pide {formatMoney(Number(av.asking_price_bob), 'BOB')} ·{' '}
                                          {av.consultas} consulta(s) · comisión pactada{' '}
                                          {Number(av.fee_pct)}%
                                          {av.status === 'cerrada' && av.closed_reason
                                            ? ` · ${av.closed_reason}`
                                            : ''}
                                        </>
                                      )}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <button
                              type="button"
                              className={btnSecondary}
                              onClick={() => setAbierto(null)}
                            >
                              Cerrar
                            </button>
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
          Un perfil es UNA persona, agrupada por su carnet. Si el mismo CI aparece con nombres
          distintos, la fila lo avisa: son dos personas fusionadas por un CI mal tecleado y hay
          que corregirlo en la venta equivocada.{' '}
          Pagado suma todo lo aprobado de la persona — incluidas señas de reservas que después
          vencieron (esa plata entró igual) y lo abonado en el sistema anterior. Saldo y mora, de
          sus ventas vivas. Las comisiones del mercado van aparte: son un servicio, no pagan
          terreno.
        </p>
      </section>

      {ficha ? (
        <FichaLoteDialog
          a={ficha}
          aviso={(mercado ?? []).find((m) => m.tracking_code === ficha.tracking_code) ?? null}
          onClose={() => setFicha(null)}
          onChanged={() => {
            void fetchAll();
            if (abiertoRef.current) void abrirPerfil(abiertoRef.current);
            setFicha(null);
          }}
        />
      ) : null}

      {editar ? (
        <EditarClienteDialog
          cliente={editar}
          onClose={() => setEditar(null)}
          onSaved={(ciNuevo) => {
            setEditar(null);
            setAbierto(null);
            setScrollTo(ciNuevo);
            void fetchAll();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

/**
 * Editar al cliente como PERSONA: el cambio alcanza a TODAS sus reservas y
 * ventas de una vez (el comprador vive desnormalizado en cada reserva y este
 * diálogo es quien lo mantiene coherente).
 *
 * Cambiar el CI cambia la llave del cliente; si el carnet nuevo ya es de otro
 * perfil, ambos se FUSIONAN en uno — es lo correcto cuando la misma persona
 * quedó partida en dos por un carnet mal tipeado, y el aviso lo dice antes.
 */
function EditarClienteDialog({
  cliente,
  onClose,
  onSaved,
}: {
  cliente: Cliente;
  onClose: () => void;
  onSaved: (ciNuevo: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [nombre, setNombre] = useState(cliente.buyer_full_name);
  const [ci, setCi] = useState(cliente.buyer_ci);
  const [tel, setTel] = useState(cliente.buyer_phone ?? '');
  const [correo, setCorreo] = useState(cliente.buyer_email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (nombre.trim().length < 3) {
      setError('El nombre no puede quedar vacío.');
      return;
    }
    if (ci.trim() === '') {
      setError('El CI no puede quedar vacío: es la llave del cliente.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('admin_editar_cliente', {
      p_ci_norm: cliente.ci_norm,
      p_full_name: nombre.trim(),
      p_ci: ci.trim(),
      p_phone: tel.trim() || null,
      p_email: correo.trim(),
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const r = data as {
      reservas_actualizadas?: number;
      ci_norm?: string;
      fusionado?: boolean;
    } | null;
    push(
      r?.fusionado
        ? `Perfil guardado y fusionado con el cliente que ya tenía ese CI (${r?.reservas_actualizadas ?? 0} reservas).`
        : `Perfil actualizado en ${r?.reservas_actualizadas ?? 0} reserva(s).`,
      'success',
    );
    onSaved(r?.ci_norm ?? cliente.ci_norm);
  }

  return (
    <Dialog open onClose={onClose} title={`Editar cliente — ${cliente.buyer_full_name}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Lo que cambies acá vale para <strong>todas</strong> sus reservas y ventas (
          {cliente.reservas_totales}): los recibos futuros, el WhatsApp y las búsquedas usan estos
          datos.
        </p>
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
            <input
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              inputMode="tel"
              className={inputClass}
            />
          </div>
        </div>
        <input
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="Correo (vacío = sin correo)"
          inputMode="email"
          className={inputClass}
        />
        {ci.trim() !== '' && ci.trim() !== cliente.buyer_ci ? (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            Estás cambiando el CI, que es la llave del cliente. Si el carnet nuevo ya pertenece a
            otro perfil, los dos se <strong>fusionan</strong> en uno solo — útil si la misma
            persona quedó partida en dos por un carnet mal tipeado.
          </p>
        ) : null}
        {cliente.buyer_ci.startsWith('MIGRADO') ? (
          <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
            El CI dice «{cliente.buyer_ci}» porque la fuente no traía documento y no se inventó
            ninguno. Completalo con el contrato delante.
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
 * La ficha del lote: TODO lo de esta compra en un solo lugar, con sus mandos.
 *
 * El lote físico (superficie, frente × fondo, esquina), la plata con su
 * desglose, el plan cuota por cuota, sus pagos con recibo, su paso por el
 * mercado y su cadena de traspaso — y desde acá mismo se cobra, se abre la
 * venta o el plan, y se escribe al comprador. Es la misma regla de los KPI:
 * ningún número sin camino a lo que cuenta.
 */
function FichaLoteDialog({
  a,
  aviso,
  onClose,
  onChanged,
}: {
  a: Actividad;
  aviso: AvisoCliente | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [plan, setPlan] = useState<PlanResumen | null>(null);
  const [cuotas, setCuotas] = useState<Cuota[] | null>(null);
  const [pagos, setPagos] = useState<PagoCadena[]>([]);
  const [cargado, setCargado] = useState(false);
  const [cobrar, setCobrar] = useState<CobroTarget | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      // Los pagos de ESTE lote, cadena incluida: si el lote vino por traspaso,
      // lo que pagó el comprador anterior también es su historia.
      const { data: pg } = await supabase
        .from('v_historial_pagos_cadena')
        .select('*')
        .eq('venta_id', a.reservation_id)
        .order('created_at', { ascending: false });
      if (vivo) setPagos((pg ?? []) as unknown as PagoCadena[]);

      const { data: pl } = await supabase
        .from('v_planes')
        .select('*')
        .eq('reservation_id', a.reservation_id)
        .order('estado', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      const planRow = (pl as PlanResumen | null) ?? null;
      setPlan(planRow);
      if (planRow) {
        const { data: cs } = await supabase
          .from('installments')
          .select('id, number, due_date, amount, amount_paid, status')
          .eq('plan_id', planRow.plan_id)
          .order('number');
        if (!vivo) return;
        setCuotas((cs ?? []) as Cuota[]);
      }
      setCargado(true);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, a.reservation_id]);

  const esVenta = a.estado === 'confirmada';
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`Mz ${a.manzana ?? '—'}, Lote ${a.lote ?? '—'} — ${a.proyecto}`}
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {/* -------- resumen: qué es y en qué estado está -------- */}
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const et = etiquetaDeMovimiento(a);
            return <Badge className={et.clase}>{et.texto}</Badge>;
          })()}
          <span className="font-mono text-xs text-stone-500">{a.tracking_code}</span>
          <span className="text-xs text-stone-400">
            {a.origen_label} · {dateLabel(a.fecha_confirmada ?? a.created_at)}
          </span>
          {aviso && !aviso.fee_payment_id && aviso.status === 'activa' ? (
            <Badge className="bg-green-100 text-green-800">En el mercado</Badge>
          ) : null}
        </div>

        {/* -------- el lote físico -------- */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-stone-500">Superficie</p>
            <p className="font-semibold tabular-nums">
              {a.area_m2 !== null ? `${Number(a.area_m2).toFixed(0)} m²` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Frente × fondo</p>
            <p className="font-semibold tabular-nums">
              {a.frontage_m !== null && a.depth_m !== null
                ? `${Number(a.frontage_m)} × ${Number(a.depth_m)} m`
                : '—'}
              {a.es_esquina ? ' · esquina' : ''}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Precio de lista</p>
            <p className="font-semibold tabular-nums">
              {a.precio_lista !== null ? formatMoney(Number(a.precio_lista), 'BOB') : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Precio pactado</p>
            <p className="font-semibold tabular-nums">
              {formatMoney(Number(a.price_agreed), 'BOB')}
            </p>
          </div>
        </div>

        {/* -------- la plata -------- */}
        {esVenta ? (
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-stone-500">Pagado</p>
                <p className="text-lg font-bold tabular-nums text-brand">
                  {formatMoney(Number(a.pagado_total ?? 0), 'BOB')}
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Saldo</p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    Number(a.saldo ?? 0) > 0 ? 'text-red-600' : 'text-stone-900'
                  }`}
                >
                  {formatMoney(Number(a.saldo ?? 0), 'BOB')}
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Avance</p>
                <p className="text-lg font-bold tabular-nums">
                  {Number(a.pagado_total ?? 0) + Number(a.saldo ?? 0) > 0
                    ? `${Math.round(
                        (Number(a.pagado_total ?? 0) /
                          (Number(a.pagado_total ?? 0) + Number(a.saldo ?? 0))) *
                          100,
                      )}%`
                    : '—'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-stone-500">
              {Number(a.abonado_migrado ?? 0) > 0
                ? `${formatMoney(Number(a.abonado_migrado), 'BOB')} ${
                    a.recibida_por_traspaso ? 'del comprador anterior' : 'en el sistema anterior'
                  } + ${formatMoney(Number(a.cobrado_aqui ?? 0), 'BOB')} acá. `
                : ''}
              {Number(a.sena_pagada ?? 0) > 0
                ? `Seña de ${formatMoney(Number(a.sena_pagada), 'BOB')}${
                    a.sena_forma ? ` por ${a.sena_forma}` : ''
                  } (aparte del precio).`
                : ''}
              {a.deuda_migrada !== null
                ? ` El saldo corre contra la deuda reportada de ${formatMoney(Number(a.deuda_migrada), 'BOB')}.`
                : ''}
            </p>
          </div>
        ) : null}

        {/* -------- traspaso y mercado -------- */}
        {a.recibida_por_traspaso || a.cedida_por_traspaso || aviso ? (
          <div className="space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
            {a.recibida_por_traspaso ? (
              <p>
                Recibida por traspaso de <strong>{a.traspaso_de_comprador ?? '—'}</strong> (
                {a.traspaso_de_tracking ?? '—'})
                {a.comprada_en_mercado
                  ? ` — comprada en el mercado por ${formatMoney(Number(a.precio_mercado ?? 0), 'BOB')}`
                  : ''}
                .
              </p>
            ) : null}
            {a.cedida_por_traspaso ? (
              <p>
                Cedida a <strong>{a.cedida_a_comprador ?? '—'}</strong> ({a.cedida_a_tracking ?? '—'})
                {a.vendida_en_mercado ? ' — vendida por el mercado' : ''}.
              </p>
            ) : null}
            {aviso ? (
              aviso.fee_payment_id ? (
                <p>
                  Vendida por el mercado a <strong>{aviso.vendido_a ?? '—'}</strong> en{' '}
                  {formatMoney(Number(aviso.sale_price_bob ?? 0), 'BOB')} — comisión{' '}
                  {formatMoney(Number(aviso.fee_bob ?? 0), 'BOB')} ({Number(aviso.fee_pct)}%) ·{' '}
                  <a
                    href={`/admin/recibo/${aviso.fee_payment_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-brand hover:underline"
                  >
                    recibo
                  </a>
                </p>
              ) : (
                <p>
                  En el mercado ({aviso.status}): pide{' '}
                  {formatMoney(Number(aviso.asking_price_bob), 'BOB')} · {aviso.consultas}{' '}
                  consulta(s) · comisión pactada {Number(aviso.fee_pct)}%.
                </p>
              )
            ) : null}
          </div>
        ) : null}

        {/* -------- el plan, cuota por cuota -------- */}
        {esVenta ? (
          !cargado ? (
            <Spinner label="Cargando plan…" />
          ) : plan ? (
            <div className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <p className="font-semibold text-stone-900">
                  Plan {plan.estado === 'activo' ? 'activo' : plan.estado}:{' '}
                  {formatMoney(Number(plan.monthly_amount), 'BOB')}/mes × {plan.months}
                </p>
                <p className="text-xs text-stone-500">
                  {plan.cuotas_pagadas}/{plan.cuotas_totales} pagadas · avance{' '}
                  {Number(plan.avance_pct)}%
                </p>
                {Number(plan.cuotas_vencidas) > 0 ? (
                  <Badge className="bg-red-100 text-red-700">
                    {plan.cuotas_vencidas} vencida(s) · {formatMoney(Number(plan.monto_vencido), 'BOB')}
                    {plan.dias_atraso ? ` · ${plan.dias_atraso} días` : ''}
                  </Badge>
                ) : plan.proxima_cuota ? (
                  <span className="text-xs text-stone-500">
                    próxima vence {dateLabel(plan.proxima_cuota)}
                  </span>
                ) : null}
                <a
                  href={`/admin/plan/${plan.plan_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs font-semibold text-brand hover:underline"
                >
                  Imprimir plan
                </a>
                <Link
                  href={`/admin/planes?open=${plan.plan_id}`}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Abrir en Planes
                </Link>
              </div>
              {cuotas && cuotas.length > 0 ? (
                <div className="mt-2 max-h-44 overflow-y-auto rounded border border-stone-100">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-stone-50">
                      <tr className="text-left text-stone-500">
                        <th className="px-2 py-1 font-semibold">#</th>
                        <th className="px-2 py-1 font-semibold">Vence</th>
                        <th className="px-2 py-1 text-right font-semibold">Cuota</th>
                        <th className="px-2 py-1 text-right font-semibold">Pagado</th>
                        <th className="px-2 py-1 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuotas.map((c) => {
                        const vencida =
                          c.status !== 'pagada' && c.due_date < hoy && Number(c.amount_paid) < Number(c.amount);
                        return (
                          <tr key={c.id} className="border-t border-stone-100">
                            <td className="px-2 py-1 tabular-nums">{c.number}</td>
                            <td className="px-2 py-1">{dateLabel(c.due_date)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatMoney(Number(c.amount), 'BOB')}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {Number(c.amount_paid) > 0 ? formatMoney(Number(c.amount_paid), 'BOB') : '—'}
                            </td>
                            <td className="px-2 py-1">
                              <Badge
                                className={
                                  c.status === 'pagada'
                                    ? 'bg-green-100 text-green-700'
                                    : vencida
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-stone-100 text-stone-600'
                                }
                              >
                                {c.status === 'pagada' ? 'pagada' : vencida ? 'vencida' : c.status}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-stone-500">
              Sin plan de cuotas: paga por abonos libres. Si va a ir en cuotas, el plan se crea
              desde Contabilidad → Por cobrar.
            </p>
          )
        ) : null}

        {/* -------- pagos de ESTE lote -------- */}
        {pagos.length > 0 ? (
          <div>
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Pagos de este lote
            </p>
            <ul className="mt-1 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
              {pagos.map((pg) => (
                <li key={pg.payment_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
                  <span className="text-xs text-stone-500">{dateLabel(pg.fecha ?? pg.created_at)}</span>
                  <Badge className="bg-stone-100 text-stone-600">{pg.tipo}</Badge>
                  <span className="text-xs text-stone-400">{pg.forma}</span>
                  {pg.de_comprador_anterior ? (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                      title={`Pago de ${pg.buyer_full_name} (${pg.tracking_code}), antes del traspaso.`}
                    >
                      {pg.buyer_full_name.split(' ')[0]} (antes)
                    </span>
                  ) : null}
                  {pg.estado !== 'aprobado' ? (
                    <Badge className={PAGO_BADGE[pg.estado] ?? 'bg-amber-100 text-amber-800'}>
                      {pg.estado}
                    </Badge>
                  ) : null}
                  <span
                    className={`ml-auto font-semibold tabular-nums ${
                      pg.estado === 'aprobado' ? 'text-stone-900' : 'text-stone-400 line-through'
                    }`}
                  >
                    {formatMoney(Number(pg.amount), pg.currency)}
                  </span>
                  {pg.tiene_recibo ? (
                    <a
                      href={`/admin/recibo/${pg.payment_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-brand hover:underline"
                    >
                      Recibo
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* -------- los mandos -------- */}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-3">
        <a
          href={waLink(
            a.buyer_phone,
            `Hola ${a.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv por su lote Mz ${a.manzana ?? ''}, Lote ${a.lote ?? ''} (${a.tracking_code}).`,
          )}
          target="_blank"
          rel="noopener noreferrer"
          className={btnSecondary}
        >
          WhatsApp
        </a>
        {aviso && !aviso.fee_payment_id ? (
          <Link href="/admin/mercado" className={btnSecondary}>
            Ver en el mercado
          </Link>
        ) : null}
        {esVenta || a.estado === 'cancelada' ? (
          <a
            href={`/admin/contrato/${a.reservation_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnSecondary}
          >
            Contrato
          </a>
        ) : null}
        {esVenta ? (
          <Link href={`/admin/ventas?open=${a.reservation_id}`} className={btnSecondary}>
            Abrir en Ventas
          </Link>
        ) : null}
        {esVenta && Number(a.saldo ?? 0) > 0 ? (
          <button
            type="button"
            className={btnPrimary}
            onClick={() =>
              setCobrar({
                reservation_id: a.reservation_id,
                project_id: a.project_id,
                tracking_code: a.tracking_code,
                buyer_full_name: a.buyer_full_name,
                buyer_phone: a.buyer_phone,
                saldo: Number(a.saldo ?? 0),
                currency: 'BOB',
                monto_sugerido: plan && plan.estado === 'activo' ? Number(plan.monthly_amount) : null,
                tiene_plan: Boolean(plan && plan.estado === 'activo'),
              })
            }
          >
            Registrar cobro
          </button>
        ) : (
          <button type="button" className={btnPrimary} onClick={onClose}>
            Cerrar
          </button>
        )}
      </div>

      {cobrar ? (
        <RegistrarCobroDialog
          cobro={cobrar}
          onClose={() => setCobrar(null)}
          onPaid={() => {
            setCobrar(null);
            onChanged();
          }}
        />
      ) : null}
    </Dialog>
  );
}
