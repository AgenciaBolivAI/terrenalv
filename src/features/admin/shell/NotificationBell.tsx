'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { NotificationRow } from '@/lib/db-types';
import { timeAgo } from '@/features/admin/lib/time';
import { useToast } from '@/features/admin/ui/toast';
import { IconBell } from '@/features/admin/ui/icons';
import { useAdmin } from './AdminContext';

const MUTE_KEY = 'terrenalv_bell_mute';

/**
 * The bell owns the single realtime subscription to `team:{projectId}` and
 * re-emits every broadcast as a DOM event, so other views (e.g. the
 * verification queue) can react without opening a second channel on the same
 * topic (some realtime-js versions reject duplicate subscriptions).
 */
export const TEAM_NOTIFICATION_EVENT = 'terrenalv:team-notification';

type FeedItem = Pick<
  NotificationRow,
  'id' | 'type' | 'priority' | 'title' | 'body' | 'entity_type' | 'entity_id' | 'created_at'
>;

const FEED_COLUMNS = 'id, type, priority, title, body, entity_type, entity_id, created_at';

export default function NotificationBell() {
  const { profile, projectId } = useAdmin();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { push } = useToast();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef<FeedItem[]>([]);
  itemsRef.current = items;

  // ---- WebAudio chime: context unlocked on the first user gesture. ----
  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === '1');
    const unlock = () => {
      try {
        if (!audioRef.current) audioRef.current = new AudioContext();
        void audioRef.current.resume();
      } catch {
        // sin soporte de audio
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const chime = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }, []);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      return next;
    });
  }

  // ---- Initial load: last 50 notifications + own read marks, diffed here. ----
  const loadFeed = useCallback(async () => {
    let query = supabase
      .from('notifications')
      .select(FEED_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50);
    if (projectId) query = query.eq('project_id', projectId);
    const { data: rows } = await query;
    if (!rows) return;
    setItems(rows as FeedItem[]);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      setReadIds(new Set());
      return;
    }
    const { data: reads } = await supabase
      .from('notification_reads')
      .select('notification_id')
      .eq('profile_id', profile.id)
      .in('notification_id', ids);
    setReadIds(new Set((reads ?? []).map((r) => r.notification_id as string)));
  }, [supabase, projectId, profile.id]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // ---- Private realtime topic team:{projectId}, event 'notification'. ----
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const channel = supabase.channel(`team:${projectId}`, { config: { private: true } });

    const setup = async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        // sin sesión — la suscripción fallará silenciosamente
      }
      if (cancelled) return;
      channel
        .on('broadcast', { event: 'notification' }, ({ payload }) => {
          const p = payload as { id?: string; type?: string; title?: string; priority?: string };
          if (!p?.id) return;
          window.dispatchEvent(new CustomEvent(TEAM_NOTIFICATION_EVENT, { detail: p }));
          if (itemsRef.current.some((n) => n.id === p.id)) return;
          push(p.title ?? 'Nueva notificación', p.priority === 'alta' ? 'error' : 'info');
          if (p.priority === 'alta' && !mutedRef.current) chime();
          // Fetch the full row (RLS-checked) — the broadcast is just a pointer.
          void supabase
            .from('notifications')
            .select(FEED_COLUMNS)
            .eq('id', p.id)
            .maybeSingle()
            .then(({ data }) => {
              if (data) {
                setItems((prev) =>
                  prev.some((n) => n.id === data.id) ? prev : [data as FeedItem, ...prev].slice(0, 50),
                );
              }
            });
        })
        .subscribe();
    };
    void setup();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, projectId, push, chime]);

  const unread = items.filter((n) => !readIds.has(n.id));

  async function markRead(id: string) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set(prev).add(id));
    await supabase
      .from('notification_reads')
      .upsert(
        { notification_id: id, profile_id: profile.id },
        { onConflict: 'notification_id,profile_id', ignoreDuplicates: true },
      );
  }

  async function markAllRead() {
    const pending = unread.map((n) => ({ notification_id: n.id, profile_id: profile.id }));
    if (pending.length === 0) return;
    setReadIds(new Set(items.map((n) => n.id)));
    await supabase
      .from('notification_reads')
      .upsert(pending, { onConflict: 'notification_id,profile_id', ignoreDuplicates: true });
  }

  function openItem(n: FeedItem) {
    void markRead(n.id);
    setOpen(false);
    if (n.entity_type === 'reservation' && n.entity_id) {
      router.push(`/admin/reservas?open=${n.entity_id}`);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notificaciones${unread.length ? ` (${unread.length} sin leer)` : ''}`}
        className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100"
      >
        <IconBell className="h-5 w-5" />
        {unread.length > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
              <p className="text-sm font-semibold text-stone-800">Notificaciones</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
                  title={muted ? 'Activar sonido' : 'Silenciar'}
                >
                  {muted ? 'Sonido: off' : 'Sonido: on'}
                </button>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={unread.length === 0}
                  className="rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-green-50 disabled:text-stone-300"
                >
                  Marcar todas como leídas
                </button>
              </div>
            </div>
            <ul className="max-h-[60dvh] overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-stone-400">Sin notificaciones</li>
              ) : (
                items.map((n) => {
                  const isUnread = !readIds.has(n.id);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-stone-50 ${
                          isUnread ? 'bg-green-50/60' : ''
                        }`}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            isUnread
                              ? n.priority === 'alta'
                                ? 'bg-red-500'
                                : 'bg-brand-light'
                              : 'bg-transparent'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-stone-800">
                            {n.title}
                          </span>
                          {n.body ? (
                            <span className="block truncate text-xs text-stone-500">{n.body}</span>
                          ) : null}
                          <span className="block text-[11px] text-stone-400">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
