'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, formatDateTime, waLink } from '@/lib/format';
import type { TeamRole } from '@/lib/db-types';
import { sinceLabel, untilLabel } from '@/features/admin/lib/time';
import {
  RESERVATION_STATUS_BADGE,
  RESERVATION_STATUS_LABEL,
} from '@/features/admin/lib/labels';
import {
  DEFAULT_WA_TEMPLATES,
  fillTemplate,
  type WhatsappTemplates,
} from '@/features/admin/lib/whatsapp';
import { TEAM_NOTIFICATION_EVENT } from '@/features/admin/shell/NotificationBell';
import { Badge, EmptyState, Spinner, inputClass } from '@/features/admin/ui/bits';
import { IconSearch, IconWhatsapp } from '@/features/admin/ui/icons';
import { useToast } from '@/features/admin/ui/toast';
import ReservationDetail from './ReservationDetail';
import {
  QUEUE_SELECT,
  TABS,
  reservePayment,
  tabForStatus,
  type QueueRow,
  type TabId,
} from './types';

interface Props {
  projectId: string | null;
  role: TeamRole;
  initialTab: TabId;
  openId: string | null;
  initialQuery: string;
}

function sanitizeQuery(q: string): string {
  return q.replace(/[,()%\\]/g, '').trim();
}

function rowTimeLabel(tab: TabId, row: QueueRow): string {
  const pay = reservePayment(row);
  switch (tab) {
    case 'revisar':
      return pay?.proof_submitted_at ? `esperando ${sinceLabel(pay.proof_submitted_at)}` : 'esperando';
    case 'espera':
      return row.hold_expires_at ? `vence en ${untilLabel(row.hold_expires_at)}` : 'sin vencimiento';
    case 'reintento':
      return row.retry_expires_at ? `vence en ${untilLabel(row.retry_expires_at)}` : 'sin vencimiento';
    case 'confirmadas':
      return row.confirmed_at ? formatDateTime(row.confirmed_at) : '';
    default:
      return formatDateTime(row.created_at);
  }
}

export default function ReservationsClient({ projectId, role, initialTab, openId, initialQuery }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [tab, setTab] = useState<TabId>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counts, setCounts] = useState<Record<TabId, number>>({
    revisar: 0,
    espera: 0,
    reintento: 0,
    confirmadas: 0,
    finalizadas: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [waTemplates, setWaTemplates] = useState<WhatsappTemplates>(DEFAULT_WA_TEMPLATES);
  const pendingOpenRef = useRef<string | null>(openId);

  const rowsRef = useRef<QueueRow[]>([]);
  rowsRef.current = rows;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const queryRef = useRef(query);
  queryRef.current = query;

  const syncUrl = useCallback((nextTab: TabId, nextOpen: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', nextTab);
    if (nextOpen) url.searchParams.set('open', nextOpen);
    else url.searchParams.delete('open');
    window.history.replaceState(null, '', url.toString());
  }, []);

  // ---- WhatsApp templates (settings, team-readable) ----
  useEffect(() => {
    let alive = true;
    void supabase
      .from('settings')
      .select('project_id, value')
      .eq('key', 'whatsapp_templates')
      .then(({ data }) => {
        if (!alive || !data) return;
        const specific = projectId ? data.find((r) => r.project_id === projectId) : undefined;
        const global = data.find((r) => r.project_id === null);
        const v = (specific ?? global)?.value as Partial<WhatsappTemplates> | undefined;
        if (v) setWaTemplates({ ...DEFAULT_WA_TEMPLATES, ...v });
      });
    return () => {
      alive = false;
    };
  }, [supabase, projectId]);

  // ---- Counts per tab ----
  const fetchCounts = useCallback(async () => {
    if (!projectId) return;
    const results = await Promise.all(
      TABS.map((t) =>
        supabase
          .from('reservations')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .in('status', t.statuses),
      ),
    );
    setCounts((prev) => {
      const next = { ...prev };
      TABS.forEach((t, i) => {
        next[t.id] = results[i].count ?? 0;
      });
      return next;
    });
  }, [supabase, projectId]);

  // ---- Main list fetch (returns the fresh list — state updates are async) ----
  const fetchList = useCallback(async (): Promise<QueueRow[]> => {
    if (!projectId) {
      setLoading(false);
      return [];
    }
    setLoading(true);
    const t = TABS.find((x) => x.id === tabRef.current) ?? TABS[0];
    let q = supabase
      .from('reservations')
      .select(QUEUE_SELECT)
      .eq('project_id', projectId)
      .in('status', t.statuses)
      .limit(200);

    const search = sanitizeQuery(queryRef.current);
    if (search) {
      q = q.or(
        `tracking_code.ilike.%${search}%,buyer_ci.ilike.%${search}%,buyer_full_name.ilike.%${search}%`,
      );
    }
    switch (t.id) {
      case 'espera':
        q = q.order('hold_expires_at', { ascending: true, nullsFirst: false });
        break;
      case 'reintento':
        q = q.order('retry_expires_at', { ascending: true, nullsFirst: false });
        break;
      case 'confirmadas':
        q = q.order('confirmed_at', { ascending: false, nullsFirst: false });
        break;
      default:
        q = q.order('created_at', { ascending: false });
    }

    const { data, error } = await q;
    if (error) {
      push('No se pudo cargar la lista de reservas.', 'error');
      setLoading(false);
      return rowsRef.current;
    }
    let list = (data ?? []) as unknown as QueueRow[];
    if (t.id === 'revisar') {
      // FIFO: oldest proof first.
      list = [...list].sort((a, b) => {
        const pa = reservePayment(a)?.proof_submitted_at ?? a.created_at;
        const pb = reservePayment(b)?.proof_submitted_at ?? b.created_at;
        return pa.localeCompare(pb);
      });
    }
    setRows(list);
    setLoading(false);
    return list;
  }, [supabase, projectId, push]);

  useEffect(() => {
    void fetchList();
    void fetchCounts();
  }, [fetchList, fetchCounts, tab]);

  // Search debounce.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchList(), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ---- Deep link ?open=<reservation_id> ----
  // Re-arms whenever the URL param changes: clicking a bell notification while
  // ALREADY on /admin/reservas only changes the query string (no remount), so a
  // ref captured once at mount left the click doing nothing.
  useEffect(() => {
    if (openId) pendingOpenRef.current = openId;
  }, [openId]);

  useEffect(() => {
    const target = pendingOpenRef.current;
    if (!target || loading) return;
    pendingOpenRef.current = null;
    const inList = rowsRef.current.find((r) => r.id === target);
    if (inList) {
      setSelectedId(target);
      return;
    }
    // Not in the current tab — fetch it directly and jump to its tab.
    void supabase
      .from('reservations')
      .select(QUEUE_SELECT)
      .eq('id', target)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const row = data as unknown as QueueRow;
        const destTab = tabForStatus(row.status);
        setTab(destTab);
        syncUrl(destTab, row.id);
        setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        setSelectedId(row.id);
      });
  }, [loading, openId, supabase, syncUrl]);

  // ---- Realtime: the NotificationBell (single team-topic subscriber) re-emits
  // broadcasts as a DOM event; refetch on it (debounced) + on window focus. ----
  useEffect(() => {
    let timer: number | undefined;
    const onNotification = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void fetchList();
        void fetchCounts();
      }, 800);
    };
    const onFocus = () => {
      void fetchList();
      void fetchCounts();
    };
    window.addEventListener(TEAM_NOTIFICATION_EVENT, onNotification);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TEAM_NOTIFICATION_EVENT, onNotification);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchList, fetchCounts]);

  // ---- Selection / navigation ----
  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;

  function openRow(id: string) {
    setSelectedId(id);
    syncUrl(tab, id);
  }

  function closeDetail() {
    setSelectedId(null);
    syncUrl(tab, null);
  }

  function navigate(dir: 1 | -1) {
    if (rows.length === 0) return;
    const idx = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, selectedIndex + dir));
    openRow(rows[idx].id);
  }

  /** After an action: refetch; optionally advance to the item now occupying the slot. */
  async function handleActed(advance: boolean) {
    const prevIndex = selectedIndex;
    const [list] = await Promise.all([fetchList(), fetchCounts()]);
    if (advance && list.length > 0) {
      const idx = Math.min(Math.max(prevIndex, 0), list.length - 1);
      openRow(list[idx].id);
    } else {
      closeDetail();
    }
  }

  function changeTab(next: TabId) {
    setTab(next);
    setSelectedId(null);
    syncUrl(next, null);
  }

  if (!projectId) {
    return (
      <EmptyState
        title="Sin conexión al proyecto"
        hint="Ejecuta las migraciones para crear el proyecto 'Prados del Sur'."
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold text-stone-900">Reservas</h1>
        <div className="relative sm:w-72">
          <IconSearch className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar código, CI o nombre…"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-stone-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => changeTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              tab === t.id ? 'bg-brand text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
            <span
              className={`rounded-full px-1.5 text-[11px] font-bold ${
                tab === t.id ? 'bg-white/20' : 'bg-stone-100 text-stone-500'
              }`}
            >
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-14">
          <Spinner label="Cargando reservas…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={query ? 'Sin resultados para tu búsqueda' : 'No hay reservas en esta bandeja'}
          hint={tab === 'revisar' ? 'Cuando un comprador suba su comprobante aparecerá aquí.' : undefined}
        />
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {rows.map((r) => {
            const pay = reservePayment(r);
            const monto = pay ? formatMoney(pay.amount_bob, 'BOB') : formatMoney(r.amount_due, r.amount_due_currency);
            const waText = fillTemplate(waTemplates.contacto, {
              nombre: r.buyer_full_name.split(' ')[0] ?? '',
              codigo: r.tracking_code,
              lote: r.lot?.number ?? '',
              manzana: r.lot?.manzana?.code ?? '',
            });
            return (
              // The WhatsApp link is a sibling of the row button, not a child:
              // nesting interactive elements breaks keyboard and screen readers.
              <li
                key={r.id}
                className={`flex items-center ${selectedId === r.id ? 'bg-green-50/70' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => openRow(r.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-stone-50 sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-mono font-semibold text-stone-900">{r.tracking_code}</span>
                      <span className="truncate text-stone-600">{r.buyer_full_name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Mz {r.lot?.manzana?.code ?? '—'} · Lote {r.lot?.number ?? '—'} ·{' '}
                      {rowTimeLabel(tab, r)}
                    </p>
                    {/* Contact details in the list: chasing a payment shouldn't
                        require opening every reservation one by one. */}
                    <p className="mt-0.5 truncate text-xs text-stone-400">
                      {r.buyer_phone}
                      {r.buyer_email ? ` · ${r.buyer_email}` : ''} · CI {r.buyer_ci}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-bold text-stone-900">{monto}</span>
                    <Badge className={RESERVATION_STATUS_BADGE[r.status]}>
                      {RESERVATION_STATUS_LABEL[r.status]}
                    </Badge>
                  </div>
                </button>
                <a
                  href={waLink(r.buyer_phone, waText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Escribir por WhatsApp a ${r.buyer_full_name}`}
                  title={`WhatsApp ${r.buyer_phone}`}
                  className="mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-green-700 sm:mr-3"
                >
                  <IconWhatsapp className="h-4 w-4" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'revisar' && rows.length > 0 ? (
        <p className="mt-2 hidden text-xs text-stone-400 md:block">
          Atajos: <kbd className="rounded bg-stone-200 px-1">a</kbd> aprobar ·{' '}
          <kbd className="rounded bg-stone-200 px-1">r</kbd> rechazar ·{' '}
          <kbd className="rounded bg-stone-200 px-1">j</kbd>/<kbd className="rounded bg-stone-200 px-1">k</kbd>{' '}
          navegar · <kbd className="rounded bg-stone-200 px-1">Esc</kbd> cerrar
        </p>
      ) : null}

      {selected ? (
        <ReservationDetail
          key={selected.id}
          row={selected}
          role={role}
          waTemplates={waTemplates}
          onClose={closeDetail}
          onNavigate={navigate}
          onActed={(advance) => void handleActed(advance)}
        />
      ) : null}
    </div>
  );
}
