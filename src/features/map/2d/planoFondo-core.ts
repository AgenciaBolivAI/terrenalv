// Cómo se encaja el dibujo del topógrafo sobre el mapa.
//
// Separado del componente para poder probarlo: si la transformada está mal, el
// plano queda corrido respecto de los lotes y NADA falla — se ve un mapa
// plausible en el que cada lote señala el terreno del vecino.

export interface PlanoFondoSpec {
  url: string;
  m_por_unidad: number;
  /** [x, y] en unidades de dibujo desde donde se midieron los lotes. */
  origen_unidades: [number, number] | null;
}

/**
 * Transforma unidades de dibujo a metros de plano.
 *
 * El dibujo lleva la Y hacia abajo (como el PDF del que salió) y el mapa la
 * lleva hacia arriba, así que la escala en Y va negativa. El origen es el
 * mismo punto desde el que se midieron los lotes: sin restarlo, el dibujo y
 * los lotes quedarían desplazados uno respecto del otro.
 */
export function transformDeFondo(spec: PlanoFondoSpec): string {
  const e = spec.m_por_unidad;
  const [ox, oy] = spec.origen_unidades ?? [0, 0];
  return `translate(${(-ox * e).toFixed(3)} ${(oy * e).toFixed(3)}) scale(${e} ${-e})`;
}

/** Se queda con lo de adentro del <svg>, que es lo que se puede injertar. */
export function contenidoDelSvg(texto: string): string | null {
  const abre = texto.indexOf('<svg');
  if (abre === -1) return null;
  const finAbre = texto.indexOf('>', abre);
  const cierra = texto.lastIndexOf('</svg>');
  if (finAbre === -1 || cierra === -1 || cierra <= finAbre) return null;
  return sanear(texto.slice(finAbre + 1, cierra));
}

/**
 * Saca cualquier cosa ejecutable del dibujo.
 *
 * El archivo sale de nuestro bucket, donde solo escribe la clave de servicio,
 * así que hoy no debería traer nada de esto. Pero se inyecta con
 * dangerouslySetInnerHTML: si alguna vez se sube un SVG de otra procedencia,
 * el costo de no haber limpiado sería ejecutar código de un tercero en la
 * sesión del comprador. Limpiar cuesta un replace.
 */
export function sanear(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

