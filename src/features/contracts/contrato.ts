import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Datos del contrato de una venta, para el panel y para el comprador.
 *
 * El contrato NO se guarda como archivo: se arma siempre desde la base, así
 * que sigue solo a la realidad. Si la venta se traspasa, el contrato del
 * comprador nuevo nace con la cadena completa (cedente, plata arrastrada,
 * saldo asumido) y el del anterior aparece ANULADO apuntando al nuevo — nadie
 * tiene que acordarse de "actualizar el contrato".
 */
export interface ContratoData {
  reservation_id: string;
  tracking_code: string;
  /** compraventa | traspaso — son dos papeles distintos. */
  tipo: 'compraventa' | 'traspaso';
  estado: string;
  fecha: string | null;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  area_m2: number | null;
  frontage_m: number | null;
  depth_m: number | null;
  precio: number;
  pagado_total: number;
  saldo: number;
  sena_pagada: number;
  plan: {
    cuota_inicial: number;
    months: number;
    monthly_amount: number;
    first_due_date: string;
  } | null;
  traspaso: {
    de_comprador: string;
    de_ci: string;
    de_tracking: string;
    fecha: string;
    pagado_arrastrado: number;
    saldo_arrastrado: number;
    motivo: string;
    mercado: { precio: number; comision_pct: number; comision_bob: number } | null;
  } | null;
  /** La venta fue cedida: el contrato queda anulado y apunta al sucesor. */
  cedida_a: { tracking: string; comprador: string } | null;
  anulada: boolean;
}

interface ResRow {
  id: string;
  tracking_code: string;
  status: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  price_agreed: number;
  confirmed_at: string | null;
  client_meta: Record<string, unknown> | null;
  projects: { name: string } | null;
  lots: {
    area_m2: number | null;
    frontage_m: number | null;
    depth_m: number | null;
    number: string;
    manzanas: { code: string } | null;
  } | null;
}

const SELECT =
  'id, tracking_code, status, buyer_full_name, buyer_ci, buyer_phone, buyer_email, ' +
  'price_agreed, confirmed_at, client_meta, projects(name), ' +
  'lots!reservations_lot_id_fkey(area_m2, frontage_m, depth_m, number, manzanas(code))';

/**
 * Contrato por id de reserva (panel) o por código de seguimiento (comprador).
 * `trackingCode` restringe el acceso al dueño, igual que en el recibo.
 */
export async function cargarContrato(opts: {
  reservationId?: string;
  trackingCode?: string;
}): Promise<ContratoData | null> {
  const supabase = createAdminClient();
  let q = supabase.from('reservations').select(SELECT);
  if (opts.reservationId) q = q.eq('id', opts.reservationId);
  else if (opts.trackingCode) q = q.eq('tracking_code', opts.trackingCode.toUpperCase());
  else return null;

  const { data } = await q.maybeSingle();
  const r = data as unknown as ResRow | null;
  if (!r) return null;
  // Un contrato solo existe para una COMPRA: una reserva sin confirmar
  // todavía no compró nada.
  if (r.status !== 'confirmada' && r.status !== 'cancelada') return null;

  const meta = (r.client_meta ?? {}) as Record<string, unknown>;
  const t = meta.traspaso as
    | {
        de_comprador?: string;
        de_ci?: string;
        de_tracking?: string;
        fecha?: string;
        pagado_arrastrado?: number;
        saldo_arrastrado?: number;
        motivo?: string;
        mercado?: { precio?: number; comision_pct?: number; comision_bob?: number };
      }
    | undefined;
  const cedida = (meta.traspasada_a ?? meta.traspasada_a_anulada) as
    | { tracking?: string; comprador?: string }
    | undefined;

  // Los números de plata: la MISMA cuenta que ven las pantallas (v_ventas)
  // para una venta viva; para una cerrada, lo que quedó escrito en su meta.
  let pagado = 0;
  let saldo = 0;
  let sena = 0;
  const { data: venta } = await supabase
    .from('v_ventas')
    .select('pagado_total, saldo, sena_pagada')
    .eq('reservation_id', r.id)
    .maybeSingle();
  if (venta) {
    pagado = Number((venta as { pagado_total: number }).pagado_total);
    saldo = Number((venta as { saldo: number }).saldo);
    sena = Number((venta as { sena_pagada: number }).sena_pagada);
  } else {
    // Reserva cerrada (la de quien cedió su lote): v_ventas ya no la trae y
    // los ceros quedaban impresos. El papel decía «pagó Bs 0» a alguien que
    // había pagado Bs 35.000, justo debajo del cartel que promete que sus
    // recibos conservan validez histórica. Se reconstruye de sus pagos.
    const { data: suyos } = await supabase
      .from('payments')
      .select('amount_bob, interest_bob, purpose')
      .eq('reservation_id', r.id)
      .eq('status', 'aprobado')
      .in('purpose', ['reserva', 'cuota', 'abono']);
    const filas = (suyos ?? []) as { amount_bob: number; interest_bob: number | null; purpose: string }[];
    pagado =
      Math.round(
        filas.reduce((t, x) => t + Number(x.amount_bob) - Number(x.interest_bob ?? 0), 0) * 100,
      ) / 100;
    sena =
      Math.round(
        filas.filter((x) => x.purpose === 'reserva').reduce((t, x) => t + Number(x.amount_bob), 0) *
          100,
      ) / 100;
    saldo = Math.max(0, Math.round((Number(r.price_agreed) - pagado) * 100) / 100);
  }

  // La cuota inicial sale de v_planes, igual que en el estado de cuenta y en
  // Planes: `installment_plans.down_payment` vale 0 cuando la inicial entró
  // como pago, y el contrato llegaba a decir «cuota inicial de Bs 0».
  const { data: plan } = await supabase
    .from('v_planes')
    .select('cuota_inicial, months, monthly_amount, first_due_date, saldo')
    .eq('reservation_id', r.id)
    .eq('estado', 'activo')
    .maybeSingle();
  // Y el saldo del contrato es el mismo que el del recibo y el del estado de
  // cuenta: lo que falta entregar.
  if (plan) saldo = Number((plan as { saldo: number }).saldo);

  return {
    reservation_id: r.id,
    tracking_code: r.tracking_code,
    tipo: t ? 'traspaso' : 'compraventa',
    estado: r.status,
    fecha: r.confirmed_at,
    buyer_full_name: r.buyer_full_name,
    buyer_ci: r.buyer_ci,
    buyer_phone: r.buyer_phone,
    buyer_email: r.buyer_email,
    proyecto: r.projects?.name ?? '',
    manzana: r.lots?.manzanas?.code ?? null,
    lote: r.lots?.number ?? null,
    area_m2: r.lots?.area_m2 == null ? null : Number(r.lots.area_m2),
    frontage_m: r.lots?.frontage_m == null ? null : Number(r.lots.frontage_m),
    depth_m: r.lots?.depth_m == null ? null : Number(r.lots.depth_m),
    precio: Number(r.price_agreed),
    pagado_total: pagado,
    saldo,
    sena_pagada: sena,
    plan: plan
      ? {
          cuota_inicial: Number((plan as { cuota_inicial: number }).cuota_inicial),
          months: Number((plan as { months: number }).months),
          monthly_amount: Number((plan as { monthly_amount: number }).monthly_amount),
          first_due_date: (plan as { first_due_date: string }).first_due_date,
        }
      : null,
    traspaso: t
      ? {
          de_comprador: t.de_comprador ?? '—',
          de_ci: t.de_ci ?? '—',
          de_tracking: t.de_tracking ?? '—',
          fecha: t.fecha ?? '',
          pagado_arrastrado: Number(t.pagado_arrastrado ?? 0),
          saldo_arrastrado: Number(t.saldo_arrastrado ?? 0),
          motivo: t.motivo ?? '',
          mercado: t.mercado
            ? {
                precio: Number(t.mercado.precio ?? 0),
                comision_pct: Number(t.mercado.comision_pct ?? 0),
                comision_bob: Number(t.mercado.comision_bob ?? 0),
              }
            : null,
        }
      : null,
    cedida_a: cedida?.tracking
      ? { tracking: cedida.tracking, comprador: cedida.comprador ?? '—' }
      : null,
    anulada: r.status === 'cancelada',
  };
}
