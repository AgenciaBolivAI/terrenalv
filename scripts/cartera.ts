// Cartera por urbanización: ventas, valor colocado y el saldo que reportaba el
// sistema anterior.
//
//   npx tsx scripts/cartera.ts
//
// Lee de `reservations` y no de las vistas v_an_*: esas usan private.to_bob y
// service_role no tiene USAGE sobre el esquema `private`, así que un script con
// la clave de servicio no puede leerlas. La app sí — la usa un usuario
// `authenticated`, que sí tiene el permiso (comprobado con una sesión real).
import { loadEnv, requireEnv } from './env';

loadEnv();
const U = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const K = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, Authorization: `Bearer ${K}` };
const bs = (n: number) => 'Bs ' + Math.round(n).toLocaleString('es-BO');

interface Res {
  project_id: string;
  price_agreed: number | string;
  confirmed_at: string | null;
  client_meta: { reportado?: { deuda?: number; abonado?: number } } | null;
}

/** PostgREST corta en 1000 filas por defecto: hay que paginar o se pierde el resto. */
async function todas(camino: string): Promise<Res[]> {
  const out: Res[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${U}/rest/v1/${camino}`, {
      headers: { ...H, Range: `${desde}-${desde + 999}` },
    });
    const lote = (await r.json()) as Res[];
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

async function main() {
  const proyectos = (await (
    await fetch(`${U}/rest/v1/projects?select=id,name&order=name`, { headers: H })
  ).json()) as { id: string; name: string }[];

  const res = await todas(
    'reservations?select=project_id,price_agreed,confirmed_at,client_meta&status=eq.confirmada',
  );

  console.log('urbanización          ventas    valor colocado      saldo reportado   últ. venta');
  console.log('─'.repeat(86));
  let tv = 0;
  let tc = 0;
  let td = 0;
  for (const p of proyectos) {
    const mias = res.filter((r) => r.project_id === p.id);
    if (!mias.length) continue;
    const valor = mias.reduce((a, r) => a + Number(r.price_agreed), 0);
    const deuda = mias.reduce((a, r) => a + Number(r.client_meta?.reportado?.deuda ?? 0), 0);
    const ult = mias
      .map((r) => r.confirmed_at?.slice(0, 10) ?? '')
      .sort()
      .pop();
    tv += mias.length;
    tc += valor;
    td += deuda;
    console.log(
      p.name.padEnd(20) +
        String(mias.length).padStart(7) +
        bs(valor).padStart(18) +
        bs(deuda).padStart(20) +
        '   ' +
        (ult || '—'),
    );
  }
  console.log('─'.repeat(86));
  console.log(`TOTAL${String(tv).padStart(22)}${bs(tc).padStart(18)}${bs(td).padStart(20)}`);
}

void main();
