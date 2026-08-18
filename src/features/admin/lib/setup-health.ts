import 'server-only';

// Configuration health for the admin dashboard.
//
// Some settings are not "nice to have": with payment_instructions empty, a buyer
// reserves a lot, gets told to pay, and is shown no bank, no account and no QR.
// The reservation then expires on its own after 48 hours and the lot goes back
// on sale. Nothing errors, nothing is logged, and from the office it just looks
// like people are not paying.
//
// That failure was invisible for as long as it existed, so the dashboard now
// says it out loud. Everything here is a read; nothing is auto-fixed, because
// each of these needs a human decision or a bank detail only Terrenalv has.

import { createAdminClient } from '@/lib/supabase/admin';

export type HealthLevel = 'critical' | 'warning';

export interface HealthIssue {
  level: HealthLevel;
  title: string;
  detail: string;
  href?: string;
  cta?: string;
}

interface PaymentInstructions {
  bank_name?: string;
  account_holder?: string;
  account_masked?: string;
  qr_image_path?: string | null;
}

function isBlank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === '';
}

export async function checkSetupHealth(projectId: string | null): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  try {
    const supabase = createAdminClient();

    const { data: settings } = await supabase
      .from('settings')
      .select('key, value, project_id')
      .in('key', ['payment_instructions', 'reserve_amount', 'financing_plan', 'notification_emails']);

    const get = (key: string) =>
      (settings ?? []).find((s) => s.key === key && (s.project_id === projectId || s.project_id === null))
        ?.value;

    // ---- Can a buyer actually pay? -------------------------------------
    const pay = (get('payment_instructions') ?? {}) as PaymentInstructions;
    const missing: string[] = [];
    if (isBlank(pay.bank_name)) missing.push('banco');
    if (isBlank(pay.account_holder)) missing.push('titular');
    if (isBlank(pay.account_masked)) missing.push('número de cuenta');
    if (isBlank(pay.qr_image_path)) missing.push('imagen del QR');

    if (missing.length === 4) {
      issues.push({
        level: 'critical',
        title: 'Nadie puede pagar una reserva',
        detail:
          'Los datos de pago están vacíos: sin banco, sin titular, sin cuenta y sin QR. ' +
          'El comprador reserva, ve una pantalla de pago sin datos, y a las 48 horas su ' +
          'reserva vence sola y el lote vuelve al mapa. Desde la oficina parece que la ' +
          'gente no paga.',
        href: '/admin/configuracion',
        cta: 'Cargar datos de pago',
      });
    } else if (missing.length > 0) {
      issues.push({
        level: 'warning',
        title: 'Faltan datos de pago',
        detail: `Sin ${missing.join(', ')}. El comprador puede quedarse sin saber a dónde transferir.`,
        href: '/admin/configuracion',
        cta: 'Completar',
      });
    }

    // ---- Seña vs cuota inicial: two figures the buyer sees together -----
    const reserve = get('reserve_amount') as { type?: string; value?: number } | undefined;
    const plan = get('financing_plan') as { down_payment_value?: number; down_payment_type?: string } | undefined;
    if (
      reserve?.type === 'fijo' &&
      typeof reserve.value === 'number' &&
      plan?.down_payment_type === 'fijo' &&
      typeof plan.down_payment_value === 'number' &&
      reserve.value !== plan.down_payment_value
    ) {
      issues.push({
        level: 'warning',
        title: 'La seña y la cuota inicial no coinciden',
        detail:
          `La landing pide Bs ${reserve.value.toLocaleString('es-BO')} para asegurar el lote ` +
          `y anuncia una cuota inicial de Bs ${plan.down_payment_value.toLocaleString('es-BO')}. ` +
          'Son cosas distintas, pero el comprador las ve juntas y pregunta cuál es.',
        href: '/admin/configuracion',
        cta: 'Revisar',
      });
    }

    if (!projectId) return issues;

    // ---- Sales nobody is billing ---------------------------------------
    const { count: confirmadas } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'confirmada');
    const { count: planes } = await supabase
      .from('installment_plans')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('status', 'cancelado');

    if ((confirmadas ?? 0) > (planes ?? 0)) {
      const gap = (confirmadas ?? 0) - (planes ?? 0);
      issues.push({
        level: 'warning',
        title: `${gap} venta(s) sin plan de pago`,
        detail:
          'Están confirmadas pero no tienen cuotas cargadas, así que no figuran en lo que hay ' +
          'por cobrar ni en la mora. A esos compradores no les está cobrando nadie.',
        href: '/admin/contabilidad?tab=cobrar',
        cta: 'Crear planes',
      });
    }

    // ---- Money already late --------------------------------------------
    const today = new Date().toISOString().slice(0, 10);
    const { count: vencidas } = await supabase
      .from('installments')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('status', ['pendiente', 'parcial'])
      .lt('due_date', today);

    if ((vencidas ?? 0) > 0) {
      issues.push({
        level: 'warning',
        title: `${vencidas} cuota(s) vencida(s)`,
        detail: 'Hay plata que ya debía haber entrado y no entró.',
        href: '/admin/contabilidad?tab=cobrar',
        cta: 'Ver atrasados',
      });
    }

    return issues;
  } catch {
    // The dashboard must render even if this check cannot run.
    return issues;
  }
}
