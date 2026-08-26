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
