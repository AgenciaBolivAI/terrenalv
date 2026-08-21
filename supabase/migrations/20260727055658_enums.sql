-- Domain enums. Spanish values — they surface directly in UI copy and API payloads.

-- The lot answers exactly one public question: "can I take it?" The rich lifecycle
-- lives on reservations. `no_disponible` = admin-blocked inventory.
create type public.lot_status as enum ('disponible', 'reservado', 'vendido', 'no_disponible');

-- Pause-during-review semantics: hold_expires_at is NULLed while `en_verificacion`
-- (a buyer must never expire because the team reviewed slowly).
create type public.reservation_status as enum
  ('pendiente_pago', 'en_verificacion', 'confirmada', 'rechazo_reintento', 'expirada', 'cancelada');

create type public.payment_status as enum
  ('pendiente', 'comprobante_subido', 'aprobado', 'rechazado', 'cancelado');

-- Plug point for future bank QR APIs.
create type public.payment_provider_kind as enum ('manual_qr', 'banco_ganadero', 'bnb');

create type public.team_role as enum ('admin', 'ventas');

create type public.manzana_kind as enum ('residencial', 'area_verde', 'equipamiento', 'amenidad');

create type public.element_kind as enum
  ('calle', 'avenida', 'ciclovia', 'area_verde', 'equipamiento', 'amenidad', 'perimetro', 'texto');

-- Draft geometry is Builder-only; the sales floor sees published state exclusively.
create type public.geom_state as enum ('draft', 'published');

create type public.notification_type as enum
  ('nueva_reserva', 'comprobante_subido', 'comprobante_tras_expiracion', 'reserva_por_expirar',
   'reserva_expirada', 'pago_aprobado', 'pago_rechazado', 'reserva_cancelada', 'sistema');

create type public.actor_type as enum ('guest', 'team', 'system', 'cron');

create type public.rejection_reason_kind as enum
  ('monto_incorrecto', 'comprobante_ilegible', 'pago_no_encontrado', 'comprobante_duplicado', 'otro');
