-- Cuando el correlativo pasó a ser global (20260828194420) se dejó
-- private.next_voucher_number con UN solo argumento — el tipo — y se borró la
-- firma vieja (project_id, kind). Se parchearon los llamadores que se
-- ejercitaban a diario, pero quedaron TRES colgados llamando a la firma que ya
-- no existe:
--
--   admin_transfer_funds   → transferir plata entre caja y banco
--   admin_close_period     → cerrar la gestión
--   admin_post_reexpresion → asentar la reexpresión UFV
--
-- plpgsql resuelve la llamada recién cuando la línea se ejecuta, así que los
-- tres compilaron sin chistar y explotan en producción con
-- «42883 function private.next_voucher_number(uuid, unknown) does not exist».
-- Nadie lo notó porque no hay ni una treasury_accounts, ni un fiscal_periods,
-- ni un ufv_rates cargado: los tres caminos nunca se corrieron.
--
-- Se parchea con el idioma de la casa (definicion + replace + guardia), para no
-- reescribir tres funciones largas y arriesgar perder algo en el camino.

do $$
declare
  v_def text;
  v_objetivo text;
  r record;
begin
  for r in
    select * from (values
      ('public.admin_transfer_funds(uuid,uuid,uuid,numeric,date,text)',
       'private.next_voucher_number(p_project_id, ''traspaso'')',
       'private.next_voucher_number(''traspaso'')'),
      ('public.admin_close_period(uuid,integer,date,date)',
       'private.next_voucher_number(p_project_id, ''cierre'')',
       'private.next_voucher_number(''cierre'')'),
      ('public.admin_post_reexpresion(uuid,date,date)',
       'private.next_voucher_number(p_project_id, ''ajuste'')',
       'private.next_voucher_number(''ajuste'')')
    ) as t(firma, viejo, nuevo)
  loop
    v_def := pg_get_functiondef(r.firma::regprocedure);

    if position(r.viejo in v_def) = 0 then
      raise exception 'PARCHE_NO_AGARRA: % ya no dice %', r.firma, r.viejo;
    end if;

    v_objetivo := replace(v_def, r.viejo, r.nuevo);

    if position(r.nuevo in v_objetivo) = 0 then
      raise exception 'PARCHE_NO_AGARRA: % no quedó con la firma nueva', r.firma;
    end if;

    execute v_objetivo;
  end loop;
end $$;

-- Y que no vuelva a pasar en silencio: un guardián que busca la firma muerta en
-- CUALQUIER función de public/private. Si alguien vuelve a llamar
-- next_voucher_number con dos argumentos, esto se pone rojo antes del deploy en
-- vez de esperar a que un contador apriete «Transferir».
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
     and p.proname <> 'llamadas_al_correlativo_viejo'
     and position('next_voucher_number(p_' in pg_get_functiondef(p.oid)) > 0;
$$;
