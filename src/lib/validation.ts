// Client/server zod schemas mirroring the DB normalizers (private.normalize_ci /
// normalize_phone_bo). The database re-validates — these exist for instant UX.

import { z } from 'zod';

export function normalizeCi(raw: string): string {
  return raw.toUpperCase().replace(/[.\s]/g, '');
}

export const ciSchema = z
  .string()
  .transform(normalizeCi)
  .refine((v) => /^[0-9]{5,10}(-?[A-Z0-9]{1,2})?$/.test(v), {
    message: 'Carnet inválido (ej: 7896541 o 7896541-1E)',
  });

export function normalizePhoneBo(raw: string): string {
  let v = raw.replace(/[\s\-().]/g, '');
  if (/^591[67][0-9]{7}$/.test(v)) v = '+' + v;
  else if (/^[67][0-9]{7}$/.test(v)) v = '+591' + v;
  return v;
}

export const phoneSchema = z
  .string()
  .transform(normalizePhoneBo)
  .refine((v) => /^\+591[67][0-9]{7}$/.test(v), {
    message: 'Celular boliviano inválido (8 dígitos, empieza con 6 o 7)',
  });

export const reserveFormSchema = z.object({
  lot_id: z.string().uuid(),
  full_name: z.string().trim().min(5, 'Escribe tu nombre completo'),
  ci: ciSchema,
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .email('Correo inválido')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  accept_terms: z.literal(true, { message: 'Debes aceptar los términos de reserva' }),
});

export type ReserveFormInput = z.input<typeof reserveFormSchema>;
export type ReserveFormData = z.output<typeof reserveFormSchema>;

export const trackingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,5}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, 'Código inválido (ej: EDS-7F3K-9Q2M)');
