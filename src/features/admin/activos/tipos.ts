// Los tipos del módulo de activos fijos, compartidos entre la lista, el
// formulario y el kardex.

export interface Activo {
  id: string;
  project_id: string;
  proyecto: string | null;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  identificacion: string | null;
  categoria: string;
  categoria_id: string;
  categoria_codigo: string;
  fecha_compra: string;
  fecha_alta: string;
  costo: number;
  valor_residual: number;
  vida_util_meses: number;
  estado: string;
  mensual: number;
  meses_corridos: number;
  acumulada: number;
  valor_en_libros: number;
  meses_restantes: number;
  totalmente_depreciado: boolean;
  centro_costo: string | null;
  centro_costo_id: string | null;
  titular: string;
  titular_nombre: string | null;
  nota: string | null;
  // El papel de la compra y cómo se pagó.
  proveedor: string | null;
  proveedor_nit: string | null;
  proveedor_contact_id: string | null;
  comprado_de: string | null;
  pagado_de: string | null;
  venta_a: string | null;
  numero_factura: string | null;
  forma_pago: string | null;
  vencimiento: string | null;
  pagado_el: string | null;
  treasury_account_id: string | null;
  // Las cuentas que mueve, para poder decirlas en pantalla.
  cuenta_activo: string | null;
  cuenta_depreciacion: string | null;
  cuenta_acumulada: string | null;
  // Cómo terminó.
  fecha_baja: string | null;
  motivo_baja: string | null;
  valor_venta: number | null;
  dep_acumulada_baja: number | null;
}

export interface Categoria {
  id: string;
  codigo: string;
  nombre: string;
  vida_util_meses: number;
  /** La cuenta que se debita al comprar un activo de esta categoría. */
  cuenta_activo: string | null;
}

/** Cómo se llama en pantalla cada estado. */
export const ESTADO_ACTIVO: Record<string, string> = {
  activo: 'En uso',
  dado_de_baja: 'Dado de baja',
  vendido: 'Vendido',
};

/**
 * El cuadro de depreciación por gestión, calculado en el navegador.
 *
 * Es una PROYECCIÓN para mostrar: las cifras del día de hoy salen siempre de
 * la vista, que es la que manda. Se hace por año y no por mes a propósito —
 * una edificación a 40 años son 480 filas mensuales que nadie lee, y 40
 * anuales son el cuadro que el contador firma.
 */
export function cuadroAnual(a: Activo): {
  gestion: number;
  meses: number;
  depreciacion: number;
  acumulada: number;
  enLibros: number;
}[] {
  const depreciable = Number(a.costo) - Number(a.valor_residual);
  const mensual = Math.round((depreciable / a.vida_util_meses) * 100) / 100;
  const alta = new Date(`${a.fecha_alta}T12:00:00`);
  const filas: ReturnType<typeof cuadroAnual> = [];

  let mesesUsados = 0;
  let gestion = alta.getFullYear();
  while (mesesUsados < a.vida_util_meses) {
    // El primer año arranca en el mes del alta; los demás, en enero.
    const desde = mesesUsados === 0 ? alta.getMonth() : 0;
    const disponibles = 12 - desde;
    const meses = Math.min(disponibles, a.vida_util_meses - mesesUsados);
    mesesUsados += meses;
    const acumulada =
      mesesUsados >= a.vida_util_meses
        ? Math.round(depreciable * 100) / 100
        : Math.round(mensual * mesesUsados * 100) / 100;
    const previa = filas.length ? filas[filas.length - 1].acumulada : 0;
    filas.push({
      gestion,
      meses,
      depreciacion: Math.round((acumulada - previa) * 100) / 100,
      acumulada,
      enLibros: Math.round((Number(a.costo) - acumulada) * 100) / 100,
    });
    gestion += 1;
  }
  return filas;
}
