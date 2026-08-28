// Alcance del tablero: qué urbanización, qué período, y en qué moneda se leen
// las cifras.
//
// Estas reglas son chicas y aburridas, y por eso mismo son peligrosas: si
// `pickMoney` lee la columna equivocada, el consolidado suma dólares con
// bolivianos y NADA falla a la vista — sale un número plausible y mentiroso.

import { describe, expect, it } from 'vitest';
import { PERIODS, periodStart, pickMoney, scopeCurrency, scopeLabel } from './scope-core';
import type { AdminProject } from '@/features/admin/lib/project-types';

const PRADOS: AdminProject = {
  id: 'p1', slug: 'prados-del-sur', name: 'Prados del Sur', currency: 'BOB', es_administracion: false,
};
const MIRADOR: AdminProject = {
  id: 'p2', slug: 'mirador', name: 'Mirador del Este', currency: 'BOB', es_administracion: false,
};

describe('pickMoney', () => {
  const fila = { valor: 1000, valor_bob: 6960 };

  it('una urbanización sola lee la columna en su moneda', () => {
    expect(pickMoney(fila, 'valor', false)).toBe(1000);
  });

  it('consolidado lee la columna normalizada a bolivianos', () => {
    expect(pickMoney(fila, 'valor', true)).toBe(6960);
  });

  it('si no existe la columna _bob cae a la original en vez de dar 0', () => {
    // Una vista vieja sin normalizar no debe hacer desaparecer la cifra del
    // tablero: es peor un cero silencioso que un número sin convertir.
    expect(pickMoney({ valor: 500 }, 'valor', true)).toBe(500);
  });

  it('un campo ausente da 0 y no NaN', () => {
    expect(pickMoney({}, 'valor', false)).toBe(0);
    expect(pickMoney({ valor: null }, 'valor', true)).toBe(0);
  });

  it('un valor no numérico da 0 y no NaN', () => {
    // Postgres devuelve numeric como string; un texto suelto no debe
    // propagarse como NaN y envenenar toda la suma de la columna.
    expect(pickMoney({ valor: 'x' }, 'valor', false)).toBe(0);
  });

  it('acepta numeric de Postgres, que llega como string', () => {
    expect(pickMoney({ valor: '1234.56' }, 'valor', false)).toBeCloseTo(1234.56);
  });
});

describe('scopeCurrency', () => {
  it('consolidado siempre en bolivianos', () => {
    expect(scopeCurrency(null, [PRADOS, MIRADOR])).toBe('BOB');
  });

  it('una urbanización usa la suya', () => {
    expect(scopeCurrency('p1', [PRADOS, MIRADOR])).toBe('BOB');
  });

  it('una urbanización desconocida cae a bolivianos', () => {
    expect(scopeCurrency('no-existe', [PRADOS])).toBe('BOB');
  });
});

describe('scopeLabel', () => {
  it('con una sola urbanización dice su nombre, no "todas"', () => {
    // "Todas las urbanizaciones (1)" es ruido cuando solo hay una.
    expect(scopeLabel(null, [PRADOS])).toBe('Prados del Sur');
  });

  it('con varias dice cuántas', () => {
    expect(scopeLabel(null, [PRADOS, MIRADOR])).toBe('Todas las urbanizaciones (2)');
  });

  it('con una elegida dice su nombre', () => {
    expect(scopeLabel('p2', [PRADOS, MIRADOR])).toBe('Mirador del Este');
  });

  it('sin urbanizaciones no revienta', () => {
    expect(typeof scopeLabel(null, [])).toBe('string');
  });
});

describe('periodStart', () => {
  it('"Todo" no pone piso de fecha', () => {
    expect(periodStart(null)).toBeNull();
  });

  it('devuelve yyyy-mm-dd', () => {
    expect(periodStart(30)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('90 días queda antes que 30 días', () => {
    expect(periodStart(90)!.localeCompare(periodStart(30)!)).toBeLessThan(0);
  });

  it('el período más largo de la lista es el más viejo', () => {
    const conDias = PERIODS.filter((p) => p.days !== null);
    const fechas = conDias.map((p) => periodStart(p.days)!);
    expect([...fechas].sort()).toEqual([...fechas].reverse().sort());
  });
});
