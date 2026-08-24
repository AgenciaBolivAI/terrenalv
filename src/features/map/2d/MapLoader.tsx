'use client';

// Carga la geometría y los estados desde el navegador, y recién entonces monta
// el mapa.
//
// Antes el servidor bajaba el snapshot completo y React lo volvía a serializar
// dentro del HTML: ~900 KB de polígonos en cada visita, que el navegador no
// podía cachear porque venían dentro del documento, y 2,7 s de espera antes del
// primer byte porque el servidor pagaba esa descarga cada vez.
//
// El snapshot ya es un objeto público direccionado por versión y servido con
// max-age de un año. Dándole la URL al navegador en lugar de los bytes, se baja
// una sola vez y después sale de caché — también entre visitas, cosa que la
// copia incrustada nunca pudo hacer.
//
// Los estados van por el mismo camino: son la otra mitad del peso, cambian
// solos, y el mapa ya tenía que resincronizarlos desde el cliente igual.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient as createAnonClient } from '@supabase/supabase-js';
import type { FinancingPlan } from '@/lib/financing';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/config';
import type { MapProjectInfo } from '../data/loadGeometry';
import { loadStatuses } from '../data/loadStatuses';
import type { GeometrySnapshot, StatusSnapshot } from '../data/types';
import type { PlanoFondoSpec } from './PlanoFondo';
import { MapShell } from './MapShell';

function isValidSnapshot(x: unknown): x is GeometrySnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as GeometrySnapshot;
  return Array.isArray(s.manzanas) && Array.isArray(s.lots) && Array.isArray(s.elements);
}

function Cargando() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#eceae3]">
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-3 border-stone-300 border-t-brand
                   motion-reduce:animate-none"
      />
      <p className="text-sm font-medium text-stone-600">Cargando el plano…</p>
    </div>
  );
}

function NoSePudo() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-bold text-brand">No pudimos cargar el plano</h1>
      <p className="max-w-xs text-sm text-stone-600">
        Puede ser la conexión. Volvé a intentarlo en unos segundos.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white"
        >
          Reintentar
        </button>
        <Link href="/" className="rounded-full bg-stone-100 px-5 py-2 text-sm font-semibold text-stone-700">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

export function MapLoader({
  project,
  snapshotUrl,
  financingPlan,
  planoFondo,
}: {
  project: MapProjectInfo;
  snapshotUrl: string | null;
  financingPlan: FinancingPlan | null;
  planoFondo?: PlanoFondoSpec | null;
}) {
  const [snapshot, setSnapshot] = useState<GeometrySnapshot | null>(null);
  const [statuses, setStatuses] = useState<StatusSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      // Geometría y estados en paralelo: son independientes y juntos definen el
      // primer dibujo, así que encadenarlos sería sumar dos esperas.
      const geoP = (async (): Promise<GeometrySnapshot | null> => {
        if (snapshotUrl) {
          try {
            // Sin cache-buster a propósito: la URL lleva la versión, así que el
            // navegador puede quedarse con ella para siempre.
            const res = await fetch(snapshotUrl);
            if (res.ok) {
              const json: unknown = await res.json();
              if (isValidSnapshot(json)) return json;
            }
          } catch {
            // cae al RPC
          }
        }
        // El storage es solo caché de CDN. Si esa versión no se subió, las filas
        // publicadas son la fuente de verdad.
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
        try {
          const sb = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data } = await sb.rpc('get_geometry_snapshot', {
            p_project_id: project.projectId,
          });
          return isValidSnapshot(data) ? data : null;
        } catch {
          return null;
        }
      })();

      const [geo, st] = await Promise.all([geoP, loadStatuses(project.projectId)]);
      if (!alive) return;
      if (!geo) {
        setFailed(true);
        return;
      }
      setSnapshot(geo);
      setStatuses(st);
    }

    void run();
    return () => {
      alive = false;
    };
  }, [snapshotUrl, project.projectId]);

  if (failed) return <NoSePudo />;
  if (!snapshot) return <Cargando />;

  return (
    <MapShell
      snapshot={snapshot}
      statuses={statuses}
      project={project}
      financingPlan={financingPlan}
      planoFondo={planoFondo ?? null}
    />
  );
}
