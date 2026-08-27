-- El ámbito arranca en 'fiscal' a propósito.
--
-- Si el default fuera 'gerencial', crear una cuenta nueva la dejaría fuera
-- de lo declarado sin que nadie lo decida — y sub-declarar por descuido es
-- el error caro. Así, todo se propone declarar como hasta hoy, y sacar una
-- cuenta del libro fiscal es un acto deliberado.

alter table public.treasury_accounts alter column ambito set default 'fiscal';
update public.treasury_accounts set ambito = 'fiscal' where ambito = 'gerencial';

-- La cola de importación dice por qué cuenta pasó cada movimiento y si esa
-- cuenta declara. Es una vista del módulo FISCAL leyendo el gerencial: la
-- dirección permitida.
create or replace view public.v_fiscal_pendiente as
select d.project_id, d.origen, d.origen_id,
       min(d.fecha) as fecha,
       min(d.comprobante) as comprobante,
       min(d.glosa) as glosa,
       max(d.cliente) as cliente,
       max(d.titular) as titular,
       max(d.titular_nombre) as titular_nombre,
       round(sum(d.debe), 2) as debe,
       round(sum(d.haber), 2) as haber,
       (x.origen is not null) as excluido,
       x.motivo as motivo_exclusion,
       max(ta.name)   as cuenta_nombre,
       max(ta.ambito) as cuenta_ambito
  from public.v_libro_diario d
  left join public.fiscal_exclusiones x
         on x.origen = d.origen and x.origen_id = d.origen_id
  -- Por qué caja o banco pasó: los cobros y los egresos lo tienen; una venta
  -- o un comprobante manual, no.
  left join public.payments  pg on d.origen = 'pago'   and pg.id = d.origen_id
  left join public.expenses  eg on d.origen = 'egreso' and eg.id = d.origen_id
  left join public.treasury_accounts ta
         on ta.id = coalesce(pg.treasury_account_id, eg.treasury_account_id)
 where not exists (
         select 1 from public.fiscal_comprobantes f
          where f.origen = d.origen and f.origen_id = d.origen_id
            and f.status = 'registrado')
 group by d.project_id, d.origen, d.origen_id, x.origen, x.motivo;

alter view public.v_fiscal_pendiente set (security_invoker = true);

-- Importar salta lo que pasó por una cuenta marcada como gerencial, igual
-- que salta lo que está a nombre de un tercero: son las dos formas de decir
-- «esto no se declara solo».
create or replace function public.fiscal_importar(
  p_project_id uuid,
  p_desde date,
  p_hasta date,
  p_incluir_terceros boolean default false,
  p_incluir_cuentas_gerenciales boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  r record;
  v_traidos int := 0;
  v_saltados_tercero int := 0;
  v_saltados_excluidos int := 0;
  v_saltados_cuenta int := 0;
  v_total numeric(14,2) := 0;
begin
  v_actor := private.assert_accounting();
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'RANGO_INVALIDO';
  end if;

  for r in
    select * from public.v_fiscal_pendiente
     where project_id = p_project_id and fecha between p_desde and p_hasta
     order by fecha, comprobante
  loop
    if r.excluido then
      v_saltados_excluidos := v_saltados_excluidos + 1;
      continue;
    end if;
    if r.titular = 'tercero' and not p_incluir_terceros then
      v_saltados_tercero := v_saltados_tercero + 1;
      continue;
    end if;
    if r.cuenta_ambito = 'gerencial' and not p_incluir_cuentas_gerenciales then
      v_saltados_cuenta := v_saltados_cuenta + 1;
      continue;
    end if;
    perform public.fiscal_importar_uno(r.origen, r.origen_id, 'importación por período');
    v_traidos := v_traidos + 1;
    v_total := v_total + coalesce(r.debe, 0);
  end loop;

  perform private.audit('team', v_actor, null, 'fiscal.importacion', p_project_id,
    'project', p_project_id, null,
    jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'traidos', v_traidos,
                       'saltados_tercero', v_saltados_tercero,
                       'saltados_excluidos', v_saltados_excluidos,
                       'saltados_cuenta', v_saltados_cuenta,
                       'incluir_terceros', p_incluir_terceros,
                       'incluir_cuentas_gerenciales', p_incluir_cuentas_gerenciales));

  return jsonb_build_object(
    'traidos', v_traidos, 'total', v_total,
    'saltados_tercero', v_saltados_tercero,
    'saltados_excluidos', v_saltados_excluidos,
    'saltados_cuenta', v_saltados_cuenta);
end;
$$;

grant execute on function public.fiscal_importar(uuid, date, date, boolean, boolean) to authenticated;
revoke execute on function public.fiscal_importar(uuid, date, date, boolean, boolean) from anon;

-- La firma vieja de 4 argumentos, fuera: dos firmas vivas es el bug de
-- «function is not unique» esperando a pasar.
drop function if exists public.fiscal_importar(uuid, date, date, boolean);

select count(*) as fugas from private.fiscal_fugas();
