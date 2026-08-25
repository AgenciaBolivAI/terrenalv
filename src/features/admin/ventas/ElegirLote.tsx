'use client';

// Elegir el lote para vender o reservar, desde una pantalla que no es la de
// Lotes.
//
// En el mostrador el orden real es al revés del que tenía el sistema: llega
// una persona, y recién entonces se busca qué lote quiere. Obligar a pasar
// por Lotes para arrancar una venta es pedirle a la vendedora que sepa el
// código de manzana antes de saludar.
//
// Solo aparecen lotes DISPONIBLES y con precio: un lote sin precio no se
// puede vender, y decírselo acá es mejor que dejar fallar el diálogo después.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { EmptyState, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';

export interface LoteElegible {
  id: string;
  project_id: string;
  number: string;
  manzana: string;
  area_m2: number | null;
  precio: number | null;
}

export function ElegirLoteDialog({
  projectId,
  titulo,
  onClose,
  onElegido,
}: {
  projectId: string | null;
  titulo: string;
  onClose: () => void;
  onElegido: (lote: LoteElegible) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<LoteElegible[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const cargar = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('lots')
      .select('id, project_id, number, area_m2, manzanas(code)')
      .eq('project_id', projectId)
      .eq('status', 'disponible')
      .is('deleted_at', null)
      .order('number')
      .limit(2000);

    const lista = (data ?? []) as unknown as {
      id: string;
      project_id: string;
      number: string;
      area_m2: number | null;
      manzanas: { code: string } | null;
    }[];

    // El precio sale de la misma función que usa el mapa público, así que el
    // mostrador y la web nunca cotizan distinto.
    const precios = await Promise.all(
      lista.map((l) => supabase.rpc('lot_price', { p_lot_id: l.id }).then(({ data: p }) => p)),
    );

    setRows(
      lista.map((l, i) => ({
        id: l.id,
        project_id: l.project_id,
        number: l.number,
        manzana: l.manzanas?.code ?? '—',
        area_m2: l.area_m2 == null ? null : Number(l.area_m2),
        precio: precios[i] == null ? null : Number(precios[i]),
      })),
    );
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = rows.filter((r) => r.precio !== null);
    if (!t) return base.slice(0, 60);
    return base
      .filter(
        (r) =>
          r.number.toLowerCase().includes(t) ||
          r.manzana.toLowerCase().includes(t) ||
          `${r.manzana}-${r.number}`.toLowerCase().includes(t),
      )
      .slice(0, 60);
  }, [rows, q]);

  const sinPrecio = rows.filter((r) => r.precio === null).length;

  return (
    <Dialog open onClose={onClose} wide title={titulo}>
      {loading ? (
        <div className="py-10">
          <Spinner label="Buscando lotes disponibles…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No hay lotes disponibles"
          hint="Todos los lotes de esta urbanización están vendidos, reservados o bloqueados."
        />
      ) : (
        <div className="space-y-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por manzana o número de lote (ej. M-2 o 14)"
            className={inputClass}
            autoFocus
          />
          {sinPrecio > 0 ? (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              {sinPrecio} lote(s) disponibles no aparecen porque no tienen precio. Ponéles precio
              en Lotes y podrás venderlos.
            </p>
          ) : null}
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-stone-200">
            {visibles.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-stone-500">
                Ningún lote disponible coincide con «{q}».
              </p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {visibles.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onElegido(l)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-green-50"
                    >
                      <span className="font-semibold text-stone-900">
                        Mz {l.manzana} · Lote {l.number}
                      </span>
                      {l.area_m2 !== null ? (
                        <span className="text-xs text-stone-400">
                          {l.area_m2.toFixed(0)} m²
                        </span>
                      ) : null}
                      <span className="ml-auto font-semibold tabular-nums text-brand">
                        {formatMoney(Number(l.precio), 'BOB')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-stone-400">
            Solo lotes disponibles y con precio. Se muestran los primeros 60: escribí para filtrar.
          </p>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
      </div>
    </Dialog>
  );
}
