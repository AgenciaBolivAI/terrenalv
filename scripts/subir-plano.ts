// Sube el dibujo del plano al bucket público `maps`, junto al snapshot de
// geometría, y deja anotado en el proyecto dónde quedó.
//
//   npx tsx scripts/subir-plano.ts <slug> <archivo.svg>
//
// Va al bucket y no al repo porque son megabytes de dibujo que el navegador
// tiene que poder cachear: servidos desde la CDN se bajan una vez y quedan.
// La ruta lleva un número de versión para poder cachear para siempre — si el
// plano se corrige, cambia la ruta y nadie se queda con el viejo.
import { readFileSync } from 'node:fs';
import { loadEnv, requireEnv } from './env';

loadEnv();
const URL_BASE = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const BUCKET = 'maps';

async function main() {
  const [slug, archivo] = process.argv.slice(2);
  if (!slug || !archivo) {
    console.error('uso: npx tsx scripts/subir-plano.ts <slug> <archivo.svg>');
    process.exit(2);
  }

  const proyectos = (await (
    await fetch(`${URL_BASE}/rest/v1/projects?slug=eq.${slug}&select=id,name,geometry_version`, {
      headers: H,
    })
  ).json()) as { id: string; name: string; geometry_version: number }[];
  if (!proyectos.length) throw new Error(`no existe la urbanización ${slug}`);
  const proyecto = proyectos[0];

  const svg = readFileSync(archivo);
  const version = (proyecto.geometry_version ?? 0) + 1;
  const ruta = `${slug}/plano-v${version}.svg`;

  const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    },
    body: svg,
  });
  if (!up.ok) throw new Error(`subida: ${up.status} ${await up.text()}`);

  const publica = `${URL_BASE}/storage/v1/object/public/${BUCKET}/${ruta}`;
  const comprobar = await fetch(publica, { method: 'HEAD' });

  console.log(`${proyecto.name}`);
  console.log(`  ${(svg.length / 1024).toFixed(0)} KB -> ${ruta}`);
  console.log(`  ${publica}`);
  console.log(`  comprobación pública: HTTP ${comprobar.status}`);
  if (!comprobar.ok) {
    console.error('  el archivo no se sirve públicamente: el mapa no podría leerlo');
    process.exit(1);
  }
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
