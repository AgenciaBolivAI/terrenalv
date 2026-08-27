import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * El estado de cuenta del comprador: TODO lo de su lote, siempre.
 *
 * Este es el enlace que se le manda por WhatsApp y que no puede morirse
 * nunca. Antes cargaba solo el plan ACTIVO, así que se rompía en los tres
 * momentos en que el comprador más quiere mirarlo:
 *
 *   · cuando termina de pagar (el plan pasa a «completado») — justo el día
 *     que quiere ver que no debe nada;
 *   · cuando no tiene plan y paga por abonos libres — la mitad de los
 *     compradores de una migrada;
 *   · cuando cedió el lote por traspaso — su plata sigue siendo su historia.
 *
 * Ahora, si el código existe, la página existe. Lo que cambia es qué muestra.
 */

export interface CuotaEstado {
  number: number;
  due_date: string;
  amount: number;
  interes: number;
  amount_paid: number;
  status: string;
}

export interface PagoEstado {
  payment_id: string;
  fecha: string | null;
  created_at: string;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  estado: string;
  tiene_recibo: boolean;
  de_comprador_anterior: boolean;
  pagado_por: string;
  /** Para qué fue el pago. La comisión del mercado la paga el VENDEDOR: no es
   *  plata que el comprador entregó por su lote, así que no suma en su hoja. */
  purpose: string;
  /** Lo que este pago pagó de interés del plan. */
  interes_bob: number;
  /** Lo que este pago bajó del precio del lote. Suman amount_bob entre los dos. */
  capital_bob: number;
}

export interface EstadoDeCuenta {
  reservation_id: string;
  tracking_code: string;
  proyecto: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string | null;
  manzana: string | null;
  lote: string | null;
  area_m2: number | null;
  estado: string;
  /** venta | reserva | cedida | cerrada — qué le muestra la página. */
  situacion: 'venta' | 'reserva' | 'cedida' | 'cerrada';
  precio: number;
  pagado: number;
  saldo: number;
  /** Reserva juntando su cuota inicial. */
  sena_pagada: number;
  abonado: number;
  inicial_objetivo: number;
  falta_para_inicial: number;
  vence: string | null;
  /** Si cedió el lote por traspaso. */
  cedida_a: string | null;
  cedida_a_tracking: string | null;
  plan: {
    plan_id: string;
    estado: string;
    total_price: number;
    down_payment: number;
    financed_amount: number;
    months: number;
    monthly_amount: number;
    monthly_interest_pct: number;
    /** La que se pacta con el comprador. La mensual se deriva de ésta. */
    annual_interest_pct: number;
    first_due_date: string;
    cuotas_pagadas: number;
    cuotas_totales: number;
    proxima_cuota: string | null;
    cuotas: CuotaEstado[];
  } | null;
  pagos: PagoEstado[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acepta el código de seguimiento (EDS-XXXX-XXXX), el id de la reserva o el
 * id del plan: a esta página se llega desde tres pantallas distintas y
 * ninguna debería dar 404 por traer la llave que tenía a mano.
 */
export async function cargarEstadoDeCuenta(
  llave: string,
): Promise<EstadoDeCuenta | null> {
  const supabase = createAdminClient();
  let code = llave.toUpperCase();

  if (UUID.test(llave)) {
    // ¿Es un plan? Entonces su reserva. Si no, tratamos el uuid como reserva.
    const { data: pl } = await supabase
      .from('installment_plans')
      .select('reservation_id')
      .eq('id', llave)
      .maybeSingle();
    const resId = (pl as { reservation_id: string } | null)?.reservation_id ?? llave;
    const { data: rr } = await supabase
      .from('reservations')
      .select('tracking_code')
      .eq('id', resId)
      .maybeSingle();
    const tc = (rr as { tracking_code: string } | null)?.tracking_code;
    if (!tc) return null;
    code = tc.toUpperCase();
  }

  const { data: res } = await supabase
    .from('reservations')
    .select(
      'id, tracking_code, status, buyer_full_name, buyer_ci, buyer_phone, price_agreed, ' +
        'hold_expires_at, retry_expires_at, client_meta, ' +
        'projects(name), lots!reservations_lot_id_fkey(area_m2, number, manzanas(code))',
    )
    .eq('tracking_code', code)
    .maybeSingle();

  if (!res) return null;
  const r = res as unknown as {
    id: string;
    tracking_code: string;
    status: string;
    buyer_full_name: string;
    buyer_ci: string;
    buyer_phone: string | null;
    price_agreed: number;
    hold_expires_at: string | null;
    retry_expires_at: string | null;
    client_meta: Record<string, unknown> | null;
    projects: { name: string } | null;
    lots: { area_m2: number | null; number: string; manzanas: { code: string } | null } | null;
  };

  const cedida = (r.client_meta?.traspasada_a ?? null) as
    | { tracking?: string; comprador?: string }
    | null;

  // ---- La plata, según en qué punto está ----------------------------------
  let pagado = 0;
  let saldo = 0;
  let sena = 0;
  let abonado = 0;
  let objetivo = 0;
  let falta = 0;
  let vence: string | null = null;

  if (r.status === 'confirmada') {
    const { data: v } = await supabase
      .from('v_ventas')
      .select('pagado_total, saldo, sena_pagada')
      .eq('reservation_id', r.id)
      .maybeSingle();
    if (v) {
      const vv = v as { pagado_total: number; saldo: number; sena_pagada: number };
      pagado = Number(vv.pagado_total);
      saldo = Number(vv.saldo);
      sena = Number(vv.sena_pagada);
    }
  } else {
    const { data: c } = await supabase
      .from('v_reservas_en_curso')
      .select('sena_pagada, abonado, inicial_objetivo, falta_para_inicial')
      .eq('reservation_id', r.id)
      .maybeSingle();
    if (c) {
      const cc = c as {
        sena_pagada: number;
        abonado: number;
        inicial_objetivo: number;
        falta_para_inicial: number;
      };
      sena = Number(cc.sena_pagada);
      abonado = Number(cc.abonado);
      objetivo = Number(cc.inicial_objetivo);
      falta = Number(cc.falta_para_inicial);
      pagado = sena + abonado;
    }
    vence = r.retry_expires_at ?? r.hold_expires_at;
  }

  // ---- El plan: el vigente si lo hay, y si no el último que tuvo ----------
  const { data: planes } = await supabase
    .from('v_planes')
    .select(
      'plan_id, estado, total_price, down_payment, financed_amount, months, monthly_amount, ' +
        'monthly_interest_pct, annual_interest_pct, first_due_date, cuotas_pagadas, cuotas_totales, ' +
        'proxima_cuota',
    )
    .eq('reservation_id', r.id)
    .order('estado');

  const lista = (planes ?? []) as unknown as {
    plan_id: string;
    estado: string;
    total_price: number;
    down_payment: number;
    financed_amount: number;
    months: number;
    monthly_amount: number;
    monthly_interest_pct: number | null;
    annual_interest_pct: number | null;
    first_due_date: string;
    cuotas_pagadas: number;
    cuotas_totales: number;
    proxima_cuota: string | null;
  }[];
  // El activo manda; si ya no hay activo, se muestra el último — un plan
  // terminado sigue siendo la historia de cómo pagó.
  const elegido = lista.find((p) => p.estado === 'activo') ?? lista[0] ?? null;

  let plan: EstadoDeCuenta['plan'] = null;
  if (elegido) {
    const { data: cs } = await supabase
      .from('installments')
      .select('number, due_date, amount, interes, amount_paid, status')
      .eq('plan_id', elegido.plan_id)
      .neq('status', 'anulada')
      .order('number');
    plan = {
      ...elegido,
      monthly_interest_pct: Number(elegido.monthly_interest_pct ?? 0),
      annual_interest_pct: Number(elegido.annual_interest_pct ?? 0),
      cuotas: (cs ?? []).map((c) => {
        const x = c as CuotaEstado;
        return {
          number: Number(x.number),
          due_date: x.due_date,
          amount: Number(x.amount),
          interes: Number(x.interes ?? 0),
          amount_paid: Number(x.amount_paid ?? 0),
          status: x.status,
        };
      }),
    };
  }

  // ---- Sus pagos, siguiendo la cadena del lote ---------------------------
  const { data: pg } = await supabase
    .from('v_historial_pagos_cadena')
    .select(
      'payment_id, fecha, created_at, tipo, forma, amount, currency, amount_bob, estado, ' +
        'tiene_recibo, de_comprador_anterior, buyer_full_name, interes_bob, capital_bob, purpose',
    )
    .eq('venta_id', r.id)
    .order('created_at', { ascending: false });

  const pagos: PagoEstado[] = (pg ?? []).map((p) => {
    const x = p as unknown as PagoEstado & { buyer_full_name: string };
    return {
      payment_id: x.payment_id,
      fecha: x.fecha,
      created_at: x.created_at,
      tipo: x.tipo,
      forma: x.forma,
      amount: Number(x.amount),
      currency: x.currency,
      amount_bob: Number(x.amount_bob),
      estado: x.estado,
      tiene_recibo: x.tiene_recibo,
      de_comprador_anterior: x.de_comprador_anterior,
      pagado_por: x.buyer_full_name,
      purpose: String(x.purpose ?? ''),
      interes_bob: Number(x.interes_bob ?? 0),
      capital_bob: Number(x.capital_bob ?? x.amount_bob),
    };
  });

  const situacion: EstadoDeCuenta['situacion'] = cedida?.tracking
    ? 'cedida'
    : r.status === 'confirmada'
      ? 'venta'
      : ['pendiente_pago', 'en_verificacion', 'rechazo_reintento'].includes(r.status)
        ? 'reserva'
        : 'cerrada';

  return {
    reservation_id: r.id,
    tracking_code: r.tracking_code,
    proyecto: r.projects?.name ?? '',
    buyer_full_name: r.buyer_full_name,
    buyer_ci: r.buyer_ci,
    buyer_phone: r.buyer_phone,
    manzana: r.lots?.manzanas?.code ?? null,
    lote: r.lots?.number ?? null,
    area_m2: r.lots?.area_m2 == null ? null : Number(r.lots.area_m2),
    estado: r.status,
    situacion,
    precio: Number(r.price_agreed),
    pagado,
    saldo,
    sena_pagada: sena,
    abonado,
    inicial_objetivo: objetivo,
    falta_para_inicial: falta,
    vence,
    cedida_a: cedida?.comprador ?? null,
    cedida_a_tracking: cedida?.tracking ?? null,
    plan,
    pagos,
  };
}
