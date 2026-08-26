import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { PlanImpreso } from './PlanDePago';

/**
 * El plan de pago para imprimir, armado desde la base.
 *
 * `trackingCode` restringe el acceso al dueño, igual que en el recibo: la
 * página pública lo exige, así que un comprador solo ve SU plan aunque
 * adivine el id de otro.
 */
export async function cargarPlanImpreso(opts: {
  planId?: string;
  trackingCode?: string;
}): Promise<PlanImpreso | null> {
  const supabase = createAdminClient();

  let q = supabase
    .from('v_planes')
    .select(
      'plan_id, reservation_id, proyecto, tracking_code, buyer_full_name, buyer_ci, buyer_phone, ' +
        'manzana, lote, estado, total_price, down_payment, financed_amount, months, ' +
        'monthly_amount, monthly_interest_pct, first_due_date',
    );
  if (opts.planId) q = q.eq('plan_id', opts.planId);
  else if (opts.trackingCode) {
    // El comprador entra con su código: se le muestra su plan VIGENTE. Un
    // plan cancelado por traspaso o por abono ya no es el suyo.
    q = q.eq('tracking_code', opts.trackingCode.toUpperCase()).eq('estado', 'activo');
  } else return null;

  const { data } = await q.limit(1).maybeSingle();
  if (!data) return null;
  const p = data as unknown as PlanImpreso & { plan_id: string };

  if (opts.trackingCode && p.tracking_code !== opts.trackingCode.toUpperCase()) return null;

  const { data: cs } = await supabase
    .from('installments')
    .select('number, due_date, amount, interes, amount_paid, status')
    .eq('plan_id', p.plan_id)
    // Las anuladas son cuotas que un abono a capital reemplazó: mostrarlas
    // sería entregarle al comprador un cronograma que ya no debe.
    .neq('status', 'anulada')
    .order('number');

  return {
    ...p,
    monthly_interest_pct: Number(p.monthly_interest_pct ?? 0),
    cuotas: (cs ?? []).map((c) => {
      const r = c as {
        number: number;
        due_date: string;
        amount: number;
        interes: number;
        amount_paid: number;
        status: string;
      };
      return {
        number: Number(r.number),
        due_date: r.due_date,
        amount: Number(r.amount),
        interes: Number(r.interes ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
        status: r.status,
      };
    }),
  };
}
