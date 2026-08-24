// Deja anotado, por urbanización, dónde vive el dibujo de su plano y en qué
// escala está, para que el mapa lo pueda poner de fondo.
//
//   npx tsx scripts/registrar-plano.ts <slug> <ruta-en-el-bucket> <m-por-unidad> <vbW> <vbH> <origenX> <origenY>
//
// Va como setting público (is_public) porque el mapa del comprador lo lee sin
// sesión, igual que el plan de pago.
import { loadEnv, requireEnv } from './env';

loadEnv();
const URL_BASE = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const CLAVE = 'plano_fondo';

async function main() {
  const [slug, ruta, escala, vbW, vbH, ox, oy] = process.argv.slice(2);
  if (!slug || !ruta || !escala) {
    console.error('uso: npx tsx scripts/registrar-plano.ts <slug> <ruta> <m/unidad> [vbW vbH ox oy]');
    process.exit(2);
  }

  const ps = (await (
    await fetch(`${URL_BASE}/rest/v1/projects?slug=eq.${slug}&select=id,name`, { headers: H })
  ).json()) as { id: string; name: string }[];
  if (!ps.length) throw new Error(`no existe ${slug}`);
  const proyecto = ps[0];

  const valor = {
    ruta,
    url: `${URL_BASE}/storage/v1/object/public/maps/${ruta}`,
    m_por_unidad: Number(escala),
    viewbox: vbW && vbH ? [0, 0, Number(vbW), Number(vbH)] : null,
    // El origen en unidades de dibujo desde el que se midieron los lotes: sin
    // esto el dibujo y los lotes quedarían desplazados uno respecto del otro.
    origen_unidades: ox && oy ? [Number(ox), Number(oy)] : null,
  };

  // Borrar e insertar: settings no tiene clave única (project_id, key), así que
  // un upsert por conflicto no aplica.
  await fetch(`${URL_BASE}/rest/v1/settings?project_id=eq.${proyecto.id}&key=eq.${CLAVE}`, {
    method: 'DELETE',
    headers: H,
  });
  const r = await fetch(`${URL_BASE}/rest/v1/settings`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: proyecto.id, key: CLAVE, value: valor, is_public: true }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);

  console.log(`${proyecto.name}: ${ruta}  (${valor.m_por_unidad} m/unidad)`);
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
