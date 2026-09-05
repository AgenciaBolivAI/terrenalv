'use client';

// Quién vendió qué, cuánto ganó y cuánto se le debe.
//
// La comisión se gana como se pacta: sobre el PRECIO (todo al firmar) o sobre
// lo COBRADO (de a poco, a medida que el comprador paga). Sobre una venta a
// 120 meses la segunda es la honesta — reconocer toda la comisión el primer
// día es pagar sobre plata que todavía no entró.
//
// Pagar una comisión es un EGRESO de verdad (cuenta 5211): sale de una caja,
// aparece en el libro y en el estado de resultados. Nada de listas paralelas
// que después nadie concilia.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
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
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import EscalaComisiones from './EscalaComisiones';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { hoyBolivia } from '@/features/admin/lib/lapaz';

interface Vendedor {
  profile_id: string;
  vendedor: string;
  rol: string;
  ventas: number;
  valor_vendido: number;
  cobrado_de_sus_ventas: number;
  ganado: number;
  pagado: number;
  por_pagar: number;
  ultima_venta: string | null;
}

interface Comision {
  reservation_id: string;
  proyecto: string;
  tracking_code: string;
  estado: string;
  fecha_venta: string | null;
  manzana: string | null;
  lote: string | null;
  comprador: string;
  profile_id: string;
  vendedor: string;
  pct: number;
  base: string;
  precio: number;
  cobrado: number;
  ganado: number;
  pagado: number;
  por_pagar: number;
  // Lo que agrega la escala del Directorio.
  modalidad: 'contado' | 'plazo' | null;
  ventas_periodo: number | null;
  comision_total: number | null;
  tramo_inicial: number | null;
  tramo_reintegro: number | null;
  inicial_cumplida: boolean | null;
  reintegro_cumplido: boolean | null;
  cuotas_pagadas: number | null;
  cuota_reintegro: number | null;
}

interface Movimiento {
  movimiento_id: string;
  tipo: 'reserva' | 'venta' | 'pago_comision';
  cuando: string;
  proyecto: string;
  profile_id: string;
  empleado: string;
  rol: string;
  reservation_id: string | null;
  tracking_code: string | null;
  manzana: string | null;
  lote: string | null;
  comprador: string | null;
  monto: number;
  comision: number;
  estado: string;
  nota: string | null;
}

const MOV_BADGE: Record<Movimiento['tipo'], { texto: string; clase: string }> = {
  reserva: { texto: 'Tomó una reserva', clase: 'bg-amber-100 text-amber-800' },
  venta: { texto: 'Cerró una venta', clase: 'bg-green-100 text-green-700' },
  pago_comision: { texto: 'Se le pagó comisión', clase: 'bg-stone-200 text-stone-700' },
};

interface Regla {
  id: string;
  profile_id: string | null;
  project_id: string | null;
  pct: number;
  base: string;
  is_active: boolean;
}

export default function ComisionesClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [detalle, setDetalle] = useState<Comision[]>([]);
  // El porcentaje pactado con cada vendedor se edita aca mismo: la regla es
  // lo que viene (sus PROXIMAS ventas); el % de una venta ya hecha se cambia
  // venta por venta, porque eso si reescribe plata pactada.
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [editandoRegla, setEditandoRegla] = useState<{
    profileId: string;
    vendedor: string;
    ruleId: string | null;
    pct: string;
    base: string;
  } | null>(null);
  const [editandoVenta, setEditandoVenta] = useState<{ c: Comision; pct: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pagando, setPagando] = useState<Comision | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  // Dos vistas del mismo asunto: cuánto le toca a cada uno HOY (equipo), y qué
  // fue pasando en el tiempo (movimientos) — que es lo que se mira cuando
  // alguien reclama o hay que auditar un pago.
  const [vista, setVista] = useState<'equipo' | 'movimientos' | 'escala'>('equipo');
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [filtroEmpleado, setFiltroEmpleado] = useState<string>('');
  // El reporte por empleado que pidio el dueno: semana, mes, ano o el rango
  // que sea. El periodo recorta los movimientos y arma el resumen de arriba.
  const [periodo, setPeriodo] = useState<'semana' | 'mes' | 'anio' | 'todo' | 'rango'>('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const rangoActivo = useMemo((): [string, string] | null => {
    const hoy = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (periodo === 'todo') return null;
    if (periodo === 'semana') {
      const d = new Date(hoy);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
      return [iso(d), iso(hoy)];
    }
    if (periodo === 'mes') return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)];
    if (periodo === 'anio') return [iso(new Date(hoy.getFullYear(), 0, 1)), iso(hoy)];
    if (desde && hasta) return [desde, hasta];
    return null;
  }, [periodo, desde, hasta]);

  const enPeriodo = useCallback(
    (cuando: string | null) => {
      if (!rangoActivo || !cuando) return rangoActivo === null;
      const f = cuando.slice(0, 10);
      return f >= rangoActivo[0] && f <= rangoActivo[1];
    },
    [rangoActivo],
  );

  const cargar = useCallback(async () => {
    const [v, d, mv, rg] = await Promise.all([
      supabase.from('v_comisiones_por_vendedor').select('*').order('por_pagar', { ascending: false }),
      supabase.from('v_comisiones').select('*').order('fecha_venta', { ascending: false }),
      supabase
        .from('v_referidos_movimientos')
        .select('*')
        .order('cuando', { ascending: false })
        .limit(500),
      supabase
        .from('commission_rules')
        .select('id, profile_id, project_id, pct, base, is_active')
        .eq('is_active', true),
    ]);
    setVendedores((v.data ?? []) as unknown as Vendedor[]);
    setDetalle((d.data ?? []) as unknown as Comision[]);
    setMovs((mv.data ?? []) as unknown as Movimiento[]);
    setReglas((rg.data ?? []) as unknown as Regla[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(
    () => ({
      ganado: vendedores.reduce((s, v) => s + Number(v.ganado), 0),
      pagado: vendedores.reduce((s, v) => s + Number(v.pagado), 0),
      porPagar: vendedores.reduce((s, v) => s + Number(v.por_pagar), 0),
      conVentas: vendedores.filter((v) => Number(v.ventas) > 0).length,
      sinVendedor: 0,
    }),
    [vendedores],
  );

  // La regla que rige para un vendedor: la suya propia si tiene, si no la
  // general del equipo. Misma precedencia que usa la base al asignar.
  const reglaDe = useCallback(
    (profileId: string) => {
      const propia = reglas.find((r) => r.profile_id === profileId && r.project_id === null);
      if (propia) return { ...propia, propia: true };
      const general = reglas.find((r) => r.profile_id === null && r.project_id === null);
      return general ? { ...general, propia: false } : null;
    },
    [reglas],
  );

  const visibles = useMemo(
    () => (soloPendientes ? vendedores.filter((v) => Number(v.por_pagar) > 0) : vendedores),
    [vendedores, soloPendientes],
  );

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
        <h1 className="text-lg font-bold text-stone-900">Comisiones</h1>
        <p className="text-xs text-stone-500">
          Quién vendió qué, cuánto ganó y cuánto se le debe.
        </p>
        <Link href="/admin/financiamiento" className={`${btnSecondary} ml-auto`}>
          Financiamiento por precio
        </Link>
      </div>

      <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setVista('equipo')}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
            vista === 'equipo' ? 'bg-green-50 text-brand' : 'text-stone-600 hover:bg-stone-50'
          }`}
        >
          Por vendedor
        </button>
        <button
          type="button"
          onClick={() => setVista('movimientos')}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
            vista === 'movimientos' ? 'bg-green-50 text-brand' : 'text-stone-600 hover:bg-stone-50'
          }`}
        >
          Movimientos ({movs.length})
        </button>
        <button
          type="button"
          onClick={() => setVista('escala')}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
            vista === 'escala' ? 'bg-green-50 text-brand' : 'text-stone-600 hover:bg-stone-50'
          }`}
        >
          Escala y políticas
        </button>
      </div>

      {vista === 'escala' ? <EscalaComisiones /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Vendedores con ventas"
          value={String(totales.conVentas)}
          hint="del equipo activo"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Comisión ganada"
          value={formatMoney(totales.ganado, 'BOB')}
          tone="good"
          hint="según lo pactado en cada venta"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Ya pagado"
          value={formatMoney(totales.pagado, 'BOB')}
          hint="egresos de comisiones (cuenta 5211)"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Se les debe"
          value={formatMoney(totales.porPagar, 'BOB')}
          tone={totales.porPagar > 0 ? 'bad' : 'normal'}
          hint="pendiente de pagar — ver"
          onClick={() => setSoloPendientes(true)}
        />
      </div>

      {vista === 'movimientos' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
            <select
              value={filtroEmpleado}
              onChange={(e) => setFiltroEmpleado(e.target.value)}
              className={`${inputClass} w-auto min-w-56`}
            >
              <option value="">Todo el equipo</option>
              {vendedores.map((v) => (
                <option key={v.profile_id} value={v.profile_id}>
                  {v.vendedor}
                </option>
              ))}
            </select>
            <div className="flex gap-1 rounded-lg border border-stone-200 bg-stone-50 p-1">
              {(
                [
                  ['semana', 'Semana'],
                  ['mes', 'Mes'],
                  ['anio', 'Año'],
                  ['todo', 'Todo'],
                  ['rango', 'Rango'],
                ] as ['semana' | 'mes' | 'anio' | 'todo' | 'rango', string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPeriodo(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    periodo === id ? 'bg-white text-brand shadow-sm' : 'text-stone-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {periodo === 'rango' ? (
              <>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className={`${inputClass} w-auto`}
                />
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className={`${inputClass} w-auto`}
                />
              </>
            ) : null}
            <p className="text-xs text-stone-500">
              Quién tomó qué reserva, qué venta cerró y cuándo se le pagó.
            </p>
          </div>
          {(() => {
            const visibles = movs.filter(
              (m) => (!filtroEmpleado || m.profile_id === filtroEmpleado) && enPeriodo(m.cuando),
            );
            const ventas = visibles.filter((m) => m.tipo === 'venta');
            const resumen = {
              ventas: ventas.length,
              monto: ventas.reduce((t, m) => t + Number(m.monto), 0),
              comision: ventas.reduce((t, m) => t + Number(m.comision), 0),
              pagado: visibles
                .filter((m) => m.tipo === 'pago_comision')
                .reduce((t, m) => t + Number(m.comision), 0),
              reservas: visibles.filter((m) => m.tipo === 'reserva').length,
            };
            return (
              <>
                {/* El resumen del periodo: lo que un jefe mira antes que la lista. */}
                <div className="grid grid-cols-2 gap-3 border-b border-stone-200 px-4 py-3 sm:grid-cols-5">
                  {(
                    [
                      ['Ventas cerradas', String(resumen.ventas)],
                      ['Monto vendido', formatMoney(resumen.monto, 'BOB')],
                      ['Comisión generada', formatMoney(resumen.comision, 'BOB')],
                      ['Comisión pagada', formatMoney(resumen.pagado, 'BOB')],
                      ['Reservas tomadas', String(resumen.reservas)],
                    ] as [string, string][]
                  ).map(([l, v]) => (
                    <div key={l}>
                      <p className="text-[11px] tracking-wide text-stone-500 uppercase">{l}</p>
                      <p className="text-base font-bold tabular-nums text-stone-900">{v}</p>
                    </div>
                  ))}
                </div>
                {visibles.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="Sin movimientos"
                hint="Cuando una venta o reserva quede asignada a alguien del equipo, aparece acá."
              />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {visibles.map((m) => {
                  const b = MOV_BADGE[m.tipo];
                  return (
                    <li
                      key={`${m.tipo}-${m.movimiento_id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                    >
                      <span className="w-24 shrink-0 text-xs text-stone-500">
                        {dateLabel(m.cuando)}
                      </span>
                      <Badge className={b.clase}>{b.texto}</Badge>
                      <span className="font-medium text-stone-900">{m.empleado}</span>
                      {m.manzana || m.lote ? (
                        <span className="text-stone-600">
                          Mz {m.manzana ?? '—'}, Lote {m.lote ?? '—'}
                        </span>
                      ) : null}
                      {m.comprador ? (
                        <span className="text-xs text-stone-400">{m.comprador}</span>
                      ) : null}
                      {m.reservation_id ? (
                        <Link
                          href={`/admin/ventas?open=${m.reservation_id}`}
                          className="font-mono text-xs font-semibold text-brand hover:underline"
                        >
                          {m.tracking_code}
                        </Link>
                      ) : null}
                      <span className="ml-auto text-right">
                        {m.tipo === 'pago_comision' ? (
                          <span className="font-semibold tabular-nums text-stone-800">
                            − {formatMoney(Number(m.monto), 'BOB')}
                          </span>
                        ) : (
                          <>
                            <span className="tabular-nums text-stone-600">
                              {formatMoney(Number(m.monto), 'BOB')}
                            </span>
                            {Number(m.comision) > 0 ? (
                              <span className="ml-2 font-semibold tabular-nums text-brand">
                                comisión {formatMoney(Number(m.comision), 'BOB')}
                              </span>
                            ) : null}
                          </>
                        )}
                      </span>
                      {m.nota ? (
                        <span className="w-full text-[11px] text-stone-400">{m.nota}</span>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          )}
              </>
            );
          })()}
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
            Los últimos 500 movimientos. Una venta aparece con la comisión que generó; un pago,
            con lo que salió de caja.
          </p>
        </section>
      ) : null}

      <section className={`rounded-xl border border-stone-200 bg-white ${vista === 'equipo' ? '' : 'hidden'}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={() => setSoloPendientes(false)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !soloPendientes ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600'
            }`}
          >
            Todo el equipo
          </button>
          <button
            type="button"
            onClick={() => setSoloPendientes(true)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              soloPendientes ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600'
            }`}
          >
            Con comisión pendiente
          </button>
          <ExportButtons
            disabled={!detalle.length}
            orientation="landscape"
            meta={{
              title: 'Comisiones por venta',
              subtitle: 'Terrenalv S.R.L.',
              filename: `comisiones-${hoyBolivia()}`,
              footnote:
                'Base «cobrado»: la comisión se gana a medida que el comprador paga capital. Base «precio»: se gana entera al firmar.',
            }}
            columns={[
              { header: 'Vendedor' },
              { header: 'Venta' },
              { header: 'Lote' },
              { header: 'Comprador' },
              { header: 'Precio', align: 'right' },
              { header: 'Cobrado', align: 'right' },
              { header: '%', align: 'right' },
              { header: 'Base' },
              { header: 'Ganado', align: 'right' },
              { header: 'Pagado', align: 'right' },
              { header: 'Se le debe', align: 'right' },
            ]}
            rows={() =>
              detalle.map((c) => [
                c.vendedor,
                c.tracking_code,
                `Mz ${c.manzana ?? '—'} L ${c.lote ?? '—'}`,
                c.comprador,
                fnum(Number(c.precio)),
                fnum(Number(c.cobrado)),
                fnum(Number(c.pct), 2),
                c.base,
                fnum(Number(c.ganado)),
                fnum(Number(c.pagado)),
                fnum(Number(c.por_pagar)),
              ]) as XCell[][]
            }
          />
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Nadie tiene comisiones pendientes"
              hint="Asigná el vendedor en cada venta (desde Ventas → detalle) y acá aparecerá lo que le toca."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Vendedor</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Ventas
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Vendió
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Ganó
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Pagado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Se le debe
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Últ. venta</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((v) => (
                  <Fragment key={v.profile_id}>
                    <tr
                      onClick={() => setAbierto(abierto === v.profile_id ? null : v.profile_id)}
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        abierto === v.profile_id ? 'bg-green-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-stone-900">{v.vendedor}</p>
                        <p className="text-xs text-stone-400">{v.rol}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{v.ventas}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(v.valor_vendido), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-brand">
                        {formatMoney(Number(v.ganado), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(v.pagado), 'BOB')}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                          Number(v.por_pagar) > 0 ? 'text-red-600' : 'text-stone-900'
                        }`}
                      >
                        {formatMoney(Number(v.por_pagar), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-stone-400">
                        {v.ultima_venta ? dateLabel(v.ultima_venta) : '—'}
                      </td>
                    </tr>

                    {abierto === v.profile_id ? (
                      <tr className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                        <td colSpan={7} className="px-4 py-3">
                          {(() => {
                            const r = reglaDe(v.profile_id);
                            return (
                              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                                <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                  Comisión pactada
                                </span>
                                <Badge className="bg-green-50 text-brand">
                                  {r ? `${Number(r.pct)}% sobre ${r.base}` : 'sin regla — 0%'}
                                </Badge>
                                {r && !r.propia ? (
                                  <span className="text-xs text-stone-400">
                                    (usa la regla general del equipo)
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="ml-auto rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                                  onClick={() =>
                                    setEditandoRegla({
                                      profileId: v.profile_id,
                                      vendedor: v.vendedor,
                                      ruleId: r && r.propia ? r.id : null,
                                      pct: String(r ? Number(r.pct) : 0),
                                      base: r?.base ?? 'cobrado',
                                    })
                                  }
                                >
                                  Cambiar %
                                </button>
                              </div>
                            );
                          })()}
                          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                            Sus ventas
                          </p>
                          {detalle.filter((c) => c.profile_id === v.profile_id).length === 0 ? (
                            <p className="mt-2 text-sm text-stone-500">
                              Todavía no tiene ventas asignadas.
                            </p>
                          ) : (
                            <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                              {detalle
                                .filter((c) => c.profile_id === v.profile_id)
                                .map((c) => (
                                  <li
                                    key={c.reservation_id}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                                  >
                                    <Link
                                      href={`/admin/ventas?open=${c.reservation_id}`}
                                      className="font-mono text-xs font-semibold text-brand hover:underline"
                                    >
                                      {c.tracking_code}
                                    </Link>
                                    <span className="text-stone-700">
                                      Mz {c.manzana ?? '—'}, Lote {c.lote ?? '—'}
                                    </span>
                                    <span className="text-xs text-stone-400">{c.comprador}</span>
                                    <button
                                      type="button"
                                      title={
                                        c.base === 'escala'
                                          ? 'Sale de la escala. Tocar para ponerle un % a mano.'
                                          : 'Cambiar el % de ESTA venta'
                                      }
                                      onClick={() =>
                                        setEditandoVenta({ c, pct: String(Number(c.pct)) })
                                      }
                                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold underline decoration-dotted underline-offset-2 ${
                                        c.base === 'escala'
                                          ? 'bg-green-50 text-brand hover:bg-green-100'
                                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                      }`}
                                    >
                                      {c.base === 'escala'
                                        ? `${Number(c.pct)}% · escala ${c.modalidad ?? ''} (${c.ventas_periodo ?? 0} ventas)`
                                        : `${Number(c.pct)}% sobre ${c.base}`}
                                    </button>
                                    {c.base === 'escala' && c.modalidad === 'plazo' ? (
                                      <span className="text-[11px] text-stone-400">
                                        {c.inicial_cumplida ? '✓' : '○'} inicial ·{' '}
                                        {c.reintegro_cumplido ? '✓' : '○'} cuota{' '}
                                        {c.cuota_reintegro ?? 4}
                                        {c.comision_total != null
                                          ? ` · de ${formatMoney(Number(c.comision_total), 'BOB')}`
                                          : ''}
                                      </span>
                                    ) : null}
                                    <span className="text-xs text-stone-500">
                                      cobrado {formatMoney(Number(c.cobrado), 'BOB')}
                                    </span>
                                    <span className="ml-auto font-semibold tabular-nums text-brand">
                                      {formatMoney(Number(c.ganado), 'BOB')}
                                    </span>
                                    {Number(c.por_pagar) > 0 ? (
                                      <button
                                        type="button"
                                        className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white"
                                        onClick={() => setPagando(c)}
                                      >
                                        Pagar {formatMoney(Number(c.por_pagar), 'BOB')}
                                      </button>
                                    ) : (
                                      <Badge className="bg-green-100 text-green-700">al día</Badge>
                                    )}
                                  </li>
                                ))}
                            </ul>
                          )}
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
          Base <strong>cobrado</strong>: la comisión se gana a medida que el comprador paga capital
          — sobre una venta a 120 meses, reconocerla entera el primer día sería pagar sobre plata
          que no entró. Base <strong>precio</strong>: se gana entera al firmar. El porcentaje queda
          congelado en cada venta: cambiar la regla no reescribe lo ya pactado.
        </p>
      </section>

      {/* ---- El % pactado con un vendedor (sus proximas ventas) ---- */}
      {editandoRegla ? (
        <Dialog
          open
          onClose={() => setEditandoRegla(null)}
          title={`Comisión de ${editandoRegla.vendedor}`}
        >
          <p className="text-sm text-stone-600">
            Vale para sus <strong>próximas</strong> ventas. Las ya asignadas no se tocan: el
            % de una venta hecha se cambia en esa venta, en su lista de ventas.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Porcentaje (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={editandoRegla.pct}
                onChange={(e) => setEditandoRegla({ ...editandoRegla, pct: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Sobre</label>
              <select
                value={editandoRegla.base}
                onChange={(e) => setEditandoRegla({ ...editandoRegla, base: e.target.value })}
                className={inputClass}
              >
                <option value="cobrado">lo cobrado (recomendado)</option>
                <option value="precio">el precio</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEditandoRegla(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { error } = await supabase.rpc('admin_guardar_regla_comision', {
                  p_id: editandoRegla.ruleId,
                  p_project_id: null,
                  p_profile_id: editandoRegla.profileId,
                  p_nombre: editandoRegla.vendedor,
                  p_pct: Number(editandoRegla.pct) || 0,
                  p_base: editandoRegla.base,
                  p_activo: true,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Regla guardada. Rige para sus próximas ventas.', 'success');
                setEditandoRegla(null);
                void cargar();
              }}
            >
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---- El % de UNA venta ya hecha ---- */}
      {editandoVenta ? (
        <Dialog
          open
          onClose={() => setEditandoVenta(null)}
          title={`${editandoVenta.c.tracking_code} — % de esta venta`}
        >
          <p className="text-sm text-stone-600">
            Cambia lo pactado en <strong>esta venta</strong> de {editandoVenta.c.vendedor}: lo
            ganado y lo que se le debe se recalculan al instante. Lo ya pagado no se toca.
          </p>
          {editandoVenta.c.base === 'escala' ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Hoy esta venta va por la <strong>escala</strong> del Directorio
              ({Number(editandoVenta.c.pct)}% por sus {editandoVenta.c.ventas_periodo ?? 0} ventas
              al {editandoVenta.c.modalidad}). Si le ponés un % a mano, sale de la escala y deja
              de moverse cuando el asesor venda más.
            </p>
          ) : (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-brand hover:underline"
              onClick={async () => {
                const { error } = await supabase.rpc('admin_comision_a_escala', {
                  p_reservation_id: editandoVenta.c.reservation_id,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Esta venta vuelve a la escala del Directorio.', 'success');
                setEditandoVenta(null);
                void cargar();
              }}
            >
              ← Volver esta venta a la escala del Directorio
            </button>
          )}
          <label className="mt-3 mb-1 block text-xs text-stone-500">Porcentaje (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={editandoVenta.pct}
            onChange={(e) => setEditandoVenta({ ...editandoVenta, pct: e.target.value })}
            className={inputClass}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEditandoVenta(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { error } = await supabase.rpc('admin_asignar_vendedor', {
                  p_reservation_id: editandoVenta.c.reservation_id,
                  p_profile_id: editandoVenta.c.profile_id,
                  p_pct: Number(editandoVenta.pct) || 0,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Porcentaje actualizado en la venta.', 'success');
                setEditandoVenta(null);
                void cargar();
              }}
            >
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}

      {pagando ? (
        <PagarComisionDialog
          c={pagando}
          onClose={() => setPagando(null)}
          onPaid={() => {
            setPagando(null);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

function PagarComisionDialog({
  c,
  onClose,
  onPaid,
}: {
  c: Comision;
  onClose: () => void;
  onPaid: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();
  const [monto, setMonto] = useState(String(c.por_pagar));
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(() => hoyBolivia());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pagar() {
    setError(null);
    const m = Number(monto);
    if (!(m > 0)) {
      setError('El monto debe ser mayor a cero.');
      return;
    }
    if (m > Number(c.por_pagar) + 0.01) {
      setError(
        `No se puede pagar más de lo ganado: quedan ${formatMoney(Number(c.por_pagar), 'BOB')}.`,
      );
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_pagar_comision', {
      p_reservation_id: c.reservation_id,
      p_amount: m,
      p_treasury_account_id: cuentaId || null,
      p_paid_on: fecha,
      p_note: nota.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Comisión pagada y registrada como egreso.', 'success');
    onPaid();
  }

  return (
    <Dialog open onClose={onClose} title={`Pagar comisión — ${c.vendedor}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          Venta <span className="font-mono">{c.tracking_code}</span> · Mz {c.manzana ?? '—'}, Lote{' '}
          {c.lote ?? '—'} · {c.comprador}.
          <br />
          {Number(c.pct)}% sobre {c.base === 'precio' ? 'el precio' : 'lo cobrado'} (
          {formatMoney(Number(c.base === 'precio' ? c.precio : c.cobrado), 'BOB')}) ={' '}
          <strong>{formatMoney(Number(c.ganado), 'BOB')}</strong>. Ya se le pagó{' '}
          {formatMoney(Number(c.pagado), 'BOB')}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Monto a pagar (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="Sale de"
          monto={Number(monto) || 0}
          signo={-1}
        />
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota (opcional)"
          className={inputClass}
        />
        <p className="text-xs text-stone-400">
          Queda como egreso de categoría «comisiones» (cuenta 5211): aparece en el libro, en el
          estado de resultados y baja el saldo de la caja de donde sale.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pagar()}>
          {busy ? 'Pagando…' : 'Registrar pago'}
        </button>
      </div>
    </Dialog>
  );
}
