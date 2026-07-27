'use client';

// Plano raster upload + two-point calibration.
//   Modo A: click two points on the photo and type their UTM coordinates
//           (similarity transform: rotation + uniform scale + translation).
//           Optionally fixes point 1 as the project origin (utm_offset_e/n).
//   Modo B: two points + the real distance between them (scale only; the sheet
//           is assumed north-up and anchored at the center of the current plat).
// The resulting px→plan affine is stored in plano_sheets.px_to_plan and the
// calibrated raster becomes a canvas underlay (signed URL + opacity slider).

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { compose, similarityFromTwoPoints, type Affine } from '../lib/affine';
import { dist } from '../lib/geom';
import type { Pt } from '../lib/types';
import { useBuilderStore } from './builderStore';

interface SheetRow {
  id: string;
  title: string | null;
  storage_path: string;
  width_px: number | null;
  height_px: number | null;
  px_to_plan: Affine | null;
}

function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

export function PlanoCalibration({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const setUnderlay = useBuilderStore((s) => s.setUnderlay);

  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<SheetRow | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints] = useState<Pt[]>([]); // natural-pixel coords, y down
  const [mode, setMode] = useState<'A' | 'B'>('A');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [e1, setE1] = useState('');
  const [n1, setN1] = useState('');
  const [e2, setE2] = useState('');
  const [n2, setN2] = useState('');
  const [distM, setDistM] = useState('');
  const [setOrigin, setSetOrigin] = useState(false);
  const [offsets, setOffsets] = useState<{ e: number | null; n: number | null } | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const [sheetRes, projRes] = await Promise.all([
        supabase
          .from('plano_sheets')
          .select('id, title, storage_path, width_px, height_px, px_to_plan')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
        supabase.from('projects').select('utm_offset_e, utm_offset_n').eq('id', projectId).maybeSingle(),
      ]);
      if (!alive) return;
      setSheets((sheetRes.data ?? []) as unknown as SheetRow[]);
      const p = projRes.data as { utm_offset_e: number | string | null; utm_offset_n: number | string | null } | null;
      setOffsets({
        e: p?.utm_offset_e != null ? Number(p.utm_offset_e) : null,
        n: p?.utm_offset_n != null ? Number(p.utm_offset_n) : null,
      });
      setSetOrigin(p?.utm_offset_e == null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, projectId, supabase]);

  async function selectSheet(sheet: SheetRow) {
    setSel(sheet);
    setPoints([]);
    setNatural(
      sheet.width_px && sheet.height_px ? { w: sheet.width_px, h: sheet.height_px } : null,
    );
    setImgUrl(null);
    const { data, error } = await supabase.storage
      .from('planos')
      .createSignedUrl(sheet.storage_path, 60 * 60 * 8);
    if (error || !data?.signedUrl) {
      push('No se pudo abrir la imagen del plano.', 'error');
      return;
    }
    setImgUrl(data.signedUrl);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const size = await readImageSize(file);
      const extByType: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const ext = extByType[file.type] ?? 'jpg';
      const path = `${projectId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from('planos')
        .upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (up.error) {
        push(`No se pudo subir el plano: ${up.error.message}`, 'error');
        return;
      }
      const ins = await supabase
        .from('plano_sheets')
        .insert({
          project_id: projectId,
          title: title.trim() || file.name,
          storage_path: path,
          width_px: size.w,
          height_px: size.h,
        })
        .select('id, title, storage_path, width_px, height_px, px_to_plan')
        .single();
      if (ins.error || !ins.data) {
        push('El archivo se subió pero no se pudo registrar la hoja del plano.', 'error');
        return;
      }
      const sheet = ins.data as unknown as SheetRow;
      setSheets((prev) => [sheet, ...prev]);
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      await selectSheet(sheet);
      push('Plano subido. Marca dos puntos para calibrarlo.', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'No se pudo subir el plano.', 'error');
    } finally {
      setUploading(false);
    }
  }

  function handleImageClick(e: React.MouseEvent) {
    const img = imgRef.current;
    if (!img || !natural) return;
    const rect = img.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * natural.w;
    const py = ((e.clientY - rect.top) / rect.height) * natural.h;
    setPoints((prev) => (prev.length >= 2 ? [[px, py]] : [...prev, [px, py]]));
  }

  async function persistCalibration(pxToPlan: Affine, calibration: Record<string, unknown>) {
    if (!sel || !natural) return false;
    const { error } = await supabase
      .from('plano_sheets')
      .update({
        px_to_plan: pxToPlan,
        calibration,
        width_px: natural.w,
        height_px: natural.h,
      })
      .eq('id', sel.id);
    if (error) {
      push(`No se pudo guardar la calibración: ${error.message}`, 'error');
      return false;
    }
    setSheets((prev) =>
      prev.map((s) => (s.id === sel.id ? { ...s, px_to_plan: pxToPlan } : s)),
    );
    if (imgUrl) {
      setUnderlay({
        sheetId: sel.id,
        url: imgUrl,
        widthPx: natural.w,
        heightPx: natural.h,
        affine: pxToPlan,
      });
    }
    return true;
  }

  async function calibrate() {
    if (!sel || !natural) return;
    if (points.length !== 2) {
      push('Marca exactamente dos puntos sobre la imagen.', 'error');
      return;
    }
    const H = natural.h;
    const s1: Pt = [points[0][0], H - points[0][1]];
    const s2: Pt = [points[1][0], H - points[1][1]];
    setBusy(true);
    try {
      if (mode === 'A') {
        const E1 = Number(e1);
        const N1 = Number(n1);
        const E2 = Number(e2);
        const N2 = Number(n2);
        if (![E1, N1, E2, N2].every(Number.isFinite)) {
          push('Coordenadas UTM inválidas.', 'error');
          return;
        }
        let offE: number;
        let offN: number;
        if (setOrigin) {
          offE = E1;
          offN = N1;
          const { error } = await supabase
            .from('projects')
            .update({ utm_offset_e: E1, utm_offset_n: N1 })
            .eq('id', projectId);
          if (error) {
            push(`No se pudo fijar el origen del proyecto: ${error.message}`, 'error');
            return;
          }
          setOffsets({ e: E1, n: N1 });
        } else if (offsets?.e != null && offsets?.n != null) {
          offE = offsets.e;
          offN = offsets.n;
        } else {
          push('El proyecto no tiene origen UTM. Activa "fijar como origen del proyecto".', 'error');
          return;
        }
        const dst1: Pt = [E1 - offE, N1 - offN];
        const dst2: Pt = [E2 - offE, N2 - offN];
        if (dist(dst1, dst2) < 1) {
          push('Los dos puntos están demasiado cerca (deben estar a más de 1 m).', 'error');
          return;
        }
        const sim = similarityFromTwoPoints(s1, s2, dst1, dst2);
        const pxToPlan = compose(sim, { a: 1, b: 0, c: 0, d: 0, e: -1, f: H });
        const ok = await persistCalibration(pxToPlan, {
          mode: 'A',
          points,
          utm: { e1: E1, n1: N1, e2: E2, n2: N2 },
          origin: { e: offE, n: offN },
        });
        if (ok) {
          push('Plano calibrado y activado como fondo.', 'success');
          onClose();
        }
      } else {
        const d = Number(distM);
        if (!Number.isFinite(d) || d <= 0) {
          push('Distancia real inválida.', 'error');
          return;
        }
        const pxDist = dist(points[0], points[1]);
        if (pxDist < 5) {
          push('Los puntos están demasiado cerca en la imagen.', 'error');
          return;
        }
        const sc = d / pxDist;
        const [bx0, by0, bx1, by1] = useBuilderStore.getState().planBbox;
        const cx = (bx0 + bx1) / 2;
        const cy = (by0 + by1) / 2;
        const pxToPlan: Affine = {
          a: sc,
          b: 0,
          c: cx - (sc * natural.w) / 2,
          d: 0,
          e: -sc,
          f: cy + (sc * natural.h) / 2,
        };
        const ok = await persistCalibration(pxToPlan, {
          mode: 'B',
          points,
          dist_m: d,
        });
        if (ok) {
          push('Plano escalado (sin rotación, asume norte arriba) y activado como fondo.', 'success');
          onClose();
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function activateAsBackground(sheet: SheetRow) {
    if (!sheet.px_to_plan || !sheet.width_px || !sheet.height_px) return;
    const { data } = await supabase.storage
      .from('planos')
      .createSignedUrl(sheet.storage_path, 60 * 60 * 8);
    if (!data?.signedUrl) {
      push('No se pudo abrir la imagen del plano.', 'error');
      return;
    }
    setUnderlay({
      sheetId: sheet.id,
      url: data.signedUrl,
      widthPx: sheet.width_px,
      heightPx: sheet.height_px,
      affine: sheet.px_to_plan,
    });
    push('Plano activado como fondo del editor.', 'success');
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Plano de referencia (calibración)" wide>
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Cargando hojas…" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Upload */}
          <div className="rounded-lg border border-stone-200 p-3">
            <p className="mb-2 text-xs font-semibold text-stone-600">Subir plano nuevo</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título (ej. Plano sector B)"
                className={`${inputClass} w-52! py-1.5!`}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
                className="text-sm text-stone-600 file:mr-2 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-700 hover:file:bg-stone-200"
              />
              {uploading ? <Spinner label="Subiendo…" /> : null}
            </div>
          </div>

          {/* Sheet list */}
          {sheets.length ? (
            <div className="flex flex-wrap gap-2">
              {sheets.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                    sel?.id === s.id ? 'border-brand bg-green-50' : 'border-stone-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void selectSheet(s)}
                    className="font-medium text-stone-700 hover:text-brand"
                  >
                    {s.title ?? 'Sin título'}
                  </button>
                  {s.px_to_plan ? (
                    <>
                      <Badge className="bg-green-100 text-green-700">calibrado</Badge>
                      <button
                        type="button"
                        onClick={() => void activateAsBackground(s)}
                        className="text-brand hover:underline"
                      >
                        usar como fondo
                      </button>
                    </>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800">sin calibrar</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-stone-400">Todavía no hay planos subidos.</p>
          )}

          {/* Calibration workspace */}
          {sel && imgUrl ? (
            <div className="space-y-3">
              <p className="text-xs text-stone-500">
                Haz clic en <strong>dos puntos reconocibles</strong> del plano (esquinas de
                manzana, mojones). Punto 1 en azul, punto 2 en rojo. Un tercer clic reinicia.
              </p>
              <div className="relative max-h-[45vh] overflow-auto rounded-lg border border-stone-200 bg-stone-50">
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={imgUrl}
                    alt={sel.title ?? 'Plano'}
                    onClick={handleImageClick}
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                    className="block max-w-full cursor-crosshair select-none"
                    draggable={false}
                  />
                  {natural
                    ? points.map((p, i) => (
                        <span
                          key={i}
                          className={`pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${
                            i === 0 ? 'bg-blue-600' : 'bg-red-600'
                          }`}
                          style={{
                            left: `${(p[0] / natural.w) * 100}%`,
                            top: `${(p[1] / natural.h) * 100}%`,
                          }}
                        />
                      ))
                    : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-stone-600">Modo</span>
                <div className="flex overflow-hidden rounded-lg border border-stone-300">
                  <button
                    type="button"
                    onClick={() => setMode('A')}
                    className={`px-3 py-1 text-xs font-medium ${mode === 'A' ? 'bg-brand text-white' : 'bg-white text-stone-600'}`}
                  >
                    A — coordenadas UTM
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('B')}
                    className={`px-3 py-1 text-xs font-medium ${mode === 'B' ? 'bg-brand text-white' : 'bg-white text-stone-600'}`}
                  >
                    B — distancia real
                  </button>
                </div>
                <span className="text-xs text-stone-400">{points.length}/2 puntos</span>
              </div>

              {mode === 'A' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={e1} onChange={(e) => setE1(e.target.value)} placeholder="Punto 1 — Este (E)" inputMode="decimal" className={`${inputClass} py-1.5! text-xs`} />
                    <input value={n1} onChange={(e) => setN1(e.target.value)} placeholder="Punto 1 — Norte (N)" inputMode="decimal" className={`${inputClass} py-1.5! text-xs`} />
                    <input value={e2} onChange={(e) => setE2(e.target.value)} placeholder="Punto 2 — Este (E)" inputMode="decimal" className={`${inputClass} py-1.5! text-xs`} />
                    <input value={n2} onChange={(e) => setN2(e.target.value)} placeholder="Punto 2 — Norte (N)" inputMode="decimal" className={`${inputClass} py-1.5! text-xs`} />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-stone-600">
                    <input
                      type="checkbox"
                      checked={setOrigin}
                      onChange={(e) => setSetOrigin(e.target.checked)}
                      className="accent-brand"
                    />
                    Fijar el punto 1 como origen del proyecto (actualiza utm_offset_e/n)
                  </label>
                  <p className="text-[11px] text-stone-400">
                    Origen actual:{' '}
                    {offsets?.e != null && offsets?.n != null
                      ? `E ${offsets.e} / N ${offsets.n} (EPSG:32720)`
                      : 'sin definir'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <input
                    value={distM}
                    onChange={(e) => setDistM(e.target.value)}
                    placeholder="Distancia real entre los puntos (m)"
                    inputMode="decimal"
                    className={`${inputClass} w-64! py-1.5! text-xs`}
                  />
                  <p className="text-[11px] text-stone-400">
                    Solo escala: el plano se asume con el norte hacia arriba y se centra sobre el
                    plat actual. Ajusta luego con el modo A si necesitas rotación/posición exacta.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void calibrate()}
                  disabled={busy || points.length !== 2}
                  className={btnPrimary}
                >
                  {busy ? 'Calibrando…' : 'Calibrar y usar como fondo'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
