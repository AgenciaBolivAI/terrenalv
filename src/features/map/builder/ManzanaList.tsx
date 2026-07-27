'use client';

// Left sidebar: every manzana with code, sector, lot count, state and review
// chips. Selecting one loads its lots into the draft store (via the shell's
// dirty-guarded handler).

import { useMemo, useState } from 'react';
import { Badge } from '@/features/admin/ui/bits';
import { IconSearch } from '@/features/admin/ui/icons';
import { useBuilderStore } from './builderStore';

export function ManzanaList({
  onSelect,
  onNew,
}: {
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const manzanas = useBuilderStore((s) => s.manzanas);
  const lotStats = useBuilderStore((s) => s.lotStats);
  const selectedId = useBuilderStore((s) => s.selectedId);
  const dirty = useBuilderStore((s) => s.dirtyManzana || s.dirtyLots);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return manzanas;
    return manzanas.filter(
      (m) =>
        m.code.toLowerCase().includes(needle) ||
        (m.sector ?? '').toLowerCase().includes(needle),
    );
  }, [manzanas, q]);

  return (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-stone-200 bg-white sm:w-60">
      <div className="space-y-2 border-b border-stone-100 p-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar manzana…"
            className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-lg border border-dashed border-stone-300 px-2 py-1.5 text-sm font-medium text-stone-600 hover:border-brand hover:text-brand"
        >
          + Nueva manzana
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.map((m) => {
          const stats = lotStats[m.id];
          const active = m.id === selectedId;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className={`mb-1 w-full rounded-lg border px-2.5 py-2 text-left ${
                  active
                    ? 'border-brand bg-green-50'
                    : 'border-transparent hover:bg-stone-50'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-sm font-bold text-stone-900">
                    {m.code}
                    {active && dirty ? (
                      <span className="ml-1 align-middle text-amber-500" title="Cambios sin guardar">
                        ●
                      </span>
                    ) : null}
                  </p>
                  <div className="flex gap-1">
                    {m.needs_review || stats?.review ? (
                      <Badge className="bg-amber-100 text-amber-800">revisar</Badge>
                    ) : null}
                    {m.isNew || m.state === 'draft' ? (
                      <Badge className="bg-stone-100 text-stone-500">borrador</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700">publicada</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  {stats?.count ?? 0} lotes
                  {m.sector ? ` · ${m.sector}` : ''}
                  {` · ${m.kind}`}
                </p>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-2 py-6 text-center text-xs text-stone-400">Sin resultados.</li>
        ) : null}
      </ul>
    </div>
  );
}
