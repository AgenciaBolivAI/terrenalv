// Estado de cada urbanización: lotes, precios, y las pruebas de integridad.
//
//   npx tsx scripts/estado-urbanizaciones.ts
//
// Existe porque después de una importación grande hay que mirar la base y no
// el log del importador: el importador dice lo que CREE que hizo.
import { loadEnv, requireEnv } from './env';

loadEnv();
const URL_BASE = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function get<T>(camino: string): Promise<T> {
  const r = await fetch(`${URL_BASE}/rest/v1/${camino}`, { headers: H });
  if (!r.ok) throw new Error(`${camino}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function main() {
  const proyectos = await get<{ project_id: string; name: string; lotes: number; sin_precio: number }[]>(
    'v_an_por_proyecto?select=project_id,name,lotes,sin_precio&order=name',
  );

  console.log('urbanización            lotes   manzanas   sin precio');
  console.log('─'.repeat(58));
  for (const p of proyectos) {
    const mz = await get<{ id: string }[]>(`manzanas?project_id=eq.${p.project_id}&select=id`);
    console.log(
      `${p.name.padEnd(22)} ${String(p.lotes).padStart(6)}   ${String(mz.length).padStart(8)}   ${String(p.sin_precio).padStart(10)}`,
    );
  }

  const checks = await (
    await fetch(`${URL_BASE}/rest/v1/rpc/verificar_integridad`, {
      method: 'POST',
      headers: H,
      body: '{}',
    })
  ).json();
  const malas = (checks as { prueba: string; ok: boolean; detalle: string }[]).filter((c) => !c.ok);
  console.log(
    `\nintegridad: ${(checks as unknown[]).length - malas.length}/${(checks as unknown[]).length} pruebas`,
  );
  for (const m of malas) console.log(`  ✗ ${m.prueba} — ${m.detalle}`);
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
