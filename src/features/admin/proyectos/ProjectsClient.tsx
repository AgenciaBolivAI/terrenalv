'use client';

// Alta y estado de las urbanizaciones.
//
// La base fue multi-proyecto desde el principio — lotes, manzanas, reservas,
// pagos y cuotas llevan todos project_id — pero no había forma de dar de alta
// una urbanización nueva sin entrar a la base a mano. Esta pantalla cierra eso:
// se crea el proyecto, se le carga el plano desde el editor de mapa, y a partir
// de ahí funciona igual que Prados del Sur, con su propio mapa público, sus
// reservas, su contabilidad y su analítica.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { PROJECT_COOKIE } from '@/features/admin/lib/constants';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  status: 'activo' | 'borrador' | 'archivado';
  currency: 'BOB' | 'USD';
  tracking_prefix: string;
  location_text: string | null;
  geometry_version: number;
  manzanas: number;
  lotes: number;
  vendidos: number;
  reservados: number;
  sin_precio: number;
}

const STATUS_BADGE: Record<ProjectRow['status'], string> = {
  activo: 'bg-green-100 text-green-700',
  borrador: 'bg-amber-100 text-amber-800',
  archivado: 'bg-stone-200 text-stone-600',
};

/**
 * Qué le falta a este proyecto para poder venderse. Se muestra como pasos y no
 * como un error: un proyecto recién creado está incompleto a propósito, y lo
 * útil es decir cuál es el siguiente paso, no que "algo falta".
 */
function pendientes(p: ProjectRow): string[] {
  const out: string[] = [];
  if (p.lotes === 0) out.push('cargar el plano');
  if (p.lotes > 0 && p.geometry_version < 1) out.push('publicar la geometría');
  if (p.lotes > 0 && p.sin_precio === p.lotes) out.push('poner precios');
  if (p.lotes > 0 && p.geometry_version >= 1 && p.status !== 'activo') out.push('publicar el proyecto');
  return out;
}

export default function ProjectsClient({ activeSlug }: { activeSlug: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [location, setLocation] = useState('');
  const [prefix, setPrefix] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('v_proyectos').select('*').order('created_at');
    setRows((data ?? []) as unknown as ProjectRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Cambiar de urbanización: se guarda en cookie y se recarga el panel entero. */
  function cambiarA(p: ProjectRow) {
    document.cookie = `${PROJECT_COOKIE}=${p.slug}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.href = '/admin';
  }

  async function crear() {
    setError(null);
    if (name.trim().length < 3) {
      setError('El nombre del proyecto es obligatorio.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('admin_create_project', {
      p_name: name.trim(),
      p_slug: slug.trim() || null,
      p_location: location.trim() || null,
      p_currency: 'BOB',
      p_tracking_prefix: prefix.trim() || null,
      p_description: null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const r = data as { slug?: string; tracking_prefix?: string } | null;
    push(`Proyecto creado (${r?.slug}). Código de reservas: ${r?.tracking_prefix}-…`, 'success');
    setOpen(false);
    setName('');
    setSlug('');
    setLocation('');
    setPrefix('');
    void load();
  }

  async function cambiarEstado(p: ProjectRow, status: ProjectRow['status']) {
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_set_project_status', {
      p_project_id: p.id,
      p_status: status,
    });
    setBusy(false);
    if (err) {
      push(adminErrorCopy(err.message), 'error');
      return;
    }
    push(status === 'activo' ? 'Proyecto publicado.' : 'Proyecto despublicado.', 'success');
    void load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-stone-900">Urbanizaciones</h1>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setOpen(true)}>
          Nueva urbanización
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Sin proyectos" hint="Creá el primero para empezar." />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => {
            const falta = pendientes(p);
            const activa = p.slug === activeSlug;
            return (
              <section
                key={p.id}
                className={`rounded-xl border bg-white p-4 ${
                  activa ? 'border-brand ring-1 ring-brand/30' : 'border-stone-200'
                }`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-stone-900">{p.name}</h2>
                      <Badge className={STATUS_BADGE[p.status]}>{p.status}</Badge>
                      {activa ? <Badge className="bg-brand/10 text-brand">administrando</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">
                      /{p.slug} · códigos {p.tracking_prefix}-… · {p.location_text ?? 'sin ubicación'}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {!activa ? (
                      <button type="button" className={btnSecondary} onClick={() => cambiarA(p)}>
                        Administrar
                      </button>
                    ) : null}
                    {p.status === 'activo' ? (
                      <>
                        <Link href={`/${p.slug}/mapa`} target="_blank" className={btnSecondary}>
                          Ver mapa público
                        </Link>
                        <button
                          type="button"
                          className={btnSecondary}
                          disabled={busy}
                          onClick={() => void cambiarEstado(p, 'borrador')}
                        >
                          Despublicar
                        </button>
                      </>
                    ) : p.status === 'borrador' ? (
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={busy}
                        onClick={() => void cambiarEstado(p, 'activo')}
                      >
                        Publicar
                      </button>
                    ) : null}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ['Manzanas', p.manzanas],
                    ['Lotes', p.lotes],
                    ['Vendidos', p.vendidos],
                    ['Reservados', p.reservados],
                    ['Sin precio', p.sin_precio],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="rounded-lg bg-stone-50 px-3 py-2">
                      <dt className="text-xs text-stone-500">{k}</dt>
                      <dd className="text-lg font-bold tabular-nums text-stone-900">{v}</dd>
                    </div>
                  ))}
                </dl>

                {falta.length ? (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Siguiente paso: {falta.join(' → ')}.{' '}
                    {activa ? (
                      <Link href="/admin/mapa" className="font-semibold underline">
                        Abrir el editor de mapa
                      </Link>
                    ) : (
                      <>Elegí «Administrar» para trabajar en este proyecto.</>
                    )}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Nueva urbanización">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Prados del Norte"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Dirección web (opcional)
              </label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="prados-del-norte"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Prefijo de códigos (opcional)
              </label>
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="PDN"
                maxLength={6}
                className={inputClass}
              />
            </div>
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Ubicación (ej. Zanja Honda, Cabezas — Santa Cruz)"
            className={inputClass}
          />
          <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
            Nace en <strong>borrador</strong>: no aparece en la web hasta que tenga plano cargado y
            se publique. Después de crearla, el siguiente paso es el editor de mapa para dibujar o
            importar las manzanas y los lotes.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
            Volver
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void crear()}>
            {busy ? 'Creando…' : 'Crear urbanización'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
