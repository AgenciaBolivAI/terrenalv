-- La vista del activo ya traía las cuentas y el proveedor; le faltaban los
-- datos de la compra que la pantalla ahora muestra y edita: la factura, la
-- forma de pago, el vencimiento, y la acumulada congelada de la baja. Van AL
-- FINAL, que es lo único que `create or replace` permite.
create or replace view public.v_activos_fijos as
select v.*,
       a.categoria_id,
       a.proveedor_contact_id,
       a.numero_factura,
       a.forma_pago,
       a.vencimiento,
       a.pagado_el,
       a.treasury_account_id,
       a.dep_acumulada_baja,
       tp.name as pagado_de,
       tc.name as comprado_de,
       cat.cuenta_activo as cuenta_activo_codigo,
       ca.name as cuenta_activo_nombre
  from public.v_activos_fijos v
  join public.fixed_assets a on a.id = v.id
  join public.asset_categories cat on cat.id = a.categoria_id
  left join public.chart_of_accounts ca on ca.code = cat.cuenta_activo
  left join public.treasury_accounts tp on tp.id = a.pagado_de
  left join public.treasury_accounts tc on tc.id = a.treasury_account_id;
