-- El guardián «cuotas_parejas» exigía que TODAS las cuotas pendientes de un
-- plan vivo fueran iguales. Pero en los planes migrados del sistema viejo la
-- PRIMERA cuota trae el ajuste inicial (Bs 4.125 y el resto 4.034,09, por
-- ejemplo) — hoy hay cinco planes activos así, y pasaban solo porque esa
-- primera cuota ya estaba pagada. Anular su pago la revivía y el guardián
-- gritaba por un plan que siempre fue así.
--
-- La regla honesta: las cuotas van parejas SALVO la primera, que puede traer
-- el ajuste del arranque. Cualquier despareje del medio del plan sigue
-- atrapado.
do $$
declare
  v_src text;
  v_old text := $blk$     where pl.status = 'activo'
       and i.status in ('pendiente','parcial')
     group by i.plan_id, pl.monthly_interest_pct$blk$;
  v_new text := $blk$     where pl.status = 'activo'
       and i.status in ('pendiente','parcial')
       -- La primera cuota puede traer el ajuste inicial: queda fuera de la
       -- comparación. El despareje del medio del plan sigue atrapado.
       and i.number > 1
     group by i.plan_id, pl.monthly_interest_pct$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname = 'verificar_integridad' and pronamespace = 'public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el bloque de cuotas_parejas para parchar';
  end if;
  -- Solo el bloque de cuotas_parejas usa este filtro con group by: una sola
  -- aparición, o el parche no procede.
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el bloque aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;
