-- Quedaba UNA fila en rojo: ING-0002 (glosa «wsx», un comprobante manual de
-- prueba del 27/08) asentado a mano en 1111 cuando 1111 todavía era una hoja.
-- Hoy 1111 es cuenta titular —tiene hijas 1111.00 y 1111.01— y el guardián
-- tiene razón en cantarlo.
--
-- La reclasificación que haría cualquier contador: la línea se muda a
-- «1111.00 · Caja y Bancos sin especificar». No cambia ni un total: la hoja
-- suma a la misma madre, y el comprobante sigue cuadrando igual.
--
-- Para adelante no hace falta candado nuevo: admin_save_voucher ya rechaza
-- asentar en cuentas con hijas (CUENTA_TITULAR) — esta línea es anterior a
-- que 1111 tuviera hijas.

update public.journal_lines
   set account_code = '1111.00'
 where account_code = '1111';
