// Qué puede ver y tocar cada persona, sección por sección.
//
// El techo lo pone el ROL (la base no deja a un vendedor tocar contabilidad,
// tenga el permiso que tenga). Los permisos RECORTAN debajo de ese techo:
// «este vendedor solo ve Lotes y Planes», «esta persona mira Contabilidad
// pero no la toca». La verdad vive en la base — private.nivel_de() — y llega
// al panel ya resuelta por mi_acceso(); acá solo están los tipos, el mapa de
// ruta→sección y las etiquetas del editor de permisos.

export type Nivel = 'no' | 've' | 'edita';
export type NivelAnalitica = 'no' | 'propia' | 'empresa';

/** Lo que devuelve mi_acceso(): nivel efectivo por sección, defaults resueltos. */
export type Acceso = Record<string, string>;

/** Las secciones del panel, con su etiqueta para el editor de permisos. */
export const SECCIONES: { clave: string; etiqueta: string; grupo: string }[] = [
  { clave: 'panel', etiqueta: 'Dashboard', grupo: 'Mostrador' },
  { clave: 'reservas', etiqueta: 'Reservas', grupo: 'Mostrador' },
  { clave: 'ventas', etiqueta: 'Ventas', grupo: 'Mostrador' },
  { clave: 'clientes', etiqueta: 'Clientes', grupo: 'Mostrador' },
  { clave: 'notificaciones', etiqueta: 'Notificaciones', grupo: 'Mostrador' },
  { clave: 'mi-cuenta', etiqueta: 'Mi cuenta', grupo: 'Mostrador' },
  { clave: 'contabilidad', etiqueta: 'Contabilidad gerencial', grupo: 'Cobranza' },
  { clave: 'fiscal', etiqueta: 'Contabilidad fiscal', grupo: 'Cobranza' },
  { clave: 'inventario', etiqueta: 'Inventario de terrenos', grupo: 'Cobranza' },
  { clave: 'activos', etiqueta: 'Activos fijos', grupo: 'Cobranza' },
  { clave: 'rrhh', etiqueta: 'Recursos Humanos', grupo: 'Empresa' },
  { clave: 'planes', etiqueta: 'Planes de pago', grupo: 'Cobranza' },
  { clave: 'comisiones', etiqueta: 'Comisiones', grupo: 'Cobranza' },
  { clave: 'financiamiento', etiqueta: 'Financiamiento', grupo: 'Cobranza' },
  { clave: 'analitica', etiqueta: 'Analítica', grupo: 'Cobranza' },
  { clave: 'mercado', etiqueta: 'Mercado', grupo: 'Traspasos' },
  { clave: 'traspasos', etiqueta: 'Traspasos', grupo: 'Traspasos' },
  { clave: 'lotes', etiqueta: 'Lotes', grupo: 'Terreno' },
  { clave: 'mapa', etiqueta: 'Mapa', grupo: 'Terreno' },
  { clave: 'proyectos', etiqueta: 'Urbanizaciones', grupo: 'Terreno' },
  { clave: 'equipo', etiqueta: 'Equipo', grupo: 'Empresa' },
  { clave: 'configuracion', etiqueta: 'Configuración', grupo: 'Empresa' },
  { clave: 'auditoria', etiqueta: 'Auditoría', grupo: 'Empresa' },
];

/**
 * A qué sección pertenece una ruta del panel.
 *
 * /admin es el dashboard; /admin/plan/[id] y /admin/recibo/[id] son papeles
 * que se abren desde Planes y Contabilidad, así que heredan esas secciones;
 * /admin/contrato/[id] se abre desde Ventas.
 */
export function seccionDe(pathname: string): string {
  const resto = pathname.replace(/^\/admin\/?/, '');
  if (resto === '') return 'panel';
  const primera = resto.split('/')[0];
  if (primera === 'plan') return 'planes';
  if (primera === 'recibo') return 'contabilidad';
  // El fiscal es su propia seccion: se puede dar el gerencial sin dar el
  // fiscal, y al reves.
  if (primera === 'fiscal') return 'fiscal';
  if (primera === 'contrato') return 'ventas';
  return primera;
}

/** ¿Puede al menos mirar esta sección? */
export function puedeVer(acceso: Acceso | null | undefined, seccion: string): boolean {
  if (!acceso) return true; // sin datos de acceso, manda el filtro por rol de siempre
  const nivel = acceso[seccion];
  if (nivel === undefined) return true; // sección sin gobernar (p. ej. ruta nueva)
  return nivel !== 'no';
}
