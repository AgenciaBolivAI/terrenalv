'use client';

// Subdivision panel: frontage-spec mini-DSL → subdivideManzana() client-side →
// preview overlay → apply as draft lots. Reuses the exact engine the seed used,
// so regenerating a pre-seeded manzana is deterministic.

import { useState } from 'react';
import polygonClipping from 'polygon-clipping';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';
import { bbox, orientedBoundingBox, ringArea, round2 } from '../lib/geom';
import { parseFrontageSpec, subdivideManzana } from '../lib/subdivide';
import type { Pt, Ring } from '../lib/types';
import { newLotKey, useBuilderStore, type DraftLot } from './builderStore';
import { cardinalPoint } from './lib/spec';

function overlapArea(a: Ring, b: Ring): number {
  const [ax0, ay0, ax1, ay1] = bbox(a);
  const [bx0, by0, bx1, by1] = bbox(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return 0;
  const toPoly = (r: Ring): polygonClipping.Polygon => [
    [...r.map((p) => [p[0], p[1]] as [number, number]), [r[0][0], r[0][1]]],
  ];
  try {
    const inter = polygonClipping.intersection(toPoly(a), toPoly(b));
    let area = 0;
    for (const poly of inter) {
      const outer = poly[0];
      area += ringArea(outer.slice(0, -1).map((p) => [p[0], p[1]] as Pt));
    }
    return area;
  } catch {
    return 0;
  }
}

function distribute(frontages: number[], leftover: number): number[] {
  const total = frontages.reduce((s, f) => s + f, 0);
  if (total <= 0) return frontages;
  const factor = (total + leftover) / total;
  const scaled = frontages.map((f) => round2(f * factor));
  const diff = round2(total + leftover - scaled.reduce((s, f) => s + f, 0));
  scaled[scaled.length - 1] = round2(scaled[scaled.length - 1] + diff);
  return scaled;
}

export function SubdividePanel() {
  const { push } = useToast();
  const spec = useBuilderStore((s) => s.specDraft);
  const setSpec = useBuilderStore((s) => s.setSpecDraft);
  const draftLots = useBuilderStore((s) => s.draftLots);
  const preview = useBuilderStore((s) => s.preview);
  const sideAHint = useBuilderStore((s) => s.sideAHint);
  const pickingSideA = useBuilderStore((s) => s.pickingSideA);
  const [applyWarnings, setApplyWarnings] = useState<string[]>([]);

  const protectedLots = draftLots.filter(
    (l) => l.is_manual_geom || l.status !== 'disponible',
  );

  function generate() {
    const st = useBuilderStore.getState();
    const ring = st.draftRing;
    if (!ring || ring.length < 3) {
      push('Dibuja primero el contorno de la manzana.', 'error');
      return;
    }
    const d = st.specDraft;
    if (!d.frontA.trim()) {
      push('Escribe la especificación de frentes de la fila A.', 'error');
      return;
    }
    try {
      const { lengthU } = orientedBoundingBox(ring);
      const frontagesA = parseFrontageSpec(d.frontA, lengthU);
      const frontagesB =
        d.rows === 2 && d.frontB.trim() !== ''
          ? parseFrontageSpec(d.frontB, lengthU)
          : undefined;
      const hint = st.sideAHint ?? cardinalPoint('S', ring);
      const depthA =
        d.depthA.trim() === '' ? undefined : Number(d.depthA);
      if (depthA !== undefined && (!Number.isFinite(depthA) || depthA <= 0)) {
        push('Fondo de la fila A inválido.', 'error');
        return;
      }
      const start = d.start.trim() === '' ? 1 : Math.max(1, Math.floor(Number(d.start)));
      const result = subdivideManzana(ring, {
        sideAHint: hint,
        rows: d.rows,
        depthA,
        frontagesA,
        frontagesB,
        numbering: { start, directionA: d.dirA, directionB: d.dirB },
      });
      st.setPreview({
        lots: result.lots,
        warnings: result.warnings,
        leftoverA: result.leftoverA,
        leftoverB: result.leftoverB,
      });
      setApplyWarnings([]);
    } catch (e) {
      push(e instanceof Error ? e.message : 'No se pudo subdividir.', 'error');
    }
  }

  function distributeLeftover() {
    const st = useBuilderStore.getState();
    const pv = st.preview;
    const ring = st.draftRing;
    if (!pv || !ring) return;
    try {
      const { lengthU } = orientedBoundingBox(ring);
      const d = st.specDraft;
      const patch: { frontA?: string; frontB?: string } = {};
      if (Math.abs(pv.leftoverA) > 0.05 && d.frontA.trim()) {
        const fa = distribute(parseFrontageSpec(d.frontA, lengthU), pv.leftoverA);
        patch.frontA = fa.join('; ');
      }
      const specB = d.rows === 2 ? (d.frontB.trim() || d.frontA) : '';
      if (d.rows === 2 && Math.abs(pv.leftoverB) > 0.05 && specB.trim()) {
        const fb = distribute(parseFrontageSpec(specB, lengthU), pv.leftoverB);
        patch.frontB = fb.join('; ');
      }
      if (Object.keys(patch).length === 0) return;
      setSpec(patch);
      generate();
    } catch (e) {
      push(e instanceof Error ? e.message : 'No se pudo distribuir el sobrante.', 'error');
    }
  }

  function apply() {
    const st = useBuilderStore.getState();
    const pv = st.preview;
    if (!pv || pv.lots.length === 0) return;
    const keep = st.draftLots.filter((l) => l.is_manual_geom || l.status !== 'disponible');
    const keepNumbers = new Set(keep.map((l) => l.number));
    const warnings: string[] = [];
    const generated: DraftLot[] = [];
    for (const g of pv.lots) {
      if (keepNumbers.has(g.number)) {
        warnings.push(`Lote ${g.number}: ya existe un lote protegido con ese número — omitido.`);
        continue;
      }
      for (const p of keep) {
        if (overlapArea(g.ring, p.ring) > 0.05) {
          warnings.push(`Lote generado ${g.number} se superpone con el lote ${p.number}.`);
        }
      }
      generated.push({
        key: newLotKey(),
        id: null,
        number: g.number,
        ring: g.ring,
        sourceRing: null,
        frontage_m: g.frontage_m,
        depth_m: g.depth_m,
        area_m2: g.area_m2,
        is_corner: g.is_corner,
        is_manual_geom: false,
        needs_review: false,
        status: 'disponible',
        state: 'draft',
        edge_dims: null,
      });
    }
    const next = [...keep, ...generated].sort((a, b) =>
      a.number.localeCompare(b.number, 'es', { numeric: true }),
    );
    st.commit('Aplicar subdivisión', { draftLots: next });
    st.setPreview(null);
    setApplyWarnings(warnings);
    push(
      `Subdivisión aplicada: ${generated.length} lotes generados${
        keep.length ? `, ${keep.length} protegidos sin cambios` : ''
      }.`,
      warnings.length ? 'info' : 'success',
    );
  }

  const leftoverVisible =
    preview && (Math.abs(preview.leftoverA) > 0.05 || Math.abs(preview.leftoverB) > 0.05);

  return (
    <div className="space-y-3 p-3">
      <div>
        <h3 className="text-sm font-semibold text-stone-900">Subdividir manzana</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Frentes: <code className="rounded bg-stone-100 px-1">12; 27x10; 12</code> o{' '}
          <code className="rounded bg-stone-100 px-1">llenar x10</code>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-stone-600">Filas</span>
        <div className="flex overflow-hidden rounded-lg border border-stone-300">
          {[1, 2].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setSpec({ rows: r as 1 | 2 })}
              className={`px-3 py-1 text-sm font-medium ${
                spec.rows === r ? 'bg-brand text-white' : 'bg-white text-stone-600'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {spec.rows === 2 ? (
          <input
            value={spec.depthA}
            onChange={(e) => setSpec({ depthA: e.target.value })}
            placeholder="Fondo fila A (m)"
            inputMode="decimal"
            className={`${inputClass} w-32! py-1! text-xs`}
            title="Vacío = mitad del fondo"
          />
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">Frentes fila A</label>
        <input
          value={spec.frontA}
          onChange={(e) => setSpec({ frontA: e.target.value })}
          placeholder="ej. 12; 27x10; 12"
          className={`${inputClass} py-1.5! font-mono text-xs`}
        />
      </div>
      {spec.rows === 2 ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">
            Frentes fila B <span className="font-normal text-stone-400">(vacío = igual que A)</span>
          </label>
          <input
            value={spec.frontB}
            onChange={(e) => setSpec({ frontB: e.target.value })}
            placeholder="igual que fila A"
            className={`${inputClass} py-1.5! font-mono text-xs`}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Numeración desde</label>
          <input
            value={spec.start}
            onChange={(e) => setSpec({ start: e.target.value })}
            placeholder="1"
            inputMode="numeric"
            className={`${inputClass} py-1! text-xs`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Dirección fila A</label>
          <select
            value={spec.dirA}
            onChange={(e) => setSpec({ dirA: e.target.value as 'forward' | 'reverse' })}
            className={`${inputClass} py-1! text-xs`}
          >
            <option value="forward">Inicio → fin</option>
            <option value="reverse">Fin → inicio</option>
          </select>
        </div>
      </div>
      {spec.rows === 2 ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Dirección fila B</label>
          <select
            value={spec.dirB}
            onChange={(e) => setSpec({ dirB: e.target.value as 'forward' | 'reverse' })}
            className={`${inputClass} py-1! text-xs`}
          >
            <option value="forward">Inicio → fin</option>
            <option value="reverse">Fin → inicio</option>
          </select>
        </div>
      ) : null}

      <div className="rounded-lg bg-stone-50 p-2">
        <button
          type="button"
          onClick={() => useBuilderStore.getState().setPickingSideA(!pickingSideA)}
          className={`${btnSecondary} w-full py-1.5! text-xs ${pickingSideA ? 'border-amber-400! bg-amber-50!' : ''}`}
        >
          {pickingSideA ? 'Haz clic en el frente (calle) de la fila A…' : 'Elegir frente de la fila A en el plano'}
        </button>
        <p className="mt-1 text-[11px] text-stone-500">
          {sideAHint
            ? `Frente A marcado en (${round2(sideAHint[0])}, ${round2(sideAHint[1])}).`
            : 'Sin marcar: se asume el lado sur.'}
        </p>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={generate} className={`${btnSecondary} flex-1 py-1.5! text-xs`}>
          Generar
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!preview || preview.lots.length === 0}
          className={`${btnPrimary} flex-1 py-1.5! text-xs`}
        >
          Aplicar
        </button>
      </div>

      {preview ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
          <p className="font-semibold">
            Vista previa: {preview.lots.length} lotes
          </p>
          {leftoverVisible ? (
            <div className="mt-1">
              <p>
                Sobrante — fila A: {preview.leftoverA} m
                {spec.rows === 2 ? ` · fila B: ${preview.leftoverB} m` : ''}
              </p>
              <button
                type="button"
                onClick={distributeLeftover}
                className="mt-1 rounded border border-indigo-300 bg-white px-2 py-0.5 font-medium text-indigo-700 hover:bg-indigo-100"
              >
                Distribuir sobrante proporcionalmente
              </button>
            </div>
          ) : null}
          {preview.warnings.length ? (
            <ul className="mt-1 list-inside list-disc text-amber-800">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {protectedLots.length ? (
        <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
          {protectedLots.length} lote(s) protegidos (geometría manual o no disponibles) no se
          regeneran: {protectedLots.map((l) => l.number).join(', ')}
        </p>
      ) : null}

      {applyWarnings.length ? (
        <ul className="list-inside list-disc rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
          {applyWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
