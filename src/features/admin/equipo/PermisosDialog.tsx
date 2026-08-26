'use client';

// Qué ve y qué toca esta persona, sección por sección.
//
// El rol pone el techo (la base no deja a un vendedor tocar contabilidad,
// tenga el permiso que tenga); acá se RECORTA debajo de ese techo: «solo
// Lotes y Planes», «mira Contabilidad pero no la toca». Lo que quede en
// «según su rol» sigue el comportamiento de siempre.

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SECCIONES } from '@/features/admin/lib/acceso';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Dialog } from '@/features/admin/ui/dialog';
import { btnPrimary, btnSecondary } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';

const HEREDAR = '__rol__';

export default function PermisosDialog({
  profileId,
  nombre,
  permisos,
  onClose,
  onSaved,
}: {
  profileId: string;
  nombre: string;
  /** Los recortes guardados (solo las secciones tocadas a mano). */
  permisos: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [valores, setValores] = useState<Record<string, string>>(() => ({ ...permisos }));
  const [busy, setBusy] = useState(false);

  const grupos = useMemo(() => {
    const g = new Map<string, typeof SECCIONES>();
    for (const s of SECCIONES) {
      if (!g.has(s.grupo)) g.set(s.grupo, []);
      g.get(s.grupo)!.push(s);
    }
    return [...g.entries()];
  }, []);

  function setNivel(clave: string, nivel: string) {
    setValores((prev) => {
      const next = { ...prev };
      if (nivel === HEREDAR) delete next[clave];
      else next[clave] = nivel;
      return next;
    });
  }

  return (
    <Dialog open onClose={onClose} wide title={`Permisos de ${nombre}`}>
      <p className="text-sm text-stone-600">
        El rol pone el techo de lo que su cuenta puede hacer en la base; acá lo recortás. Lo que
        quede en <strong>según su rol</strong> se comporta como siempre. En las secciones con
        candado de solo lectura, «Ve» bloquea la escritura también en la base.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {grupos.map(([grupo, items]) => (
          <div key={grupo} className="rounded-lg border border-stone-200 p-3">
            <p className="text-[10px] font-bold tracking-wider text-stone-400 uppercase">{grupo}</p>
            <div className="mt-2 space-y-1.5">
              {items.map((s) => (
                <label key={s.clave} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-stone-700">{s.etiqueta}</span>
                  <select
                    value={valores[s.clave] ?? HEREDAR}
                    onChange={(e) => setNivel(s.clave, e.target.value)}
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs"
                  >
                    <option value={HEREDAR}>según su rol</option>
                    {s.clave === 'analitica' ? (
                      <>
                        <option value="no">No ve</option>
                        <option value="propia">Solo lo suyo</option>
                        <option value="empresa">Toda la empresa</option>
                      </>
                    ) : (
                      <>
                        <option value="no">No ve</option>
                        <option value="ve">Ve</option>
                        <option value="edita">Edita</option>
                      </>
                    )}
                  </select>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await supabase.rpc('admin_guardar_permisos', {
              p_profile_id: profileId,
              p_permisos: valores,
            });
            setBusy(false);
            if (error) {
              push(adminErrorCopy(error.message), 'error');
              return;
            }
            push('Permisos guardados. Rigen desde su próxima carga del panel.', 'success');
            onSaved();
          }}
        >
          {busy ? 'Guardando…' : 'Guardar permisos'}
        </button>
      </div>
    </Dialog>
  );
}
