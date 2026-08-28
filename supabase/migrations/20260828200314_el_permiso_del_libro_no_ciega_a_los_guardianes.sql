-- El filtro de permiso que le puse al libro dejó ciego a `verificar_integridad`:
-- corre como definer, sin sesión de nadie, así que el filtro le devolvía CERO
-- filas y «diario_cuadra» pasaba con debe 0 / haber 0. Un guardián que mira un
-- libro vacío y dice que todo cuadra es peor que no tener guardián: los otros
-- dos («todo pago aprobado está en el libro», «la cuenta por cobrar es la de
-- pantalla») se pusieron en rojo y delataron el problema.
--
-- La distinción correcta no es «hay sesión o no» —eso es el error que ya
-- cometí con el candado de solo lectura— sino CON QUÉ ROL DE BASE corre la
-- consulta. Una persona por la API corre como `authenticated` o `anon`. Los
-- guardianes, los trabajos internos y la clave de servicio corren con otro
-- rol, y a esos no se los filtra.
--
-- Por eso esta función NO es security definer: necesita ver el rol de quien
-- pregunta, no el suyo. Para leer `profiles` se apoya en `nivel_de`, que sí lo
-- es.
create or replace function private.ve_contabilidad()
returns boolean
language sql
stable
set search_path to 'public', 'private'
as $$
  select current_user not in ('authenticated', 'anon')
      or private.nivel_de((select auth.uid()), 'contabilidad') <> 'no';
$$;

comment on function private.ve_contabilidad is
  'Quién puede LEER el libro: admin y contabilidad por rol, más quien tenga el '
  'permiso «contabilidad» abierto a mano. Es la misma regla que decide si la '
  'sección aparece en el panel — una sola verdad. Las consultas que no vienen '
  'de una persona (guardianes, trabajos internos, clave de servicio) no se '
  'filtran: filtrarlas haría que los guardianes revisaran un libro vacío.';

grant execute on function private.ve_contabilidad() to authenticated, anon;
grant execute on function private.nivel_de(uuid, text) to authenticated;
