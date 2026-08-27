// La aritmética del estado de cuenta, en un solo lugar.
//
// La pantalla y el PDF mostraban cada uno su propia cuenta del «te queda» y
// del encabezado del plan. Mientras fueron la misma fórmula copiada dos
// veces, nadie lo notó; el día que una cambió sola, el papel impreso dijo una
// cosa y la pantalla otra. Acá vive la cuenta única, y el test la clava a los
// números reales de un plan de producción.

export interface CuotaComoSeMuestra {
  amount: number | string;
}

export interface TerminosDelPlan {
  months: number;
  monthly_amount: number | string;
  cuotas_totales: number;
  cuotas_pagadas: number;
}

/**
 * El «te queda» después de cada cuota: la columna que el comprador busca con
 * el dedo. Arranca en la suma de TODAS las cuotas vivas (pagadas incluidas,
 * porque la primera fila también muestra cuánto quedaba después de pagarla) y
 * baja cuota a cuota hasta cero.
 */
export function saldosCorridos(cuotas: CuotaComoSeMuestra[]): number[] {
  let restante = cuotas.reduce((s, c) => s + Number(c.amount), 0);
  return cuotas.map((c) => {
    restante = Math.round((restante - Number(c.amount)) * 100) / 100;
    return Math.max(0, restante);
  });
}

/**
 * Cómo se nombran los términos del plan, en texto plano.
 *
 * Si se reprogramó, las cuotas ya pagadas fueron de otro monto: decir «8
 * cuotas de Bs 5.156» sobre un cronograma de nueve filas se contradice solo.
 * Se nombra el total y se aclara qué falta. `formatea` recibe el formateador
 * de moneda para no atar esta cuenta a ninguna pantalla.
 */
export function terminosDelPlan(
  plan: TerminosDelPlan,
  formatea: (monto: number) => string,
): string {
  const total = Number(plan.cuotas_totales);
  const faltan = total - Number(plan.cuotas_pagadas);
  const cuota = formatea(Number(plan.monthly_amount));
  return total === Number(plan.months)
    ? `${plan.months} cuotas de ${cuota}`
    : `${total} cuotas · las ${faltan} que faltan son de ${cuota}`;
}

/** Un pago, como lo trae la vista del historial. */
export interface PagoDelComprador {
  estado: string;
  purpose: string;
  amount_bob: number | string;
}

/** El plan, con sus cuotas vivas. */
export interface PlanDelComprador {
  estado: string;
  cuotas: { amount: number | string; amount_paid: number | string; status: string }[];
}

export interface CuentaDelComprador {
  /** La plata que entregó, tal cual. Si puso 646, pagó 646. */
  entregado: number;
  /** Lo que todavía tiene que entregar. Las cuotas ya llevan el interés. */
  teQueda: number;
  /** Todo lo que va a pagar por el lote: entregado + lo que falta. */
  totalAPagar: number;
  /** Lo que el financiamiento agrega por encima del precio. */
  interes: number;
}

const cent = (n: number) => Math.round(n * 100) / 100;

/**
 * La cuenta que ve el comprador, en un solo lugar.
 *
 * Tres reglas, y de ellas sale todo lo demás:
 *
 *  · ENTREGADO es lo que puso, sin repartirlo en capital e interés. La
 *    comisión del mercado NO cuenta: esa la paga el vendedor del traspaso, y
 *    contarla le imprimía al comprador nuevo plata que nunca puso.
 *  · TE QUEDA es lo que falta ENTREGAR. Con plan vivo son las cuotas que
 *    quedan (que ya llevan su interés adentro); sin plan, el precio menos lo
 *    entregado. Un plan cancelado NO manda: sus cuotas quedan anuladas, la
 *    suma daría cero y la hoja le diría «pagado» a alguien que debe.
 *  · TOTAL es la suma de los dos, así que la resta cierra por construcción:
 *    total − entregado = te queda, siempre, sin excepciones ni redondeos.
 *
 * El interés sale por diferencia contra el precio, no de una tabla aparte:
 * es la única forma de que precio + interés = total se cumpla en pantalla.
 */
export function cuentaDelComprador(
  precio: number,
  pagos: PagoDelComprador[],
  plan: PlanDelComprador | null,
): CuentaDelComprador {
  const suyos = pagos.filter((p) => p.estado === 'aprobado' && p.purpose !== 'comision');
  const entregado = cent(suyos.reduce((t, p) => t + Number(p.amount_bob), 0));

  const falta =
    plan && plan.estado === 'activo'
      ? cent(
          plan.cuotas
            .filter((c) => c.status !== 'pagada')
            .reduce((t, c) => t + Number(c.amount) - Number(c.amount_paid), 0),
        )
      : null;

  const teQueda = falta == null ? Math.max(0, cent(precio - entregado)) : falta;
  const totalAPagar = cent(entregado + teQueda);
  return { entregado, teQueda, totalAPagar, interes: cent(totalAPagar - precio) };
}
