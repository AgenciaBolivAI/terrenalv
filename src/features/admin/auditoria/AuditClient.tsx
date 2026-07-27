'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/format';
import { laPazDateToEndIso, laPazDateToStartIso } from '@/features/admin/lib/lapaz';
import { EmptyState, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_type: 'guest' | 'team' | 'system' | 'cron';
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
}

const PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  'reservation.created',
  'payment.proof_submitted',
  'payment.approved',
  'payment.rejected',
  'payment.attached_on_behalf',
  'reservation.hold_extended',
  'reservation.cancelled',
  'reservation.cancelled_by_admin',
  'reservation.sale_reverted',
  'reservation.reinstated',
  'reservation.expired',
  'lot.sold_offline',
  'lot.changed',
  'lots.blocked',
  'lots.unblocked',
  'lots.bulk_price_update',
  'lots.saved',
  'lots.csv_import',
  'manzana.saved',
  'map_elements.saved',
  'geometry.published',
  'profile.updated',
  'setting.updated',
];

const ENTITY_TYPES = ['reservation', 'payment', 'lot', 'lots', 'manzana', 'profile', 'setting', 'project', 'pricing_category'];

const ACTOR_LABEL: Record<AuditRow['actor_type'], string> = {
  guest: 'Comprador',
  team: 'Equipo',
  system: 'Sistema',
  cron: 'Automático',
};

export default function AuditClient({ projectId }: { projectId: string | null }) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Filters
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorType, setActorType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    let q = supabase
      .from('audit_log')
      .select('id, occurred_at, actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after')
      .order('occurred_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    if (projectId) q = q.eq('project_id', projectId);
    if (action.trim()) q = q.ilike('action', `%${action.trim().replace(/[%,()]/g, '')}%`);
    if (entityType) q = q.eq('entity_type', entityType);
    if (actorType) q = q.eq('actor_type', actorType);
    const fromIso = dateFrom ? laPazDateToStartIso(dateFrom) : null;
    const toIso = dateTo ? laPazDateToEndIso(dateTo) : null;
    if (fromIso) q = q.gte('occurred_at', fromIso);
    if (toIso) q = q.lt('occurred_at', toIso);

    const { data, error } = await q;
    if (error) {
      setFailed(true);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as AuditRow[];
    setHasMore(list.length > PAGE_SIZE);
    setRows(list.slice(0, PAGE_SIZE));
    setLoading(false);

    const actorIds = [...new Set(list.map((r) => r.actor_id).filter(Boolean))] as string[];
    if (actorIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', actorIds);
      if (profs) setNames(new Map(profs.map((p) => [p.id as string, p.full_name as string])));
    }
  }, [supabase, projectId, page, action, entityType, actorType, dateFrom, dateTo]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchPage(), 250);
    return () => window.clearTimeout(t);
  }, [fetchPage]);

  function actorDisplay(r: AuditRow): string {
    if (r.actor_id && names.get(r.actor_id)) return names.get(r.actor_id) as string;
    if (r.actor_label) return `${ACTOR_LABEL[r.actor_type]} · ${r.actor_label}`;
    return ACTOR_LABEL[r.actor_type];
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-3 text-lg font-bold text-stone-900">Auditoría</h1>

      {/* Filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-stone-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-stone-500">Acción</label>
          <input list="audit-actions" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} placeholder="todas" className={inputClass} />
          <datalist id="audit-actions">
            {KNOWN_ACTIONS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Entidad</label>
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }} className={inputClass}>
            <option value="">todas</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Actor</label>
          <select value={actorType} onChange={(e) => { setActorType(e.target.value); setPage(0); }} className={inputClass}>
            <option value="">todos</option>
            <option value="team">Equipo</option>
            <option value="guest">Comprador</option>
            <option value="cron">Automático</option>
            <option value="system">Sistema</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className={inputClass} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-14">
          <Spinner label="Cargando auditoría…" />
        </div>
      ) : failed ? (
        <EmptyState title="No se pudo cargar la auditoría" hint="Verifica tu conexión o tus permisos." />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin registros con estos filtros" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold text-stone-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Entidad</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2 whitespace-nowrap text-stone-600">{formatDateTime(r.occurred_at)}</td>
                    <td className="px-3 py-2 text-stone-700">{actorDisplay(r)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-800">{r.action}</td>
                    <td className="px-3 py-2 text-xs text-stone-500">
                      {r.entity_type ?? '—'}
                      {r.entity_id ? <span className="text-stone-300"> · {r.entity_id.slice(0, 8)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        {expanded === r.id ? 'Ocultar' : 'Detalle'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id ? (
                    <tr className="border-b border-stone-100 bg-stone-50">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold text-stone-500">Antes</p>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">
                              {r.before ? JSON.stringify(r.before, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold text-stone-500">Después</p>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">
                              {r.after ? JSON.stringify(r.after, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          className={btnSecondary}
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Anterior
        </button>
        <span className="text-xs text-stone-400">Página {page + 1}</span>
        <button
          type="button"
          className={btnSecondary}
          disabled={!hasMore || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
