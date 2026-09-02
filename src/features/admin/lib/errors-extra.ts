// Team-RPC error codes that only surface in the admin panel — layered on top of
// the buyer-facing table in src/lib/errors.ts.

import { rpcErrorCopy } from '@/lib/errors';

const ADMIN_ERROR_COPY: Record<string, string> = {
  PERMISO_SOLO_LECTURA:
    'Tu acceso a esta sección es de solo lectura: podés mirar, pero no cambiar nada. Pedí al administrador que te habilite la edición.',
  PLAZO_NO_AMORTIZA:
    'Con ese interés y ese plazo la cuota apenas cubre el interés del mes: la deuda nunca bajaría. Acortá el plazo o bajá la tasa.',
  ADMIN_NO_SE_RESTRINGE:
    'Un administrador siempre puede todo. Si querés restringir a esta persona, cambiale primero el rol.',
  PAYMENT_NOT_REVIEWABLE: 'Este comprobante ya fue revisado por otra persona. Actualiza la lista.',
  RESERVATION_NOT_IN_REVIEW: 'La reserva ya no está en verificación. Actualiza la lista.',
  NOTE_REQUIRED: 'La nota es obligatoria para esta acción.',
  ABONO_CON_CUOTA_DEL_MES:
    'Primero la cuota del mes: no se abona a capital debiendo la cuota corriente ni las vencidas. Cobrala y después amortizá.',
  INVALID_HOURS: 'Cantidad de horas inválida (entre 1 y 720).',
  RESERVATION_NOT_CONFIRMED: 'La reserva no está confirmada; no hay venta que revertir.',
  RESERVATION_NOT_REINSTATABLE: 'Solo se pueden reactivar reservas expiradas o canceladas.',
  MANZANA_NOT_FOUND: 'No se encontró la manzana.',
  CATEGORY_NOT_FOUND: 'No se encontró la categoría de precios.',
  INVALID_OP: 'Operación de precios inválida.',
  PROFILE_NOT_FOUND: 'No se encontró el perfil.',
  MANZANA_HAS_NO_GEOMETRY: 'La manzana no tiene geometría dibujada.',
  // admin_reserve_offline
  BUYER_NAME_REQUIRED: 'Falta el nombre completo del comprador.',
  BUYER_CI_REQUIRED: 'Falta el carnet del comprador.',
  BUYER_PHONE_REQUIRED: 'Falta el celular del comprador.',
  INVALID_HOLD_HOURS: 'El plazo debe estar entre 1 y 720 horas.',
  // Compras a crédito, pagos a proveedores y fondos por rendir.
  VENCIMIENTO_REQUERIDO: 'Una compra a crédito necesita fecha de vencimiento.',
  CREDITO_NO_LLEVA_CAJA:
    'Si no se pagó al contado, todavía no salió plata de ninguna cuenta: no elijas caja.',
  FORMA_DE_PAGO_INVALIDA: 'Esa forma de pago no existe.',
  EGRESO_YA_PAGADO: 'Ese egreso ya está pagado. Actualizá la lista.',
  EGRESO_NO_ES_A_CREDITO: 'Ese egreso no quedó debiéndose: no hay nada que cancelar.',
  EGRESO_NO_ESTA_PAGADO: 'Ese egreso todavía no está pagado.',
  ACTIVO_YA_PAGADO: 'Ese activo ya está pagado. Anulá el pago antes de cambiarlo.',
  ACTIVO_NO_ES_A_CREDITO: 'Ese activo no quedó debiéndose: no hay nada que cancelar.',
  ACTIVO_NO_ESTA_PAGADO: 'Ese activo todavía no está pagado.',
  ACTIVO_DADO_DE_BAJA: 'Un activo dado de baja no se edita: su asiento ya está cerrado.',
  EGRESO_NO_CAPITALIZA:
    'Ese egreso carga a una cuenta de gasto, no a la del activo. Corregí el concepto del egreso o registrá el activo suelto.',
  FONDO_INSUFICIENTE:
    'El fondo de esa persona no alcanza para este gasto. Entregale más fondos o registralo al contado.',
  SALDO_INSUFICIENTE: 'No puede devolver más de lo que le queda sin rendir.',
  FONDO_YA_RENDIDO: 'Esa entrega ya se gastó: anulá primero la rendición.',
  FONDO_YA_ANULADO: 'Ese movimiento del fondo ya estaba anulado.',
  FONDO_NO_ENCONTRADO: 'No se encontró ese movimiento del fondo.',
  EMPLEADO_REQUERIDO: 'Elegí a la persona que recibe o rinde el fondo.',
  EMPLEADO_NO_ENCONTRADO: 'No se encontró a esa persona en el personal.',
  EMPLEADO_RETIRADO: 'No se le entrega un fondo a alguien que ya no trabaja acá.',
  CONTRATO_SIN_FIN: 'Un contrato a plazo necesita su fecha de fin.',
  CONTRATO_INDEFINIDO_CON_FIN: 'Un contrato indefinido no lleva fecha de fin.',
  DOC_NO_ENCONTRADO: 'No se encontró el documento. Puede que ya lo hayan sacado del file.',
  ARCHIVO_REQUERIDO: 'Falta el archivo.',
  CUENTA_NO_ENCONTRADA: 'Esa caja o banco no existe o está inactiva.',
  // Pagos parciales y planilla devengada.
  PAGO_MAYOR_AL_SALDO: 'No se puede pagar más de lo que se debe. Revisá el saldo.',
  PAGO_NO_ENCONTRADO: 'No se encontró ese pago.',
  PAGO_YA_ANULADO: 'Ese pago ya estaba anulado.',
  PLANILLA_SIN_DEVENGAR:
    'Primero devengá la planilla: el sueldo es del mes trabajado, y recién después se paga.',
  PLANILLA_YA_DEVENGADA: 'Esa planilla ya entró al libro.',
  PLANILLA_YA_PAGADA: 'No quedaba nada por pagar en esa planilla.',
  PLANILLA_NO_ENCONTRADA: 'No se encontró la planilla.',
  PLANILLA_VACIA: 'La planilla no tiene a nadie con sueldo por pagar.',
  // El libro fiscal: comprobantes sólo fiscales e importación del gerencial.
  CUENTA_INVALIDA:
    'Esa cuenta no existe en el plan o no es imputable. Elegí una cuenta de último nivel, sin hijas.',
  MINIMO_DOS_LINEAS: 'Un asiento necesita al menos dos líneas: algo al debe y algo al haber.',
  IMPORTE_CERO:
    'Hay una línea sin importe. Cada línea lleva un monto mayor a cero, al debe o al haber.',
  NO_CUADRA: 'El asiento no cuadra: el total del debe tiene que coincidir con el total del haber.',
  ORIGEN_INVALIDO: 'Ese tipo de movimiento no existe: no se puede llevar al libro fiscal.',
  YA_DECLARADO: 'Ese movimiento ya está declarado en el libro fiscal. Actualizá la lista.',
  // Postgres cuando la función todavía no está creada en la base.
  'Could not find the function': 'Falta aplicar la migración admin_reserve_offline en la base de datos.',
  PGRST202: 'Falta aplicar la migración admin_reserve_offline en la base de datos.',
};

/** Spanish copy for any RPC error seen from the admin panel. */
export function adminErrorCopy(message: string | undefined | null): string {
  if (message) {
    const extra = Object.keys(ADMIN_ERROR_COPY).find((code) => message.includes(code));
    if (extra) return ADMIN_ERROR_COPY[extra];
  }
  return rpcErrorCopy(message);
}
