// De qué tipo es una venta. Las definiciones son de la contadora:
//
//   Contado  — pagada por completo, sin cuotas.
//   Crédito  — el cliente paga en cuotas mensuales.
//   Traspaso — el comprador le cede su terreno a otra persona.
//   Sin plan — el cuarto grupo que sus tres no cubren: sin cronograma de
//              cuotas y todavía debiendo. No es contado (no está pagada) ni
//              crédito (no tiene cuotas). Se muestra aparte en vez de
//              esconderla: si no, los tipos no suman el total.
//
// EL ORDEN ES LA REGLA, y está escrito igual en la base: el CASE de
// `rep_ventas_por_tipo` (migración las_ventas_se_cuentan_por_tipo_y_por_periodo)
// evalúa traspaso → crédito → contado → sin plan. Un traspaso pagado del todo
// es traspaso, no contado. Si alguna vez se cambia acá, hay que cambiarlo allá
// el mismo día: el tablero lee la función y la pantalla de Ventas lee esto, y
// tienen que dar el mismo número.

export type TipoVenta = 'Contado' | 'Crédito' | 'Traspaso' | 'Sin plan';

export const TIPOS_VENTA: TipoVenta[] = ['Contado', 'Crédito', 'Traspaso', 'Sin plan'];

/** El filtro de la pantalla de Ventas que corresponde a cada tipo. */
export const FILTRO_DE_TIPO: Record<TipoVenta, string> = {
  Contado: 'contado',
  Crédito: 'credito',
  Traspaso: 'traspasos',
  'Sin plan': 'sin_plan',
};

export function tipoDeVenta(v: {
  traspaso?: boolean | null;
  con_plan?: boolean | null;
  saldo?: number | string | null;
}): TipoVenta {
  if (v.traspaso) return 'Traspaso';
  if (v.con_plan) return 'Crédito';
  return Number(v.saldo ?? 0) <= 0 ? 'Contado' : 'Sin plan';
}
