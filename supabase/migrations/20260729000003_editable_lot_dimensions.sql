-- ============================================================================
-- Frente × fondo editable desde /admin/lotes
--
-- `lots` no se actualiza columna por columna desde el cliente: hay un GRANT
-- por columna (category_id, price_override, needs_review) y todo lo demás sólo
-- se toca por RPC. frontage_m/depth_m quedaron fuera porque nacen de la
-- geometría, pero son datos del plano que el equipo necesita corregir a mano:
-- el plano dice 12 × 25 y la subdivisión automática no siempre acierta.
--
-- Al abrirlos al cliente hacen falta dos cosas que antes daba el RPC:
--   1. Un tope. La restricción vieja sólo exigía > 0, así que un 250 tecleado
--      en lugar de 25 se publicaba al comprador sin resistencia.
--   2. Auditoría. Frente y fondo aparecen en la ficha del lote que ve el
--      comprador; un cambio en esos números debe quedar registrado como
--      cualquier cambio de precio.
-- ============================================================================

-- 1. Tope de cordura. El lote más grande del proyecto mide 12 × 25 m; 1.000 m
--    deja muchísimo margen para cualquier proyecto futuro y aun así atrapa el
--    dedo gordo. Las restricciones viejas (> 0) se mantienen.
alter table public.lots drop constraint if exists lots_frontage_m_max_check;
alter table public.lots add constraint lots_frontage_m_max_check
  check (frontage_m is null or frontage_m <= 1000);

alter table public.lots drop constraint if exists lots_depth_m_max_check;
alter table public.lots add constraint lots_depth_m_max_check
  check (depth_m is null or depth_m <= 1000);

-- 2. El GRANT por columna sigue siendo la lista blanca; sólo crece en dos.
--    RLS (lots_admin_update) sigue exigiendo administrador.
grant update (frontage_m, depth_m) on public.lots to authenticated;

-- 3. Auditar el cambio igual que precio/categoría/estado.
create or replace function private.tg_audit_lot_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (old.status is distinct from new.status)
     or (old.price_override is distinct from new.price_override)
     or (old.category_id is distinct from new.category_id)
     or (old.deleted_at is distinct from new.deleted_at)
     or (old.frontage_m is distinct from new.frontage_m)
     or (old.depth_m is distinct from new.depth_m) then
    perform private.audit(
      case when auth.uid() is not null then 'team'::public.actor_type
           else 'system'::public.actor_type end,
      auth.uid(), null, 'lot.changed', new.project_id, 'lot', new.id,
      jsonb_build_object('status', old.status, 'price_override', old.price_override,
                         'category_id', old.category_id, 'deleted_at', old.deleted_at,
                         'frontage_m', old.frontage_m, 'depth_m', old.depth_m),
      jsonb_build_object('status', new.status, 'price_override', new.price_override,
                         'category_id', new.category_id, 'deleted_at', new.deleted_at,
                         'frontage_m', new.frontage_m, 'depth_m', new.depth_m));
  end if;
  return new;
end;
$$;
