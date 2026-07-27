-- Production bootstrap: global settings defaults, the Estrellas del Sur project row,
-- and the A–E pricing tiers (prices start at 0 = browsable but not reservable —
-- the team's pricing pass is what opens each manzana for reservations).
-- All idempotent.

insert into public.settings (project_id, key, value, is_public) values
  (null, 'hold_hours', '48', false),
  (null, 'expiry_grace_minutes', '10', false),
  (null, 'retry_hours', '24', false),
  (null, 'max_active_per_ci', '1', false),
  (null, 'captcha_enabled', 'false', false),
  (null, 'reserve_amount', '{"type": "fijo", "value": 1000, "currency": "BOB"}', false),
  (null, 'exchange_rate_bob_per_usd', '6.96', false),
  (null, 'notification_emails', '[]', false),
  (null, 'payment_provider', '"manual_qr"', false),
  (null, 'payment_instructions',
   '{"bank_name": "", "account_holder": "", "account_masked": "", "qr_image_path": null, "note": "Envía el monto exacto y escribe el código de referencia en la glosa/concepto de la transferencia."}',
   false),
  (null, 'terms_version', '"2026-07-v1"', false),
  (null, 'app_base_url', 'null', false),
  (null, 'whatsapp_templates',
   '{"contacto": "Hola {nombre}, te escribimos de Terrenalv sobre tu reserva {codigo} del lote {lote}, manzana {manzana}.", "rechazo": "Hola {nombre}, te escribimos de Terrenalv sobre tu reserva {codigo}. Hubo un problema con tu comprobante: {motivo}. Puedes volver a subirlo desde tu enlace de seguimiento."}',
   false)
on conflict (project_id, key) do nothing;

-- Random bearer for the pg_net → app outbox ping. Regenerate any time via update_setting.
insert into public.settings (project_id, key, value, is_public)
select null, 'internal_cron_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')), false
where not exists (
  select 1 from public.settings where project_id is null and key = 'internal_cron_secret'
);

-- UTM offsets are provisional (derived from the site pin at ≈ -18.2702, -63.1960,
-- consistent with the plano's 479,250+ easting grid); Builder calibration refines them.
insert into public.projects
  (slug, name, description, location_text, status, currency, tracking_prefix,
   utm_epsg, utm_offset_e, utm_offset_n)
values
  ('estrellas-del-sur', 'Estrellas del Sur',
   'Urbanización Estrellas del Sur — lotes desde 250 m² sobre la Carretera Internacional Ruta 9 (Argentina–Paraguay), con mega piscina y club house.',
   'Zanja Honda, Cabezas, Cordillera — Santa Cruz, Bolivia',
   'activo', 'USD', 'EDS',
   32720, 479250.00, 7972500.00)
on conflict (slug) do nothing;

insert into public.pricing_categories (project_id, code, name, color_hex, price_per_m2, sort_order)
select p.id, c.code, c.name, c.color_hex, 0, c.sort_order
from public.projects p
cross join (values
  ('A', 'Categoría A', '#F97316', 1),
  ('B', 'Categoría B', '#22C55E', 2),
  ('C', 'Categoría C', '#FACC15', 3),
  ('D', 'Categoría D', '#F9A8D4', 4),
  ('E', 'Categoría E', '#38BDF8', 5)
) as c(code, name, color_hex, sort_order)
where p.slug = 'estrellas-del-sur'
on conflict (project_id, code) do nothing;
