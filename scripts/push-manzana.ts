// Re-push ONE manzana's outline from seed/generated-geometry.json, then publish.
//
// For fixes that touch a single block (M-77's boundary), re-running the full
// seed would re-upsert 2 035 lots for no reason — and there is a live
// reservation on M-59/26.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/push-manzana.ts M-77

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

interface SeedManzana {
  code: string;
  kind: string;
  sector: string;
  ring: number[][];
  subdivision_spec: Record<string, unknown> | null;
  needs_review: boolean;
  lots: unknown[];
}

async function main() {
  const codes = process.argv.slice(2);
  if (!codes.length) {
    console.error('uso: push-manzana.ts M-77 [M-78 ...]');
    process.exit(1);
  }

  const geometry = JSON.parse(
    readFileSync(join(process.cwd(), 'seed', 'generated-geometry.json'), 'utf8'),
  ) as { manzanas: SeedManzana[] };

  const { data: project, error: projErr } = await supabase
    .from('projects').select('id').eq('slug', SLUG).single();
  if (projErr || !project) {
    console.error('Proyecto no encontrado:', projErr?.message);
    process.exit(1);
  }

  for (const code of codes) {
    const mz = geometry.manzanas.find((m) => m.code === code);
    if (!mz) {
      console.error(`${code} no está en el seed`);
      process.exit(1);
    }
    const { data: saved, error } = await supabase.rpc('save_manzana', {
      p_project_id: project.id,
      p_code: mz.code,
      p_kind: mz.kind,
      p_sector: mz.sector,
      p_ring: mz.ring,
      p_spec: mz.subdivision_spec,
    });
    if (error) {
      console.error(`save_manzana ${code}:`, error.message);
      process.exit(1);
    }
    await supabase.from('manzanas')
      .update({ needs_review: mz.needs_review })
      .eq('id', (saved as { id: string }).id);
    console.log(`${code}: ${mz.ring.length} vértices, needs_review=${mz.needs_review}`);
  }

  const { data: snapshot, error: pubErr } = await supabase.rpc('publish_geometry', {
    p_project_id: project.id,
  });
  if (pubErr) {
    console.error('publish_geometry:', pubErr.message);
    process.exit(1);
  }
  const version = (snapshot as { v: number }).v;
  const { error: upErr } = await supabase.storage
    .from('maps')
    .upload(`${SLUG}/geometry-v${version}.json`, JSON.stringify(snapshot), {
      contentType: 'application/json',
      cacheControl: '31536000',
      upsert: true,
    });
  if (upErr) {
    console.error('subida del snapshot:', upErr.message);
    process.exit(1);
  }
  console.log(`Publicado v${version}`);
}

void main();
