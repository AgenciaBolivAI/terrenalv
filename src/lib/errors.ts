// RPC error codes → buyer-facing Spanish copy. The database raises stable codes;
// this is the single translation table.

const ERROR_COPY: Record<string, string> = {
  INVALID_CI: 'El carnet de identidad no es válido. Revisa el número.',
  INVALID_PHONE: 'El número de celular no es válido. Debe ser un celular boliviano (8 dígitos, empieza con 6 o 7).',
  INVALID_NAME: 'Escribe tu nombre completo.',
  INVALID_EMAIL: 'El correo electrónico no es válido.',
  LOT_NOT_AVAILABLE: 'Este lote acaba de ser reservado por otra persona. Elige otro lote del mapa.',
  LOT_NOT_PRICED: 'Este lote todavía no está habilitado para reservas. Contáctanos por WhatsApp para más información.',
  CI_LIMIT_REACHED: 'Ya tienes una reserva activa con este carnet. Consulta su estado con tu código de seguimiento o contáctanos.',
  RATE_LIMITED: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.',
  RESERVATION_NOT_FOUND: 'No encontramos una reserva con ese código.',
  RESERVATION_NOT_PENDING: 'Esta reserva ya no está esperando pago.',
  RESERVATION_EXPIRED: 'Tu reserva expiró. Contáctanos por WhatsApp: si ya pagaste, es posible que podamos ayudarte.',
  RESERVATION_NOT_ACTIVE: 'Esta reserva ya no está activa.',
  INVALID_PROOF_PATH: 'El comprobante no se subió correctamente. Intenta de nuevo.',
  PROOF_NOT_UPLOADED: 'El comprobante no se subió correctamente. Intenta de nuevo.',
  PAYMENT_NOT_FOUND: 'No encontramos el pago de esta reserva. Contáctanos.',
  CI_MISMATCH: 'El carnet no coincide con el de la reserva.',
  CAPTCHA_FAILED: 'No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.',
  NO_AUTORIZADO: 'No tienes permiso para realizar esta acción.',
  VERSION_CONFLICT: 'Otra persona editó esta manzana al mismo tiempo. Recarga e intenta de nuevo.',
  LAST_ADMIN: 'No puedes desactivar o degradar al único administrador activo.',
};

const GENERIC = 'Ocurrió un error. Intenta de nuevo o contáctanos por WhatsApp.';

/** Extract the stable code from a PostgREST/Supabase error message. */
export function rpcErrorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  const known = Object.keys(ERROR_COPY).find((code) => message.includes(code));
  return known ?? null;
}

export function rpcErrorCopy(message: string | undefined | null): string {
  const code = rpcErrorCode(message);
  return code ? ERROR_COPY[code] : GENERIC;
}
