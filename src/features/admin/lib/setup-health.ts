import 'server-only';

// ONE check, and only because it is a broken state rather than an opinion:
// with payment_instructions empty a buyer reserves a lot, reaches a payment
// screen with no bank, no account and no QR, and 48 hours later the hold
// expires and the lot goes back on the map. Nothing errors and nothing is
// logged, so from the office it just looks like people are not paying.
//
// This panel belongs to Terrenalv's staff, not to whoever builds it. Anything
// that is merely advice — how they price, how they structure a seña versus a
// cuota inicial, what they should chase — does NOT go here. Those are business
// decisions, and a warning banner that second-guesses them is noise in someone
// else's workplace.

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
      .in('key', ['payment_instructions']);

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

    return issues;
  } catch {
    // The dashboard must render even if this check cannot run.
    return issues;
  }
}
