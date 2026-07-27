'use client';

// Right-panel inspector for the selected draft lot. area_m2 is the OFFICIAL
// printed value (editable); the computed geometric area is shown next to it
// with a % diff badge (red beyond the 3% QA gate).

import { useState } from 'react';
import { Badge, btnDanger, inputClass } from '@/features/admin/ui/bits';
import { LOT_STATUS_BADGE, LOT_STATUS_LABEL } from '@/features/admin/lib/labels';
import { useToast } from '@/features/admin/ui/toast';
import { ringArea, round2 } from '../lib/geom';
import { useBuilderStore, type DraftLot } from './builderStore';

export function LotInspector() {
  const selectedLotKey = useBuilderStore((s) => s.selectedLotKey);
  const lot = useBuilderStore((s) =>
    s.selectedLotKey ? s.draftLots.find((l) => l.key === s.selectedLotKey) ?? null : null,
  );
  if (!lot || !selectedLotKey) return null;
  return <InspectorInner key={lot.key} lot={lot} />;
}

function InspectorInner({ lot }: { lot: DraftLot }) {
  const { push } = useToast();
  const [number, setNumber] = useState(lot.number);
  const [frontage, setFrontage] = useState(lot.frontage_m != null ? String(lot.frontage_m) : '');
  const [depth, setDepth] = useState(lot.depth_m != null ? String(lot.depth_m) : '');
  const [area, setArea] = useState(lot.area_m2 ? String(lot.area_m2) : '');

  const computed = round2(ringArea(lot.ring));
  const official = Number(area) > 0 ? Number(area) : lot.area_m2;
  const diffPct =
    official > 0 && computed > 0 ? round2((Math.abs(official - computed) / official) * 100) : 0;

  function patchLot(label: string, patch: Partial<DraftLot>) {
    const st = useBuilderStore.getState();
    const next = st.draftLots.map((l) => (l.key === lot.key ? { ...l, ...patch } : l));
    st.commit(label, { draftLots: next });
  }

  function commitNumber() {
    const n = number.trim();
    if (!n) {
      setNumber(lot.number);
      return;
    }
    if (n === lot.number) return;
    const st = useBuilderStore.getState();
    if (st.draftLots.some((l) => l.key !== lot.key && l.number === n)) {
      push(`Ya existe el lote ${n} en esta manzana.`, 'error');
      setNumber(lot.number);
      return;
    }
    patchLot('Renumerar lote', { number: n });
  }

  function commitNum(
    raw: string,
    field: 'frontage_m' | 'depth_m' | 'area_m2',
    label: string,
    reset: (v: string) => void,
  ) {
    const t = raw.trim();
    if (t === '') {
      if (field === 'area_m2') {
        reset(String(lot.area_m2));
        return;
      }
      if (lot[field] != null) patchLot(label, { [field]: null } as Partial<DraftLot>);
      return;
    }
    const v = Number(t.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) {
      push('Valor inválido.', 'error');
      reset(field === 'area_m2' ? String(lot.area_m2) : lot[field] != null ? String(lot[field]) : '');
      return;
    }
    const rounded = round2(v);
    if (rounded === lot[field]) return;
    patchLot(label, { [field]: rounded } as Partial<DraftLot>);
  }

  function deleteLot() {
    if (lot.status !== 'disponible') return;
    const st = useBuilderStore.getState();
    st.commit(`Eliminar lote ${lot.number}`, {
      draftLots: st.draftLots.filter((l) => l.key !== lot.key),
    });
    st.selectLot(null);
    push(`Lote ${lot.number} eliminado del borrador. Guarda la manzana para confirmar.`, 'info');
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Lote {lot.number}</h3>
        <Badge className={LOT_STATUS_BADGE[lot.status]}>{LOT_STATUS_LABEL[lot.status]}</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {lot.state !== 'published' ? (
          <Badge className="bg-stone-100 text-stone-500">borrador</Badge>
        ) : (
          <Badge className="bg-green-100 text-green-700">publicado</Badge>
        )}
        {lot.is_manual_geom ? (
          <Badge className="bg-violet-100 text-violet-700">geometría manual</Badge>
        ) : null}
        {lot.id === null ? <Badge className="bg-blue-100 text-blue-700">nuevo</Badge> : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">Número</label>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onBlur={commitNumber}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={`${inputClass} py-1.5!`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Frente (m)</label>
          <input
            value={frontage}
            onChange={(e) => setFrontage(e.target.value)}
            onBlur={() => commitNum(frontage, 'frontage_m', 'Editar frente', setFrontage)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            inputMode="decimal"
            className={`${inputClass} py-1.5!`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Fondo (m)</label>
          <input
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            onBlur={() => commitNum(depth, 'depth_m', 'Editar fondo', setDepth)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            inputMode="decimal"
            className={`${inputClass} py-1.5!`}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">
          Superficie oficial (m²) — la del plano impreso
        </label>
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          onBlur={() => commitNum(area, 'area_m2', 'Editar superficie', setArea)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          className={`${inputClass} py-1.5!`}
        />
        <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
          <span>Geométrica: {computed} m²</span>
          <Badge
            className={
              diffPct > 3 ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-500'
            }
          >
            {diffPct}% dif.
          </Badge>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={lot.is_corner}
          onChange={(e) => patchLot('Marcar esquinero', { is_corner: e.target.checked })}
          className="accent-brand"
        />
        Lote esquinero
      </label>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={lot.needs_review}
          onChange={(e) => patchLot('Marcar para revisión', { needs_review: e.target.checked })}
          className="accent-brand"
        />
        Necesita revisión
      </label>

      <div className="border-t border-stone-100 pt-3">
        <button
          type="button"
          onClick={deleteLot}
          disabled={lot.status !== 'disponible'}
          title={
            lot.status !== 'disponible'
              ? 'Solo se pueden eliminar lotes disponibles (sin reservas ni ventas).'
              : undefined
          }
          className={`${btnDanger} w-full py-1.5! text-xs`}
        >
          Eliminar lote
        </button>
        {lot.status !== 'disponible' ? (
          <p className="mt-1 text-[11px] text-stone-400">
            Este lote está {LOT_STATUS_LABEL[lot.status].toLowerCase()}; el servidor bloquea su
            eliminación.
          </p>
        ) : null}
      </div>
    </div>
  );
}
