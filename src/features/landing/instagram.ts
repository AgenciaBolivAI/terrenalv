import 'server-only';

// Live Instagram feed for the landing page.
//
// Instagram has no public profile-feed widget — Meta retired it — so the only
// way to show "whatever Terrenalv posted last" is the Graph API with a token.
//
// The token lives in settings.instagram_token with is_public = false, NOT in an
// environment variable. Long-lived Instagram tokens expire after 60 days and can
// only be refreshed by calling Meta with the current one; a token in Vercel's
// env would need a human to notice the feed had gone dark and paste a new one
// every two months. In the database, this module refreshes it on its own.
//
// Everything degrades to null. If the token is missing, expired, revoked, or
// Meta is down, the landing page falls back to the fixed posts it already had —
// it must never fail to render because a social network did.

import { createAdminClient } from '@/lib/supabase/admin';

export { captionHeadline } from './caption';

const GRAPH = 'https://graph.instagram.com';
const SETTING_KEY = 'instagram_token';

/** Refresh once the token has less than this left, well inside the 60-day life. */
const REFRESH_WHEN_DAYS_LEFT = 10;
/** Meta refuses to refresh a token younger than 24 h; don't waste the call. */
const MIN_AGE_HOURS = 24;

export interface InstagramPost {
  id: string;
  permalink: string;
  caption: string | null;
  /** Always a still image: the poster frame for videos and reels. */
  imageUrl: string;
  isVideo: boolean;
  timestamp: string;
}

interface StoredToken {
  token: string;
  /** ISO date the token stops working. */
  expires_at: string;
  /** ISO date it was last issued or refreshed — Meta's 24 h minimum age. */
  obtained_at: string;
}

interface MediaNode {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

function parseStored(raw: unknown): StoredToken | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.token !== 'string' || !t.token.trim()) return null;
  const expires = typeof t.expires_at === 'string' ? t.expires_at : null;
  const obtained = typeof t.obtained_at === 'string' ? t.obtained_at : null;
  if (!expires || Number.isNaN(Date.parse(expires))) return null;
  return {
    token: t.token,
    expires_at: expires,
    obtained_at: obtained && !Number.isNaN(Date.parse(obtained)) ? obtained : expires,
  };
}

/**
 * Swap the current long-lived token for a fresh 60-day one and store it.
 * Failure is not fatal: the current token still works until it expires, so the
 * caller keeps using it and simply tries again on the next revalidation.
 */
async function refresh(current: StoredToken): Promise<StoredToken> {
  const ageHours = (Date.now() - Date.parse(current.obtained_at)) / 36e5;
  if (ageHours < MIN_AGE_HOURS) return current;

  const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current.token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.error('instagram: no se pudo renovar el token', res.status, await res.text());
    return current;
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token || !body.expires_in) return current;

  const now = new Date();
  const next: StoredToken = {
    token: body.access_token,
    expires_at: new Date(now.getTime() + body.expires_in * 1000).toISOString(),
    obtained_at: now.toISOString(),
  };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('settings')
    .update({ value: next, is_public: false, updated_at: now.toISOString() })
    .eq('key', SETTING_KEY)
    .is('project_id', null);
  if (error) {
    // The new token is valid but unsaved; using it now and re-refreshing later
    // is harmless, so this is a warning rather than a failure.
    console.error('instagram: token renovado pero no guardado:', error.message);
  }
  return next;
}

async function loadToken(): Promise<StoredToken | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value, is_public')
    .eq('key', SETTING_KEY)
    .is('project_id', null)
    .maybeSingle();
  if (error || !data) return null;

  // A token that somehow got marked public would be readable by anon through
  // RLS. Refuse to use it and say so loudly rather than quietly leaking it.
  if (data.is_public) {
    console.error(`instagram: settings.${SETTING_KEY} está marcado is_public — no se usa`);
    return null;
  }

  const stored = parseStored(data.value);
  if (!stored) return null;
  if (Date.parse(stored.expires_at) <= Date.now()) {
    console.error('instagram: el token expiró; hay que generar uno nuevo');
    return null;
  }

  const daysLeft = (Date.parse(stored.expires_at) - Date.now()) / 864e5;
  return daysLeft <= REFRESH_WHEN_DAYS_LEFT ? refresh(stored) : stored;
}

/**
 * The newest posts from the connected Instagram account, or null when the feed
 * is not configured or unreachable. Cached for `revalidateSeconds` — Instagram's
 * media URLs are signed and expire in a matter of days, so this must not be
 * cached hard.
 */
export async function loadInstagramPosts(
  limit = 3,
  revalidateSeconds = 300,
): Promise<InstagramPost[] | null> {
  try {
    const stored = await loadToken();
    if (!stored) return null;

    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
    const url =
      `${GRAPH}/me/media?fields=${fields}&limit=${Math.max(1, Math.min(limit, 25))}` +
      `&access_token=${encodeURIComponent(stored.token)}`;
    const res = await fetch(url, { next: { revalidate: revalidateSeconds } });
    if (!res.ok) {
      console.error('instagram: media falló', res.status, await res.text());
      return null;
    }

    const body = (await res.json()) as { data?: MediaNode[] };
    const posts = (body.data ?? [])
      .map((m): InstagramPost | null => {
        // Videos and reels report the mp4 in media_url; the still is in
        // thumbnail_url. Putting an mp4 in an <img> renders nothing.
        const isVideo = m.media_type === 'VIDEO';
        const imageUrl = isVideo ? m.thumbnail_url : m.media_url;
        if (!imageUrl || !m.permalink) return null;
        return {
          id: m.id,
          permalink: m.permalink,
          caption: m.caption?.trim() ? m.caption.trim() : null,
          imageUrl,
          isVideo,
          timestamp: m.timestamp ?? '',
        };
      })
      .filter((p): p is InstagramPost => p !== null)
      .slice(0, limit);

    return posts.length ? posts : null;
  } catch (err) {
    console.error('instagram: feed no disponible', err);
    return null;
  }
}
