-- Postgres puede repartir una consulta grande entre varios procesos, pero se
-- niega en cuanto la consulta toca UNA función marcada como "parallel unsafe".
-- Todas estas lo estaban, porque es lo que Postgres asume cuando uno no dice
-- nada. Ninguna escribe: leen pagos o traducen un código a una etiqueta.
--
-- Con veinte ventas no se nota. Con mil quinientas —que es donde va esto— la
-- diferencia es usar un solo núcleo o todos.

alter function private.capital_pagado(uuid)  parallel safe;
alter function private.base_del_lote(uuid)   parallel safe;
alter function private.etiqueta_origen(text) parallel safe;
alter function private.forma_de_pago(payment_provider_kind) parallel safe;
alter function private.origen_de_venta(text, jsonb, timestamptz, timestamptz) parallel safe;
alter function private.exigir_correo(text)   parallel safe;

-- A propósito NO se les clava el search_path a las de etiquetas.
--
-- El asesor de Supabase las marca, pero son SQL puro sobre valores sueltos:
-- no nombran ninguna tabla, así que no hay nada que un search_path hostil
-- pueda secuestrar. Y hay un costo real en clavárselo: una función SQL con
-- cláusula SET deja de poder incrustarse en la consulta que la llama, que es
-- justamente lo que las hace baratas hoy. Se dejan como están, a sabiendas.

-- Por qué v_mercado es SECURITY DEFINER y debe seguir siéndolo.
comment on view public.v_mercado is
  'Vidriera pública del mercado de traspasos. Es SECURITY DEFINER a propósito: '
  'quien mira sin cuenta no puede leer reservations, así que con security_invoker '
  'la vitrina saldría vacía. No expone datos de nadie — ni nombre, ni CI, ni '
  'teléfono, ni tracking_code — solo lote, medidas, precio y saldo a asumir. '
  'El asesor de seguridad la marca en ERROR por la regla general; acá está '
  'revisada y es la decisión correcta. No ponerle security_invoker.';
