// Vuelca al repo el SQL real de las migraciones aplicadas contra la base.
//
// Por qué existe: varias migraciones se aplicaron directo contra Supabase y en
// el repo quedó sólo un archivo de notas describiéndolas. Con eso el repo no
// puede reconstruir la base — faltan tablas, funciones y vistas enteras. La
// base guarda el SQL de cada migración, así que se recupera exactamente lo que
// se ejecutó.
//
// Sólo escribe los archivos que faltan: nunca pisa uno que ya está en el repo.
//
// Usa fetch directo y no supabase-js porque el cliente arranca el módulo de
// realtime, que en Node 20 no tiene WebSocket nativo y revienta al importarse.
import { existsSync, writeFileSync } from 'node:fs';
import { loadEnv, requireEnv } from './env';

loadEnv();

const DIR = 'supabase/migrations';

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${url}/rest/v1/rpc/_dump_migrations`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!res.ok) {
    console.error(`No se pudo leer las migraciones: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const rows = (await res.json()) as { version: string; name: string; sql: string }[];
  let escritos = 0;

  for (const r of rows) {
    const file = `${DIR}/${r.version}_${r.name}.sql`;
    if (existsSync(file)) continue;
    writeFileSync(file, `${r.sql.trimEnd().replace(/;$/, '')};\n`, 'utf8');
    console.log(`escrito ${file} (${r.sql.length} car.)`);
    escritos++;
  }

  console.log(`${escritos} archivo(s) nuevo(s); la base tiene ${rows.length} migraciones`);
}

void main();
