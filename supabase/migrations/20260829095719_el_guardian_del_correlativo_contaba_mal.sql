-- El guardián recién puesto buscaba el texto «next_voucher_number(p_», que es
-- demasiado flojo y se comía dos inocentes:
--
--   admin_save_voucher — llama next_voucher_number(p_kind), UN argumento, bien.
--   verificar_integridad — el propio mensaje del chequeo nombraba la firma
--                          vieja, así que el guardián se denunciaba a sí mismo.
--
-- Ahora se mide la ARIDAD de verdad: una coma dentro del paréntesis. Y el
-- mensaje deja de escribir la firma para no volver a morderse la cola.

create or replace function private.llamadas_al_correlativo_viejo()
returns int
language sql
stable
set search_path to 'public', 'private'
as $$
  select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind = 'f'
     and p.proname not in ('llamadas_al_correlativo_viejo', 'next_voucher_number')
     -- Una coma antes de cerrar el paréntesis = dos argumentos = la firma
     -- muerta. Un solo identificador adentro es la firma buena.
     and pg_get_functiondef(p.oid) ~ 'next_voucher_number\s*\(\s*[A-Za-z_][A-Za-z0-9_.]*\s*,';
$$;

do $$
declare
  v_def text;
  v_viejo text := $viejo$    format('%s función(es) llamando a next_voucher_number(project_id, kind)', v_n);$viejo$;
  v_nuevo text := $nuevo$    format('%s función(es) llaman al correlativo con la firma vieja de dos argumentos', v_n);$nuevo$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no está el mensaje viejo del chequeo';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
