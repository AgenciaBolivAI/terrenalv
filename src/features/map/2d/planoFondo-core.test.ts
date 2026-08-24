// Encaje del dibujo del topógrafo sobre el mapa.
//
// Si la transformada está mal, el plano queda corrido respecto de los lotes y
// nada falla a la vista: se ve un mapa plausible donde cada lote señala el
// terreno del vecino, y el comprador reserva el equivocado.

import { describe, expect, it } from 'vitest';
import { contenidoDelSvg, sanear, transformDeFondo } from './planoFondo-core';

/** Aplica a mano la transformada que el SVG aplicará, para comprobarla. */
function aplicar(t: string, x: number, y: number): [number, number] {
  const tr = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t)!;
  const sc = /scale\(([-\d.]+) ([-\d.]+)\)/.exec(t)!;
  const [tx, ty] = [Number(tr[1]), Number(tr[2])];
  const [sx, sy] = [Number(sc[1]), Number(sc[2])];
  return [x * sx + tx, y * sy + ty];
}

describe('transformDeFondo', () => {
  const spec = { url: 'x', m_por_unidad: 2, origen_unidades: [10, 100] as [number, number] };

  it('lleva el origen del dibujo al origen del mapa', () => {
    const [x, y] = aplicar(transformDeFondo(spec), 10, 100);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('convierte unidades de dibujo a metros', () => {
    // 5 unidades a la derecha del origen, a 2 m/unidad = 10 m
    const [x] = aplicar(transformDeFondo(spec), 15, 100);
    expect(x).toBeCloseTo(10);
  });

  it('invierte la Y: el dibujo la lleva hacia abajo y el mapa hacia arriba', () => {
    // 5 unidades MÁS ABAJO en el dibujo (y mayor) es más al SUR: y negativa.
    const [, y] = aplicar(transformDeFondo(spec), 10, 105);
    expect(y).toBeCloseTo(-10);
    // y 5 unidades más arriba es y positiva
    const [, y2] = aplicar(transformDeFondo(spec), 10, 95);
    expect(y2).toBeCloseTo(10);
  });

  it('sin origen declarado no desplaza', () => {
    const t = transformDeFondo({ url: 'x', m_por_unidad: 3, origen_unidades: null });
    const [x, y] = aplicar(t, 0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });
});

describe('contenidoDelSvg', () => {
  it('devuelve lo de adentro, sin la etiqueta <svg>', () => {
    const r = contenidoDelSvg('<svg viewBox="0 0 1 1"><rect/></svg>');
    expect(r).toBe('<rect/>');
  });

  it('devuelve null si no hay svg', () => {
    expect(contenidoDelSvg('<p>hola</p>')).toBeNull();
  });
});

describe('sanear', () => {
  it('quita <script>', () => {
    expect(sanear('<g></g><script>alert(1)</script>')).not.toContain('script');
  });

  it('quita manejadores de evento', () => {
    expect(sanear('<rect onclick="robar()" />')).not.toContain('onclick');
    expect(sanear("<rect onload='x' />")).not.toContain('onload');
  });

  it('neutraliza javascript: en un enlace', () => {
    expect(sanear('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('deja intacto el dibujo', () => {
    const svg = '<path d="M0,0L5,5Z" fill="#eee"/><text x="1" y="2">15.00</text>';
    expect(sanear(svg)).toBe(svg);
  });
});
