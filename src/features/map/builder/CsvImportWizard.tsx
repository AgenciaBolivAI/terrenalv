'use client';

// CSV import of official lot data (frente/fondo/superficie/categoría/precio).
// papaparse client-side → dry-run table (matched / missing / area >3% / bad
// rows) → stage_lot_import + apply_lot_import RPCs; server warnings rendered.

import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { createClient } from '@/lib/supabase/client';
import { traerTodo } from '@/features/admin/lib/traer-todo';
import { Badge, Spinner, btnPrimary, btnSecondary } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { round2 } from '../lib/geom';
import { useBuilderStore } from './builderStore';
import { builderErrorCopy } from './lib/errors';

interface CsvRow {
  manzana: string;
  lote: string;
  frente: string;
  fondo: string;
  superficie: string;
  categoria: string;
  precio: string;
}

type RowStatus = 'ok' | 'no_encontrado' | 'superficie' | 'invalida';

interface CheckedRow extends CsvRow {
  status: RowStatus;
  note: string;
}

interface ApplyResult {
  actualizados: number;
  errores: number;
  advertencias: {
    manzana: string;
    lote: string;
    area_csv: number;
    area_geom: number;
  }[];
}

const HEADER_MAP: Record<string, keyof CsvRow> = {
  manzana: 'manzana',
  mz: 'manzana',
  manz: 'manzana',
  lote: 'lote',
  lot: 'lote',
  nro: 'lote',
  numero: 'lote',
  n: 'lote',
  frente: 'frente',
  fondo: 'fondo',
  superficie: 'superficie',
  area: 'superficie',
  sup: 'superficie',
  categoria: 'categoria',
  cat: 'categoria',
  precio: 'precio',
  price: 'precio',
};

function normalizeHeader(h: string): string {
  const clean = h
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return HEADER_MAP[clean] ?? clean;
}

/** '1.234,56' / '1234.56' / '1234,56' → canonical dot-decimal string. */
function normalizeNumber(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let t = s.replace(/\s/g, '');
  if (t.includes(',') && t.includes('.')) {
    // Assume '.' thousands + ',' decimals (es-BO convention).
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    t = t.replace(',', '.');
  }
  return t;
}

function badNumber(s: string): boolean {
  return s !== '' && !Number.isFinite(Number(s));
}

export function CsvImportWizard({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { push } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CheckedRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function dryRun(parsed: CsvRow[]) {
    setChecking(true);
    // Existing lots (any manzana) for the match + area gate.
    // Paginado: acá se busca si el lote YA existe, y la urbanización tiene más
    // de mil. Con el tope de PostgREST, un número repetido más allá de la fila
    // 1.000 pasaba el control de duplicados sin que nadie se enterara.
    let error: unknown = null;
    const lotRows = await traerTodo<{ number: string; manzana_id: string; computed_area_m2: number | null }>(
      (desde, hasta) =>
        supabase
          .from('lots')
          .select('number, manzana_id, computed_area_m2')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('id')
          .range(desde, hasta)
          .then((r) => {
            if (r.error) error = r.error;
            return r;
          }),
    );
    if (error) {
      push(builderErrorCopy((error as { message: string }).message), 'error');
      setChecking(false);
      return;
    }
    const codeById = new Map(
      useBuilderStore.getState().manzanas.map((m) => [m.id, m.code.toLowerCase()]),
    );
    const byKey = new Map<string, number>();
    for (const r of (lotRows ?? []) as {
      number: string;
      manzana_id: string;
      computed_area_m2: number | null;
    }[]) {
      const code = codeById.get(r.manzana_id);
      if (!code) continue;
      byKey.set(`${code}|${String(r.number).toLowerCase()}`, Number(r.computed_area_m2 ?? 0));
    }

    const checked: CheckedRow[] = parsed.map((r) => {
      if (!r.manzana || !r.lote) {
        return { ...r, status: 'invalida', note: 'Falta manzana o lote' };
      }
      if ([r.frente, r.fondo, r.superficie, r.precio].some(badNumber)) {
        return { ...r, status: 'invalida', note: 'Número ilegible' };
      }
      const computed = byKey.get(`${r.manzana.toLowerCase()}|${r.lote.toLowerCase()}`);
      if (computed === undefined) {
        return { ...r, status: 'no_encontrado', note: 'No existe en el mapa' };
      }
      const sup = Number(r.superficie);
      if (r.superficie !== '' && computed > 0 && Math.abs(sup - computed) / computed > 0.03) {
        return {
          ...r,
          status: 'superficie',
          note: `CSV ${sup} m² vs geometría ${round2(computed)} m²`,
        };
      }
      return { ...r, status: 'ok', note: '' };
    });
    setRows(checked);
    setChecking(false);
  }

  function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader,
      complete: (res) => {
        const parsed: CsvRow[] = res.data.map((raw) => ({
          manzana: String(raw.manzana ?? '').trim(),
          lote: String(raw.lote ?? '').trim(),
          frente: normalizeNumber(raw.frente),
          fondo: normalizeNumber(raw.fondo),
          superficie: normalizeNumber(raw.superficie),
          categoria: String(raw.categoria ?? '').trim(),
          precio: normalizeNumber(raw.precio),
        }));
        if (!parsed.length) {
          push('El archivo no tiene filas legibles.', 'error');
          return;
        }
        void dryRun(parsed);
      },
      error: () => push('No se pudo leer el archivo CSV.', 'error'),
    });
  }

  async function runImport() {
    const importable = rows.filter((r) => r.status !== 'invalida');
    if (!importable.length) return;
    setImporting(true);
    const batch = crypto.randomUUID();
    const payload = importable.map((r) => ({
      manzana: r.manzana,
      lote: r.lote,
      frente: r.frente,
      fondo: r.fondo,
      superficie: r.superficie,
      categoria: r.categoria,
      precio: r.precio,
    }));
    const staged = await supabase.rpc('stage_lot_import', {
      p_batch_id: batch,
      p_rows: payload,
    });
    if (staged.error) {
      push(builderErrorCopy(staged.error.message), 'error');
      setImporting(false);
      return;
    }
    const applied = await supabase.rpc('apply_lot_import', {
      p_batch_id: batch,
      p_project_id: projectId,
    });
    setImporting(false);
    if (applied.error) {
      push(builderErrorCopy(applied.error.message), 'error');
      return;
    }
    const r = applied.data as ApplyResult;
    setResult({
      actualizados: r?.actualizados ?? 0,
      errores: r?.errores ?? 0,
      advertencias: Array.isArray(r?.advertencias) ? r.advertencias : [],
    });
    push(`Importación aplicada: ${r?.actualizados ?? 0} lotes actualizados.`, 'success');
  }

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { ok: 0, no_encontrado: 0, superficie: 0, invalida: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const STATUS_BADGE: Record<RowStatus, { cls: string; label: string }> = {
    ok: { cls: 'bg-green-100 text-green-800', label: 'ok' },
    no_encontrado: { cls: 'bg-red-100 text-red-700', label: 'no encontrado' },
    superficie: { cls: 'bg-amber-100 text-amber-800', label: 'superficie >3%' },
    invalida: { cls: 'bg-stone-200 text-stone-600', label: 'inválida' },
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Importar CSV de lotes"
      wide
    >
      <p className="text-xs text-stone-500">
        Columnas reconocidas: <code>manzana</code>, <code>lote</code>, <code>frente</code>,{' '}
        <code>fondo</code>, <code>superficie</code>, <code>categoria</code>, <code>precio</code>{' '}
        (separador coma o punto y coma). Actualiza los datos oficiales de lotes existentes; no crea
        lotes nuevos.
      </p>

      <div className="mt-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-700 hover:file:bg-stone-200"
        />
      </div>

      {checking ? (
        <div className="mt-4 flex justify-center">
          <Spinner label="Verificando contra el mapa…" />
        </div>
      ) : null}

      {rows.length > 0 && !checking ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-stone-700">{fileName}</span>
            <Badge className="bg-green-100 text-green-800">{counts.ok} ok</Badge>
            {counts.superficie ? (
              <Badge className="bg-amber-100 text-amber-800">
                {counts.superficie} superficie &gt;3%
              </Badge>
            ) : null}
            {counts.no_encontrado ? (
              <Badge className="bg-red-100 text-red-700">{counts.no_encontrado} no encontrados</Badge>
            ) : null}
            {counts.invalida ? (
              <Badge className="bg-stone-200 text-stone-600">{counts.invalida} inválidas</Badge>
            ) : null}
          </div>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-stone-200">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-stone-50">
                <tr className="border-b border-stone-200 text-left">
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Mz</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Lote</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Frente</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Fondo</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Superficie</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Cat.</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Precio</th>
                  <th className="px-2 py-1.5 font-semibold text-stone-500">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0">
                    <td className="px-2 py-1 font-semibold">{r.manzana}</td>
                    <td className="px-2 py-1">{r.lote}</td>
                    <td className="px-2 py-1">{r.frente || '—'}</td>
                    <td className="px-2 py-1">{r.fondo || '—'}</td>
                    <td className="px-2 py-1">{r.superficie || '—'}</td>
                    <td className="px-2 py-1">{r.categoria || '—'}</td>
                    <td className="px-2 py-1">{r.precio || '—'}</td>
                    <td className="px-2 py-1">
                      <Badge className={STATUS_BADGE[r.status].cls}>
                        {STATUS_BADGE[r.status].label}
                      </Badge>
                      {r.note ? <span className="ml-1 text-stone-400">{r.note}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p className="font-semibold">
            {result.actualizados} lotes actualizados
            {result.errores ? ` · ${result.errores} filas con error (ver tabla)` : ''}.
          </p>
          {result.advertencias.length ? (
            <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
              {result.advertencias.map((w, i) => (
                <li key={i}>
                  Mz {w.manzana} lote {w.lote}: superficie CSV {w.area_csv} m² vs geometría{' '}
                  {w.area_geom} m²
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cerrar
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={importing || checking || rows.every((r) => r.status === 'invalida') || rows.length === 0 || !!result}
          onClick={() => void runImport()}
        >
          {importing
            ? 'Importando…'
            : `Importar ${rows.filter((r) => r.status !== 'invalida').length} filas`}
        </button>
      </div>
    </Dialog>
  );
}
