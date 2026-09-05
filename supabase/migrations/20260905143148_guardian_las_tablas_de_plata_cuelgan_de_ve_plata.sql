-- Las tres tablas de plata tienen que colgar de `private.ve_plata()`. Si
-- alguien las devuelve a `is_team()` —que es como estaban— cualquiera del
-- equipo vuelve a leer los 59 pagos aunque su permiso diga «no».
--
-- Se mira por OID del catálogo (`pg_depend`), NO por el texto de la política:
-- `pg_policies.qual` omite el esquema cuando la función es visible en el
-- `search_path`, y por eso un guardián por texto ya nos dio verde con el
-- agujero abierto una vez.
create or replace function private.tablas_de_plata_sin_su_puerta()
returns table(tabla text)
language sql stable
set search_path to 'public', 'private', 'pg_temp'
as $function$
  with quieren as (
    select unnest(array['payments','installments','installment_plans']) as t
  ), tienen as (
    select distinct c.relname::text as t
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_depend d on d.objid = pol.oid and d.classid = 'pg_policy'::regclass
      join pg_proc pr on pr.oid = d.refobjid and d.refclassid = 'pg_proc'::regclass
      join pg_namespace n on n.oid = pr.pronamespace
     where pol.polcmd in ('r', '*')
       and n.nspname = 'private'
       and pr.proname = 've_plata'
  )
  select q.t from quieren q where q.t not in (select t from tienen);
$function$;

do $$
declare
  v_def text;
  v_anchor text := $a$  -- Sumas y Saldos y el Balance General dicen el mismo saldo por cuenta.$a$;
  v_extra text := $x$  -- Los pagos, las cuotas y los planes se leen sólo con permiso de plata.
  select count(*) into v_n from private.tablas_de_plata_sin_su_puerta();
  return query select 'la_plata_cuelga_de_su_puerta'::text, (v_n = 0),
    format('%s tabla(s) de plata sin ve_plata() en su política de lectura', v_n);

$x$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';
  if position(v_anchor in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró el ancla';
  end if;
  if position('la_plata_cuelga_de_su_puerta' in v_def) > 0 then
    raise exception 'PARCHE_NO_AGARRA: el guardián ya estaba';
  end if;
  execute replace(v_def, v_anchor, v_extra || v_anchor);
end $$;
