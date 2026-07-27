// Pushes seed/generated-geometry.json into the live database through the SAME
// RPCs the Map Builder uses (save_manzana / save_lots / save_map_elements),
// publishes, and uploads the client snapshot to Storage.
// Run: npx tsx scripts/seed-geometry.ts
// Idempotent: re-running upserts by (project, code) / (manzana, number).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(url, key, { auth: { persistSession: false } });

const SLUG = 'estrellas-del-sur';

interface SeedLot {
  number: string;
  ring: [number, number][];
  frontage_m: number;
  depth_m: number;
  area_m2: number;
  is_corner: boolean;
}
interface SeedManzana {
  code: string;
  sector: string;
  kind: string;
  ring: [number, number][];
  subdivision_spec: Record<string, unknown> | null;
  needs_review: boolean;
  lots: SeedLot[];
}
interface SeedGeometry {
  manzanas: SeedManzana[];
  elements: { kind: string; name: string; ring: [number, number][]; props: Record<string, unknown> }[];
}

async function main() {
  const geometry: SeedGeometry = JSON.parse(
    readFileSync(join(process.cwd(), 'seed', 'generated-geometry.json'), 'utf8'),
  );

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, slug, geometry_version')
    .eq('slug', SLUG)
    .single();
  if (projErr || !project) {
    console.error('Proyecto no encontrado — ¿se aplicó la migración de bootstrap?', projErr?.message);
    process.exit(1);
  }
  console.log(`Proyecto ${project.slug} (${project.id})`);

  let lotTotal = 0;
  for (const mz of geometry.manzanas) {
    const { data: saved, error } = await supabase.rpc('save_manzana', {
      p_project_id: project.id,
      p_code: mz.code,
      p_kind: mz.kind,
      p_sector: mz.sector,
      p_ring: mz.ring,
      p_spec: mz.subdivision_spec,
    });
    if (error) {
      console.error(`save_manzana ${mz.code}:`, error.message);
      process.exit(1);
    }
    const manzanaId = (saved as { id: string }).id;

    if (mz.lots.length) {
      const { error: lotsErr } = await supabase.rpc('save_lots', {
        p_manzana_id: manzanaId,
        p_lots: mz.lots.map((l) => ({ ...l, needs_review: true })),
        p_replace_missing: false,
      });
      if (lotsErr) {
        console.error(`save_lots ${mz.code}:`, lotsErr.message);
        process.exit(1);
      }
      lotTotal += mz.lots.length;
    }

    await supabase.from('manzanas').update({ needs_review: mz.needs_review }).eq('id', manzanaId);
    console.log(`  ${mz.code}: ${mz.lots.length} lotes`);
  }

  const { error: elemErr } = await supabase.rpc('save_map_elements', {
    p_project_id: project.id,
    p_elements: geometry.elements.map((e) => ({
      kind: e.kind,
      name: e.name,
      ring: e.ring,
      props: e.props,
    })),
  });
  if (elemErr) {
    console.error('save_map_elements:', elemErr.message);
    process.exit(1);
  }

  console.log('Publicando geometría…');
  const { data: snapshot, error: pubErr } = await supabase.rpc('publish_geometry', {
    p_project_id: project.id,
  });
  if (pubErr) {
    console.error('publish_geometry:', pubErr.message);
    process.exit(1);
  }
  const version = (snapshot as { v: number }).v;

  const path = `${SLUG}/geometry-v${version}.json`;
  const { error: upErr } = await supabase.storage
    .from('maps')
    .upload(path, JSON.stringify(snapshot), {
      contentType: 'application/json',
      cacheControl: '31536000',
      upsert: true,
    });
  if (upErr) {
    console.error('subida del snapshot:', upErr.message);
    process.exit(1);
  }

  console.log(`Listo: ${geometry.manzanas.length} manzanas, ${lotTotal} lotes, snapshot maps/${path} (v${version})`);
}

main();
