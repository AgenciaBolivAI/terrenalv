-- Reparación: la envoltura que agregué llamaba a admin_reserve_offline_base,
-- que no existía — la reserva de mostrador con vendedor habría fallado en el
-- primer intento. Se renombra la implementación original a _base y la
-- envoltura pasa a ser la única puerta.
alter function public.admin_reserve_offline(
  uuid, text, text, text, text, int, text, public.payment_provider_kind)
  rename to admin_reserve_offline_base;

revoke execute on function public.admin_reserve_offline_base(
  uuid, text, text, text, text, int, text, public.payment_provider_kind)
  from public, anon;
grant execute on function public.admin_reserve_offline_base(
  uuid, text, text, text, text, int, text, public.payment_provider_kind)
  to authenticated, service_role;

revoke execute on function public.admin_reserve_offline(
  uuid, text, text, text, text, int, text, public.payment_provider_kind, uuid)
  from public, anon;
grant execute on function public.admin_reserve_offline(
  uuid, text, text, text, text, int, text, public.payment_provider_kind, uuid)
  to authenticated, service_role;
