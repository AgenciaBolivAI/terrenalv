import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSetting } from '@/lib/server/settings';
import { loadInstagramPosts } from '@/features/landing/instagram';
import { loadTikTokVideos } from '@/features/landing/tiktok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La clave del cron va comparada en tiempo constante, como la del outbox. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

const SALUD_KEY = 'social_feed_health';
const IG_TOKEN_KEY = 'instagram_token';

interface EstadoFeed {
  /** true = la portada está mostrando publicaciones vivas de la red. */
  vivo: boolean;
  /** Cuántas trajo. 0 con vivo=false significa que se ve el respaldo fijo. */
  cantidad: number;
  /** Identificador de la más nueva, para saber si algo cambió desde ayer. */
  ultima: string | null;
  /** Fecha de la más nueva cuando la red la informa (Instagram sí, TikTok no). */
  publicada_el: string | null;
  /** En castellano y sin jerga: por qué no está vivo. */
  motivo: string | null;
}

interface Salud {
  revisado_el: string;
  instagram: EstadoFeed;
  tiktok: EstadoFeed;
  token_instagram: {
    presente: boolean;
    expira_el: string | null;
    dias_restantes: number | null;
  };
}

/**
 * Lee el token de Instagram solo para informar su vencimiento. No lo devuelve
 * nunca: acá se guarda un resumen que después mira el panel, y un token en esa
 * fila sería un secreto de más viajando por la aplicación.
 */
async function estadoDelToken(admin: SupabaseClient): Promise<Salud['token_instagram']> {
  const raw = await getSetting<unknown>(admin, null, IG_TOKEN_KEY, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { presente: false, expira_el: null, dias_restantes: null };
  }
  const expira = (raw as Record<string, unknown>).expires_at;
  if (typeof expira !== 'string' || Number.isNaN(Date.parse(expira))) {
    return { presente: true, expira_el: null, dias_restantes: null };
  }
  return {
    presente: true,
    expira_el: expira,
    dias_restantes: Math.floor((Date.parse(expira) - Date.now()) / 864e5),
  };
}

/**
 * Revisión diaria de los feeds de la portada.
 *
 * La llama pg_cron (`private.ping_social_check`) con
 * `Authorization: Bearer <settings.internal_cron_secret>`, igual que el outbox.
 *
 * Hace DOS cosas, y la primera es la que de verdad importa:
 *
 * 1. **Mantiene vivo el token de Instagram.** El token largo de Meta dura 60
 *    días y solo se renueva llamando a Meta con el token actual. Hasta ahora eso
 *    pasaba únicamente cuando alguien entraba a la portada: si el sitio quedaba
 *    tranquilo dos meses, el token vencía solo y el feed se apagaba sin que
 *    nadie se enterara. Al pedir las publicaciones todos los días, la renovación
 *    ocurre sola dentro de `loadInstagramPosts`.
 *
 * 2. **Deja anotado si la portada está mostrando lo último o el respaldo fijo.**
 *    Los dos feeds caen en silencio a publicaciones fijas cuando la red no
 *    responde — eso es a propósito, para que la página nunca quede con un hueco,
 *    pero el silencio es justo el problema: desde la oficina se ve una sección
 *    llena y nadie sospecha que está congelada. El resumen queda en
 *    `settings.social_feed_health` y el panel lo levanta desde ahí.
 *
 * Se pide sin caché (revalidate 0): una revisión que lee la copia guardada de
 * ayer no está revisando nada.
 */
export async function POST(req: NextRequest) {
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Supabase no configurado.' }, { status: 503 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const secret = await getSetting<string | null>(admin, null, 'internal_cron_secret', null);
  if (!secret || !token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // Ninguno puede tumbar al otro: si Meta se cae, la revisión de TikTok igual
  // tiene que quedar anotada.
  const [igRes, ttRes, tk] = await Promise.all([
    loadInstagramPosts(3, 0).catch(() => null),
    loadTikTokVideos(6, 0).catch(() => null),
    estadoDelToken(admin),
  ]);

  const instagram: EstadoFeed = igRes?.length
    ? {
        vivo: true,
        cantidad: igRes.length,
        ultima: igRes[0].permalink,
        publicada_el: igRes[0].timestamp || null,
        motivo: null,
      }
    : {
        vivo: false,
        cantidad: 0,
        ultima: null,
        publicada_el: null,
        motivo: tk.presente
          ? 'Meta no devolvió publicaciones: el token puede estar vencido o revocado.'
          : 'Falta conectar el token de Instagram; la portada muestra los tres reels fijos.',
      };

  const tiktok: EstadoFeed = ttRes?.length
    ? { vivo: true, cantidad: ttRes.length, ultima: ttRes[0].id, publicada_el: null, motivo: null }
    : {
        vivo: false,
        cantidad: 0,
        ultima: null,
        publicada_el: null,
        motivo:
          'TikTok no respondió o cambió el formato de su embed; la portada muestra los videos fijos.',
      };

  const salud: Salud = {
    revisado_el: new Date().toISOString(),
    instagram,
    tiktok,
    token_instagram: tk,
  };

  // `upsert` y no `update`: la primera corrida tiene que poder crear la fila.
  const { error } = await admin
    .from('settings')
    .upsert(
      { key: SALUD_KEY, project_id: null, value: salud, is_public: false, updated_at: salud.revisado_el },
      { onConflict: 'project_id,key' },
    );
  if (error) {
    // La revisión sirvió igual —el token se renovó si hacía falta—, así que se
    // informa el resultado y se avisa que no se pudo guardar.
    console.error('social-check: no se pudo guardar la salud:', error.message);
    return NextResponse.json({ ...salud, guardado: false }, { status: 200 });
  }

  return NextResponse.json({ ...salud, guardado: true });
}
