'use client';

// COMPROBANTE SÓLO FISCAL — el asiento manual del libro que se declara.
//
// Existe para lo que no tiene espejo en el gerencial: la planilla fiscal, los
// aportes a la AFP y a la gestora, lo que pide el ministerio de trabajo. Eso
// vive únicamente en el libro fiscal, así que no hay nada que importar — se
// asienta acá directo con fiscal_guardar_comprobante, y el gerencial ni se
// entera, como debe ser.
//
// El editor de líneas copia al de Comprobantes.tsx de contabilidad: el asiento
// se escribe de arriba hacia abajo y el cuadre se mira en vivo al pie, sin
// pelearse con el formulario a mitad de camino.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { num } from '@/features/admin/export';
import { todayIso } from '@/features/admin/contabilidad/types';
import { codigoDe, type Account } from '@/features/admin/contabilidad/Comprobantes';

interface DraftLine {
  account_code: string;
  debe: string;
  haber: string;
  glosa: string;
}

const EMPTY_LINE: DraftLine = { account_code: '', debe: '', haber: '', glosa: '' };

export default function ComprobanteSoloFiscal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  /** El libro fiscal se recarga afuera: acá solo se avisa que hay uno nuevo. */
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [fecha, setFecha] = useState(todayIso);
  const [glosa, setGlosa] = useState('');
  const [nota, setNota] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El plan de cuentas se carga acá y no llega por props: este módulo no
  // comparte estado con contabilidad. El plan sí es el mismo para los dos
  // libros — un solo plan, dos libros.
  const [plan, setPlan] = useState<Account[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('chart_of_accounts')
        .select('code, codigo_plan, parent_code, name, kind, is_active, is_system')
        .order('sort_order');
      setPlan((data ?? []) as unknown as Account[]);
    })();
  }, [supabase]);

  // Solo se ofrecen las cuentas IMPUTABLES. Una cuenta con hijas es titular:
  // agrupa, no se asienta. El servidor igual lo rechaza (CUENTA_INVALIDA),
  // pero ofrecerla y después negarla es hacerle perder el asiento a quien lo
  // está escribiendo.
  const activos = useMemo(() => {
    const conHijas = new Set(plan.filter((a) => a.is_active).map((a) => a.parent_code));
    return plan.filter((a) => a.is_active && !conHijas.has(a.code));
  }, [plan]);

  const totalDebe = lines.reduce((s, l) => s + (Number(l.debe) || 0), 0);
  const totalHaber = lines.reduce((s, l) => s + (Number(l.haber) || 0), 0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.005 && totalDebe > 0;

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // Una línea es debe o haber, nunca las dos: escribir en una vacía la otra.
        if (patch.debe !== undefined && patch.debe !== '') next.haber = '';
        if (patch.haber !== undefined && patch.haber !== '') next.debe = '';
        return next;
      }),
    );
  }

  async function registrar() {
    setError(null);
    const payload = lines
      .filter((l) => l.account_code && (Number(l.debe) > 0 || Number(l.haber) > 0))
      .map((l) => ({
        account_code: l.account_code,
        glosa: l.glosa.trim() || null,
        debe: Number(l.debe) || 0,
        haber: Number(l.haber) || 0,
      }));

    if (payload.length < 2) {
      setError('Un asiento necesita al menos dos líneas.');
      return;
    }
    if (!cuadra) {
      setError(`No cuadra: debe ${num(totalDebe)} contra haber ${num(totalHaber)}.`);
      return;
    }

    setBusy(true);
    const { error: err } = await supabase.rpc('fiscal_guardar_comprobante', {
      p_project_id: projectId,
      p_fecha: fecha,
      p_glosa: glosa.trim(),
      p_lines: payload,
      p_nota: nota.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Comprobante sólo fiscal registrado.', 'success');
    onSaved();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Comprobante sólo fiscal" wide>
      <div className="space-y-3">
        <p className="text-sm text-stone-600">
          Para lo que solo existe en el libro fiscal: la planilla fiscal, la AFP, la gestora, el
          ministerio de trabajo. Se asienta acá directo y{' '}
          <strong>jamás toca el libro gerencial</strong>.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Glosa</label>
            <input
              value={glosa}
              onChange={(e) => setGlosa(e.target.value)}
              placeholder="ej. Planilla fiscal agosto 2026"
              className={inputClass}
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full min-w-150 text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-2 py-1.5 text-xs font-semibold text-stone-500">Cuenta</th>
                <th className="px-2 py-1.5 text-xs font-semibold text-stone-500">Detalle</th>
                <th className="px-2 py-1.5 text-right text-xs font-semibold text-stone-500">Debe</th>
                <th className="px-2 py-1.5 text-right text-xs font-semibold text-stone-500">Haber</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-stone-100 last:border-0">
                  <td className="px-2 py-1">
                    <select
                      value={l.account_code}
                      onChange={(e) => setLine(i, { account_code: e.target.value })}
                      className="w-full rounded border border-stone-200 bg-white px-1.5 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {activos.map((a) => (
                        <option key={a.code} value={a.code}>
                          {codigoDe(a)} · {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={l.glosa}
                      onChange={(e) => setLine(i, { glosa: e.target.value })}
                      className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number" step="0.01" min={0} value={l.debe}
                      onChange={(e) => setLine(i, { debe: e.target.value })}
                      className="w-24 rounded border border-stone-200 px-1.5 py-1 text-right text-xs"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number" step="0.01" min={0} value={l.haber}
                      onChange={(e) => setLine(i, { haber: e.target.value })}
                      className="w-24 rounded border border-stone-200 px-1.5 py-1 text-right text-xs"
                    />
                  </td>
                  <td className="px-2 py-1">
                    {lines.length > 2 ? (
                      <button
                        type="button"
                        aria-label="Quitar línea"
                        onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                        className="cursor-pointer px-1 text-stone-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={`border-t-2 ${cuadra ? 'border-green-300 bg-green-50' : 'border-stone-300 bg-stone-50'}`}>
                <td className="px-2 py-2 text-xs font-semibold text-stone-600" colSpan={2}>
                  {cuadra ? '✓ Cuadra' : 'Debe y haber tienen que coincidir'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">{num(totalDebe)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">{num(totalHaber)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <button
          type="button"
          className={btnSecondary}
          onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
        >
          Agregar línea
        </button>

        <div>
          <label className="mb-1 block text-xs text-stone-500">Nota (opcional, queda escrita)</label>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ej. según planilla presentada al ministerio de trabajo"
            className={inputClass}
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !cuadra}
          onClick={() => void registrar()}
        >
          {busy ? 'Registrando…' : 'Registrar'}
        </button>
      </div>
    </Dialog>
  );
}
