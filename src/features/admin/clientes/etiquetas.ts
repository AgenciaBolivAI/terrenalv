// Cómo se llama, en el mostrador, lo que le pasó a un lote de un cliente.
//
// Vive suelto porque lo dicen DOS pantallas —el perfil del cliente y el
// historial que se abre desde Ventas— y decían cosas distintas: una mostraba
// «Comprado» donde la otra mostraba «Recibido por traspaso». Un lote que llegó
// por traspaso NO se compró a Terrenalv, y la oficina necesita distinguirlo de
// un vistazo: son dos contratos distintos y dos historias de plata distintas.

export interface MovimientoEtiquetable {
  estado: string;
  recibida_por_traspaso?: boolean | null;
  cedida_por_traspaso?: boolean | null;
  comprada_en_mercado?: boolean | null;
  vendida_en_mercado?: boolean | null;
}

export interface Etiqueta {
  texto: string;
  clase: string;
}

const CLASE = {
  comprado: 'bg-green-100 text-green-700',
  traspaso: 'bg-violet-100 text-violet-800',
  reservado: 'bg-amber-100 text-amber-800',
  cerrado: 'bg-stone-200 text-stone-600',
} as const;

/**
 * Qué fue este movimiento. El orden importa: primero lo que salió de sus
 * manos (cedido), después cómo llegó (traspaso o compra), y al final los
 * estados de una reserva que nunca llegó a venta.
 */
export function etiquetaDeMovimiento(m: MovimientoEtiquetable): Etiqueta {
  if (m.cedida_por_traspaso) {
    return {
      texto: m.vendida_en_mercado ? 'Vendido por el mercado' : 'Cedido por traspaso',
      clase: CLASE.traspaso,
    };
  }
  if (m.estado === 'confirmada' && m.recibida_por_traspaso) {
    return {
      texto: m.comprada_en_mercado ? 'Comprado en el mercado' : 'Recibido por traspaso',
      clase: CLASE.traspaso,
    };
  }
  if (m.estado === 'confirmada') return { texto: 'Comprado', clase: CLASE.comprado };
  if (m.estado === 'expirada') return { texto: 'Reserva vencida', clase: CLASE.cerrado };
  if (m.estado === 'cancelada') return { texto: 'Cancelado', clase: CLASE.cerrado };
  if (m.estado === 'en_verificacion') return { texto: 'En verificación', clase: CLASE.reservado };
  if (m.estado === 'rechazo_reintento') return { texto: 'Reintento', clase: CLASE.reservado };
  return { texto: 'Reservado', clase: CLASE.reservado };
}
