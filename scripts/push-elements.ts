// Push ONLY the map elements from seed/generated-geometry.json, then publish.
//
// Exists because re-running seed-geometry.ts re-upserts all 2 035 lots to fix a
// streets-only problem — pointless risk with a live reservation on M-59/26.
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/push-elements.ts
//
// save_map_elements UPSERTS, it does not replace, and nothing in it matches an
// incoming ring to an existing row — so a second push stacks a duplicate set on
// top of the old one. This used to be a comment telling the operator to delete
// the stale rows by hand; it got missed twice (once leaving the map with the
// old invented streets, once leaving 18 elements where there should be 10), so
// the delete now happens here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const SLUG = 'prados-del-sur';

async function main() {
  const geometry = JSON.parse(
    readFileSync(join(process.cwd(), 'seed', 'generated-geometry.json'), 'utf8'),
  ) as { elements: { kind: string; name: string; ring: number[][]; props: unknown }[] };

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, slug')
    .eq('slug', SLUG)
    .single();
  if (projErr || !project) {
    console.error('Proyecto no encontrado:', projErr?.message);
    process.exit(1);
  }

  // Replace, don't accumulate. Elements are pure geometry from the CAD —
  // nothing references them, so deleting is safe (unlike lots, which carry
  // reservations and go through reseed-safe.ts).
  const { error: delErr, count: deleted } = await supabase
    .from('map_elements')
    .delete({ count: 'exact' })
    .eq('project_id', project.id);
  if (delErr) {
    console.error('borrado de elementos previos:', delErr.message);
    process.exit(1);
  }
  console.log(`elementos previos borrados: ${deleted}`);

  const { error: elemErr } = await supabase.rpc('save_map_elements', {
    p_project_id: project.id,
    p_elements: geometry.elements.map((e) => ({
      kind: e.kind,
      name: e.name,
      ring: e.ring,
      props: e.props ?? {},
    })),
  });
  if (elemErr) {
    console.error('save_map_elements:', elemErr.message);
    process.exit(1);
  }
  console.log(`${geometry.elements.length} elementos guardados`);

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
  console.log(`Publicado v${version} (maps/${path})`);
}

void main();
