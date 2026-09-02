import 'server-only';

// Los últimos videos de TikTok para la portada, sin credenciales.
//
// TikTok no tiene API pública sin OAuth, pero la página del embed de creador
// (tiktok.com/embed/@usuario) se sirve a cualquier navegador sin login y trae
// los videos más recientes del perfil como JSON incrustado. De ahí se leen los
// ids y las descripciones, y la sección renderiza las MISMAS tarjetas por
// video de siempre (embed/v2/<id>) — la grilla no cambia de forma, solo se
// mantiene al día sola.
//
// Todo degrada a null. Si TikTok bloquea el pedido (a veces reta a las IPs de
// datacenter), la portada vuelve a los seis videos fijos verificados a mano:
// la página jamás puede dejar de renderizar porque una red social se cayó.

const EMBED_URL = 'https://www.tiktok.com/embed/@terrenalv.s.r.l';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface TikTokVideo {
  id: string;
  caption: string;
}

/**
 * El titular de la tarjeta sale de la descripción del video: se desescapa el
 * JSON, se corta antes del primer hashtag y se limita el largo. Una descripción
 * que quede vacía no es titular.
 */
function limpiarCaption(raw: string): string | null {
  let texto: string;
  try {
    texto = JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
  const corte = texto.indexOf('#');
  if (corte >= 0) texto = texto.slice(0, corte);
  texto = texto.replace(/\s+/g, ' ').trim();
  if (!texto) return null;
  return texto.length > 90 ? `${texto.slice(0, 87).trimEnd()}…` : texto;
}

/**
 * Los videos más nuevos del perfil (el fijado primero, después por fecha), o
 * null cuando TikTok no responde o cambió el formato. El HTML del embed trae un
 * objeto por video: {"id":"<dígitos>", …, "desc":"…"}. El primer id largo es el
 * de la CUENTA y no lleva desc — exigir la descripción hace de filtro.
 */
export async function loadTikTokVideos(
  limit = 6,
  revalidateSeconds = 300,
): Promise<TikTokVideo[] | null> {
  try {
    const res = await fetch(EMBED_URL, {
      next: { revalidate: revalidateSeconds },
      headers: { 'User-Agent': UA, 'Accept-Language': 'es' },
    });
    if (!res.ok) {
      console.error('tiktok: el embed de creador respondió', res.status);
      return null;
    }
    const html = await res.text();

    // split con grupo de captura: [antes, id1, cuerpo1, id2, cuerpo2, …] — cada
    // cuerpo llega hasta el id siguiente, así que su primer "desc" es el suyo.
    const tramos = html.split(/"id":"(\d{15,})"/);
    const vistos = new Set<string>();
    const videos: TikTokVideo[] = [];
    for (let i = 1; i < tramos.length - 1 && videos.length < limit; i += 2) {
      const id = tramos[i];
      if (vistos.has(id)) continue;
      const m = tramos[i + 1].match(/"desc":"((?:[^"\\]|\\.)*)"/);
      if (!m) continue;
      vistos.add(id);
      videos.push({ id, caption: limpiarCaption(m[1]) ?? 'Ver el video en TikTok' });
    }

    return videos.length ? videos : null;
  } catch (err) {
    console.error('tiktok: feed no disponible', err);
    return null;
  }
}
