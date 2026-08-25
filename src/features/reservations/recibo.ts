import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Datos de un recibo, para el panel y para el comprador.
 *
 * Vive fuera de las dos páginas para que las dos muestren EXACTAMENTE el mismo
 * papel. Si cada una armara el suyo, con el tiempo dirían cosas distintas del
 * mismo pago — y el comprador tendría un recibo que no coincide con el del
 * mostrador.
 */
export interface ReciboData {
  id: string;
  reference_code: string;
  purpose: string;
  amount: number;
  currency: 'BOB' | 'USD';
  provider: string;
  verified_at: string | null;
  created_at: string;
  status: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  price_agreed: number;
  manzana: string;
  lote: string;
  /** Nombre de la urbanización: son varias, no siempre Prados del Sur. */
  proyecto: string;
  pagado_total: number;
  saldo: number;
}

interface Row {
  id: string;
  reservation_id: string;
  reference_code: string;
  purpose: string;
  amount: number;
  currency: 'BOB' | 'USD';
  provider: string;
  verified_at: string | null;
  created_at: string;
  status: string;
  reservations: {
    tracking_code: string;
    buyer_full_name: string;
    buyer_ci: string;
    buyer_phone: string;
    price_agreed: number;
    currency: 'BOB' | 'USD';
    projects: { name: string } | null;
    lots: { number: string; manzanas: { code: string } | null } | null;
  } | null;
}

const SELECT =
  'id, reservation_id, reference_code, purpose, amount, currency, provider, verified_at, created_at, status, ' +
  'reservations!payments_reservation_id_fkey(tracking_code, buyer_full_name, buyer_ci, buyer_phone, ' +
  'price_agreed, currency, projects(name), lots!reservations_lot_id_fkey(number, manzanas(code)))';

/**
 * Un recibo por id de pago.
 *
 * `trackingCode` restringe el acceso al dueño del pago: la página pública lo
 * exige, así que un comprador sólo ve los recibos de SU reserva aunque adivine
 * el id de otro pago. El panel lo omite porque ya está detrás de sesión.
 */
export async function cargarRecibo(
  paymentId: string,
  trackingCode?: string,
): Promise<ReciboData | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('payments').select(SELECT).eq('id', paymentId).maybeSingle();

  const pay = data as unknown as Row | null;
  if (!pay?.reservations) return null;

  const res = pay.reservations;
  if (trackingCode && res.tracking_code !== trackingCode) return null;

  // Sólo se entrega recibo de un pago aprobado: uno pendiente todavía puede
  // rechazarse, y un papel que dice "recibimos" de plata que quizá se devuelva
  // es peor que no dar papel.
  if (pay.status !== 'aprobado') return null;

  const { data: todos } = await supabase
    .from('payments')
    .select('amount')
    .eq('reservation_id', pay.reservation_id)
    .eq('status', 'aprobado');
  const pagadoTotal = (todos ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return {
    id: pay.id,
    reference_code: pay.reference_code,
    purpose: pay.purpose,
    amount: Number(pay.amount),
    currency: pay.currency,
    provider: pay.provider,
    verified_at: pay.verified_at,
    created_at: pay.created_at,
    status: pay.status,
    tracking_code: res.tracking_code,
    buyer_full_name: res.buyer_full_name,
    buyer_ci: res.buyer_ci,
    buyer_phone: res.buyer_phone,
    price_agreed: Number(res.price_agreed),
    manzana: res.lots?.manzanas?.code ?? '—',
    lote: res.lots?.number ?? '—',
    proyecto: res.projects?.name ?? 'Terrenalv',
    pagado_total: pagadoTotal,
    saldo: Math.max(0, Number(res.price_agreed) - pagadoTotal),
  };
}

/** Los pagos aprobados de una reserva, para listarlos con su recibo. */
export async function recibosDeReserva(
  trackingCode: string,
): Promise<{ id: string; reference_code: string; amount: number; currency: string; provider: string; verified_at: string | null; purpose: string }[]> {
  const supabase = createAdminClient();
  const { data: res } = await supabase
    .from('reservations')
    .select('id')
    .eq('tracking_code', trackingCode)
    .maybeSingle();
  if (!res) return [];

  const { data } = await supabase
    .from('payments')
    .select('id, reference_code, amount, currency, provider, verified_at, purpose')
    .eq('reservation_id', (res as { id: string }).id)
    .eq('status', 'aprobado')
    .order('verified_at', { ascending: false });
  return (data ?? []) as never;
}
