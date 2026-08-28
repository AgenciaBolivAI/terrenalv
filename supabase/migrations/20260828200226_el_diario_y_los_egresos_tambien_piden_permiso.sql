-- Faltaban las dos de la base: gatear solo las vistas de arriba dejaba
-- `v_libro_diario` y `v_egresos` abiertas a cualquiera del equipo, y son
-- justamente las que traen el detalle.
--
-- Se envuelve la definición que ya tienen en vez de reescribirla: el diario
-- son once ramas unidas por UNION ALL con la lógica de qué cuenta toca cada
-- operación, y volver a tipearla para agregarle un WHERE es la forma más
-- segura de introducir un error en la única vista que no puede tener errores.
do $$
declare v_def text;
begin
  select pg_get_viewdef('public.v_libro_diario'::regclass, true) into v_def;
  if position('ve_contabilidad' in v_def) = 0 then
    execute 'create or replace view public.v_libro_diario as select * from ('
            || rtrim(rtrim(v_def), ';')
            || ') libro where private.ve_contabilidad()';
  end if;

  select pg_get_viewdef('public.v_egresos'::regclass, true) into v_def;
  if position('ve_contabilidad' in v_def) = 0 then
    execute 'create or replace view public.v_egresos as select * from ('
            || rtrim(rtrim(v_def), ';')
            || ') egresos where private.ve_contabilidad()';
  end if;
end $$;

alter view public.v_libro_diario set (security_invoker = true);
alter view public.v_egresos set (security_invoker = true);
