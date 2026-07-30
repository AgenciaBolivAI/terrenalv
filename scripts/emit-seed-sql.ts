// Emits per-manzana SQL files (seed/sql/NN_<code>.sql) that push the generated
// geometry through the SAME RPCs the Map Builder uses. Each file is one
// self-contained batch runnable via the Supabase MCP execute_sql tool (which has
// no JWT, so it first sets a service_role claim for private.is_service()).
// Run: npx tsx scripts/emit-seed-sql.ts

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'seed', 'sql');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

interface SeedGeometry {
  manzanas: {
    code: string;
    sector: string;
    kind: string;
    ring: [number, number][];
    subdivision_spec: Record<string, unknown> | null;
    needs_review: boolean;
    lots: Record<string, unknown>[];
  }[];
  elements: { kind: string; name: string; ring: [number, number][]; props: Record<string, unknown> }[];
}

const geometry: SeedGeometry = JSON.parse(
  readFileSync(join(root, 'seed', 'generated-geometry.json'), 'utf8'),
);

const CLAIM = `select set_config('request.jwt.claims', '{"role":"service_role"}', false);`;

const jsonLit = (v: unknown) => `$json$${JSON.stringify(v)}$json$::jsonb`;

let n = 0;
const pad = (i: number) => String(i).padStart(2, '0');

for (const mz of geometry.manzanas) {
  n++;
  const lots = mz.lots.map((l) => ({ ...l, needs_review: true }));
  const sql = `${CLAIM}
do $seed$
declare
  v_project uuid;
  v_id uuid;
begin
  select id into v_project from public.projects where slug = 'prados-del-sur';
  if v_project is null then raise exception 'proyecto no encontrado'; end if;
  v_id := ((public.save_manzana(
    v_project,
    ${sqlStr(mz.code)},
    ${sqlStr(mz.kind)}::public.manzana_kind,
    ${sqlStr(mz.sector)},
    ${jsonLit(mz.ring)},
    ${mz.subdivision_spec ? jsonLit(mz.subdivision_spec) : 'null'}
  ))->>'id')::uuid;
${lots.length ? `  perform public.save_lots(v_id, ${jsonLit(lots)}, false);` : ''}
  update public.manzanas set needs_review = ${mz.needs_review} where id = v_id;
end $seed$;
select '${mz.code} ok' as resultado;`;
  writeFileSync(join(outDir, `${pad(n)}_${mz.code.replace(/[^A-Za-z0-9-]/g, '')}.sql`), sql);
}

n++;
writeFileSync(
  join(outDir, `${pad(n)}_elements.sql`),
  `${CLAIM}
do $seed$
declare v_project uuid;
begin
  select id into v_project from public.projects where slug = 'prados-del-sur';
  perform public.save_map_elements(v_project, ${jsonLit(
    geometry.elements.map((e) => ({ kind: e.kind, name: e.name, ring: e.ring, props: e.props })),
  )});
end $seed$;
select 'elements ok' as resultado;`,
);

n++;
writeFileSync(
  join(outDir, `${pad(n)}_publish.sql`),
  `${CLAIM}
do $seed$
declare v_project uuid; v_snapshot jsonb;
begin
  select id into v_project from public.projects where slug = 'prados-del-sur';
  v_snapshot := public.publish_geometry(v_project);
  raise notice 'published v%', v_snapshot->>'v';
end $seed$;
select p.geometry_version,
       (select count(*) from public.manzanas m where m.project_id = p.id) as manzanas,
       (select count(*) from public.lots l where l.project_id = p.id and l.deleted_at is null) as lotes,
       (select count(*) from public.map_elements e where e.project_id = p.id) as elementos
from public.projects p where p.slug = 'prados-del-sur';`,
);

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

console.log(`${n} archivos SQL en seed/sql/`);
