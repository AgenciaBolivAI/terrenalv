// Datos de DEMOSTRACIÓN para que el panel se pueda mirar y entender.
//
//   npx tsx scripts/seed-demo.ts            (ensayo: dice qué haría)
//   npx tsx scripts/seed-demo.ts --aplicar
//
// Por qué existe: con las urbanizaciones vacías, media pantalla del panel es un
// estado vacío y no se puede ver si algo funciona. Con miles de filas
// importadas de un sistema ajeno, tampoco: nadie distingue lo que probó de lo
// que es real. Esto siembra POCO y OBVIAMENTE de prueba — nombres de ejemplo,
// pocos lotes — pero cubre todos los caminos que las pantallas muestran:
// venta directa, reserva que se confirmó, venta con plan de cuotas al día,
// venta con cuotas vencidas, y cobros en efectivo, QR y dólares.
//
// Es idempotente por proyecto: si la urbanización ya tiene manzanas, no la
// vuelve a sembrar. Para re-sembrar, borrá antes sus datos.
//
// TODO lo que crea lleva el prefijo DEMO en la nota de auditoría y nombres
// evidentemente de ejemplo, para que nadie los confunda con compradores reales.
import { loadEnv, requireEnv } from './env';

loadEnv();
const U = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const K = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

const APLICAR = process.argv.includes('--aplicar');

/** Compradores de ejemplo. Nombres claramente inventados, a propósito. */
// UN COMPRADOR POR VENTA. Antes eran seis nombres repartidos con módulo entre
// las seis urbanizaciones, así que la misma persona terminaba dueña de cuatro
// lotes en cuatro proyectos y la pantalla de Clientes mostraba puros
// multi-compradores. Hay uno por cada venta sembrada (6 proyectos × 3), y el
// caso «varios lotes» se siembra a propósito más abajo, no por accidente.
const COMPRADORES = [
  { nombre: 'María Fernanda Quiroga', ci: '8123456', tel: '70011001' },
  { nombre: 'Carlos Villarroel Peña', ci: '8123457', tel: '70011002' },
  { nombre: 'Ana Lucía Mendoza', ci: '8123458', tel: '70011003' },
  { nombre: 'Jorge Antonio Salazar', ci: '8123459', tel: '70011004' },
  { nombre: 'Rosa Elena Chávez', ci: '8123460', tel: '70011005' },
  { nombre: 'Luis Alberto Terceros', ci: '8123461', tel: '70011006' },
  { nombre: 'Sergio Daniel Peredo', ci: '8341201', tel: '70120101' },
  { nombre: 'Gabriela Ortiz Camacho', ci: '8341202', tel: '70120102' },
  { nombre: 'Iván Rodrigo Zeballos', ci: '8341203', tel: '70120103' },
  { nombre: 'Carla Beatriz Montaño', ci: '8341204', tel: '70120104' },
  { nombre: 'Freddy Wilson Aramayo', ci: '8341205', tel: '70120105' },
  { nombre: 'Silvia Roxana Ledezma', ci: '8341206', tel: '70120106' },
  { nombre: 'Ramiro Ernesto Vaca', ci: '8341207', tel: '70120107' },
  { nombre: 'Nayra Alejandra Choque', ci: '8341208', tel: '70120108' },
  { nombre: 'Óscar Fernando Rojas', ci: '8341209', tel: '70120109' },
  { nombre: 'Daniela Paz Arandia', ci: '8341210', tel: '70120110' },
  { nombre: 'Hugo Marcelo Suárez', ci: '8341211', tel: '70120111' },
  { nombre: 'Elena Mariela Coca', ci: '8341212', tel: '70120112' },
];

/** El comprador de la venta n de la urbanización idx: uno distinto cada vez. */
function compradorDe(idx: number, n: number) {
  const i = idx * 3 + n;
  if (i >= COMPRADORES.length) {
    throw new Error(
      `Faltan compradores de ejemplo: hacen falta ${i + 1} y hay ${COMPRADORES.length}.`,
    );
  }
  return COMPRADORES[i];
}

interface Proyecto {
  id: string;
  name: string;
  slug: string;
  tracking_prefix: string;
}

async function rest<T>(camino: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${U}/rest/v1/${camino}`, { ...init, headers: { ...H, ...init?.headers } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${camino}: ${r.status} ${t.slice(0, 300)}`);
  return (t ? JSON.parse(t) : null) as T;
}

/** Un rectángulo de `ancho`×`fondo` metros con su esquina en (x, y). */
function rect(x: number, y: number, ancho: number, fondo: number): number[][] {
  return [
    [x, y],
    [x + ancho, y],
    [x + ancho, y + fondo],
    [x, y + fondo],
  ];
}

/**
 * Dos manzanas de diez lotes cada una, en una cuadrícula simple.
 *
 * No pretende ser un plano: es geometría suficiente para que el mapa dibuje
 * algo, los lotes se puedan clicar y las pantallas tengan filas. El plano de
 * verdad entra por el lector de planos cuando el topógrafo lo entregue.
 */
function manzanaDemo(indice: number) {
  const baseX = indice * 220;
  const lotes = Array.from({ length: 10 }, (_, i) => {
    const col = i % 5;
    const fila = Math.floor(i / 5);
    const x = baseX + col * 15;
    const y = fila * 25;
    return {
      number: String(i + 1),
      ring: rect(x, y, 15, 20),
      area_m2: 300,
      frontage_m: 15,
      depth_m: 20,
      is_corner: col === 0 || col === 4,
      is_manual_geom: true,
      needs_review: false,
    };
  });
  // El anillo de la manzana envuelve sus lotes con un metro de holgura.
  const ring = rect(baseX - 1, -1, 5 * 15 + 2, 2 * 25 + 2);
  return { code: `M-${String(indice + 1).padStart(2, '0')}`, ring, lotes };
}

async function sembrarProyecto(p: Proyecto, idx: number) {
  // Geometría y ventas se deciden por separado: Prados del Sur ya tiene su
  // plano real del CAD —eso no se toca— pero se quedó sin ventas, y una
  // pantalla sin filas tampoco deja ver si algo funciona.
  const mzExistentes = await rest<{ id: string }[]>(
    `manzanas?project_id=eq.${p.id}&select=id&limit=1`,
  );
  const ventasExistentes = await rest<{ id: string }[]>(
    `reservations?project_id=eq.${p.id}&select=id&limit=1`,
  );
  const sembrarGeometria = mzExistentes.length === 0;
  const sembrarVentas = ventasExistentes.length === 0;

  if (!sembrarGeometria && !sembrarVentas) {
    console.log(`  ${p.name}: ya tiene geometría y ventas — se deja como está`);
    return;
  }

  if (!APLICAR) {
    const partes = [
      sembrarGeometria ? '2 manzanas y 20 lotes' : 'conserva su plano',
      sembrarVentas ? '3 ventas de ejemplo' : 'conserva sus ventas',
    ];
    console.log(`  ${p.name}: ${partes.join(' · ')}`);
    return;
  }

  // ---- geometría -----------------------------------------------------------
  const lotIds: { id: string; number: string; mz: string }[] = [];
  for (let i = 0; sembrarGeometria && i < 2; i++) {
    const mz = manzanaDemo(i);
    const res = await rest<{ id: string }>(`rpc/save_manzana`, {
      method: 'POST',
      body: JSON.stringify({
        p_project_id: p.id,
        p_code: mz.code,
        p_kind: 'residencial',
        p_sector: null,
        p_ring: mz.ring,
      }),
    });
    await rest(`rpc/save_lots`, {
      method: 'POST',
      body: JSON.stringify({ p_manzana_id: res.id, p_lots: mz.lotes, p_replace_missing: false }),
    });
    const creados = await rest<{ id: string; number: string }[]>(
      `lots?manzana_id=eq.${res.id}&select=id,number&order=number`,
    );
    for (const l of creados) lotIds.push({ id: l.id, number: l.number, mz: mz.code });
  }

  // Sin geometría nueva, las ventas se apoyan en lotes disponibles que ya
  // existen (el caso de Prados del Sur y su plano real).
  if (!sembrarGeometria) {
    const libres = await rest<{ id: string; number: string }[]>(
      `lots?project_id=eq.${p.id}&status=eq.disponible&deleted_at=is.null&select=id,number&limit=9`,
    );
    for (const l of libres) lotIds.push({ id: l.id, number: l.number, mz: '' });
  }

  if (!sembrarVentas) {
    console.log(`  ${p.name}: geometría sembrada; ya tenía ventas`);
    return;
  }

  // Precio: se fija por lote para no depender de las categorías del proyecto.
  const precio = 30000 + idx * 5000;
  for (const l of lotIds) {
    if (!sembrarGeometria) break; // no se re-tarifa un lote que ya tiene precio
    await rest(`lots?id=eq.${l.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ price_override: precio }),
    });
  }

  // ---- tres ventas que cubren los caminos que muestran las pantallas -------
  const hoy = new Date();
  const hace = (dias: number) =>
    new Date(hoy.getTime() - dias * 86400000).toISOString().slice(0, 10);

  const casos = [
    { c: compradorDe(idx, 0), origen: 'oficina_directa', dias: 40, forma: 'efectivo', plan: true, atraso: false },
    { c: compradorDe(idx, 1), origen: 'oficina_reserva', dias: 90, forma: 'manual_qr', plan: true, atraso: true },
    // Un solo comprador con dos lotes, y a propósito: en la vida real existen,
    // y el filtro «Varios lotes» de Clientes necesita un caso que mostrar.
    {
      c: idx === 1 ? compradorDe(0, 2) : compradorDe(idx, 2),
      origen: 'oficina_directa',
      dias: 10,
      forma: 'efectivo',
      plan: false,
      atraso: false,
    },
  ];

  let n = 0;
  for (const caso of casos) {
    const lote = lotIds[n * 3];
    if (!lote) break;
    const codigo = `${p.tracking_prefix}-DEMO${n + 1}`;
    const inicial = Math.round(precio * 0.1);

    const [venta] = await rest<{ id: string }[]>(`reservations`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        project_id: p.id,
        lot_id: lote.id,
        tracking_code: codigo,
        buyer_full_name: caso.c.nombre,
        buyer_ci: caso.c.ci,
        buyer_ci_normalized: caso.c.ci,
        buyer_phone: caso.c.tel,
        buyer_email: `${caso.c.ci}@ejemplo.bo`,
        status: 'confirmada',
        price_agreed: precio,
        amount_due: inicial,
        amount_due_currency: 'BOB',
        currency: 'BOB',
        source: 'oficina',
        confirmed_at: `${hace(caso.dias)}T15:00:00Z`,
        client_meta: { origen: caso.origen, demo: true },
      }),
    });

    await rest(`lots?id=eq.${lote.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'vendido', active_reservation_id: venta.id }),
    });

    // La seña solo existe si reservó antes de comprar.
    if (caso.origen === 'oficina_reserva') {
      await rest(`payments`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          project_id: p.id,
          reservation_id: venta.id,
          provider: 'manual_qr',
          reference_code: `${codigo}-SENA`,
          purpose: 'reserva',
          amount: 1000,
          currency: 'BOB',
          amount_bob: 1000,
          exchange_rate_used: 6.96,
          status: 'aprobado',
          verified_at: `${hace(caso.dias + 5)}T15:00:00Z`,
        }),
      });
    }

    // La cuota inicial: es lo que convierte la reserva en compra iniciada.
    await rest(`payments`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        project_id: p.id,
        reservation_id: venta.id,
        provider: caso.forma,
        reference_code: `${codigo}-INI`,
        purpose: 'cuota',
        amount: inicial,
        currency: 'BOB',
        amount_bob: inicial,
        exchange_rate_used: 6.96,
        status: 'aprobado',
        verified_at: `${hace(caso.dias)}T16:00:00Z`,
      }),
    });

    if (caso.plan) {
      const financiado = precio - inicial;
      const meses = 12;
      const cuota = Math.round((financiado / meses) * 100) / 100;
      const [plan] = await rest<{ id: string }[]>(`installment_plans`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          project_id: p.id,
          reservation_id: venta.id,
          total_price: precio,
          currency: 'BOB',
          down_payment: inicial,
          financed_amount: financiado,
          months: meses,
          monthly_amount: cuota,
          first_due_date: hace(caso.atraso ? 60 : 10),
          status: 'activo',
          note: 'DEMO',
        }),
      });

      // Cronograma: las primeras pagadas, el resto pendiente. En el caso "con
      // atraso" quedan vencidas para que la cobranza tenga algo que mostrar.
      const primera = new Date(`${hace(caso.atraso ? 60 : 10)}T12:00:00Z`);
      const pagadas = caso.atraso ? 1 : 2;
      const cuotas = Array.from({ length: meses }, (_, i) => {
        const vence = new Date(primera);
        vence.setMonth(vence.getMonth() + i);
        const pagada = i < pagadas;
        return {
          plan_id: plan.id,
          project_id: p.id,
          number: i + 1,
          due_date: vence.toISOString().slice(0, 10),
          amount: cuota,
          currency: 'BOB',
          amount_paid: pagada ? cuota : 0,
          status: pagada ? 'pagada' : 'pendiente',
          paid_at: pagada ? `${vence.toISOString().slice(0, 10)}T15:00:00Z` : null,
        };
      });
      await rest(`installments`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(cuotas),
      });

      // Y los cobros de esas cuotas, para que el historial y el desglose por
      // vía tengan filas de verdad.
      for (let i = 0; i < pagadas; i++) {
        await rest(`payments`, {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            project_id: p.id,
            reservation_id: venta.id,
            provider: i % 2 === 0 ? 'efectivo' : 'manual_qr',
            reference_code: `${codigo}-C${i + 1}`,
            purpose: 'cuota',
            amount: cuota,
            currency: 'BOB',
            amount_bob: cuota,
            exchange_rate_used: 6.96,
            status: 'aprobado',
            verified_at: `${hace(caso.dias - i * 30 > 0 ? caso.dias - i * 30 : 1)}T15:00:00Z`,
          }),
        });
      }
    }
    n++;
  }

  console.log(`  ${p.name}: 2 manzanas, ${lotIds.length} lotes, ${n} ventas de ejemplo`);
}

async function main() {
  const proyectos = await rest<Proyecto[]>(
    `projects?select=id,name,slug,tracking_prefix&order=created_at`,
  );
  console.log(APLICAR ? 'Sembrando datos de demostración\n' : 'ENSAYO — nada se escribe\n');
  let i = 0;
  for (const p of proyectos) {
    await sembrarProyecto(p, i);
    i++;
  }
  if (!APLICAR) console.log('\n(agregá --aplicar para escribir)');
}

void main().catch((e) => {
  console.error('ERROR:', (e as Error).message);
  process.exit(1);
});
