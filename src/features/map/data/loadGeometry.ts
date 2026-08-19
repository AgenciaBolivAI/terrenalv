// Geometry loader. Primary path: get_map_manifest RPC (anon) → published
// snapshot JSON from the public `maps` bucket. Dev fallback (server only):
// seed/generated-geometry.json adapted to the GeometrySnapshot shape, so the
// map is tangible before the Supabase project exists. Never throws — a null
// result means the page renders "Mapa en preparación".

import { createClient as createAnonClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ElementKind, ManzanaKind } from '@/lib/db-types';
import type { Ring } from '../lib/types';
import {
  BUILTIN_ANON_KEY,
  CAN_RETRY_BUILTIN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '@/lib/supabase/config';
import type { GeometrySnapshot, SnapshotElement, SnapshotLot, SnapshotManzana } from './types';

export interface MapProjectInfo {
  projectId: string;
  slug: string;
  name: string;
  currency: 'USD' | 'BOB';
  geometryVersion: number;
  statusRev: number;
  /** 'seed' = filesystem fallback: realtime + reservations are disabled. */
  source: 'db' | 'seed';
}

export interface GeometryLoadResult {
  project: MapProjectInfo;
  snapshot: GeometrySnapshot;
}

interface ManifestPayload {
  project_id: string;
  slug: string;
  name: string;
  currency: 'USD' | 'BOB';
  geometry_version: number;
  status_rev: number;
}

/**
 * Why the map has no geometry. "Mapa en preparación" is the right thing to show
 * a BUYER for every one of these, but they are very different operationally —
 * a missing env var is an outage, an unpublished project is expected. Without
 * this distinction a misconfigured deploy looks exactly like a healthy one.
 */
type LoadFailure =
  | 'sin_configuracion' // Supabase env vars absent → deploy misconfigured
  | 'sin_conexion' // RPC failed / timed out
  | 'proyecto_no_encontrado' // slug not found or not 'activo'
  | 'sin_publicar' // project exists, geometry never published
  | 'sin_geometria'; // published but the snapshot is empty/invalid

function reportFailure(slug: string, reason: LoadFailure, detail?: string): null {
  // Server-side only; the buyer sees the friendly state either way.
  const level = reason === 'sin_configuracion' || reason === 'sin_conexion' ? 'error' : 'warn';
  console[level](
    `[mapa] ${slug}: ${reason}${detail ? ` — ${detail}` : ''}` +
      (reason === 'sin_configuracion'
        ? ' (falta NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno)'
        : ''),
  );
  return null;
}

function anonClient(key: string = SUPABASE_ANON_KEY): SupabaseClient | null {
  if (!SUPABASE_URL || !key) return null;
  return createAnonClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A wrong key configured in the environment must not take the map down. */
function isAuthError(message: string): boolean {
  return /invalid api key|jwt|unauthorized|api key/i.test(message);
}

function isValidSnapshot(x: unknown): x is GeometrySnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as GeometrySnapshot;
  return Array.isArray(s.manzanas) && Array.isArray(s.lots) && Array.isArray(s.elements);
}

async function loadFromDb(
  slug: string,
  key: string = SUPABASE_ANON_KEY,
): Promise<GeometryLoadResult | null> {
  const supabase = anonClient(key);
  if (!supabase) return reportFailure(slug, 'sin_configuracion');
  try {
    const { data, error } = await supabase
      .rpc('get_map_manifest', { p_slug: slug })
      .abortSignal(AbortSignal.timeout(6000));
    if (error) {
      // The environment supplied a key this project rejects — fall back to the
      // built-in pair rather than serving "Mapa en preparación" to buyers.
      if (isAuthError(error.message) && key === SUPABASE_ANON_KEY && CAN_RETRY_BUILTIN) {
        console.error(
          `[mapa] ${slug}: la clave de NEXT_PUBLIC_SUPABASE_ANON_KEY fue rechazada ` +
            '(Invalid API key) — reintentando con la clave incorporada',
        );
        return loadFromDb(slug, BUILTIN_ANON_KEY);
      }
      return reportFailure(slug, 'sin_conexion', error.message);
    }
    if (!data) return reportFailure(slug, 'proyecto_no_encontrado');
    const manifest = data as ManifestPayload;
    if (!manifest.project_id || !Number.isFinite(manifest.geometry_version)) {
      return reportFailure(slug, 'proyecto_no_encontrado');
    }
    if (manifest.geometry_version < 1) return reportFailure(slug, 'sin_publicar');

    const base = SUPABASE_URL;
    const url = `${base}/storage/v1/object/public/maps/${manifest.slug}/geometry-v${manifest.geometry_version}.json`;
    // Content-addressed by version → safe to cache indefinitely.
    let snapshot: unknown = null;
    try {
      const res = await fetch(url, {
        cache: 'force-cache',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) snapshot = await res.json();
    } catch {
      // fall through to the database
    }

    // Storage is only a CDN cache. When the snapshot for this version hasn't
    // been uploaded (or the fetch failed), read the same shape from the
    // published rows — they are the source of truth.
    if (!isValidSnapshot(snapshot)) {
      const { data: fromDb } = await supabase.rpc('get_geometry_snapshot', {
        p_project_id: manifest.project_id,
      });
      snapshot = fromDb;
    }
    if (!isValidSnapshot(snapshot)) return reportFailure(slug, 'sin_geometria');

    return {
      project: {
        projectId: manifest.project_id,
        slug: manifest.slug,
        name: manifest.name,
        currency: manifest.currency === 'BOB' ? 'BOB' : 'USD',
        geometryVersion: manifest.geometry_version,
        statusRev: manifest.status_rev ?? 0,
        source: 'db',
      },
      snapshot,
    };
  } catch (err) {
    return reportFailure(slug, 'sin_conexion', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Seed fallback (server-side only): adapt seed/generated-geometry.json.
// ---------------------------------------------------------------------------

interface SeedLot {
  number: string | number;
  ring: Ring;
  frontage_m: number | null;
  depth_m: number | null;
  area_m2: number;
  is_corner: boolean;
}
interface SeedManzana {
  code: string;
  sector: string | null;
  kind: string;
  ring: Ring;
  needs_review?: boolean;
  lots?: SeedLot[];
}
interface SeedElement {
  kind: string;
  name?: string | null;
  ring: Ring;
  props?: Record<string, unknown>;
}
interface SeedFile {
  manzanas?: SeedManzana[];
  elements?: SeedElement[];
}

function seedToSnapshot(seed: SeedFile): GeometrySnapshot | null {
  const manzanas: SnapshotManzana[] = [];
  const lots: SnapshotLot[] = [];
  const elements: SnapshotElement[] = [];

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (const m of seed.manzanas ?? []) {
    if (!Array.isArray(m.ring) || m.ring.length < 3 || !m.code) continue;
    const mzId = `seed-${m.code}`;
    for (const [x, y] of m.ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    manzanas.push({
      id: mzId,
      code: m.code,
      kind: (m.kind as ManzanaKind) ?? 'residencial',
      sector: m.sector ?? null,
      needs_review: !!m.needs_review,
      ring: m.ring,
    });
    for (const l of m.lots ?? []) {
      if (!Array.isArray(l.ring) || l.ring.length < 3) continue;
      lots.push({
        id: `seed-${m.code}-${l.number}`,
        mz: mzId,
        n: String(l.number),
        f: l.frontage_m ?? null,
        d: l.depth_m ?? null,
        a: l.area_m2 ?? 0,
        corner: !!l.is_corner,
        ring: l.ring,
      });
    }
  }
  if (!manzanas.length || !Number.isFinite(x0)) return null;

  (seed.elements ?? []).forEach((el, i) => {
    if (!Array.isArray(el.ring) || el.ring.length < 3) return;
    elements.push({
      id: `seed-el-${i}`,
      kind: (el.kind as ElementKind) ?? 'calle',
      name: el.name ?? null,
      props: el.props ?? {},
      geojson: { type: 'Polygon', coordinates: [[...el.ring, el.ring[0]]] },
    });
  });

  return { v: 0, bbox: [x0, y0, x1, y1], manzanas, lots, elements };
}

/** The only slug the on-disk seed geometry describes. */
const SEED_SLUG = 'prados-del-sur';

async function loadFromSeed(slug: string): Promise<GeometryLoadResult | null> {
  if (typeof window !== 'undefined') return null; // filesystem is server-only
  try {
    // Indirect dynamic import: keeps node builtins out of any client bundle
    // if this module ever gets pulled into one (it is server+client capable).
    const dynamicImport = new Function('m', 'return import(m)') as (
      m: string,
    ) => Promise<Record<string, unknown>>;
    const [fsMod, pathMod] = await Promise.all([
      dynamicImport('node:fs'),
      dynamicImport('node:path'),
    ]);
    const readFileSync = fsMod.readFileSync as typeof import('node:fs')['readFileSync'];
    const join = pathMod.join as typeof import('node:path')['join'];
    const raw = readFileSync(join(process.cwd(), 'seed', 'generated-geometry.json'), 'utf8');
    const snapshot = seedToSnapshot(JSON.parse(raw) as SeedFile);
    if (!snapshot) return null;
    return {
      project: {
        projectId: 'seed-prados-del-sur',
        slug,
        name: 'Prados del Sur',
        currency: 'BOB',
        geometryVersion: 0,
        statusRev: 0,
        source: 'seed',
      },
      snapshot,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the published geometry for a project slug, or null (map not ready).
 *
 * The seed fallback is a DEVELOPMENT convenience only. In production it would
 * be actively harmful: a transient database blip would swap the live map for
 * stale seed geometry whose lot ids don't exist in the DB — every lot would
 * render as available-unpriced and any reserve attempt would 404. Better to
 * show "Mapa en preparación" than a map that lies about availability. It is
 * also restricted to the seed's own slug so an arbitrary slug can't serve it.
 */
export async function loadGeometry(slug: string): Promise<GeometryLoadResult | null> {
  const fromDb = await loadFromDb(slug);
  if (fromDb) return fromDb;
  if (process.env.NODE_ENV === 'production') return null;
  if (slug !== SEED_SLUG) return null;
  return loadFromSeed(slug);
}

// ---------------------------------------------------------------------------
// Manifest-only path (what the page actually uses now)
// ---------------------------------------------------------------------------

export interface MapManifest {
  project: MapProjectInfo;
  /** Public, content-addressed by version → cacheable forever by the CDN. */
  snapshotUrl: string | null;
}

/**
 * Resolve WHERE the geometry lives without downloading it.
 *
 * The page used to call loadGeometry(), which fetched the whole snapshot
 * server-side and then React serialised all of it back into the HTML — every
 * visit shipped ~900 KB of polygons that the browser could not cache, and the
 * server paid the fetch each time (TTFB 2.7 s).
 *
 * The snapshot is already a public object addressed by version and served with
 * max-age=31536000. Handing the browser the URL instead of the bytes means it
 * is downloaded once and then comes from cache — including across page loads,
 * which the inlined copy could never do.
 */
export async function loadMapManifest(slug: string): Promise<MapManifest | null> {
  const supabase = anonClient();
  if (!supabase) return reportFailure(slug, 'sin_configuracion');
  try {
    const { data, error } = await supabase
      .rpc('get_map_manifest', { p_slug: slug })
      .abortSignal(AbortSignal.timeout(6000));
    if (error) return reportFailure(slug, 'sin_conexion', error.message);
    if (!data) return reportFailure(slug, 'proyecto_no_encontrado');

    const manifest = data as ManifestPayload;
    if (!manifest.project_id || !Number.isFinite(manifest.geometry_version)) {
      return reportFailure(slug, 'proyecto_no_encontrado');
    }
    if (manifest.geometry_version < 1) return reportFailure(slug, 'sin_publicar');

    return {
      project: {
        projectId: manifest.project_id,
        slug: manifest.slug,
        name: manifest.name,
        currency: manifest.currency === 'BOB' ? 'BOB' : 'USD',
        geometryVersion: manifest.geometry_version,
        statusRev: manifest.status_rev ?? 0,
        source: 'db',
      },
      snapshotUrl: `${SUPABASE_URL}/storage/v1/object/public/maps/${manifest.slug}/geometry-v${manifest.geometry_version}.json`,
    };
  } catch (err) {
    return reportFailure(slug, 'sin_conexion', err instanceof Error ? err.message : String(err));
  }
}
