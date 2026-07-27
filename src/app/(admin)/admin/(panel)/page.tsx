import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime, formatMoney, waLink } from '@/lib/format';
import type { LotStatus, ReservationStatus } from '@/lib/db-types';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import {
  laPazDayEndIso,
  laPazDayStartIso,
  laPazMonthEndIso,
  laPazMonthStartIso,
} from '@/features/admin/lib/lapaz';
import { DEFAULT_WA_TEMPLATES, fillTemplate } from '@/features/admin/lib/whatsapp';
import { EmptyState } from '@/features/admin/ui/bits';
import { IconWhatsapp } from '@/features/admin/ui/icons';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const LOT_CARDS: { status: LotStatus; label: string; accent: string }[] = [
  { status: 'disponible', label: 'Disponibles', accent: 'text-green-700' },
  { status: 'reservado', label: 'Reservados', accent: 'text-orange-600' },
  { status: 'vendido', label: 'Vendidos', accent: 'text-stone-600' },
  { status: 'no_disponible', label: 'Bloqueados', accent: 'text-stone-400' },
];

const RES_CARDS: { status: ReservationStatus; label: string; tab: string }[] = [
  { status: 'en_verificacion', label: 'Por revisar', tab: 'revisar' },
  { status: 'pendiente_pago', label: 'Esperando pago', tab: 'espera' },
  { status: 'rechazo_reintento', label: 'En reintento', tab: 'reintento' },
  { status: 'confirmada', label: 'Confirmadas', tab: 'confirmadas' },
];

interface ExpiringRow {
  id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  hold_expires_at: string | null;
  lot: { number: string; manzana: { code: string } | null } | null;
}

export default async function DashboardPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null; // layout already rendered the failure state
  }
  if (!ctx.project) {
    return (
      <EmptyState
        title="Proyecto no encontrado"
        hint="Ejecuta las migraciones de la base de datos para crear 'Estrellas del Sur'."
      />
    );
  }
  const projectId = ctx.project.id;
  const supabase = await createClient();

  const monthStart = laPazMonthStartIso();
  const monthEnd = laPazMonthEndIso();
  const todayStart = laPazDayStartIso();
  const todayEnd = laPazDayEndIso();
  const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const lotCountQ = (status: LotStatus) =>
    supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .eq('status', status);

  const resCountQ = (status: ReservationStatus) =>
    supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', status);

  const [
    lotCounts,
    resCounts,
    incomeRes,
    funnelCreated,
    funnelProof,
    funnelConfirmed,
    expiringRes,
    waSettingRes,
  ] = await Promise.all([
    Promise.all(LOT_CARDS.map((c) => lotCountQ(c.status))),
    Promise.all(RES_CARDS.map((c) => resCountQ(c.status))),
    supabase
      .from('payments')
      .select('amount_bob')
      .eq('project_id', projectId)
      .eq('status', 'aprobado')
      .gte('verified_at', monthStart)
      .lt('verified_at', monthEnd)
      .limit(2000),
    supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('created_at', d30),
    supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('proof_submitted_at', d30),
    supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('confirmed_at', d30),
    supabase
      .from('reservations')
      .select(
        'id, tracking_code, buyer_full_name, buyer_phone, hold_expires_at, lot:lots!reservations_lot_id_fkey(number, manzana:manzanas(code))',
      )
      .eq('project_id', projectId)
      .eq('status', 'pendiente_pago')
      .gte('hold_expires_at', todayStart)
      .lt('hold_expires_at', todayEnd)
      .order('hold_expires_at', { ascending: true })
      .limit(30),
    supabase.from('settings').select('project_id, value').eq('key', 'whatsapp_templates'),
  ]);

  const ingresosBs = (incomeRes.data ?? []).reduce(
    (sum, r) => sum + Number(r.amount_bob ?? 0),
    0,
  );

  const waRows = waSettingRes.data ?? [];
  const waValue =
    (waRows.find((r) => r.project_id === projectId)?.value as { contacto?: string } | undefined) ??
    (waRows.find((r) => r.project_id === null)?.value as { contacto?: string } | undefined);
  const contactoTpl = waValue?.contacto ?? DEFAULT_WA_TEMPLATES.contacto;

  const expiring = (expiringRes.data ?? []) as unknown as ExpiringRow[];
  const created30 = funnelCreated.count ?? 0;
  const proof30 = funnelProof.count ?? 0;
  const confirmed30 = funnelConfirmed.count ?? 0;
  const funnelMax = Math.max(created30, 1);

  const funnel = [
    { label: 'Reservas creadas', value: created30, cls: 'bg-brand-light' },
    { label: 'Con comprobante', value: proof30, cls: 'bg-sky-500' },
    { label: 'Confirmadas', value: confirmed30, cls: 'bg-brand' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-lg font-bold text-stone-900">Dashboard</h1>

      {/* Reservations KPI cards */}
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Reservas
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {RES_CARDS.map((c, i) => (
            <Link
              key={c.status}
              href={`/admin/reservas?tab=${c.tab}`}
              className="rounded-xl border border-stone-200 bg-white p-4 hover:border-brand-light"
            >
              <p className="text-2xl font-bold text-stone-900">{resCounts[i].count ?? 0}</p>
              <p className="text-xs text-stone-500">{c.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Lots + income */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Inventario de lotes
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LOT_CARDS.map((c, i) => (
              <Link key={c.status} href="/admin/lotes" className="rounded-lg bg-stone-50 p-3 hover:bg-stone-100">
                <p className={`text-xl font-bold ${c.accent}`}>{lotCounts[i].count ?? 0}</p>
                <p className="text-xs text-stone-500">{c.label}</p>
              </Link>
            ))}
          </div>
        </div>
        <Link
          href="/admin/reservas?tab=confirmadas"
          className="rounded-xl border border-stone-200 bg-white p-4 hover:border-brand-light"
        >
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Ingresos verificados (este mes)
          </h2>
          <p className="mt-2 text-2xl font-bold text-brand">{formatMoney(ingresosBs, 'BOB')}</p>
          <p className="mt-1 text-xs text-stone-400">Pagos aprobados del mes (hora de Bolivia)</p>
        </Link>
      </section>

      {/* Funnel */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Embudo — últimos 30 días
        </h2>
        <div className="space-y-2">
          {funnel.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <p className="w-36 shrink-0 text-xs text-stone-500">{f.label}</p>
              <div className="h-6 flex-1 overflow-hidden rounded-md bg-stone-100">
                <div
                  className={`flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white ${f.cls}`}
                  style={{ width: `${Math.max(4, Math.round((f.value / funnelMax) * 100))}%` }}
                >
                  {f.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Expiring today */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Por expirar hoy
          </h2>
          <Link href="/admin/reservas?tab=espera" className="text-xs font-medium text-brand hover:underline">
            Ver todas
          </Link>
        </div>
        {expiring.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-400">
            Ninguna reserva vence hoy. Todo en orden.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {expiring.map((r) => {
              const mz = r.lot?.manzana?.code ?? '—';
              const lote = r.lot?.number ?? '—';
              const waText = fillTemplate(contactoTpl, {
                nombre: r.buyer_full_name.split(' ')[0] ?? '',
                codigo: r.tracking_code,
                lote,
                manzana: mz,
              });
              return (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <Link href={`/admin/reservas?open=${r.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-800">
                      <span className="font-mono">{r.tracking_code}</span> · {r.buyer_full_name}
                    </p>
                    <p className="text-xs text-stone-500">
                      Mz {mz}, Lote {lote} · vence{' '}
                      {r.hold_expires_at ? formatDateTime(r.hold_expires_at) : '—'}
                    </p>
                  </Link>
                  <a
                    href={waLink(r.buyer_phone, waText)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    <IconWhatsapp className="h-4 w-4" /> WhatsApp
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
