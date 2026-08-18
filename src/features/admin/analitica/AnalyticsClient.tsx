'use client';

// Analítica del proyecto.
//
// Cada bloque responde una pregunta que cambia una decisión. Si una cifra no
// cambia ninguna decisión, no está acá: un panel lleno de números bonitos que
// nadie usa es peor que uno corto que se lee entero.
//
// Todo se agrega en Postgres (vistas v_an_*), no en el navegador.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { Spinner, btnSecondary } from '@/features/admin/ui/bits';
import { downloadCsv, toCsv } from '@/features/admin/contabilidad/types';
import { GroupedBars, Legend, RankBars, StackedRow, EmptyChart } from './Charts';
import {
  bsCorto,
  mesCorto,
  mesesDeInventario,
  type AgingRow,
  type ColocacionRow,
  type DemandaRow,
  type EquipoRow,
  type FunnelRow,
  type ProyeccionRow,
  type TiemposRow,
} from './types';

type Currency = 'USD' | 'BOB';

function Section({
  title,
  question,
  children,
  action,
}: {
  title: string;
  /** The decision this block exists to inform, in plain words. */
  question: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-stone-900">{title}</h2>
          <p className="mt-0.5 text-xs text-stone-500">{question}</p>
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  href,
  tone = 'normal',
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
  tone?: 'normal' | 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'text-brand' : tone === 'bad' ? 'text-red-600' : 'text-stone-900';
  return (
    <Link
      href={href}
      className="group rounded-xl border border-stone-200 bg-white p-4 transition-colors
                 hover:border-brand-light hover:bg-stone-50
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
    >
      <p className="flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
        {label}
        <span aria-hidden="true" className="text-stone-300 group-hover:text-brand-light">&rsaquo;</span>
      </p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-stone-400">{hint}</p> : null}
    </Link>
  );
}

export default function AnalyticsClient({
  projectId,
  currency,
}: {
  projectId: string;
  currency: Currency;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);

  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [tiempos, setTiempos] = useState<TiemposRow[]>([]);
  const [demanda, setDemanda] = useState<DemandaRow[]>([]);
  const [colocacion, setColocacion] = useState<ColocacionRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [proyeccion, setProyeccion] = useState<ProyeccionRow[]>([]);
  const [equipo, setEquipo] = useState<EquipoRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, t, d, c, a, pr, e] = await Promise.all([
      supabase.from('v_an_funnel_mensual').select('*').eq('project_id', projectId).order('mes').limit(24),
      supabase.from('v_an_tiempos').select('*').eq('project_id', projectId).order('mes').limit(24),
      supabase.from('v_an_demanda_manzana').select('*').eq('project_id', projectId),
      supabase.from('v_an_colocacion').select('*').eq('project_id', projectId).order('mes').limit(24),
      supabase.from('v_an_aging').select('*').eq('project_id', projectId).order('orden'),
      supabase.from('v_an_proyeccion').select('*').eq('project_id', projectId).order('mes').limit(18),
      supabase.from('v_an_equipo').select('*').eq('project_id', projectId),
    ]);
    setFunnel((f.data ?? []) as unknown as FunnelRow[]);
    setTiempos((t.data ?? []) as unknown as TiemposRow[]);
    setDemanda((d.data ?? []) as unknown as DemandaRow[]);
    setColocacion((c.data ?? []) as unknown as ColocacionRow[]);
    setAging((a.data ?? []) as unknown as AgingRow[]);
    setProyeccion((pr.data ?? []) as unknown as ProyeccionRow[]);
    setEquipo((e.data ?? []) as unknown as EquipoRow[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  // ---- Headline figures -------------------------------------------------
  const totalLotes = demanda.reduce((s, m) => s + Number(m.lotes), 0);
  const disponibles = demanda.reduce((s, m) => s + Number(m.disponibles), 0);
  const colocados = demanda.reduce((s, m) => s + Number(m.vendidos) + Number(m.reservados), 0);
  const pctColocado = totalLotes > 0 ? (colocados / totalLotes) * 100 : 0;

  const meses = mesesDeInventario(colocacion, disponibles);
  const valorColocado = colocacion.reduce((s, r) => s + Number(r.valor_colocado), 0);
  const ultimoFunnel = funnel[funnel.length - 1];
  const totalCreadas = funnel.reduce((s, r) => s + Number(r.creadas), 0);
  const totalConfirmadas = funnel.reduce((s, r) => s + Number(r.confirmadas), 0);
  const convGlobal = totalCreadas > 0 ? (totalConfirmadas / totalCreadas) * 100 : 0;
  const porCobrarTotal = aging.reduce((s, r) => s + Number(r.monto), 0);
  const vencidoTotal = aging.filter((r) => r.orden > 0).reduce((s, r) => s + Number(r.monto), 0);
  const pctMora = porCobrarTotal > 0 ? (vencidoTotal / porCobrarTotal) * 100 : 0;

  // Top / bottom manzanas by placement.
  const conLotes = demanda.filter((m) => Number(m.lotes) > 0);
  const mejores = [...conLotes]
    .sort((a, b) => Number(b.pct_colocado ?? 0) - Number(a.pct_colocado ?? 0))
    .slice(0, 8);
  const peores = [...conLotes]
    .sort((a, b) => Number(a.pct_colocado ?? 0) - Number(b.pct_colocado ?? 0))
    .slice(0, 8);

  const SERIE = {
    creadas: 'var(--an-4)',
    comprobante: 'var(--an-3)',
    confirmadas: 'var(--an-1)',
    expiradas: 'var(--an-5)',
    web: 'var(--an-4)',
    oficina: 'var(--an-2)',
  };

  const AGING_COLOR: Record<number, string> = {
    0: 'var(--an-6)',
    1: 'var(--an-3)',
    2: 'var(--an-5)',
    3: 'var(--an-2)',
    4: 'var(--an-5)',
  };

  function exportarTodo() {
    downloadCsv(
      `analitica-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ['Bloque', 'Clave', 'Métrica', 'Valor'],
        [
          ...funnel.flatMap((r) => [
            ['Embudo', mesCorto(r.mes), 'Reservas creadas', Number(r.creadas)],
            ['Embudo', mesCorto(r.mes), 'Con comprobante', Number(r.con_comprobante)],
            ['Embudo', mesCorto(r.mes), 'Confirmadas', Number(r.confirmadas)],
            ['Embudo', mesCorto(r.mes), 'Expiradas', Number(r.expiradas)],
            ['Embudo', mesCorto(r.mes), 'Conversión %', Number(r.tasa_conversion ?? 0)],
          ]),
          ...colocacion.flatMap((r) => [
            ['Colocación', mesCorto(r.mes), 'Lotes colocados', Number(r.lotes_colocados)],
            ['Colocación', mesCorto(r.mes), 'Valor colocado', Number(r.valor_colocado)],
            ['Colocación', mesCorto(r.mes), 'Ticket promedio', Number(r.ticket_promedio)],
            ['Colocación', mesCorto(r.mes), 'Precio por m²', Number(r.precio_m2_realizado ?? 0)],
          ]),
          ...demanda.map((m) => ['Demanda', m.manzana, '% colocado', Number(m.pct_colocado ?? 0)]),
          ...aging.map((r) => ['Antigüedad', r.tramo, 'Monto', Number(r.monto)]),
          ...proyeccion.map((r) => ['Proyección', mesCorto(r.mes), 'Por cobrar', Number(r.por_cobrar)]),
          ...equipo.map((e) => [
            'Equipo',
            e.full_name,
            'Ventas cerradas',
            Number(e.ventas_cerradas),
          ]),
        ] as (string | number)[][],
      ),
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-stone-900">Analítica</h1>
        <button type="button" className={`${btnSecondary} ml-auto`} onClick={exportarTodo}>
          Exportar todo a CSV
        </button>
      </div>

      {/* --- Headline: the four numbers a decision usually starts from ----- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Colocado"
          value={`${pctColocado.toFixed(1)}%`}
          hint={`${colocados.toLocaleString('es-BO')} de ${totalLotes.toLocaleString('es-BO')} lotes — ver`}
          href="/admin/lotes"
          tone="good"
        />
        <Tile
          label="Meses de inventario"
          value={meses === null ? '—' : meses > 240 ? '20+ años' : meses.toFixed(1)}
          hint={meses === null ? 'sin ritmo de venta aún' : 'al ritmo de los últimos 3 meses'}
          href="/admin/lotes?estado=disponible"
        />
        <Tile
          label="Conversión"
          value={`${convGlobal.toFixed(1)}%`}
          hint={`${totalConfirmadas} de ${totalCreadas} reservas — ver`}
          href="/admin/reservas?tab=confirmadas"
        />
        <Tile
          label="Mora sobre cartera"
          value={`${pctMora.toFixed(1)}%`}
          hint={`${formatMoney(vencidoTotal, currency)} vencido — ver`}
          href="/admin/contabilidad?tab=cobrar"
          tone={pctMora > 0 ? 'bad' : 'normal'}
        />
      </div>

      {/* --- Embudo --------------------------------------------------------- */}
      <Section
        title="Embudo mes a mes"
        question="¿Dónde se caen los compradores: no pagan, o no los verificamos a tiempo?"
      >
        {funnel.length ? (
          <>
            <GroupedBars
              data={funnel.map((r) => ({
                label: mesCorto(r.mes),
                values: {
                  creadas: Number(r.creadas),
                  comprobante: Number(r.con_comprobante),
                  confirmadas: Number(r.confirmadas),
                  expiradas: Number(r.expiradas),
                },
              }))}
              series={[
                { key: 'creadas', label: 'Creadas', color: SERIE.creadas },
                { key: 'comprobante', label: 'Con comprobante', color: SERIE.comprobante },
                { key: 'confirmadas', label: 'Confirmadas', color: SERIE.confirmadas },
                { key: 'expiradas', label: 'Expiradas', color: SERIE.expiradas },
              ]}
            />
            <Legend
              items={[
                { label: 'Creadas', color: SERIE.creadas },
                { label: 'Con comprobante', color: SERIE.comprobante },
                { label: 'Confirmadas', color: SERIE.confirmadas },
                { label: 'Expiradas', color: SERIE.expiradas },
              ]}
            />
            {ultimoFunnel ? (
              <p className="mt-3 text-xs text-stone-500">
                Último mes: {ultimoFunnel.creadas} reservas, {ultimoFunnel.confirmadas} confirmadas
                ({ultimoFunnel.tasa_conversion ?? 0}%), {ultimoFunnel.expiradas} expiradas
                ({ultimoFunnel.tasa_expiracion ?? 0}%).
              </p>
            ) : null}
          </>
        ) : (
          <EmptyChart msg="Todavía no hay reservas para analizar." />
        )}
      </Section>

      {/* --- Tiempos -------------------------------------------------------- */}
      <Section
        title="Velocidad: comprador y equipo"
        question="¿La demora es del comprador que no paga, o nuestra que no verificamos? Son dos problemas distintos."
      >
        {tiempos.some((t) => t.muestras > 0) ? (
          <GroupedBars
            data={tiempos
              .filter((t) => t.muestras > 0)
              .map((t) => ({
                label: mesCorto(t.mes),
                values: {
                  comprador: Math.round(Number(t.horas_hasta_comprobante ?? 0) * 10) / 10,
                  equipo: Math.round(Number(t.horas_hasta_verificacion ?? 0) * 10) / 10,
                },
              }))}
            series={[
              { key: 'comprador', label: 'Horas hasta el comprobante', color: SERIE.creadas },
              { key: 'equipo', label: 'Horas hasta verificar', color: SERIE.oficina },
            ]}
            format={(n) => `${n} h`}
            height={180}
          />
        ) : (
          <EmptyChart msg="Sin comprobantes suficientes para medir tiempos." />
        )}
        <p className="mt-3 text-xs text-stone-400">
          Medianas, no promedios: un caso que tardó tres semanas no debe arrastrar la cifra que
          describe a todos los demás.
        </p>
      </Section>

      {/* --- Colocación y precio -------------------------------------------- */}
      <Section
        title="Colocación y precio realizado"
        question="¿Cuántos lotes se cierran por mes, a qué ticket, y a cuánto el metro cuadrado de verdad?"
      >
        {colocacion.length ? (
          <>
            <GroupedBars
              data={colocacion.map((r) => ({
                label: mesCorto(r.mes),
                values: {
                  oficina: Number(r.por_oficina),
                  web: Number(r.por_web),
                },
              }))}
              series={[
                { key: 'oficina', label: 'Cerradas en oficina', color: SERIE.oficina },
                { key: 'web', label: 'Cerradas por la web', color: SERIE.web },
              ]}
              height={180}
            />
            <Legend
              items={[
                { label: 'Cerradas en oficina', color: SERIE.oficina },
                { label: 'Cerradas por la web', color: SERIE.web },
              ]}
            />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-150 text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left">
                    <th className="py-2 text-xs font-semibold text-stone-500">Mes</th>
                    <th className="py-2 text-right text-xs font-semibold text-stone-500">Lotes</th>
                    <th className="py-2 text-right text-xs font-semibold text-stone-500">Valor</th>
                    <th className="py-2 text-right text-xs font-semibold text-stone-500">Ticket</th>
                    <th className="py-2 text-right text-xs font-semibold text-stone-500">Bs/m²</th>
                  </tr>
                </thead>
                <tbody>
                  {colocacion.map((r) => (
                    <tr key={r.mes} className="border-b border-stone-100 last:border-0">
                      <td className="py-1.5 text-stone-700">{mesCorto(r.mes)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.lotes_colocados}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(r.valor_colocado), currency)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(r.ticket_promedio), currency)}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold">
                        {r.precio_m2_realizado ? formatMoney(Number(r.precio_m2_realizado), currency) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              Valor colocado acumulado: {formatMoney(valorColocado, currency)}.
            </p>
          </>
        ) : (
          <EmptyChart msg="Todavía no hay ventas confirmadas." />
        )}
      </Section>

      {/* --- Demanda por manzana -------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Manzanas que más se mueven"
          question="Dónde concentrar el esfuerzo de venta y qué habilitar primero."
        >
          <RankBars
            rows={mejores.map((m) => ({
              label: m.manzana,
              value: Number(m.pct_colocado ?? 0),
              hint: `${m.vendidos + m.reservados}/${m.lotes}`,
            }))}
            format={(n) => `${n.toFixed(0)}%`}
            max={100}
            color="var(--an-1)"
          />
        </Section>
        <Section
          title="Manzanas estancadas"
          question="Candidatas a revisar precio, accesos o servicios antes de seguir empujando."
        >
          <RankBars
            rows={peores.map((m) => ({
              label: m.manzana,
              value: Number(m.pct_colocado ?? 0),
              hint: `${m.vendidos + m.reservados}/${m.lotes}`,
            }))}
            format={(n) => `${n.toFixed(0)}%`}
            max={100}
            color="var(--an-3)"
          />
        </Section>
      </div>

      {/* --- Cartera --------------------------------------------------------- */}
      <Section
        title="Antigüedad de la cartera"
        question="Cuanto más vieja la deuda, menos probable que entre. ¿Cuánto está en riesgo real?"
        action={
          <Link href="/admin/contabilidad?tab=cobrar" className={btnSecondary}>
            Ver deudores
          </Link>
        }
      >
        <StackedRow
          parts={aging.map((r) => ({
            label: r.tramo,
            value: Number(r.monto),
            color: AGING_COLOR[r.orden] ?? 'var(--an-5)',
          }))}
          format={(n) => formatMoney(n, currency)}
        />
      </Section>

      <Section
        title="Proyección de cobranza"
        question="Cuánta plata está comprometida a entrar mes a mes según los planes ya firmados."
      >
        {proyeccion.length ? (
          <GroupedBars
            data={proyeccion.map((r) => ({
              label: mesCorto(r.mes),
              values: { por_cobrar: Number(r.por_cobrar) },
            }))}
            series={[{ key: 'por_cobrar', label: 'Por cobrar', color: 'var(--an-6)' }]}
            format={(n) => bsCorto(n)}
            height={180}
          />
        ) : (
          <EmptyChart msg="Sin planes de pago activos todavía." />
        )}
      </Section>

      {/* --- Equipo ---------------------------------------------------------- */}
      <Section
        title="Equipo"
        question="Quién cierra y quién verifica, para repartir carga y reconocer trabajo."
      >
        {equipo.some((e) => e.ventas_cerradas > 0 || e.pagos_verificados > 0) ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left">
                  <th className="py-2 text-xs font-semibold text-stone-500">Persona</th>
                  <th className="py-2 text-xs font-semibold text-stone-500">Rol</th>
                  <th className="py-2 text-right text-xs font-semibold text-stone-500">Ventas</th>
                  <th className="py-2 text-right text-xs font-semibold text-stone-500">Monto</th>
                  <th className="py-2 text-right text-xs font-semibold text-stone-500">Verificados</th>
                </tr>
              </thead>
              <tbody>
                {equipo.map((e) => (
                  <tr key={e.profile_id} className="border-b border-stone-100 last:border-0">
                    <td className="py-1.5 font-medium text-stone-800">{e.full_name}</td>
                    <td className="py-1.5 text-stone-500">{e.rol === 'admin' ? 'Administrador' : 'Ventas'}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.ventas_cerradas}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(e.monto_vendido), currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.pagos_verificados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyChart msg="Todavía no hay ventas ni verificaciones registradas." />
        )}
      </Section>
    </div>
  );
}
