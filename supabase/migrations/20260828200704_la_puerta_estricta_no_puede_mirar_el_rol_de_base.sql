-- `assert_contabilidad` copiaba de `ve_contabilidad` el atajo «si no corre
-- como authenticated/anon, es un trabajo interno y no se filtra». En una
-- VISTA eso está bien: las vistas corren como quien mira. En un RPC no: los
-- RPC son SECURITY DEFINER, así que adentro `current_user` es el DUEÑO de la
-- función, nunca el vendedor — y la puerta se abría sola para todos.
--
-- Se vio en la prueba: Beymar pasaba el assert y el egreso solo lo frenaba,
-- de casualidad, el candado de solo lectura. Un guardián que solo funciona
-- porque otro guardián estaba detrás no es un guardián.
--
-- Acá la pregunta correcta es por la SESIÓN (auth.uid()), que sobrevive al
-- security definer, más la clave de servicio para los trabajos.
create or replace function private.assert_contabilidad()
returns uuid
language plpgsql
stable
set search_path to 'public', 'private'
as $$
begin
  if not private.is_service()
     and private.nivel_de((select auth.uid()), 'contabilidad') <> 'edita' then
    raise exception 'NO_AUTORIZADO'
      using detail = 'La contabilidad es de Contabilidad y de Administración.';
  end if;
  return auth.uid();
end;
$$;

comment on function private.assert_contabilidad is
  'La puerta del LIBRO: asientos manuales, egresos, plan de cuentas, '
  'tesorería y cierre de gestión. Mira el techo del rol vía nivel_de, así '
  'que un vendedor no entra ni con el permiso guardado a mano. NO usar '
  'current_user acá: adentro de un RPC security definer es el dueño de la '
  'función, no la persona.';

grant execute on function private.assert_contabilidad() to authenticated;
