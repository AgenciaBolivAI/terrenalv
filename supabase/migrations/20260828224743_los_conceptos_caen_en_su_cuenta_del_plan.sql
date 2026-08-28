-- CADA CONCEPTO, EN SU CUENTA DEL PLAN.
--
-- Los 28 conceptos de egreso apuntaban a cuatro cuentas gruesas: la luz, el
-- alquiler, el combustible, la limpieza y el software caían TODOS en «5411
-- Gastos de Administración». Con el plan cargado eso ya no tiene excusa: el
-- plan trae ENERGIA ELECTRICA, AGUA POTABLE, ALQUUILERES (con la errata del
-- plan, a propósito), COMBUSTIBLES, LIMPIEZA, cada una con su código.
--
-- OJO para el futuro: el diario deriva la cuenta del concepto AL LEER. Hoy no
-- hay egresos, así que esto no reexpresa nada; el día que los haya, cambiar
-- un concepto de cuenta MUEVE los asientos viejos. Si hace falta cambiarlo con
-- historia cargada, se crea un concepto nuevo y se da de baja el viejo.
update public.expense_concepts c set account_code = m.cuenta, updated_at = now()
  from (values
    ('PER-CS',   '5.01.03.060'),  -- APORTES PATRONALES
    ('PER-AGUI', '5.01.03.080'),  -- AGUINALDOS
    ('PER-UNIF', '5.01.03.120'),  -- UNIFORMES
    ('PER-CAP',  '5.01.03.130'),  -- CAPACITACION
    ('PER-VIAT', '5.01.04.030'),  -- PASAJES Y VIATICOS
    ('SB-LUZ',   '5.01.05.010'),  -- ENERGIA ELECTRICA
    ('SB-AGUA',  '5.01.05.020'),  -- AGUA POTABLE
    ('SB-INT',   '5.01.05.050'),  -- INTERNET. HOSTING Y DOMINIO
    ('OF-ALQ',   '5.01.04.080'),  -- ALQUUILERES (sic, así viene el plan)
    ('OF-PAP',   '5.01.04.010'),  -- MATERIAL DE ESCRITORIO
    ('OF-LIMP',  '5.01.07.080'),  -- LIMPIEZA
    ('OF-MANT',  '5.01.07.040'),  -- MANT. EQUIPOS E INSTALACIONES
    ('OP-COMB',  '5.01.04.070'),  -- COMBUSTIBLES
    ('OP-VEH',   '5.01.07.060'),  -- MANT. VEHICULOS
    ('OP-SEG',   '5.01.04.090'),  -- SEGUROS
    ('OP-HON',   '5.01.04.200'),  -- HONORARIOS PROFESIONALES
    ('OP-SOFT',  '5.01.04.040'),  -- SUSCRIPCIONES
    ('COM-EVE',  '5.01.06.020'),  -- PROMOCIONES
    ('FIN-BAN',  '5.02.01.040'),  -- OTROS GASTOS BANCARIOS
    ('FIN-INT',  '5.02.01.010')   -- INTERESES BANCARIOS
  ) as m(codigo, cuenta)
 where c.codigo = m.codigo;

-- Los que quedan como están, y por qué: PER-SUE en 5221 (que ES 5.01.03.010
-- SUELDOS Y SALARIOS), COM-PUB en 5311 (= 5.01.06.010 PUBLICIDAD Y
-- PROPAGANDA), COM-COMI en 5211 (= 5.01.04.190 COMISIONES SOBRE VENTAS),
-- IMP-IMP en 5511, OTR-VAR en 5911, y los OBRA-* en 5111, que normalmente
-- capitalizan por centro de costos.

-- Faltaban dos servicios básicos que el plan sí tiene.
insert into public.expense_concepts (codigo, nombre, categoria, account_code, ayuda, sort_order, is_active)
select * from (values
  ('SB-TEL', 'Teléfono', 'administracion'::expense_category, '5.01.05.040',
   'La línea fija o el plan de celular de la oficina.', 111, true),
  ('SB-GAS', 'Gas', 'administracion'::expense_category, '5.01.05.030',
   'Garrafas o gas domiciliario de la oficina.', 112, true)
) as v(codigo, nombre, categoria, account_code, ayuda, sort_order, is_active)
 where not exists (select 1 from public.expense_concepts ec
                    where lower(btrim(ec.codigo)) = lower(btrim(v.codigo)));

-- Ningún concepto puede apuntar a una cuenta TITULAR (las que agrupan): el
-- asiento se caería recién al cargar el egreso.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.expense_concepts ec
   where ec.account_code is not null
     and exists (select 1 from public.chart_of_accounts h
                  where h.parent_code = ec.account_code and h.is_active);
  if v_n > 0 then
    raise exception 'CONCEPTO_EN_CUENTA_TITULAR'
      using detail = format('%s concepto(s) apuntan a una cuenta que agrupa.', v_n);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Y que el registro de comprobantes nombre bien lo nuevo, en vez de decir
-- «Activo» y «Fondo» a secas.
-- ---------------------------------------------------------------------------
create or replace view public.v_comprobantes as
select d.project_id,
       p.name as proyecto,
       d.comprobante as numero,
       d.origen,
       d.origen_id,
       case d.origen
         when 'comprobante' then 'Comprobante manual'
         when 'egreso'      then 'Comprobante de egreso'
         when 'venta'       then 'Venta'
         when 'pago'        then 'Recibo de cobro'
         when 'terreno'     then 'Compra de terreno'
         when 'activo'      then 'Activo fijo'
         when 'fondo'       then 'Fondo a rendir'
         else initcap(d.origen)
       end as tipo,
       min(d.fecha) as fecha,
       min(d.glosa) as glosa,
       count(*) as lineas,
       sum(d.debe) as debe,
       sum(d.haber) as haber,
       round(sum(d.debe) - sum(d.haber), 2) as diferencia,
       max(d.registrado_en) as registrado_en,
       max(d.modificado_en) as modificado_en,
       min(d.usuario_id::text)::uuid as usuario_id,
       min(d.usuario) as usuario,
       min(d.moneda) as moneda,
       max(d.tipo_cambio) as tipo_cambio,
       min(d.centro_costo) as centro_costo,
       min(d.cliente) as cliente,
       d.origen = 'comprobante' as es_manual
  from public.v_libro_diario d
  join public.projects p on p.id = d.project_id
 where private.ve_contabilidad()
 group by d.project_id, p.name, d.comprobante, d.origen, d.origen_id;

alter view public.v_comprobantes set (security_invoker = true);
