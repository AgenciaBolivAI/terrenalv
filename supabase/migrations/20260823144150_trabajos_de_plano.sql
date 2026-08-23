-- Lectura de planos como trabajo en segundo plano.
--
-- Analizar el plano de Prados del Sur toma ~130 segundos: recorrer el stream
-- de contenido del PDF, nodar 15.000 segmentos sueltos y recuperar las caras
-- del grafo plano. Eso no puede colgar de una petición del navegador — si la
-- persona cierra la pestaña o se le corta el internet, el trabajo se pierde y
-- no queda ni rastro de por qué.
--
-- Con una fila por trabajo, el progreso sobrevive a la pestaña: se puede
-- recargar, volver mañana, o ver que falló y por qué.

create type public.plano_job_status as enum ('pendiente', 'procesando', 'listo', 'error');

create table if not exists public.plano_jobs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  sheet_id      uuid references public.plano_sheets (id) on delete set null,
  storage_path  text not null,
  status        public.plano_job_status not null default 'pendiente',
  etapa         text,
  -- Lo que el análisis encontró: capas, cuál parece la de lotes, qué escala.
  analisis      jsonb,
  -- La geometría ya extraída, cuando se confirma capa y escala.
  resultado     jsonb,
  capa_lotes    text,
  escala        int,
  error         text,
  -- Cuántos segundos tardó: si un plano grande se acerca al techo del runtime
  -- hay que saberlo antes de que empiece a fallar por tiempo.
  duracion_s    numeric(8,2),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists plano_jobs_proyecto on public.plano_jobs (project_id, created_at desc);
create index if not exists plano_jobs_pendientes on public.plano_jobs (status) where status in ('pendiente','procesando');

alter table public.plano_jobs enable row level security;
revoke insert, update, delete, truncate on public.plano_jobs from anon, authenticated;

create policy plano_jobs_read on public.plano_jobs
  for select to authenticated using (private.is_team());

create trigger set_updated_at before update on public.plano_jobs
  for each row execute function private.tg_set_updated_at();

-- Encolar. Devuelve el trabajo para que la pantalla lo siga desde el principio.
create or replace function public.admin_encolar_plano(
  p_project_id uuid, p_storage_path text, p_sheet_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_storage_path, '')) = '' then raise exception 'PLANO_REQUERIDO'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  -- Un solo trabajo activo por urbanización: dos lecturas del mismo plano a la
  -- vez solo gastan tiempo y confunden cuál resultado es el bueno.
  if exists (select 1 from public.plano_jobs
              where project_id = p_project_id and status in ('pendiente','procesando')) then
    raise exception 'YA_HAY_UNO_EN_CURSO';
  end if;

  insert into public.plano_jobs (project_id, sheet_id, storage_path, created_by)
  values (p_project_id, p_sheet_id, btrim(p_storage_path), v_actor)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'plano.encolado', p_project_id,
    'plano_job', v_id, null, jsonb_build_object('archivo', p_storage_path));

  return jsonb_build_object('job_id', v_id);
end;
$fn$;

revoke execute on function public.admin_encolar_plano(uuid, text, uuid) from public, anon;
grant execute on function public.admin_encolar_plano(uuid, text, uuid) to authenticated, service_role;
