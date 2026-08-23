// Todo lo que tiene que pasar ANTES de desplegar.
//
//   npx tsx scripts/predeploy.ts
//
// Corre en orden de más barato a más caro, y se detiene en el primer fallo:
// no tiene sentido esperar tres minutos de build para enterarse de un error de
// tipos que tardaba diez segundos en aparecer.
//
// La verificación contra la base va ANTES del build a propósito. Un build
// verde con la contabilidad descuadrada es un despliegue que rompe la empresa
// en silencio; al revés, un dato malo detectado a tiempo cuesta un minuto.
//
// Usa fetch y no supabase-js porque el cliente arranca el módulo de realtime,
// que en Node 20 no tiene WebSocket nativo y revienta al importarse.
import { spawnSync } from 'node:child_process';
import { loadEnv, requireEnv } from './env';

loadEnv();

const OK = '✓';
const NO = '✗';

let fallos = 0;

function paso(nombre: string, cmd: string, args: string[]): boolean {
  process.stdout.write(`\n── ${nombre}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  const ok = r.status === 0;
  if (!ok) fallos++;
  process.stdout.write(`${ok ? OK : NO} ${nombre}${ok ? '' : ` (salida ${r.status})`}\n`);
  return ok;
}

interface Check {
  prueba: string;
  ok: boolean;
  detalle: string;
}

async function integridad(): Promise<boolean> {
  process.stdout.write('\n── Integridad de datos (base real)\n');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${url}/rest/v1/rpc/verificar_integridad`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    process.stdout.write(`${NO} no se pudo consultar: ${res.status} ${await res.text()}\n`);
    fallos++;
    return false;
  }

  const checks = (await res.json()) as Check[];
  let malos = 0;
  for (const c of checks) {
    if (c.ok) {
      process.stdout.write(`  ${OK} ${c.prueba}\n`);
    } else {
      malos++;
      process.stdout.write(`  ${NO} ${c.prueba} — ${c.detalle}\n`);
    }
  }
  // Cero pruebas es un fallo: significa que la función no existe o no devolvió
  // nada, no que todo esté bien.
  if (checks.length === 0) {
    process.stdout.write(`${NO} la suite no devolvió ninguna prueba\n`);
    fallos++;
    return false;
  }
  if (malos > 0) fallos++;
  process.stdout.write(`${malos === 0 ? OK : NO} ${checks.length - malos}/${checks.length} pruebas de integridad\n`);
  return malos === 0;
}

async function main() {
  const t0 = Date.now();
  process.stdout.write('Verificación previa al despliegue — Terrenalv\n');

  paso('Tipos (tsc)', 'npx', ['tsc', '--noEmit']);
  paso('Lint (eslint)', 'npx', ['eslint', 'src', 'scripts']);
  paso('Pruebas unitarias (vitest)', 'npx', ['vitest', 'run']);
  await integridad();

  // El build es lo más caro: solo si todo lo anterior pasó.
  if (fallos === 0) {
    paso('Build de producción', 'npm', ['run', 'build']);
  } else {
    process.stdout.write('\n── Build de producción\n');
    process.stdout.write('  omitido: hay fallos que arreglar primero\n');
  }

  const seg = ((Date.now() - t0) / 1000).toFixed(0);
  process.stdout.write(`\n${'─'.repeat(52)}\n`);
  if (fallos === 0) {
    process.stdout.write(`${OK} Todo en orden en ${seg}s. Listo para desplegar.\n`);
    process.exit(0);
  }
  process.stdout.write(`${NO} ${fallos} etapa(s) con fallos (${seg}s). NO desplegar.\n`);
  process.exit(1);
}

void main();
