'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type PaginationState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { createClient } from '@/lib/supabase/client';
import { traerTodo } from '@/features/admin/lib/traer-todo';
import { cuotaDelPlan, parseFinancingPlan, type FinancingPlan } from '@/lib/financing';
import { formatMoney } from '@/lib/format';
import type { LotStatus, PricingCategory, TeamRole } from '@/lib/db-types';
import { ciSchema, phoneSchema } from '@/lib/validation';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { LOT_STATUS_BADGE, LOT_STATUS_LABEL } from '@/features/admin/lib/labels';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import {
  ReserveDialog,
  SellOfflineDialog,
} from '@/features/admin/ventas/VenderLoteDialogs';
import { IconChevronLeft } from '@/features/admin/ui/icons';
import { useToast } from '@/features/admin/ui/toast';
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import CategoryPrices from './CategoryPrices';

interface Manzana {
  id: string;
  code: string;
  kind: string;
  sector: string | null;
  needs_review: boolean;
}

/**
 * Per-manzana counts, straight from v_manzana_summary.
 *
 * The grid used to be built by fetching all 2.078 lots and counting them in the
 * browser on every load. It needs 88 rows; the lots themselves are only needed
 * once a manzana is actually opened.
 */
interface MzSummary {
  manzana_id: string;
  code: string;
  kind: string;
  sector: string | null;
  needs_review: boolean;
  total: number;
  disponible: number;
  reservado: number;
  vendido: number;
  no_disponible: number;
  sin_precio: number;
  algun_lote_a_revisar: boolean;
}

interface LotRow {
  id: string;
  project_id: string;
  manzana_id: string;
  number: string;
  status: LotStatus;
  category_id: string | null;
  frontage_m: number | null;
  depth_m: number | null;
  area_m2: number;
  price_override: number | null;
  active_reservation_id: string | null;
  needs_review: boolean;
  state: string;
}

/**
 * The fields a staged edit can carry. Exactly the columns the database grants
 * an authenticated admin — category_id, price_override, frontage_m, depth_m.
 * Status is deliberately absent: it moves through RPCs that keep it in step
 * with the reservation, never through a direct column write.
 */
type PendingEdit = Partial<Pick<LotRow, 'category_id' | 'price_override' | 'frontage_m' | 'depth_m'>>;

type BulkMode = 'set_category' | 'set_override' | 'adjust_override_pct' | 'clear_override';

interface Props {
  projectId: string | null;
  role: TeamRole;
  currency: 'USD' | 'BOB';
  /** From the dashboard inventory cards: show these lots across all manzanas. */
  initialStatus?: LotStatus | null;
}

export default function LotesClient({ projectId, role, currency, initialStatus = null }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const isAdmin = role === 'admin';

  const [manzanas, setManzanas] = useState<Manzana[]>([]);
  const [summaries, setSummaries] = useState<MzSummary[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  // Read inside callbacks that must not re-create on every lot change.
  const lotsRef = useRef<LotRow[]>([]);
  lotsRef.current = lots;
  const [cats, setCats] = useState<PricingCategory[]>([]);
  const [financing, setFinancing] = useState<FinancingPlan | null>(null);
  const [resCodes, setResCodes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedMz, setSelectedMz] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LotStatus | null>(initialStatus);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [busy, setBusy] = useState(false);

  // A manzana can hold 50+ lots and the "todos los disponibles" view holds 2.078;
  // paging beats scrolling to the bottom to find the last one.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });

  /**
   * Edits waiting to be saved, keyed by lot id. Category, price and dimensions
   * used to write to the database the instant a field lost focus — no way to
   * look over a screenful of changes before committing them, and no way to back
   * out of a mistyped price. They are staged here until "Guardar cambios".
   */
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  /** Bumped on save/discard to remount the uncontrolled inputs with fresh values. */
  const [formKey, setFormKey] = useState(0);

  // Dialogs
  const [bulkCatOpen, setBulkCatOpen] = useState(false);
  const [bulkCatId, setBulkCatId] = useState<string>('');
  const [blockDialog, setBlockDialog] = useState<null | { blocked: boolean }>(null);
  const [blockNote, setBlockNote] = useState('');
  const [pricesOpen, setPricesOpen] = useState(false);
  const [priceMode, setPriceMode] = useState<BulkMode>('set_category');
  const [priceCatCode, setPriceCatCode] = useState('');
  const [priceValue, setPriceValue] = useState('');
  const [sellLot, setSellLot] = useState<LotRow | null>(null);
  const [statusLot, setStatusLot] = useState<LotRow | null>(null);
  const [reserveLot, setReserveLot] = useState<LotRow | null>(null);

  const LOT_COLUMNS =
    'id, project_id, manzana_id, number, status, category_id, frontage_m, depth_m, area_m2, price_override, active_reservation_id, needs_review, state';

  /** Tracking codes for whatever lots are currently loaded. */
  const loadResCodes = useCallback(
    async (rows: LotRow[]) => {
      const ids = rows.map((l) => l.active_reservation_id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setResCodes(new Map());
        return;
      }
      const { data } = await supabase
        .from('reservations')
        .select('id, tracking_code')
        .in('id', ids.slice(0, 1000));
      setResCodes(new Map((data ?? []).map((r) => [r.id as string, r.tracking_code as string])));
    },
    [supabase],
  );

  /**
   * The grid: 88 summary rows plus the reference data. No lots at all — the
   * counts come from the database, which is what turned this page from a
   * 2.078-row download into an 88-row one.
   */
  const fetchAll = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [sumRes, catRes, planRes] = await Promise.all([
      supabase
        .from('v_manzana_summary')
        .select('*')
        .eq('project_id', projectId)
        .order('code'),
      supabase
        .from('pricing_categories')
        .select('id, project_id, code, name, color_hex, price_per_m2, sort_order')
        .eq('project_id', projectId)
        .order('sort_order'),
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'financing_plan')
        .is('project_id', null)
        .maybeSingle(),
    ]);

    const sums = ((sumRes.data ?? []) as unknown as MzSummary[]).slice().sort((a, b) => {
      const na = Number(String(a.code).replace(/\D/g, '')) || 0;
      const nb = Number(String(b.code).replace(/\D/g, '')) || 0;
      return na - nb;
    });
    setSummaries(sums);
    setManzanas(
      sums.map((m) => ({
        id: m.manzana_id,
        code: m.code,
        kind: m.kind,
        sector: m.sector,
        needs_review: m.needs_review,
      })),
    );
    setCats((catRes.data ?? []) as PricingCategory[]);
    setFinancing(parseFinancingPlan(planRes.data?.value));
    setLoading(false);
  }, [supabase, projectId]);

  /** Lots for one manzana, or for one status across the whole project. */
  const fetchLots = useCallback(async () => {
    if (!projectId || (!selectedMz && !statusFilter)) {
      setLots([]);
      setResCodes(new Map());
      return;
    }
    setLoading(true);
    // Paginado: filtrar por estado en toda la urbanización trae más de mil
    // lotes (hoy 2.071 disponibles) y PostgREST corta en 1.000 sin avisar — el
    // tablero decía 2.071 y esta lista mostraba 1.000.
    const rows = await traerTodo<LotRow>((desde, hasta) => {
      let q = supabase.from('lots').select(LOT_COLUMNS).eq('project_id', projectId).is('deleted_at', null);
      if (selectedMz) q = q.eq('manzana_id', selectedMz);
      else if (statusFilter) q = q.eq('status', statusFilter);
      return q.order('id').range(desde, hasta);
    });
    setLots(rows);
    await loadResCodes(rows);
    setLoading(false);
  }, [supabase, projectId, selectedMz, statusFilter, loadResCodes]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    void fetchLots();
  }, [fetchLots]);

  /** After a write: refresh both the counts and whatever rows are on screen. */
  const refreshAll = useCallback(async () => {
    await Promise.all([fetchAll(), fetchLots()]);
  }, [fetchAll, fetchLots]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const lotPrice = useCallback(
    (lot: LotRow): number | null => {
      if (lot.price_override != null) return Number(lot.price_override);
      const cat = lot.category_id ? catById.get(lot.category_id) : undefined;
      if (!cat) return null;
      return Math.round(Number(cat.price_per_m2) * Number(lot.area_m2) * 100) / 100;
    },
    [catById],
  );

  const mzByCode = useMemo(() => new Map(manzanas.map((m) => [m.id, m.code])), [manzanas]);

  /**
   * Rows for the table. Two ways in: a manzana (the normal path), or a status
   * filter from the dashboard, which lists matching lots across every manzana
   * — clicking "1 Reservados" has to land on that lot, not on the grid.
   */
  const mzLots = useMemo(() => {
    if (selectedMz) {
      return lots
        .filter((l) => l.manzana_id === selectedMz)
        .sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true }));
    }
    if (statusFilter) {
      return lots
        .filter((l) => l.status === statusFilter)
        .sort(
          (a, b) =>
            (mzByCode.get(a.manzana_id) ?? '').localeCompare(
              mzByCode.get(b.manzana_id) ?? '',
              'es',
              { numeric: true },
            ) || a.number.localeCompare(b.number, 'es', { numeric: true }),
        );
    }
    return [];
  }, [lots, selectedMz, statusFilter, mzByCode]);

  // Counted by Postgres now, not by walking every lot in the browser.
  const statsByMz = useMemo(() => {
    const map = new Map<string, { total: number; byStatus: Record<LotStatus, number>; review: boolean }>();
    for (const m of summaries) {
      map.set(m.manzana_id, {
        total: Number(m.total),
        byStatus: {
          disponible: Number(m.disponible),
          reservado: Number(m.reservado),
          vendido: Number(m.vendido),
          no_disponible: Number(m.no_disponible),
        },
        review: Boolean(m.algun_lote_a_revisar),
      });
    }
    return map;
  }, [summaries]);

  /**
   * Stage an edit instead of writing it. Fields that end up back at their
   * original value drop out, and a lot with nothing left changed drops out
   * entirely — so "3 cambios sin guardar" always means three real ones.
   */
  const stageLot = useCallback(
    (lotId: string, patch: PendingEdit) => {
      setPending((prev) => {
        const lot = lotsRef.current.find((l) => l.id === lotId);
        if (!lot) return prev;
        const merged: PendingEdit = { ...prev[lotId], ...patch };
        for (const k of Object.keys(merged) as (keyof PendingEdit)[]) {
          if (merged[k] === (lot[k] ?? null)) delete merged[k];
        }
        const next = { ...prev };
        if (Object.keys(merged).length === 0) delete next[lotId];
        else next[lotId] = merged;
        return next;
      });
      return true;
    },
    [],
  );

  const pendingCount = Object.keys(pending).length;

  function discardPending() {
    setPending({});
    setFormKey((k) => k + 1);
  }

  async function savePending() {
    const entries = Object.entries(pending);
    if (entries.length === 0) return;
    setBusy(true);
    // Los lotes se guardan a la vez, no en fila india. Cuando alguien corrige
    // media manzana son cincuenta lotes: de a uno era esperar cincuenta viajes
    // al servidor, uno atrás del otro, mirando el botón girar.
    //
    // Cada lote sigue yendo en su propio UPDATE, así que uno que falla no
    // arrastra a los demás y se lo puede nombrar por su número, como antes.
    const failed: string[] = [];
    const resultados = await Promise.all(
      entries.map(([lotId, patch]) =>
        supabase
          .from('lots')
          .update(patch)
          .eq('id', lotId)
          .then(({ error }) => ({ lotId, error })),
      ),
    );
    for (const { lotId, error } of resultados) {
      if (error) {
        const lot = lotsRef.current.find((l) => l.id === lotId);
        failed.push(lot?.number ?? lotId);
        console.error('lote', lot?.number, error.message);
      }
    }
    // Apply only what actually landed, so a failed row keeps showing its old
    // value instead of a change that was never written.
    const saved = entries.filter(([id]) => {
      const lot = lotsRef.current.find((l) => l.id === id);
      return !failed.includes(lot?.number ?? id);
    });
    setLots((prev) =>
      prev.map((l) => {
        const patch = saved.find(([id]) => id === l.id)?.[1];
        return patch ? { ...l, ...patch } : l;
      }),
    );
    setPending({});
    setFormKey((k) => k + 1);
    setBusy(false);
    if (failed.length) {
      push(`No se pudieron guardar ${failed.length} lote(s): ${failed.join(', ')}`, 'error');
    } else {
      push(`${entries.length} lote(s) guardados.`, 'success');
    }
  }

  /** The value to show for a field: the staged edit if there is one. */
  function effective<K extends keyof PendingEdit>(lot: LotRow, key: K): LotRow[K] {
    const p = pending[lot.id];
    return p && key in p ? (p[key] as LotRow[K]) : lot[key];
  }

  // ---- Table ----
  const columnHelper = createColumnHelper<LotRow>();
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Seleccionar todos"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="accent-brand"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Seleccionar lote ${row.original.number}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="accent-brand"
          />
        ),
      }),
      ...(selectedMz
        ? []
        : [
            columnHelper.display({
              id: 'manzana',
              header: 'Manzana',
              cell: ({ row }) => (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMz(row.original.manzana_id);
                    setRowSelection({});
                  }}
                  className="font-semibold text-brand hover:underline"
                >
                  {mzByCode.get(row.original.manzana_id) ?? '—'}
                </button>
              ),
            }),
          ]),
      columnHelper.accessor('number', {
        header: 'Lote',
        cell: (info) => (
          <span className="font-semibold text-stone-900">
            {info.getValue()}
            {info.row.original.needs_review ? (
              <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
                revisar
              </span>
            ) : null}
            {info.row.original.state !== 'published' ? (
              <span className="ml-1 rounded bg-stone-100 px-1 text-[10px] text-stone-500">borrador</span>
            ) : null}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'dims',
        header: 'Frente × Fondo',
        cell: ({ row }) => (
          <DimsCell
            key={`${row.original.id}-${formKey}`}
            lot={row.original}
            isAdmin={isAdmin}
            onSave={(patch) => stageLot(row.original.id, patch)}
            onInvalid={(msg) => push(msg, 'error')}
          />
        ),
      }),
      columnHelper.accessor('area_m2', {
        header: 'Superficie',
        cell: (info) => `${Number(info.getValue())} m²`,
      }),
      columnHelper.accessor('category_id', {
        header: 'Categoría',
        cell: ({ row }) => {
          const lot = row.original;
          const catId = effective(lot, 'category_id');
          const cat = catId ? catById.get(catId) : undefined;
          if (!isAdmin) {
            return cat ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: `${cat.color_hex}33`, color: '#1c1917' }}
              >
                {cat.code}
              </span>
            ) : (
              '—'
            );
          }
          return (
            <select
              value={catId ?? ''}
              onChange={(e) => stageLot(lot.id, { category_id: e.target.value || null })}
              className={`rounded-lg border bg-white px-1.5 py-1 text-xs ${
                pending[lot.id]?.category_id !== undefined
                  ? 'border-amber-400 ring-1 ring-amber-200'
                  : 'border-stone-200'
              }`}
              style={cat ? { backgroundColor: `${cat.color_hex}22` } : undefined}
            >
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          );
        },
      }),
      columnHelper.display({
        id: 'precio',
        header: `Precio (${currency === 'BOB' ? 'Bs' : '$us'})`,
        cell: ({ row }) => {
          const lot = row.original;
          const price = lotPrice(lot);
          if (!isAdmin) {
            return price != null ? formatMoney(price, currency) : <span className="text-stone-400">sin precio</span>;
          }
          return (
            <div className="flex items-center gap-1">
              <input
                key={`${lot.id}-price-${formKey}`}
                type="number"
                min={0}
                step="0.01"
                placeholder={price != null && lot.price_override == null ? String(price) : 'manual'}
                defaultValue={lot.price_override ?? ''}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const next = raw === '' ? null : Number(raw);
                  if (next !== null && (Number.isNaN(next) || next < 0)) return;
                  stageLot(lot.id, { price_override: next });
                }}
                className={`w-24 rounded-lg border px-1.5 py-1 text-right text-xs ${
                  pending[lot.id]?.price_override !== undefined
                    ? 'border-amber-400 ring-1 ring-amber-200'
                    : 'border-stone-200'
                }`}
                title="Precio manual (vacío = precio por categoría)"
              />
              {lot.price_override != null ? (
                <span className="text-[10px] text-amber-600" title="Precio manual activo">M</span>
              ) : null}
            </div>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ row }) => {
          const lot = row.original;
          const badge = (
            <Badge className={LOT_STATUS_BADGE[lot.status]}>{LOT_STATUS_LABEL[lot.status]}</Badge>
          );
          if (!isAdmin) return badge;
          return (
            <div className="flex items-center gap-1.5">
              {badge}
              <button
                type="button"
                onClick={() => setStatusLot(lot)}
                aria-label={`Cambiar estado del lote ${lot.number}`}
                title="Cambiar estado"
                className="cursor-pointer rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs font-medium text-stone-600
                           transition-colors duration-150 hover:border-brand hover:bg-brand hover:text-white
                           active:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Cambiar
              </button>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'reserva',
        header: 'Reserva',
        cell: ({ row }) => {
          const rid = row.original.active_reservation_id;
          if (!rid) {
            return isAdmin && row.original.status === 'disponible' ? (
              <button
                type="button"
                onClick={() => setSellLot(row.original)}
                className="cursor-pointer rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-600
                           transition-colors duration-150 hover:border-brand hover:bg-brand hover:text-white
                           active:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Vender en oficina
              </button>
            ) : (
              '—'
            );
          }
          const code = resCodes.get(rid);
          return code ? (
            <Link href={`/admin/reservas?open=${rid}`} className="font-mono text-xs font-semibold text-brand hover:underline">
              {code}
            </Link>
          ) : (
            '—'
          );
        },
      }),
    ],
    // `pending` and `formKey` MUST stay here: without them the memo keeps the
    // first render's closure and a staged edit never appears on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cats, catById, currency, isAdmin, resCodes, lotPrice, selectedMz, mzByCode, pending, formKey, stageLot],
  );

  const table = useReactTable({
    data: mzLots,
    columns,
    state: { rowSelection, pagination },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
  });

  // Changing manzana or filter shows a different set of lots; staying on page 7
  // of the previous one lands on an empty table.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [selectedMz, statusFilter]);

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const currentMz = manzanas.find((m) => m.id === selectedMz) ?? null;

  // ---- Bulk actions ----
  async function bulkAssignCategory() {
    if (!bulkCatId || selectedIds.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from('lots').update({ category_id: bulkCatId }).in('id', selectedIds);
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push(`Categoría asignada a ${selectedIds.length} lotes.`, 'success');
    setBulkCatOpen(false);
    setRowSelection({});
    void refreshAll();
  }

  /** Block/unblock a single lot from the status dialog. */
  async function setBlocked(lot: LotRow, blocked: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_lots_blocked', {
      p_lot_ids: [lot.id],
      p_blocked: blocked,
      p_note: null,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push(blocked ? `Lote ${lot.number} bloqueado.` : `Lote ${lot.number} desbloqueado.`, 'success');
    setStatusLot(null);
    void refreshAll();
  }

  async function bulkBlock(blocked: boolean) {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_set_lots_blocked', {
      p_lot_ids: selectedIds,
      p_blocked: blocked,
      p_note: blockNote.trim() || null,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const n = (data as { afectados?: number } | null)?.afectados ?? 0;
    push(blocked ? `${n} lotes bloqueados.` : `${n} lotes desbloqueados.`, 'success');
    setBlockDialog(null);
    setBlockNote('');
    setRowSelection({});
    void refreshAll();
  }

  function pricesPreview(): string {
    const n = mzLots.length;
    const mz = currentMz?.code ?? '';
    const cur = currency === 'BOB' ? 'Bs' : '$us';
    switch (priceMode) {
      case 'set_category':
        return priceCatCode
          ? `Asignará la categoría ${priceCatCode} a los ${n} lotes de la manzana ${mz}. El precio será (precio/m² de ${priceCatCode}) × superficie.`
          : 'Elige una categoría.';
      case 'set_override':
        return priceValue
          ? `Fijará un precio manual de ${cur} ${priceValue} en los ${n} lotes de la manzana ${mz}.`
          : 'Escribe el precio.';
      case 'adjust_override_pct':
        return priceValue
          ? `Ajustará el precio vigente de los ${n} lotes en ${Number(priceValue) >= 0 ? '+' : ''}${priceValue}% (queda como precio manual).`
          : 'Escribe el porcentaje (ej. 10 o -5).';
      case 'clear_override':
        return `Quitará los precios manuales de los ${n} lotes de la manzana ${mz}; volverán al precio por categoría.`;
    }
  }

  async function runBulkPrices() {
    if (!selectedMz) return;
    const op: Record<string, unknown> = { mode: priceMode };
    if (priceMode === 'set_category') {
      if (!priceCatCode) return;
      op.category_code = priceCatCode;
    } else if (priceMode === 'set_override') {
      const v = Number(priceValue);
      if (Number.isNaN(v) || v < 0) {
        push('Precio inválido.', 'error');
        return;
      }
      op.value = v;
    } else if (priceMode === 'adjust_override_pct') {
      const v = Number(priceValue);
      if (Number.isNaN(v)) {
        push('Porcentaje inválido.', 'error');
        return;
      }
      op.pct = v;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('bulk_update_lot_prices', {
      p_manzana_id: selectedMz,
      p_op: op,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const n = (data as { afectados?: number } | null)?.afectados ?? 0;
    push(`Precios actualizados en ${n} lotes.`, 'success');
    setPricesOpen(false);
    void refreshAll();
  }

  if (!projectId) {
    return (
      <EmptyState title="Sin conexión al proyecto" hint="Ejecuta las migraciones de la base de datos." />
    );
  }
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Cargando lotes…" />
      </div>
    );
  }

  // ---- Manzana grid (only when nothing narrows the view) ----
  if (!selectedMz && !statusFilter) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-3 text-lg font-bold text-stone-900">Lotes por manzana</h1>
        <CategoryPrices
          categories={cats}
          currency={currency}
          isAdmin={isAdmin}
          financing={financing}
          onSaved={() => void refreshAll()}
        />
        {manzanas.length === 0 ? (
          <EmptyState
            title="Mapa en preparación"
            hint="Todavía no hay manzanas cargadas en este proyecto."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {manzanas.map((m) => {
              const s = statsByMz.get(m.id);
              const total = s?.total ?? 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMz(m.id);
                    setRowSelection({});
                  }}
                  className="rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-brand-light"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-stone-900">{m.code}</p>
                    {(m.needs_review || s?.review) && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        revisar
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500">
                    {total} lotes{m.sector ? ` · ${m.sector}` : ''}
                  </p>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-stone-100">
                    {total > 0 && s ? (
                      <>
                        <div className="bg-green-500" style={{ width: `${(s.byStatus.disponible / total) * 100}%` }} />
                        <div className="bg-orange-400" style={{ width: `${(s.byStatus.reservado / total) * 100}%` }} />
                        <div className="bg-stone-400" style={{ width: `${(s.byStatus.vendido / total) * 100}%` }} />
                        <div className="bg-stone-300" style={{ width: `${(s.byStatus.no_disponible / total) * 100}%` }} />
                      </>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- Lot table: one manzana, or one status across all of them ----
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSelectedMz(null);
            // Back out of the manzana first; the status list stays underneath.
            if (!selectedMz) setStatusFilter(null);
            setRowSelection({});
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
        >
          <IconChevronLeft className="h-4 w-4" />
          {selectedMz && statusFilter ? LOT_STATUS_LABEL[statusFilter] : 'Manzanas'}
        </button>
        <h1 className="text-lg font-bold text-stone-900">
          {selectedMz
            ? `Manzana ${currentMz?.code}`
            : statusFilter
              ? `Lotes ${LOT_STATUS_LABEL[statusFilter].toLowerCase()}`
              : 'Lotes'}
        </h1>
        <span className="text-sm text-stone-400">{mzLots.length} lotes</span>
        {!selectedMz && statusFilter ? (
          <button
            type="button"
            onClick={() => {
              setStatusFilter(null);
              setRowSelection({});
            }}
            className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-200"
          >
            Quitar filtro ✕
          </button>
        ) : null}
        {isAdmin && selectedMz ? (
          <button
            type="button"
            onClick={() => {
              setPriceMode('set_category');
              setPriceCatCode(cats[0]?.code ?? '');
              setPriceValue('');
              setPricesOpen(true);
            }}
            className={`${btnSecondary} ml-auto`}
          >
            Actualización masiva de precios
          </button>
        ) : null}
      </div>

      {/* Bulk selection bar */}
      {isAdmin && selectedIds.length > 0 ? (
        <div className="sticky top-14 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-green-50 px-3 py-2">
          <p className="text-sm font-medium text-brand">{selectedIds.length} seleccionados</p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setBulkCatId(cats[0]?.id ?? '');
                setBulkCatOpen(true);
              }}
            >
              Asignar categoría
            </button>
            <button type="button" className={btnSecondary} onClick={() => setBlockDialog({ blocked: true })}>
              Bloquear
            </button>
            <button type="button" className={btnSecondary} onClick={() => setBlockDialog({ blocked: false })}>
              Desbloquear
            </button>
          </div>
        </div>
      ) : null}

      {/* Unsaved edits. Sticky, because with 25 rows on screen the change you
          made at the top must stay visible when you reach the bottom. */}
      {isAdmin && pendingCount > 0 ? (
        <div className="sticky top-14 z-30 mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-900">
            {pendingCount} {pendingCount === 1 ? 'lote con cambios' : 'lotes con cambios'} sin guardar
          </p>
          <div className="ml-auto flex gap-2">
            <button type="button" className={btnSecondary} onClick={discardPending} disabled={busy}>
              Descartar
            </button>
            <button type="button" className={btnPrimary} onClick={() => void savePending()} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full min-w-200 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-stone-200 bg-stone-50 text-left">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-3 py-2 text-xs font-semibold text-stone-500">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-3 py-2">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {mzLots.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">
            {selectedMz
              ? 'Esta manzana no tiene lotes.'
              : `No hay lotes ${statusFilter ? LOT_STATUS_LABEL[statusFilter].toLowerCase() : ''}.`}
          </p>
        ) : null}
      </div>

      {/* Pagination */}
      {mzLots.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-stone-500">
            Mostrar
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
            >
              {[10, 25, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={mzLots.length}>Todos ({mzLots.length})</option>
            </select>
            por página
          </label>

          <p className="text-stone-400">
            {table.getState().pagination.pageIndex * pagination.pageSize + 1}–
            {Math.min((table.getState().pagination.pageIndex + 1) * pagination.pageSize, mzLots.length)} de{' '}
            {mzLots.length}
          </p>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Anterior
            </button>
            <span className="text-stone-500">
              Página {table.getState().pagination.pageIndex + 1} de {Math.max(table.getPageCount(), 1)}
            </span>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Siguiente
            </button>
          </div>
        </div>
      ) : null}
      {!isAdmin ? (
        <p className="mt-2 text-xs text-stone-400">
          Solo los administradores pueden editar categorías y precios.
        </p>
      ) : null}

      {/* Bulk category dialog */}
      <Dialog open={bulkCatOpen} onClose={() => setBulkCatOpen(false)} title="Asignar categoría">
        <p className="text-sm text-stone-600">
          Se asignará la categoría a <strong>{selectedIds.length}</strong> lotes seleccionados.
        </p>
        <select value={bulkCatId} onChange={(e) => setBulkCatId(e.target.value)} className={`${inputClass} mt-3`}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name ?? ''} ({formatMoney(Number(c.price_per_m2), currency)}/m²)
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setBulkCatOpen(false)}>
            Volver
          </button>
          <button type="button" disabled={busy || !bulkCatId} className={btnPrimary} onClick={() => void bulkAssignCategory()}>
            {busy ? 'Guardando…' : 'Asignar'}
          </button>
        </div>
      </Dialog>

      {/* Block / unblock dialog */}
      <Dialog
        open={blockDialog !== null}
        onClose={() => setBlockDialog(null)}
        title={blockDialog?.blocked ? 'Bloquear lotes' : 'Desbloquear lotes'}
      >
        <p className="text-sm text-stone-600">
          {blockDialog?.blocked
            ? `Los lotes disponibles seleccionados (${selectedIds.length}) pasarán a "no disponible" y no podrán reservarse.`
            : `Los lotes bloqueados seleccionados (${selectedIds.length}) volverán a estar disponibles.`}
        </p>
        <input
          value={blockNote}
          onChange={(e) => setBlockNote(e.target.value)}
          placeholder="Nota (opcional)"
          className={`${inputClass} mt-3`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setBlockDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnPrimary}
            onClick={() => blockDialog && void bulkBlock(blockDialog.blocked)}
          >
            {busy ? 'Guardando…' : blockDialog?.blocked ? 'Bloquear' : 'Desbloquear'}
          </button>
        </div>
      </Dialog>

      {/* Bulk prices dialog */}
      <Dialog open={pricesOpen} onClose={() => setPricesOpen(false)} title={`Precios — Manzana ${currentMz?.code ?? ''}`}>
        <label className="mb-1 block text-sm font-medium text-stone-700">Operación</label>
        <select
          value={priceMode}
          onChange={(e) => setPriceMode(e.target.value as BulkMode)}
          className={inputClass}
        >
          <option value="set_category">Asignar categoría a toda la manzana</option>
          <option value="set_override">Fijar precio manual</option>
          <option value="adjust_override_pct">Ajustar precio en %</option>
          <option value="clear_override">Quitar precios manuales</option>
        </select>
        {priceMode === 'set_category' ? (
          <select value={priceCatCode} onChange={(e) => setPriceCatCode(e.target.value)} className={`${inputClass} mt-3`}>
            {cats.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.name ?? ''} ({formatMoney(Number(c.price_per_m2), currency)}/m²)
              </option>
            ))}
          </select>
        ) : null}
        {priceMode === 'set_override' || priceMode === 'adjust_override_pct' ? (
          <input
            type="number"
            step="0.01"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder={priceMode === 'set_override' ? `Precio en ${currency === 'BOB' ? 'Bs' : '$us'}` : 'Porcentaje (ej. 10 o -5)'}
            className={`${inputClass} mt-3`}
          />
        ) : null}
        <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">{pricesPreview()}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setPricesOpen(false)}>
            Volver
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void runBulkPrices()}>
            {busy ? 'Aplicando…' : 'Aplicar'}
          </button>
        </div>
      </Dialog>

      {/* Change status.
          Status is not a free-text column: "reservado" without a reservation is
          a lot nobody can ever release, and "vendido" without a buyer is a sale
          with no record. So each destination routes through the RPC that keeps
          the rest of the row in step, and the one that needs a buyer says so. */}
      <Dialog
        open={statusLot !== null}
        onClose={() => setStatusLot(null)}
        title={statusLot ? `Estado del lote ${statusLot.number}` : 'Estado'}
      >
        {statusLot ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Ahora está{' '}
              <Badge className={LOT_STATUS_BADGE[statusLot.status]}>
                {LOT_STATUS_LABEL[statusLot.status]}
              </Badge>
            </p>

            {statusLot.status === 'disponible' ? (
              <>
                <button
                  type="button"
                  className={`${btnSecondary} w-full justify-start text-left`}
                  onClick={() => {
                    const lot = statusLot;
                    setStatusLot(null);
                    setReserveLot(lot);
                  }}
                >
                  <span className="font-semibold">Reservar en oficina</span>
                  <span className="block text-xs text-stone-500">
                    Crea la reserva con su plazo y su glosa de pago, igual que desde el mapa.
                  </span>
                </button>
                <button
                  type="button"
                  className={`${btnSecondary} w-full justify-start text-left`}
                  onClick={() => {
                    const lot = statusLot;
                    setStatusLot(null);
                    setSellLot(lot);
                  }}
                >
                  <span className="font-semibold">Marcar como vendido</span>
                  <span className="block text-xs text-stone-500">
                    Pide nombre, carnet y teléfono del comprador y deja el registro de la venta.
                  </span>
                </button>
                <button
                  type="button"
                  className={`${btnSecondary} w-full justify-start text-left`}
                  disabled={busy}
                  onClick={() => void setBlocked(statusLot, true)}
                >
                  <span className="font-semibold">Bloquear</span>
                  <span className="block text-xs text-stone-500">
                    Lo saca del mapa público sin venderlo.
                  </span>
                </button>
              </>
            ) : null}

            {statusLot.status === 'no_disponible' ? (
              <button
                type="button"
                className={`${btnSecondary} w-full justify-start text-left`}
                disabled={busy}
                onClick={() => void setBlocked(statusLot, false)}
              >
                <span className="font-semibold">Desbloquear</span>
                <span className="block text-xs text-stone-500">Vuelve a estar disponible.</span>
              </button>
            ) : null}

            {statusLot.status === 'reservado' ? (
              <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
                Este lote tiene una reserva activa. Su estado se maneja desde la reserva —
                confirmala, rechazala o cancelala en{' '}
                <Link
                  href={`/admin/reservas?open=${statusLot.active_reservation_id ?? ''}`}
                  className="font-semibold text-brand hover:underline"
                >
                  Reservas
                </Link>
                .
              </p>
            ) : null}

            {statusLot.status === 'vendido' ? (
              <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
                Ya está vendido. Revertir una venta toca el historial de pagos, así que se hace
                desde la reserva correspondiente y queda registrado en la auditoría.
              </p>
            ) : null}

            {statusLot.status === 'disponible' ? (
              <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
                El estado no se escribe a mano: un lote <strong>reservado</strong> sin reserva
                detrás no tiene plazo, ni comprador, ni forma de liberarse. Por eso cada opción de
                arriba crea el registro que corresponde.
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {sellLot ? (
        <SellOfflineDialog
          lot={sellLot}
          // Not currentMz: the status-filter view lists lots across every
          // manzana, so there is no "current" one and the title said "Mz ".
          mzCode={mzByCode.get(sellLot.manzana_id) ?? ''}
          defaultPrice={lotPrice(sellLot)}
          currency={currency}
          onClose={() => setSellLot(null)}
          onSold={() => {
            setSellLot(null);
            void refreshAll();
          }}
        />
      ) : null}

      {reserveLot ? (
        <ReserveDialog
          lot={reserveLot}
          mzCode={mzByCode.get(reserveLot.manzana_id) ?? ''}
          currency={currency}
          onClose={() => setReserveLot(null)}
          onReserved={() => {
            setReserveLot(null);
            void refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}

/** "12.00" → "12", null → "". Nobody types the trailing zeros back in. */
function dimText(v: number | null): string {
  return v == null || !Number.isFinite(Number(v)) ? '' : String(Number(v));
}

const MAX_DIM_M = 1000; // mirrors lots_frontage_m_max_check / lots_depth_m_max_check

/**
 * Frente × fondo, editable in place.
 *
 * These come off the plano, not off the polygon: the automatic subdivision
 * gets them approximately right and the team corrects them against the printed
 * plan. They are also buyer-facing (the lot sheet shows "Frente × fondo"), so
 * a bad value is visible immediately — hence validation here, a CHECK in the
 * database, and a revert when the write is refused.
 */
function DimsCell({
  lot,
  isAdmin,
  onSave,
  onInvalid,
}: {
  lot: LotRow;
  isAdmin: boolean;
  /** Staging is synchronous now; kept awaitable so the cell needn't care. */
  onSave: (patch: Partial<Pick<LotRow, 'frontage_m' | 'depth_m'>>) => boolean | Promise<boolean>;
  onInvalid: (message: string) => void;
}) {
  const [draft, setDraft] = useState({ f: dimText(lot.frontage_m), d: dimText(lot.depth_m) });

  // Re-sync after a save or a refetch replaces the row.
  useEffect(() => {
    setDraft({ f: dimText(lot.frontage_m), d: dimText(lot.depth_m) });
  }, [lot.frontage_m, lot.depth_m]);

  const f = Number(lot.frontage_m);
  const d = Number(lot.depth_m);
  const area = Number(lot.area_m2);
  // Lots are rarely perfect rectangles, so only flag a real discrepancy.
  const mismatch = f > 0 && d > 0 && area > 0 && Math.abs(f * d - area) / area > 0.1;

  if (!isAdmin) {
    return <span>{f > 0 && d > 0 ? `${f} × ${d} m` : '—'}</span>;
  }

  async function commit(which: 'f' | 'd') {
    const raw = draft[which].replace(',', '.').trim();
    const stored = which === 'f' ? lot.frontage_m : lot.depth_m;
    const revert = () => setDraft((p) => ({ ...p, [which]: dimText(stored) }));

    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next <= 0 || next > MAX_DIM_M)) {
      onInvalid(`Medida inválida: escribe un número entre 0 y ${MAX_DIM_M} m.`);
      revert();
      return;
    }
    if (next === (stored == null ? null : Number(stored))) return;

    const ok = await onSave(which === 'f' ? { frontage_m: next } : { depth_m: next });
    if (!ok) revert();
  }

  const field = (which: 'f' | 'd', label: string) => (
    <input
      inputMode="decimal"
      aria-label={`${label} del lote ${lot.number} (m)`}
      value={draft[which]}
      onChange={(e) => setDraft((p) => ({ ...p, [which]: e.target.value }))}
      onBlur={() => void commit(which)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft((p) => ({ ...p, [which]: dimText(which === 'f' ? lot.frontage_m : lot.depth_m) }));
          e.currentTarget.blur();
        }
      }}
      className="w-14 rounded-lg border border-stone-200 px-1.5 py-1 text-right text-xs"
    />
  );

  return (
    <div className="flex items-center gap-1">
      {field('f', 'Frente')}
      <span className="text-xs text-stone-400">×</span>
      {field('d', 'Fondo')}
      <span className="text-xs text-stone-400">m</span>
      {mismatch ? (
        <span
          className="text-[10px] text-amber-600"
          title={`Frente × fondo = ${Math.round(f * d)} m², pero la superficie del lote es ${area} m². Revisa contra el plano.`}
        >
          ≠
        </span>
      ) : null}
    </div>
  );
}
