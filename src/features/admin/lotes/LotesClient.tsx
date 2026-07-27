'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import type { LotStatus, PricingCategory, TeamRole } from '@/lib/db-types';
import { ciSchema, phoneSchema } from '@/lib/validation';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { LOT_STATUS_BADGE, LOT_STATUS_LABEL } from '@/features/admin/lib/labels';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { IconChevronLeft } from '@/features/admin/ui/icons';
import { useToast } from '@/features/admin/ui/toast';

interface Manzana {
  id: string;
  code: string;
  kind: string;
  sector: string | null;
  needs_review: boolean;
}

interface LotRow {
  id: string;
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

type BulkMode = 'set_category' | 'set_override' | 'adjust_override_pct' | 'clear_override';

interface Props {
  projectId: string | null;
  role: TeamRole;
  currency: 'USD' | 'BOB';
}

export default function LotesClient({ projectId, role, currency }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const isAdmin = role === 'admin';

  const [manzanas, setManzanas] = useState<Manzana[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [cats, setCats] = useState<PricingCategory[]>([]);
  const [resCodes, setResCodes] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedMz, setSelectedMz] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [busy, setBusy] = useState(false);

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

  const fetchAll = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [mzRes, lotRes, catRes] = await Promise.all([
      supabase
        .from('manzanas')
        .select('id, code, kind, sector, needs_review')
        .eq('project_id', projectId)
        .order('code'),
      supabase
        .from('lots')
        .select(
          'id, manzana_id, number, status, category_id, frontage_m, depth_m, area_m2, price_override, active_reservation_id, needs_review, state',
        )
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .limit(5000),
      supabase
        .from('pricing_categories')
        .select('id, project_id, code, name, color_hex, price_per_m2, sort_order')
        .eq('project_id', projectId)
        .order('sort_order'),
    ]);
    const lotsData = (lotRes.data ?? []) as LotRow[];
    setManzanas((mzRes.data ?? []) as Manzana[]);
    setLots(lotsData);
    setCats((catRes.data ?? []) as PricingCategory[]);

    const activeIds = lotsData.map((l) => l.active_reservation_id).filter(Boolean) as string[];
    if (activeIds.length > 0) {
      const { data: resRows } = await supabase
        .from('reservations')
        .select('id, tracking_code')
        .in('id', activeIds.slice(0, 1000));
      setResCodes(new Map((resRows ?? []).map((r) => [r.id as string, r.tracking_code as string])));
    } else {
      setResCodes(new Map());
    }
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

  const mzLots = useMemo(
    () =>
      lots
        .filter((l) => l.manzana_id === selectedMz)
        .sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true })),
    [lots, selectedMz],
  );

  const statsByMz = useMemo(() => {
    const map = new Map<string, { total: number; byStatus: Record<LotStatus, number>; review: boolean }>();
    for (const l of lots) {
      let s = map.get(l.manzana_id);
      if (!s) {
        s = {
          total: 0,
          byStatus: { disponible: 0, reservado: 0, vendido: 0, no_disponible: 0 },
          review: false,
        };
        map.set(l.manzana_id, s);
      }
      s.total += 1;
      s.byStatus[l.status] += 1;
      if (l.needs_review) s.review = true;
    }
    return map;
  }, [lots]);

  async function updateLot(lotId: string, patch: Partial<Pick<LotRow, 'category_id' | 'price_override'>>) {
    const { error } = await supabase.from('lots').update(patch).eq('id', lotId);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    setLots((prev) => prev.map((l) => (l.id === lotId ? { ...l, ...patch } : l)));
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
        cell: ({ row }) => {
          const f = row.original.frontage_m;
          const d = row.original.depth_m;
          return f && d ? `${Number(f)} × ${Number(d)} m` : '—';
        },
      }),
      columnHelper.accessor('area_m2', {
        header: 'Superficie',
        cell: (info) => `${Number(info.getValue())} m²`,
      }),
      columnHelper.accessor('category_id', {
        header: 'Categoría',
        cell: ({ row }) => {
          const lot = row.original;
          const cat = lot.category_id ? catById.get(lot.category_id) : undefined;
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
              value={lot.category_id ?? ''}
              onChange={(e) => void updateLot(lot.id, { category_id: e.target.value || null })}
              className="rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-xs"
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
                type="number"
                min={0}
                step="0.01"
                placeholder={price != null && lot.price_override == null ? String(price) : 'manual'}
                defaultValue={lot.price_override ?? ''}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const next = raw === '' ? null : Number(raw);
                  if (next !== null && (Number.isNaN(next) || next < 0)) return;
                  if (next === (lot.price_override ?? null)) return;
                  void updateLot(lot.id, { price_override: next });
                }}
                className="w-24 rounded-lg border border-stone-200 px-1.5 py-1 text-right text-xs"
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
        cell: (info) => (
          <Badge className={LOT_STATUS_BADGE[info.getValue()]}>{LOT_STATUS_LABEL[info.getValue()]}</Badge>
        ),
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
                className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cats, catById, currency, isAdmin, resCodes, lotPrice],
  );

  const table = useReactTable({
    data: mzLots,
    columns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

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
    void fetchAll();
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
    void fetchAll();
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
    void fetchAll();
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

  // ---- Manzana grid ----
  if (!selectedMz) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-3 text-lg font-bold text-stone-900">Lotes por manzana</h1>
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

  // ---- Lot table for the selected manzana ----
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSelectedMz(null);
            setRowSelection({});
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
        >
          <IconChevronLeft className="h-4 w-4" /> Manzanas
        </button>
        <h1 className="text-lg font-bold text-stone-900">Manzana {currentMz?.code}</h1>
        <span className="text-sm text-stone-400">{mzLots.length} lotes</span>
        {isAdmin ? (
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

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
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
          <p className="py-8 text-center text-sm text-stone-400">Esta manzana no tiene lotes.</p>
        ) : null}
      </div>
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

      {sellLot ? (
        <SellOfflineDialog
          lot={sellLot}
          mzCode={currentMz?.code ?? ''}
          defaultPrice={lotPrice(sellLot)}
          currency={currency}
          onClose={() => setSellLot(null)}
          onSold={() => {
            setSellLot(null);
            void fetchAll();
          }}
        />
      ) : null}
    </div>
  );
}

function SellOfflineDialog({
  lot,
  mzCode,
  defaultPrice,
  currency,
  onClose,
  onSold,
}: {
  lot: LotRow;
  mzCode: string;
  defaultPrice: number | null;
  currency: 'USD' | 'BOB';
  onClose: () => void;
  onSold: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [name, setName] = useState('');
  const [ci, setCi] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState(defaultPrice != null ? String(defaultPrice) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sell() {
    setError(null);
    if (name.trim().length < 5) {
      setError('Escribe el nombre completo del comprador.');
      return;
    }
    const ciCheck = ciSchema.safeParse(ci);
    if (!ciCheck.success) {
      setError('Carnet inválido (ej: 7896541 o 7896541-1E).');
      return;
    }
    const phoneCheck = phoneSchema.safeParse(phone);
    if (!phoneCheck.success) {
      setError('Celular boliviano inválido (8 dígitos, empieza con 6 o 7).');
      return;
    }
    const monto = amount.trim() === '' ? null : Number(amount);
    if (monto !== null && (Number.isNaN(monto) || monto < 0)) {
      setError('Monto inválido.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('mark_sold_offline', {
      p_lot_id: lot.id,
      p_full_name: name.trim(),
      p_ci: ci.trim(),
      p_phone: phone.trim(),
      p_email: email.trim() || null,
      p_amount: monto,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const code = (data as { tracking_code?: string } | null)?.tracking_code;
    push(`Lote vendido en oficina${code ? ` — código ${code}` : ''}.`, 'success');
    onSold();
  }

  return (
    <Dialog open onClose={onClose} title={`Vender en oficina — Mz ${mzCode}, Lote ${lot.number}`}>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <input value={ci} onChange={(e) => setCi(e.target.value)} placeholder="Carnet (CI)" className={inputClass} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular" inputMode="tel" className={inputClass} />
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo (opcional)" inputMode="email" className={inputClass} />
        <div>
          <label className="mb-1 block text-xs text-stone-500">
            Monto cobrado ({currency === 'BOB' ? 'Bs' : '$us'}) — vacío usa el precio del lote
          </label>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (ej. pago en efectivo en oficina)" rows={2} className={inputClass} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => void sell()}>
          {busy ? 'Registrando…' : 'Registrar venta'}
        </button>
      </div>
    </Dialog>
  );
}
