import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime, formatMoney, waLink } from '@/lib/format';
import type { LotStatus, ReservationStatus } from '@/lib/db-types';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { checkSetupHealth } from '@/features/admin/lib/setup-health';
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
        hint="Ejecuta las migraciones de la base de datos para crear 'Prados del Sur'."
      />
    );
  }
  const projectId = ctx.project.id;
  const supabase = await createClient();
  // Config problems that silently cost sales — payment details above all.
  const health = ctx.profile.role === 'admin' ? await checkSetupHealth(projectId) : [];

  const monthStart = laPazMonthStartIso();
  const monthEnd = laPazMonthEndIso();
  const todayStart = laPazDayStartIso();
  const todayEnd = laPazDayEndIso();
  const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Diez casillas, dos preguntas. La base agrupa por estado mucho mejor de lo
  // que nosotros podemos pedirle un conteo por vez.
  const conteo = (filas: { status: string; n: number }[] | null, status: string) =>
    Number(filas?.find((f) => f.status === status)?.n ?? 0);

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
    supabase.from('v_conteo_lotes').select('status, n').eq('project_id', projectId),
    supabase.from('v_conteo_reservas').select('status, n').eq('project_id', projectId),
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

  // Each step drills into the queue that step lives in. The 30-day window is
  // NOT carried across: /admin/reservas filters by state, not by date, so the
  // list will show every reservation in that state. Said plainly in the hint
  // under the funnel rather than letting the number and the list disagree.
  const funnel = [
    {
      label: 'Reservas creadas',
      value: created30,
      cls: 'bg-brand-light',
      href: '/admin/reservas',
    },
    {
      label: 'Con comprobante',
      value: proof30,
      cls: 'bg-sky-500',
      href: '/admin/reservas?tab=revisar',
    },
    {
      label: 'Confirmadas',
      value: confirmed30,
      cls: 'bg-brand',
      href: '/admin/reservas?tab=confirmadas',
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-lg font-bold text-stone-900">Dashboard</h1>

      {health.length > 0 ? (
        <section className="space-y-2">
          {health.map((h) => (
            <div
              key={h.title}
              className={`flex flex-wrap items-start gap-3 rounded-xl border p-4 ${
                h.level === 'critical'
                  ? 'border-red-300 bg-red-50'
                  : 'border-amber-300 bg-amber-50'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-bold ${
                    h.level === 'critical' ? 'text-red-800' : 'text-amber-900'
                  }`}
                >
                  {h.level === 'critical' ? '⚠ ' : ''}
                  {h.title}
                </p>
                <p
                  className={`mt-1 text-xs ${
                    h.level === 'critical' ? 'text-red-700' : 'text-amber-800'
                  }`}
                >
                  {h.detail}
                </p>
              </div>
              {h.href ? (
                <Link
                  href={h.href}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                    h.level === 'critical'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {h.cta ?? 'Revisar'}
                </Link>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

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
              className="group rounded-xl border border-stone-200 bg-white p-4 transition hover:border-brand-light hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
            >
              <p className="text-2xl font-bold text-stone-900">{conteo(resCounts.data as { status: string; n: number }[] | null, c.status)}</p>
              <p className="flex items-center justify-between gap-2 text-xs text-stone-500">
                {c.label}
                <span aria-hidden="true" className="text-stone-300 group-hover:text-brand-light">
                  ›
                </span>
              </p>
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
              <Link
                key={c.status}
                href={`/admin/lotes?estado=${c.status}`}
                className="group rounded-lg bg-stone-50 p-3 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
              >
                <p className={`text-xl font-bold ${c.accent}`}>{conteo(lotCounts.data as { status: string; n: number }[] | null, c.status)}</p>
                <p className="flex items-center justify-between gap-2 text-xs text-stone-500">
                  {c.label}
                  <span aria-hidden="true" className="text-stone-300 group-hover:text-stone-500">
                    ›
                  </span>
                </p>
              </Link>
            ))}
          </div>
        </div>
        <Link
          href="/admin/reservas?tab=confirmadas"
          className="group rounded-xl border border-stone-200 bg-white p-4 transition hover:border-brand-light hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
        >
          <h2 className="flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Ingresos verificados (este mes)
            <span aria-hidden="true" className="text-stone-300 group-hover:text-brand-light">
              ›
            </span>
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
        <div className="space-y-1">
          {funnel.map((f) => (
            <Link
              key={f.label}
              href={f.href}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
            >
              <p className="w-36 shrink-0 text-xs text-stone-500">{f.label}</p>
              <div className="h-6 flex-1 overflow-hidden rounded-md bg-stone-100">
                <div
                  className={`flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white ${f.cls}`}
                  style={{ width: `${Math.max(4, Math.round((f.value / funnelMax) * 100))}%` }}
                >
                  {f.value}
                </div>
              </div>
              <span aria-hidden="true" className="shrink-0 text-stone-300">
                ›
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-stone-400">
          Las cifras son de los últimos 30 días; al abrir cada paso verás la cola completa, sin
          filtro de fecha.
        </p>
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
