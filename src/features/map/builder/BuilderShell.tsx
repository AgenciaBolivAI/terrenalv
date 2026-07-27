'use client';

// Map Builder shell: toolbar (tools, undo/redo, save, publish), manzana list,
// canvas, and the context-dependent right panel. All persistence flows live
// here so every RPC error surfaces as a Spanish toast in one place.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Logo } from '@/components/Logo';
import { createClient } from '@/lib/supabase/client';
import type { ManzanaKind } from '@/lib/db-types';
import { EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { round2 } from '../lib/geom';
import { BuilderCanvas } from './BuilderCanvas';
import { CsvImportWizard } from './CsvImportWizard';
import { LotInspector } from './LotInspector';
import { ManzanaList } from './ManzanaList';
import { PlanoCalibration } from './PlanoCalibration';
import { SubdividePanel } from './SubdividePanel';
import { useBuilderStore, type BuilderTool } from './builderStore';
import { builderErrorCopy } from './lib/errors';
import { filletVertex } from './lib/fillet';
import { ringsEqual } from './lib/load-geom';
import { specToJson } from './lib/spec';

const TOOLS: { id: BuilderTool; label: string; title: string }[] = [
  { id: 'select', label: 'Seleccionar', title: 'Seleccionar y navegar (arrastra para mover el plano)' },
  { id: 'draw', label: 'Dibujar', title: 'Dibujar el contorno de la manzana (clic para colocar vértices)' },
  { id: 'subdivide', label: 'Subdividir', title: 'Generar lotes con la especificación de frentes' },
  { id: 'vertex', label: 'Vértices', title: 'Mover vértices de lotes (imán 0.05 m)' },
  { id: 'cutline', label: 'Corte', title: 'Arrastrar el límite entre dos lotes vecinos (ajusta frentes)' },
];

const KINDS: { value: ManzanaKind; label: string }[] = [
  { value: 'residencial', label: 'Residencial' },
  { value: 'area_verde', label: 'Área verde' },
  { value: 'equipamiento', label: 'Equipamiento' },
  { value: 'amenidad', label: 'Amenidad' },
];

export default function BuilderShell({
  projectId,
}: {
  projectId: string;
}) {
  const { push } = useToast();
  const status = useBuilderStore((s) => s.status);
  const loadError = useBuilderStore((s) => s.loadError);
  const manzanas = useBuilderStore((s) => s.manzanas);
  const selectedId = useBuilderStore((s) => s.selectedId);
  const tool = useBuilderStore((s) => s.tool);
  const dirty = useBuilderStore((s) => s.dirtyManzana || s.dirtyLots);
  const canUndo = useBuilderStore((s) => s.undoStack.length > 0);
  const canRedo = useBuilderStore((s) => s.redoStack.length > 0);
  const selectedLotKey = useBuilderStore((s) => s.selectedLotKey);
  const underlay = useBuilderStore((s) => s.underlay);
  const underlayVisible = useBuilderStore((s) => s.underlayVisible);
  const underlayOpacity = useBuilderStore((s) => s.underlayOpacity);
  const loadingLots = useBuilderStore((s) => s.loadingLots);

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [planoOpen, setPlanoOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  useEffect(() => {
    void useBuilderStore.getState().init(projectId);
  }, [projectId]);

  const selectedMz = useMemo(
    () => (selectedId ? manzanas.find((m) => m.id === selectedId) ?? null : null),
    [manzanas, selectedId],
  );

  // ---- manzana switching with dirty guard ---------------------------------
  const guardedSelect = useCallback(
    (id: string) => {
      const st = useBuilderStore.getState();
      if (id === st.selectedId) return;
      if (st.dirtyManzana || st.dirtyLots) {
        setPendingSelect(id);
        return;
      }
      void st.selectManzana(id);
    },
    [],
  );

  function confirmDiscard() {
    const st = useBuilderStore.getState();
    const cur = st.selectedId ? st.manzanas.find((m) => m.id === st.selectedId) : null;
    const target = pendingSelect;
    setPendingSelect(null);
    if (cur?.isNew) st.discardNewManzana(cur.id);
    if (target) void st.selectManzana(target);
  }

  // ---- save ---------------------------------------------------------------
  async function saveManzana() {
    const st = useBuilderStore.getState();
    const mz = st.selectedId ? st.manzanas.find((m) => m.id === st.selectedId) : null;
    if (!mz) return;
    if (!st.draftRing || st.draftRing.length < 3) {
      push('Dibuja el contorno de la manzana antes de guardar.', 'error');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const specPayload = st.specDraft.frontA.trim()
        ? specToJson(st.specDraft, st.sideAHint, st.draftRing)
        : null;
      const { data, error } = await supabase.rpc('save_manzana', {
        p_project_id: projectId,
        p_code: mz.code,
        p_kind: mz.kind,
        p_sector: mz.sector,
        p_ring: st.draftRing,
        p_spec: specPayload,
        p_expected_version: mz.isNew ? null : st.baseVersion,
      });
      if (error) {
        push(builderErrorCopy(error.message), 'error');
        return;
      }
      const saved = data as { id: string; version: number };
      st.markManzanaSaved(mz.id, saved);

      const lots = useBuilderStore.getState().draftLots;
      const hadDbLots = (st.lotStats[mz.id]?.count ?? 0) > 0;
      if (lots.length > 0 || hadDbLots) {
        const payload = lots.map((l) => {
          const geomUnchanged = l.sourceRing != null && ringsEqual(l.ring, l.sourceRing, 1e-9);
          return {
            number: l.number,
            ring: l.ring,
            frontage_m: l.frontage_m,
            depth_m: l.depth_m,
            area_m2: l.area_m2,
            is_corner: l.is_corner,
            is_manual_geom: l.is_manual_geom,
            needs_review: l.needs_review,
            ...(geomUnchanged && l.edge_dims != null ? { edge_dims: l.edge_dims } : {}),
          };
        });
        const lotsRes = await supabase.rpc('save_lots', {
          p_manzana_id: saved.id,
          p_lots: payload,
          p_replace_missing: true,
        });
        if (lotsRes.error) {
          push(builderErrorCopy(lotsRes.error.message), 'error');
          push('El contorno se guardó, pero los lotes no. Corrige y vuelve a guardar.', 'info');
          return;
        }
        useBuilderStore.setState((s) => ({
          lotStats: {
            ...s.lotStats,
            [saved.id]: { count: lots.length, review: lots.some((l) => l.needs_review) },
          },
        }));
      }
      push(`Manzana ${mz.code} guardada (${lots.length} lotes, borrador).`, 'success');
      await useBuilderStore.getState().reloadSelectedLots();
    } finally {
      setSaving(false);
    }
  }

  // ---- publish ------------------------------------------------------------
  async function publish() {
    setPublishing(true);
    try {
      const res = await fetch('/api/admin/publish-snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { version?: number; error?: string }
        | null;
      if (!res.ok || !body?.version) {
        push(body?.error ?? 'No se pudo publicar el mapa.', 'error');
        return;
      }
      push(`Publicado v${body.version}. El mapa público ya usa la nueva geometría.`, 'success');
      setPublishOpen(false);
      await useBuilderStore.getState().refresh();
    } finally {
      setPublishing(false);
    }
  }

  // ---- vertex ops (draw tool right panel) ---------------------------------
  const [filletRadius, setFilletRadius] = useState('9.00');

  function applyFillet() {
    const st = useBuilderStore.getState();
    const sv = st.selectedVertex;
    if (!st.draftRing || !sv || sv.lotKey !== null) return;
    const r = Number(filletRadius.replace(',', '.'));
    if (!Number.isFinite(r) || r <= 0) {
      push('Radio inválido.', 'error');
      return;
    }
    const res = filletVertex(st.draftRing, sv.index, r, 8);
    if ('error' in res) {
      push(res.error, 'error');
      return;
    }
    st.commit(`Redondear esquina R${r}`, { draftRing: res.ring });
    st.selectVertex(null);
    push(`Esquina redondeada con radio ${r} m (8 segmentos).`, 'success');
  }

  function deleteVertex() {
    const st = useBuilderStore.getState();
    const sv = st.selectedVertex;
    if (!st.draftRing || !sv || sv.lotKey !== null) return;
    if (st.draftRing.length <= 3) {
      push('El contorno necesita al menos 3 vértices.', 'error');
      return;
    }
    st.commit('Eliminar vértice', {
      draftRing: st.draftRing.filter((_, i) => i !== sv.index),
    });
    st.selectVertex(null);
  }

  async function toggleManzanaReview(v: boolean) {
    const st = useBuilderStore.getState();
    const mz = st.selectedId ? st.manzanas.find((m) => m.id === st.selectedId) : null;
    if (!mz) return;
    st.updateManzanaMeta({ needs_review: v });
    if (!mz.isNew) {
      const supabase = createClient();
      const { error } = await supabase
        .from('manzanas')
        .update({ needs_review: v })
        .eq('id', mz.id);
      if (error) push(builderErrorCopy(error.message), 'error');
    }
  }

  // ---- render -------------------------------------------------------------
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Cargando el editor de mapa…" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="p-4">
        <EmptyState
          title="No se pudo cargar el editor"
          hint={loadError ?? 'Revisa la conexión con la base de datos.'}
        />
      </div>
    );
  }

  const draftCount = manzanas.filter((m) => !m.isNew && m.state === 'draft').length;
  const unsavedNew = manzanas.filter((m) => m.isNew);

  const rightPanel =
    tool === 'subdivide' && selectedMz ? (
      <SubdividePanel />
    ) : selectedLotKey ? (
      <LotInspector />
    ) : tool === 'draw' && selectedMz ? (
      <DrawPanel
        filletRadius={filletRadius}
        setFilletRadius={setFilletRadius}
        onFillet={applyFillet}
        onDeleteVertex={deleteVertex}
      />
    ) : (
      <InfoPanel onToggleReview={(v) => void toggleManzanaReview(v)} />
    );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-stone-100">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 bg-white px-2 py-1.5">
        {/* This view negative-margins out of the AdminShell chrome, so it carries its own brand. */}
        <div className="mr-1 hidden items-center gap-2 border-r border-stone-200 pr-2.5 sm:flex">
          <Logo className="h-5 w-auto" srl={false} />
          <span className="text-xs font-medium text-stone-400">Editor de mapa</span>
        </div>

        <div className="flex overflow-hidden rounded-lg border border-stone-300">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.title}
              onClick={() => useBuilderStore.getState().setTool(t.id)}
              className={`px-2.5 py-1.5 text-xs font-medium ${
                tool === t.id ? 'bg-brand text-white' : 'bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded-lg border border-stone-300">
          <button
            type="button"
            title="Deshacer (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => useBuilderStore.getState().undo()}
            className="px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
          >
            ↶
          </button>
          <button
            type="button"
            title="Rehacer (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={() => useBuilderStore.getState().redo()}
            className="border-l border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
          >
            ↷
          </button>
        </div>

        {/* Compact manzana picker for small screens (sidebar hidden) */}
        <select
          value={selectedId ?? ''}
          onChange={(e) => e.target.value && guardedSelect(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs md:hidden"
        >
          <option value="">Manzana…</option>
          {manzanas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code}
            </option>
          ))}
        </select>

        {underlay ? (
          <label className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={underlayVisible}
              onChange={(e) => useBuilderStore.getState().setUnderlayVisible(e.target.checked)}
              className="accent-brand"
            />
            Plano
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(underlayOpacity * 100)}
              onChange={(e) =>
                useBuilderStore.getState().setUnderlayOpacity(Number(e.target.value) / 100)
              }
              className="w-20 accent-brand"
              title="Opacidad del plano de fondo"
            />
          </label>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => setPlanoOpen(true)} className={`${btnSecondary} px-2.5! py-1.5! text-xs`}>
            Plano de referencia
          </button>
          <button type="button" onClick={() => setCsvOpen(true)} className={`${btnSecondary} px-2.5! py-1.5! text-xs`}>
            Importar CSV
          </button>
          <button
            type="button"
            onClick={() => void saveManzana()}
            disabled={saving || !selectedMz || !dirty}
            className={`${btnPrimary} px-3! py-1.5! text-xs`}
          >
            {saving ? 'Guardando…' : 'Guardar manzana'}
          </button>
          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            disabled={publishing}
            className={`${btnSecondary} border-brand! px-3! py-1.5! text-xs text-brand!`}
          >
            Publicar cambios
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className="hidden h-full md:block">
          <ManzanaList onSelect={guardedSelect} onNew={() => setNewOpen(true)} />
        </div>
        <div className="relative h-full min-w-0 flex-1">
          <BuilderCanvas onSelectManzanaRequest={guardedSelect} />
          {loadingLots ? (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 shadow">
              <Spinner label="Cargando lotes…" />
            </div>
          ) : null}
          <a
            href="https://bolivai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-1.5 right-2 text-[10px] text-stone-400/80 hover:text-stone-600"
          >
            Made by BolivAI
          </a>
        </div>
        <div className="hidden h-full w-72 shrink-0 overflow-y-auto border-l border-stone-200 bg-white sm:block lg:w-80">
          {rightPanel}
        </div>
      </div>

      {/* Dialogs */}
      <NewManzanaDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        existingCodes={manzanas.map((m) => m.code.toLowerCase())}
      />
      <CsvImportWizard projectId={projectId} open={csvOpen} onClose={() => setCsvOpen(false)} />
      <PlanoCalibration projectId={projectId} open={planoOpen} onClose={() => setPlanoOpen(false)} />

      <Dialog open={publishOpen} onClose={() => setPublishOpen(false)} title="Publicar cambios">
        <p className="text-sm text-stone-600">
          Se validará todo el proyecto (superposiciones entre manzanas), los borradores pasarán a{' '}
          <strong>publicado</strong> y el mapa público cargará la nueva versión.
        </p>
        <ul className="mt-2 list-inside list-disc text-sm text-stone-600">
          <li>{draftCount} manzana(s) en borrador para publicar.</li>
        </ul>
        {dirty ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            Tienes cambios sin guardar en la manzana {selectedMz?.code ?? 'actual'}. Guárdalos
            primero o se publicará la última versión guardada.
          </p>
        ) : null}
        {unsavedNew.length ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            Manzanas nuevas sin guardar (no se publicarán):{' '}
            {unsavedNew.map((m) => m.code).join(', ')}.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setPublishOpen(false)}>
            Volver
          </button>
          <button type="button" disabled={publishing} className={btnPrimary} onClick={() => void publish()}>
            {publishing ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={pendingSelect !== null}
        onClose={() => setPendingSelect(null)}
        title="Cambios sin guardar"
      >
        <p className="text-sm text-stone-600">
          La manzana {selectedMz?.code ?? 'actual'} tiene cambios sin guardar. Si continúas, se
          descartarán.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setPendingSelect(null)}>
            Cancelar
          </button>
          <button type="button" className={btnPrimary} onClick={confirmDiscard}>
            Descartar y continuar
          </button>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right-panel variants
// ---------------------------------------------------------------------------

function DrawPanel({
  filletRadius,
  setFilletRadius,
  onFillet,
  onDeleteVertex,
}: {
  filletRadius: string;
  setFilletRadius: (v: string) => void;
  onFillet: () => void;
  onDeleteVertex: () => void;
}) {
  const drawPoints = useBuilderStore((s) => s.drawPoints);
  const draftRing = useBuilderStore((s) => s.draftRing);
  const selectedVertex = useBuilderStore((s) => s.selectedVertex);
  const ringVertexSelected = selectedVertex !== null && selectedVertex.lotKey === null;

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-sm font-semibold text-stone-900">Dibujar contorno</h3>
      {drawPoints.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-stone-500">
            {drawPoints.length} vértice(s) colocados. Doble clic, Enter o clic sobre el primer
            punto para cerrar. Retroceso borra el último; Esc cancela.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => useBuilderStore.getState().closeDrawRing()}
              disabled={drawPoints.length < 3}
              className={`${btnPrimary} flex-1 py-1.5! text-xs`}
            >
              Cerrar contorno
            </button>
            <button
              type="button"
              onClick={() => useBuilderStore.getState().setDrawPoints([])}
              className={`${btnSecondary} py-1.5! text-xs`}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          Haz clic en el plano para colocar vértices ({draftRing ? 'reemplaza el contorno actual al cerrar' : 'contorno nuevo'}).
          Imán: cuadrícula 0.25 m, ángulos 45°/90° y vértices de manzanas vecinas (0.5 m).
          Mantén <kbd className="rounded bg-stone-100 px-1">Shift</kbd> para desactivar el imán.
        </p>
      )}

      {draftRing && drawPoints.length === 0 ? (
        <div className="space-y-2 border-t border-stone-100 pt-3">
          <p className="text-xs font-medium text-stone-600">
            Vértices del contorno: {draftRing.length}
          </p>
          {ringVertexSelected ? (
            <>
              <p className="text-xs text-stone-500">
                Vértice #{(selectedVertex?.index ?? 0) + 1} seleccionado — arrástralo para moverlo.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={filletRadius}
                  onChange={(e) => setFilletRadius(e.target.value)}
                  inputMode="decimal"
                  className={`${inputClass} w-20! py-1! text-xs`}
                  title="Radio en metros"
                />
                <button type="button" onClick={onFillet} className={`${btnSecondary} flex-1 py-1.5! text-xs`}>
                  Redondear esquina
                </button>
              </div>
              <button type="button" onClick={onDeleteVertex} className={`${btnSecondary} w-full py-1.5! text-xs`}>
                Eliminar vértice
              </button>
            </>
          ) : (
            <p className="text-xs text-stone-400">
              Haz clic en un vértice del contorno para redondearlo (R 9.00 típico del plano) o
              eliminarlo.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function InfoPanel({ onToggleReview }: { onToggleReview: (v: boolean) => void }) {
  const selectedMz = useBuilderStore((s) =>
    s.selectedId ? s.manzanas.find((m) => m.id === s.selectedId) ?? null : null,
  );
  const draftLots = useBuilderStore((s) => s.draftLots);
  const updateMeta = useBuilderStore((s) => s.updateManzanaMeta);

  if (!selectedMz) {
    return (
      <div className="space-y-2 p-3 text-xs text-stone-500">
        <h3 className="text-sm font-semibold text-stone-900">Editor de mapa</h3>
        <p>Selecciona una manzana de la lista para editar sus lotes, o crea una nueva.</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Dibujar</strong>: contorno de la manzana con imán a cuadrícula/ángulos.
          </li>
          <li>
            <strong>Subdividir</strong>: genera lotes desde la especificación de frentes.
          </li>
          <li>
            <strong>Vértices</strong>: corrige esquinas de lotes (mueve vértices compartidos).
          </li>
          <li>
            <strong>Corte</strong>: arrastra el límite entre dos lotes para ajustar frentes.
          </li>
        </ul>
        <p className="text-stone-400">
          Guardar deja todo en borrador; Publicar lo hace visible a los compradores.
        </p>
      </div>
    );
  }

  const totalOficial = round2(draftLots.reduce((s, l) => s + (l.area_m2 || 0), 0));

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-sm font-semibold text-stone-900">Manzana {selectedMz.code}</h3>
      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">Tipo</label>
        <select
          value={selectedMz.kind}
          onChange={(e) => updateMeta({ kind: e.target.value as ManzanaKind })}
          className={`${inputClass} py-1.5! text-xs`}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-stone-600">Sector</label>
        <input
          value={selectedMz.sector ?? ''}
          onChange={(e) => updateMeta({ sector: e.target.value.trim() || null })}
          placeholder="ej. Sector B"
          className={`${inputClass} py-1.5! text-xs`}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={selectedMz.needs_review}
          onChange={(e) => onToggleReview(e.target.checked)}
          className="accent-brand"
        />
        Necesita revisión
      </label>
      <div className="rounded-lg bg-stone-50 p-2 text-xs text-stone-600">
        <p>{draftLots.length} lotes en el borrador.</p>
        <p>Superficie oficial total: {totalOficial} m²</p>
        <p className="mt-1 text-stone-400">
          Estado: {selectedMz.isNew ? 'nueva (sin guardar)' : selectedMz.state === 'draft' ? 'borrador' : 'publicada'} · v{selectedMz.version}
        </p>
      </div>
      <p className="text-[11px] text-stone-400">
        Haz clic en un lote (herramienta Seleccionar) para editar número, medidas y superficie
        oficial.
      </p>
    </div>
  );
}

function NewManzanaDialog({
  open,
  onClose,
  existingCodes,
}: {
  open: boolean;
  onClose: () => void;
  existingCodes: string[];
}) {
  const { push } = useToast();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<ManzanaKind>('residencial');
  const [sector, setSector] = useState('');

  function create() {
    const c = code.trim().toUpperCase();
    if (!c) {
      push('Escribe el código de la manzana (ej. MZ-41).', 'error');
      return;
    }
    if (existingCodes.includes(c.toLowerCase())) {
      push(`Ya existe una manzana con el código ${c}.`, 'error');
      return;
    }
    useBuilderStore.getState().createManzana({
      code: c,
      kind,
      sector: sector.trim() || null,
    });
    push(`Manzana ${c} creada. Dibuja su contorno en el plano.`, 'success');
    setCode('');
    setSector('');
    setKind('residencial');
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nueva manzana">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Código</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ej. MZ-41"
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Tipo</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ManzanaKind)} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-600">Sector (opcional)</label>
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="ej. Sector B"
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} onClick={create}>
          Crear y dibujar
        </button>
      </div>
    </Dialog>
  );
}
