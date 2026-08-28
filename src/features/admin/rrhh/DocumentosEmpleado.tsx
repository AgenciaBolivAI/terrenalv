'use client';

// LOS PAPELES DEL FILE: carnet, contrato, currículum, el croquis del domicilio.
//
// Suben por el servidor —nunca directo al storage— porque ahí se les borran
// los metadatos a las fotos: la foto del carnet sacada con el teléfono lleva la
// ubicación GPS de dónde se sacó, y eso no tiene por qué quedar guardado en el
// file de nadie.
//
// El bucket es privado y se lee con un enlace firmado que dura diez minutos.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { TIPO_DOCUMENTO, type Documento } from './tipos';

const MAX_MB = 4;

export function DocumentosEmpleado({ empleadoId }: { empleadoId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [docs, setDocs] = useState<Documento[] | null>(null);
  const [tipo, setTipo] = useState('ci');
  const [subiendo, setSubiendo] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('hr_documentos')
      .select('id, empleado_id, tipo, nombre, created_at')
      .eq('empleado_id', empleadoId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setDocs((data ?? []) as Documento[]);
  }, [supabase, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      push(`El archivo pasa de ${MAX_MB} MB. Sacá una foto más chica o subilo en PDF.`, 'error');
      return;
    }
    setSubiendo(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('empleado_id', empleadoId);
    fd.append('tipo', tipo);
    fd.append('nombre', file.name);
    const res = await fetch('/api/admin/hr-doc', { method: 'POST', body: fd });
    setSubiendo(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      push(j?.error ?? 'No pudimos subir el papel.', 'error');
      return;
    }
    push('Papel guardado en el file.', 'success');
    void cargar();
  }

  async function ver(doc: Documento) {
    const res = await fetch(`/api/admin/hr-doc-url?doc=${doc.id}`);
    const j = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !j?.url) {
      push(j?.error ?? 'No pudimos abrir el papel.', 'error');
      return;
    }
    window.open(j.url, '_blank', 'noopener');
  }

  async function borrar(doc: Documento) {
    if (!window.confirm(`¿Sacar «${doc.nombre}» del file?`)) return;
    const { error } = await supabase.rpc('admin_borrar_hr_documento', { p_id: doc.id });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Papel sacado del file.', 'success');
    void cargar();
  }

  return (
    <section className="rounded-lg border border-stone-200 p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
        Documentos del file
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-stone-500">¿Qué papel es?</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputClass}>
            {TIPO_DOCUMENTO.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <label className={`${btnSecondary} cursor-pointer`}>
          {subiendo ? 'Subiendo…' : 'Subir papel'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            disabled={subiendo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void subir(f);
            }}
          />
        </label>
        <p className="text-[11px] text-stone-500">
          Foto o PDF, hasta {MAX_MB} MB. A las fotos se les borra la ubicación antes de guardarlas.
        </p>
      </div>

      <div className="mt-3">
        {docs === null ? (
          <Spinner />
        ) : !docs.length ? (
          <p className="text-xs text-stone-500">
            Todavía no hay papeles cargados. El carnet, el contrato y el croquis del domicilio van
            acá.
          </p>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <Badge className="bg-stone-100 text-stone-600">
                  {TIPO_DOCUMENTO.find(([v]) => v === d.tipo)?.[1] ?? d.tipo}
                </Badge>
                <span className="flex-1 truncate text-stone-800">{d.nombre}</span>
                <span className="text-stone-400">{dateLabel(d.created_at.slice(0, 10))}</span>
                <button
                  type="button"
                  className="cursor-pointer font-medium text-brand hover:underline"
                  onClick={() => void ver(d)}
                >
                  Ver
                </button>
                <button
                  type="button"
                  className="cursor-pointer text-stone-400 hover:text-red-600"
                  onClick={() => void borrar(d)}
                >
                  Sacar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
