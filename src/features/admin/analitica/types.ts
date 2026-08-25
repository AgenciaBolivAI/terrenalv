// Shapes of the analytics views. One interface per view, matching it exactly.

export interface FunnelRow {
  mes: string;
  creadas: number;
  con_comprobante: number;
  confirmadas: number;
  expiradas: number;
  canceladas: number;
  web: number;
  oficina: number;
  tasa_conversion: number | null;
  tasa_expiracion: number | null;
}

export interface TiemposRow {
  mes: string;
  horas_hasta_comprobante: number | null;
  horas_hasta_verificacion: number | null;
  muestras: number;
}

export interface DemandaRow {
  manzana_id: string;
  manzana: string;
  sector: string | null;
  lotes: number;
  vendidos: number;
  reservados: number;
  disponibles: number;
  pct_colocado: number | null;
  area_promedio: number | null;
  precio_promedio: number | null;
}

export interface ColocacionRow {
  mes: string;
  lotes_colocados: number;
  valor_colocado: number;
  ticket_promedio: number;
  precio_m2_realizado: number | null;
  por_oficina: number;
  por_web: number;
}

export interface AgingRow {
  tramo: string;
  orden: number;
  cuotas: number;
  clientes: number;
  monto: number;
}

export interface ProyeccionRow {
  mes: string;
  por_cobrar: number;
  cuotas: number;
  planes: number;
}

export interface EquipoRow {
  profile_id: string;
  full_name: string;
  rol: string;
  ventas_cerradas: number;
  monto_vendido: number;
  pagos_verificados: number;
}

/** "ago 26" — short enough for an axis label. */
export function mesCorto(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('es-BO', { month: 'short', year: '2-digit' }).format(d);
}

/** Compact money for axes: 24.801 → "24,8k". Full figures stay in the tables. */
export function bsCorto(n: number): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace('.', ',')}k`;
  return String(Math.round(v));
}

/**
 * Months of inventory left at the recent pace of sales.
 *
 * Uses the last 3 months rather than the all-time average: a project that sold
 * nothing for a year and 40 lots last month has an answer about NOW, and the
 * lifetime average would hide it. Returns null when there is no pace yet —
 * "infinito" would read as good news.
 */
export function mesesDeInventario(
  colocacion: ColocacionRow[],
  disponibles: number,
): number | null {
  const recientes = colocacion.slice(-3);
  const total = recientes.reduce((s, r) => s + Number(r.lotes_colocados), 0);
  if (total <= 0 || recientes.length === 0) return null;
  const ritmo = total / recientes.length;
  return disponibles / ritmo;
}

/**
 * Una fila por urbanización, con lo que se compara entre proyectos.
 *
 * Todo en bolivianos: es la única forma de poner en la misma columna un
 * proyecto que se lleva en BOB y otro en USD.
 */
export interface PorProyectoRow {
  project_id: string;
  name: string;
  slug: string;
  status: string;
  currency: 'BOB' | 'USD';
  lotes: number;
  disponibles: number;
  vendidos: number;
  reservados: number;
  sin_precio: number;
  pct_colocado: number;
  valor_colocado_bob: number;
  ventas: number;
  ultima_venta: string | null;
  por_cobrar_bob: number;
  vencido_bob: number;
  planes_activos: number;
  ingresos_bob: number;
  egresos_bob: number;
  resultado_bob: number;
  traspasos: number;
}
