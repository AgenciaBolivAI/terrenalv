// Trae del sistema anterior las ventas: comprador, teléfono, fecha, lote,
// precio y el saldo TAL COMO LO REPORTA la fuente.
//
//   npx tsx scripts/importar-ventas.ts <slug>-ventas.json [--aplicar]
//
// LO QUE NO HACE, A PROPÓSITO: no arma el plan de cuotas.
//
// La página trae totales (monto abonado, deuda total, cuotas faltantes) pero no
// el detalle de las cuotas ni sus vencimientos. Se probó reconstruirlos y los
// números no cierran: sólo el 34 % de los contratos cumple
// `valor_contrato = abonado + deuda`, y ni sumando la cuota inicial mejora
// (5 %). Faltan el interés, las expensas y cómo se imputan los pagos parciales
// — lógica que vive en el sistema de origen, no en esta página.
//
// Inventar un cronograma de 84 cuotas con vencimientos supuestos habría llenado
// la cartera de fechas falsas: el aging, el aviso de mora y las llamadas de
// cobranza saldrían todos de datos que nadie pactó. El cronograma real tiene
// que venir de una exportación del sistema de origen.
//
// Así que cada venta entra con lo que la fuente afirma directamente, y las
// cifras financieras quedan guardadas en `client_meta` como lo que son: lo que
// reportaba el sistema anterior el día de la migración.
import { readFileSync } from 'node:fs';
import { loadEnv, requireEnv } from './env';

loadEnv();
const U = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const K = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

interface Venta {
  idproducto: string;
  idventa: string;
  idcliente: string;
  nombre: string;
  telefono: string | null;
  fecha_venta: string | null;
  estado: string;
  precio: number;
  cuota_inicial: number;
  abonado: number;
  deuda: number;
  contrato: number;
  plazo: number;
  cuotas_faltantes: number | null;
  manzana: string;
  lote: string;
}

async function get<T>(camino: string): Promise<T> {
  const r = await fetch(`${U}/rest/v1/${camino}`, { headers: H });
  if (!r.ok) throw new Error(`${camino}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function main() {
  const archivo = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!archivo) {
    console.error('uso: npx tsx scripts/importar-ventas.ts <slug>-ventas.json [--aplicar]');
    process.exit(2);
  }

  const doc = JSON.parse(readFileSync(archivo, 'utf8')) as { slug: string; ventas: Venta[] };
  const ps = await get<{ id: string; name: string; tracking_prefix: string }[]>(
    `projects?slug=eq.${doc.slug}&select=id,name,tracking_prefix`,
  );
  if (!ps.length) throw new Error(`no existe ${doc.slug}`);
  const proyecto = ps[0];

  // Los lotes ya importados, por manzana+número: es la única forma de atar cada
  // venta a SU lote, porque el id del sistema anterior no existe acá.
  const manzanas = await get<{ id: string; code: string }[]>(
    `manzanas?project_id=eq.${proyecto.id}&select=id,code`,
  );
  const porCodigo = new Map(manzanas.map((m) => [m.code, m.id]));

  const lotesPorClave = new Map<string, string>();
  for (const m of manzanas) {
    const ls = await get<{ id: string; number: string }[]>(
      `lots?manzana_id=eq.${m.id}&deleted_at=is.null&select=id,number`,
    );
    for (const l of ls) lotesPorClave.set(`${m.code}|${l.number}`, l.id);
  }

  let sinLote = 0;
  const listas: { v: Venta; lotId: string }[] = [];
  for (const v of doc.ventas) {
    // El código de manzana lleva la unidad vecinal, igual que en la geometría.
    const uv = /^\d+([A-Z]\d+)/.exec(v.idproducto)?.[1] ?? 'X';
    const code = `M-${uv}-${v.manzana.padStart(2, '0')}`;
    const lotId = lotesPorClave.get(`${code}|${v.lote}`);
    if (!lotId) {
      sinLote++;
      continue;
    }
    listas.push({ v, lotId });
  }

  console.log(`${proyecto.name}`);
  console.log(`  ventas en la fuente : ${doc.ventas.length}`);
  console.log(`  con lote en la base : ${listas.length}`);
  if (sinLote) console.log(`  sin lote (no entran): ${sinLote}`);
  const conDeuda = listas.filter((x) => x.v.deuda > 0).length;
  console.log(`  con saldo pendiente : ${conDeuda}`);
  console.log(`  por cobrar reportado: Bs ${listas.reduce((s, x) => s + x.v.deuda, 0).toLocaleString('es-BO')}`);
  if (!aplicar) {
    console.log('\n(ensayo: no se tocó la base — agregá --aplicar)');
    return;
  }

  let hechas = 0;
  let fallos = 0;
  const errores: string[] = [];

  for (const { v, lotId } of listas) {
    // Sin documento del comprador en la fuente: se guarda una marca visible
    // atada al id de cliente de origen, NUNCA un CI inventado. La oficina lo
    // completa con el contrato en la mano.
    const ciMarcado = `MIGRADO-${v.idcliente}`;
    const cuerpo = {
      project_id: proyecto.id,
      lot_id: lotId,
      tracking_code: `${proyecto.tracking_prefix}-M${v.idventa}`,
      buyer_full_name: v.nombre.trim().slice(0, 120),
      buyer_ci: ciMarcado,
      buyer_ci_normalized: ciMarcado,
      buyer_phone: v.telefono || 's/d',
      buyer_email: null,
      status: 'confirmada',
      price_agreed: v.precio,
      amount_due: Math.max(0, v.cuota_inicial),
      amount_due_currency: 'BOB',
      currency: 'BOB',
      source: 'oficina',
      confirmed_at: v.fecha_venta,
      // Lo que reportaba el sistema anterior. Se guarda como reporte, no como
      // verdad contable: los totales no cierran entre sí.
      client_meta: {
        migrado_de: 'conexion.tierrafuturo.com.bo',
        idventa: v.idventa,
        idcliente: v.idcliente,
        idproducto: v.idproducto,
        estado_origen: v.estado,
        reportado: {
          precio: v.precio,
          cuota_inicial: v.cuota_inicial,
          abonado: v.abonado,
          deuda: v.deuda,
          valor_contrato: v.contrato,
          plazo_meses: v.plazo,
          cuotas_faltantes: v.cuotas_faltantes,
        },
        sin_cronograma:
          'La fuente no trae el detalle de cuotas ni sus vencimientos, y sus totales no cierran ' +
          '(sólo 34 % cumple contrato = abonado + deuda). El plan de pago debe cargarse desde una ' +
          'exportación del sistema de origen.',
      },
    };

    const r = await fetch(`${U}/rest/v1/reservations`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) {
      fallos++;
      if (errores.length < 8) errores.push(`${v.idventa}: ${r.status} ${(await r.text()).slice(0, 140)}`);
      continue;
    }
    const [res] = (await r.json()) as { id: string }[];

    // El lote refleja el estado del sistema anterior.
    await fetch(`${U}/rest/v1/lots?id=eq.${lotId}`, {
      method: 'PATCH',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: v.estado === 'vendido' ? 'vendido' : 'reservado',
        active_reservation_id: res.id,
      }),
    });
    hechas++;
    if (hechas % 100 === 0) process.stdout.write(`  ${hechas}\r`);
  }

  console.log(`\nventas creadas : ${hechas}/${listas.length}`);
  if (fallos) {
    console.log(`fallos         : ${fallos}`);
    for (const e of errores) console.log('  ' + e);
  }
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
