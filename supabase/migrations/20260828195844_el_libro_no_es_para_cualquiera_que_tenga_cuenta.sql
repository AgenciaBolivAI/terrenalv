-- EL LIBRO NO ES PARA CUALQUIERA QUE TENGA CUENTA.
--
-- `v_libro_diario`, `v_libro_mayor` y `v_egresos` corrían como su DUEÑO, y el
-- grant de Supabase se lo da a `authenticated` entero. Mientras «authenticated»
-- era sinónimo de «alguien del equipo» eso no se notaba. Desde que el
-- comprador tiene cuenta, no lo es: probado impersonando a un uuid que no está
-- en `profiles`, un comprador logueado leía los 143 movimientos del libro —
-- cada venta, con nombre y carnet del comprador y el importe— y los 21 saldos
-- del mayor.
--
-- El arreglo es el que ya está escrito en la casa: **una vista del PANEL corre
-- como quien mira** (`security_invoker`), y entonces la RLS de `reservations`,
-- `payments`, `expenses` y `journal_entries` decide qué ve cada uno. El equipo
-- las ve enteras; un comprador ve, como mucho, lo suyo.
--
-- (La otra mitad de esa regla —una vidriera pública corre como su dueño— sigue
-- valiendo para `v_mercado`, y no se toca.)
alter view public.v_libro_diario set (security_invoker = true);
alter view public.v_libro_mayor set (security_invoker = true);
alter view public.v_egresos set (security_invoker = true);

comment on view public.v_libro_diario is
  'El libro diario. Corre como quien mira: la RLS de las tablas de origen '
  'decide qué ve cada uno. NO volver a definer — con el comprador teniendo '
  'cuenta, definer significa que cualquiera con usuario lee la contabilidad '
  'entera.';
