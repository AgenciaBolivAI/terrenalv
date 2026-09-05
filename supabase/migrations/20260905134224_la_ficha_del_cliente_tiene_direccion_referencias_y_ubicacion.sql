-- La ficha del cliente sólo tenía lo que el comprador tipeó al reservar:
-- nombre, carnet, celular y correo. Faltaba lo que la oficina necesita para
-- ir a buscarlo — dirección, referencias para llegar, y el punto en el mapa.
--
-- Va en tabla propia y NO en `customers` por dos razones: `customers` son los
-- que se crearon una cuenta para entrar (hoy: cero), mientras que los clientes
-- de verdad viven en las reservas; y porque esto lo carga la OFICINA, no el
-- comprador. La llave es el carnet normalizado, que es como Clientes agrupa a
-- una persona en todas sus compras.

create table if not exists public.client_profiles (
  ci_normalized text primary key,
  direccion     text,
  -- Cómo se llega: «entre 2do y 3er anillo, portón verde, frente a la cancha».
  referencias   text,
  -- Un punto del mapa. Se acepta «-17.78,-63.18» o un enlace de Google Maps
  -- pegado tal cual; la pantalla arma el enlace y deja copiarlo.
  ubicacion     text,
  nota          text,
  updated_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.client_profiles enable row level security;

-- La lee el equipo que atiende clientes; la escribe quien puede editar la
-- sección Clientes. Un comprador nunca ve esta tabla.
drop policy if exists client_profiles_lee on public.client_profiles;
create policy client_profiles_lee on public.client_profiles
  for select to authenticated
  using ((select private.nivel_de((select auth.uid()), 'clientes')) <> 'no');

drop trigger if exists tg_client_profiles_solo_lectura on public.client_profiles;
create trigger tg_client_profiles_solo_lectura
  before insert or update or delete on public.client_profiles
  for each row execute function private.tg_solo_lectura('clientes');

create or replace function public.admin_guardar_ficha_cliente(
  p_ci text,
  p_direccion text default null,
  p_referencias text default null,
  p_ubicacion text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_ci text;
begin
  v_actor := private.assert_seccion('clientes');
  v_ci := private.normalizar_ci(p_ci);
  if coalesce(v_ci, '') = '' then raise exception 'BUYER_CI_REQUIRED'; end if;

  insert into public.client_profiles as cp
    (ci_normalized, direccion, referencias, ubicacion, nota, updated_by)
  values
    (v_ci,
     nullif(btrim(coalesce(p_direccion, '')), ''),
     nullif(btrim(coalesce(p_referencias, '')), ''),
     nullif(btrim(coalesce(p_ubicacion, '')), ''),
     nullif(btrim(coalesce(p_nota, '')), ''),
     v_actor)
  on conflict (ci_normalized) do update
     set direccion   = excluded.direccion,
         referencias = excluded.referencias,
         ubicacion   = excluded.ubicacion,
         nota        = excluded.nota,
         updated_by  = v_actor,
         updated_at  = now();

  perform private.audit('team', v_actor, null, 'cliente.ficha_guardada', null,
    'cliente', null, null,
    jsonb_build_object('ci', v_ci, 'con_direccion', p_direccion is not null,
                       'con_ubicacion', p_ubicacion is not null));

  return jsonb_build_object('ok', true, 'ci', v_ci);
end;
$function$;

grant execute on function public.admin_guardar_ficha_cliente(text, text, text, text, text) to authenticated;

-- La ficha, lista para leer junto al historial.
create or replace view public.v_ficha_cliente
with (security_invoker = on) as
  select cp.ci_normalized,
         cp.direccion,
         cp.referencias,
         cp.ubicacion,
         cp.nota,
         cp.updated_at,
         p.full_name as actualizado_por
    from public.client_profiles cp
    left join public.profiles p on p.id = cp.updated_by;

grant select on public.v_ficha_cliente to authenticated;
