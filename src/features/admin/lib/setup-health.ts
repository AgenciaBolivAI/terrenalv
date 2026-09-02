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

/** Lo que deja escrito la revisión diaria de los feeds de la portada. */
interface SocialFeedHealth {
  revisado_el?: string;
  instagram?: { vivo: boolean; motivo: string | null };
  tiktok?: { vivo: boolean; motivo: string | null };
  token_instagram?: { presente: boolean; dias_restantes: number | null };
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
      .in('key', ['payment_instructions', 'social_feed_health']);

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

    // ---- ¿La portada muestra lo último, o quedó congelada? --------------
    // Esto NO es un consejo sobre cómo usar las redes: es un estado roto y
    // silencioso. Los dos feeds caen a publicaciones fijas cuando la red no
    // responde, así que la sección se ve llena aunque lleve meses detenida.
    // Lo escribe la revisión diaria (private.ping_social_check → /api/internal
    // /social-check); sin esa fila todavía, no se dice nada.
    const salud = get('social_feed_health') as SocialFeedHealth | undefined;
    if (salud) {
      if (salud.instagram && !salud.instagram.vivo) {
        const sinToken = salud.token_instagram?.presente === false;
        issues.push({
          level: 'warning',
          title: sinToken
            ? 'Instagram no está conectado'
            : 'Instagram dejó de traer publicaciones',
          detail:
            (salud.instagram.motivo ?? 'El feed no respondió.') +
            ' La portada sigue mostrando los tres reels fijos de siempre, así que ' +
            'desde afuera parece al día.',
          href: '/admin/configuracion',
          cta: sinToken ? 'Cómo conectarlo' : 'Revisar',
        });
      }

      // Meta solo renueva el token con el token vivo: si vence, hay que rehacer
      // el trámite entero. Se avisa con margen.
      const dias = salud.token_instagram?.dias_restantes;
      if (salud.token_instagram?.presente && typeof dias === 'number' && dias <= 7) {
        issues.push({
          level: dias <= 2 ? 'critical' : 'warning',
          title: `El token de Instagram vence en ${dias <= 0 ? 'menos de un día' : `${dias} día${dias === 1 ? '' : 's'}`}`,
          detail:
            'Se renueva solo todos los días, así que esto solo aparece si la renovación ' +
            'viene fallando. Si vence hay que rehacer el trámite en Meta desde cero.',
          href: '/admin/configuracion',
          cta: 'Revisar',
        });
      }

      if (salud.tiktok && !salud.tiktok.vivo) {
        issues.push({
          level: 'warning',
          title: 'TikTok dejó de traer videos',
          detail:
            (salud.tiktok.motivo ?? 'El feed no respondió.') +
            ' La portada muestra los seis videos fijos, así que la sección se ve bien ' +
            'pero no tiene lo nuevo.',
        });
      }
    }

    return issues;
  } catch {
    // The dashboard must render even if this check cannot run.
    return issues;
  }
}
