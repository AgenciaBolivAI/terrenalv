// Shapes of the accounting reads. These mirror the two database views and the
// expenses table exactly; nothing here is computed differently to how the
// database computes it, so a figure on screen can always be traced to a row.

export type Currency = 'USD' | 'BOB';

export interface AccountStatus {
  plan_id: string;
  project_id: string;
  reservation_id: string;
  plan_status: 'activo' | 'completado' | 'cancelado';
  total_price: number;
  down_payment: number;
  financed_amount: number;
  months: number;
  monthly_amount: number;
  currency: Currency;
  first_due_date: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  buyer_ci: string;
  manzana: string;
  lote: string;
  total_cuotas: number;
  pagado: number;
  saldo: number;
  cuotas_vencidas: number;
  monto_vencido: number;
  cuotas_pagadas: number;
  cuotas_totales: number;
  proxima_cuota: string | null;
  /** Days since the OLDEST unpaid cuota fell due; null when nothing is late. */
  dias_atraso: number | null;
}

export interface MonthlyCashflow {
  project_id: string;
  mes: string;
  ingresos_bob: number;
  egresos_bob: number;
  resultado_bob: number;
}

export const EXPENSE_CATEGORIES = [
  'obra',
  'comisiones',
  'sueldos',
  'publicidad',
  'administracion',
  'impuestos',
  'financiero',
  'otros',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  obra: 'Obra',
  comisiones: 'Comisiones',
  sueldos: 'Sueldos',
  publicidad: 'Publicidad',
  administracion: 'Administración',
  impuestos: 'Impuestos',
  financiero: 'Financiero',
  otros: 'Otros',
};

/**
 * Cuenta del plan a la que va cada categoría de egreso.
 *
 * Es el mismo mapeo que hace `v_libro_diario` en la base. Está duplicado acá
 * a propósito y no leído de la base: sirve para que un gráfico de egresos abra
 * el libro filtrado por la cuenta correcta, y si alguna vez los dos se separan,
 * lo que manda es la vista — acá sólo se rompe un enlace, no un asiento.
 */
export const EXPENSE_ACCOUNT: Record<ExpenseCategory, string> = {
  obra: '5111',
  comisiones: '5211',
  sueldos: '5221',
  publicidad: '5311',
  administracion: '5411',
  impuestos: '5511',
  financiero: '5611',
  otros: '5911',
};

export interface Expense {
  id: string;
  incurred_on: string;
  category: ExpenseCategory;
  description: string;
  supplier: string | null;
  amount: number;
  currency: Currency;
  amount_bob: number;
  note: string | null;
  created_at: string;
}

export interface Installment {
  id: string;
  number: number;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: 'pendiente' | 'parcial' | 'pagada' | 'anulada';
  paid_at: string | null;
}

/**
 * Venta confirmada sin plan de cuotas.
 *
 * Antes era solo una alarma («nadie les está facturando»). Con la migración son
 * 1.400+ ventas legítimas cuyo cronograma vive en el sistema anterior, así que
 * además de crearles plan hay que poder COBRARLES: cada pago sin plan entra
 * como abono y baja el saldo.
 */
export interface SaleWithoutPlan {
  id: string;
  project_id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  price_agreed: number;
  currency: Currency;
  confirmed_at: string | null;
  manzana: string;
  lote: string;
  /** Del saldo reportado al migrar (o del precio) menos lo cobrado acá. */
  saldo: number;
  migrada: boolean;
}

/**
 * A quién se le está cobrando, venga de donde venga.
 *
 * El diálogo de cobro atiende dos casos con la misma cara: la cuenta con plan
 * (cuota, cascada desde la más vieja) y la venta sin plan (abono directo al
 * saldo). Si cada caso tuviera su diálogo, uno de los dos se quedaría sin
 * recibo o sin forma de pago la próxima vez que se toque el otro.
 */
export interface CobroTarget {
  reservation_id: string;
  /** Para prellenar el tipo de cambio del proyecto al cobrar en dólares. */
  project_id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  saldo: number;
  currency: Currency;
  /** Monto sugerido al abrir: la cuota mensual si hay plan, vacío si no. */
  monto_sugerido: number | null;
  tiene_plan: boolean;
}

/** es-BO short month label: "ago 2026". */
export function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('es-BO', { month: 'short', year: 'numeric' }).format(d);
}

export function dateLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/**
 * Build a CSV the accountant can open in Excel.
 *
 * Separator is ';' and decimals use a comma: Excel in a Bolivian locale reads a
 * comma-separated file as one column per row, which makes the export useless
 * exactly where it is meant to be used. The BOM keeps accents intact.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One side of one journal entry, as projected by v_libro_diario. */
export interface LedgerLine {
  fecha: string;
  comprobante: string;
  glosa: string;
  cuenta: string;
  debe: number;
  haber: number;
  origen: 'pago' | 'egreso';
  origen_id: string;
  // Las dimensiones con las que se segrega el libro: de quien es el
  // movimiento, a que centro carga, y a nombre de quien esta.
  cliente_ci: string | null;
  cliente: string | null;
  centro_costo_id: string | null;
  centro_costo: string | null;
  titular: string | null;
  titular_nombre: string | null;
}

/** One account's totals, as projected by v_libro_mayor. */
export interface LedgerAccount {
  cuenta: string;
  cuenta_nombre: string;
  tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';
  sort_order: number;
  debe: number;
  haber: number;
  saldo: number;
}

export const ACCOUNT_KIND_LABEL: Record<LedgerAccount['tipo'], string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  gasto: 'Gasto',
};

/** First day of the current month, yyyy-mm-dd — the default report period. */
export function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** An approved payment, as listed on an account statement. */
export interface PaymentRow {
  id: string;
  reference_code: string;
  amount: number;
  currency: Currency;
  purpose: string;
  provider: string;
  verified_at: string | null;
  status: string;
}

/** Last day of the month a yyyy-mm-dd date falls in, as yyyy-mm-dd. */
export function mesFin(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

/**
 * Cuánto entró por cada vía: efectivo, QR, depósito bancario.
 *
 * El efectivo hay que arquearlo y depositarlo; el QR tiene que aparecer en el
 * extracto del banco. Sin separarlos no se puede cuadrar la caja, y ese dato
 * se venía guardando sin mostrarse en ninguna parte.
 */
export interface CobroPorVia {
  project_id: string;
  mes: string;
  provider: string;
  forma: string;
  purpose: string;
  cobros: number;
  total_bob: number;
}
