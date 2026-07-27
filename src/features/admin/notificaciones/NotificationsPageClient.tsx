'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { NotificationRow } from '@/lib/db-types';
import { timeAgo } from '@/features/admin/lib/time';
import { EmptyState, Spinner, btnSecondary } from '@/features/admin/ui/bits';

type Item = Pick<
  NotificationRow,
  'id' | 'type' | 'priority' | 'title' | 'body' | 'entity_type' | 'entity_id' | 'created_at'
>;

export default function NotificationsPageClient({
  projectId,
  profileId,
}: {
  projectId: string | null;
  profileId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('notifications')
      .select('id, type, priority, title, body, entity_type, entity_id, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (projectId) q = q.eq('project_id', projectId);
    const { data } = await q;
    const list = (data ?? []) as Item[];
    setItems(list);
    if (list.length > 0) {
      const { data: reads } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('profile_id', profileId)
        .in('notification_id', list.map((n) => n.id));
      setReadIds(new Set((reads ?? []).map((r) => r.notification_id as string)));
    }
    setLoading(false);
  }, [supabase, projectId, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set(prev).add(id));
    await supabase
      .from('notification_reads')
      .upsert({ notification_id: id, profile_id: profileId }, { onConflict: 'notification_id,profile_id', ignoreDuplicates: true });
  }

  async function markAll() {
    const pending = items.filter((n) => !readIds.has(n.id)).map((n) => ({ notification_id: n.id, profile_id: profileId }));
    if (pending.length === 0) return;
    setReadIds(new Set(items.map((n) => n.id)));
    await supabase
      .from('notification_reads')
      .upsert(pending, { onConflict: 'notification_id,profile_id', ignoreDuplicates: true });
  }

  function openItem(n: Item) {
    void markRead(n.id);
    if (n.entity_type === 'reservation' && n.entity_id) {
      router.push(`/admin/reservas?open=${n.entity_id}`);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-stone-900">Notificaciones</h1>
        <button type="button" className={btnSecondary} onClick={() => void markAll()}>
          Marcar todas como leídas
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-14">
          <Spinner label="Cargando notificaciones…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Sin notificaciones" hint="Aquí verás nuevas reservas y comprobantes." />
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {items.map((n) => {
            const unread = !readIds.has(n.id);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50 ${unread ? 'bg-green-50/60' : ''}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      unread ? (n.priority === 'alta' ? 'bg-red-500' : 'bg-brand-light') : 'bg-transparent'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${unread ? 'font-semibold text-stone-900' : 'font-medium text-stone-700'}`}>
                      {n.title}
                    </span>
                    {n.body ? <span className="block text-xs text-stone-500">{n.body}</span> : null}
                    <span className="block text-[11px] text-stone-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
