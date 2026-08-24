// Escribe en la base lo que `importar-plano-web.py` extrajo del sistema
// anterior: manzanas, lotes, superficies, precios y estado de venta.
//
//   npx tsx scripts/aplicar-plano.ts <slug>-import.json [--aplicar]
//
// Sin --aplicar solo informa. Es idempotente: `save_manzana` y `save_lots`
// actualizan por código y por número, así que correrlo dos veces no duplica.
//
// Va por los RPC y no por INSERT directo aunque la clave de servicio permita
// las dos cosas: los RPC validan que el lote caiga dentro de su manzana,
// llevan el versionado y dejan rastro en auditoría. Un INSERT directo se
// saltaría las tres cosas.
import { readFileSync } from 'node:fs';
import { loadEnv, requireEnv } from './env';

loadEnv();

const URL_BASE = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

interface Lote {
  number: string;
  ring: number[][];
  area_m2: number;
  frontage_m: number | null;
  depth_m: number | null;
  is_corner: boolean;
  is_manual_geom: boolean;
  needs_review: boolean;
  precio: number | null;
  vendido: boolean;
}
interface Manzana {
  code: string;
  ring: number[][];
  lots: Lote[];
}
interface Payload {
  slug: string;
  escala_m_por_unidad: number;
  manzanas: Manzana[];
}

async function rpc<T>(nombre: string, args: unknown): Promise<T> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${txt.slice(0, 300)}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

async function main() {
  const archivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!archivo) {
    console.error('uso: npx tsx scripts/aplicar-plano.ts <slug>-import.json [--aplicar]');
    process.exit(2);
  }

  const p = JSON.parse(readFileSync(archivo, 'utf8')) as Payload;
  const proyectos = (await (
    await fetch(`${URL_BASE}/rest/v1/projects?slug=eq.${p.slug}&select=id,name,slug`, { headers: H })
  ).json()) as { id: string; name: string }[];
  if (!proyectos.length) throw new Error(`no existe la urbanización ${p.slug}`);
  const proyecto = proyectos[0];

  const totalLotes = p.manzanas.reduce((s, m) => s + m.lots.length, 0);
  console.log(`${proyecto.name}  (${p.slug})`);
  console.log(`  escala   ${p.escala_m_por_unidad} m/unidad`);
  console.log(`  manzanas ${p.manzanas.length}`);
  console.log(`  lotes    ${totalLotes}`);
  if (!aplicar) {
    console.log('\n(ensayo: no se tocó la base — agregá --aplicar)');
    return;
  }

  let hechas = 0;
  let hechos = 0;
  let conPrecio = 0;
  const fallos: string[] = [];

  for (const mz of p.manzanas) {
    let manzanaId: string;
    try {
      const r = await rpc<{ id: string }>('save_manzana', {
        p_project_id: proyecto.id,
        p_code: mz.code,
        p_kind: 'residencial',
        p_sector: null,
        p_ring: mz.ring,
      });
      manzanaId = r.id;
      hechas++;
    } catch (e) {
      fallos.push(`manzana ${mz.code}: ${(e as Error).message}`);
      continue;
    }

    try {
      await rpc('save_lots', {
        p_manzana_id: manzanaId,
        p_lots: mz.lots.map((l) => ({
          number: l.number,
          ring: l.ring,
          area_m2: l.area_m2,
          frontage_m: l.frontage_m,
          depth_m: l.depth_m,
          is_corner: l.is_corner,
          is_manual_geom: true,
          // La forma es un rectángulo del área correcta, no el polígono del
          // levantamiento: queda marcado para que nadie lo tome por definitivo.
          needs_review: true,
        })),
        p_replace_missing: false,
      });
      hechos += mz.lots.length;
    } catch (e) {
      fallos.push(`lotes de ${mz.code}: ${(e as Error).message}`);
      continue;
    }

    // Precio por lote: el sistema anterior lo lleva por lote, no por categoría,
    // así que va como price_override y no tocando las categorías del proyecto.
    const conP = mz.lots.filter((l) => l.precio && l.precio > 0);
    for (const l of conP) {
      const r = await fetch(
        `${URL_BASE}/rest/v1/lots?manzana_id=eq.${manzanaId}&number=eq.${encodeURIComponent(l.number)}`,
        {
          method: 'PATCH',
          headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ price_override: l.precio }),
        },
      );
      if (r.ok) conPrecio++;
    }
    process.stdout.write(`  ${mz.code}: ${mz.lots.length} lotes\r`);
  }

  console.log(`\n\nmanzanas creadas : ${hechas}/${p.manzanas.length}`);
  console.log(`lotes guardados  : ${hechos}/${totalLotes}`);
  console.log(`con precio       : ${conPrecio}`);
  if (fallos.length) {
    console.log(`\nfallos (${fallos.length}):`);
    for (const f of fallos.slice(0, 12)) console.log('  ' + f);
  }
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
