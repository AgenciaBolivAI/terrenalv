// La fecha con la que se guarda la plata.
//
// Bolivia es UTC-4 fijo, sin horario de verano. El atajo de siempre
// —`toISOString().slice(0, 10)`— devuelve el día UTC, así que entre las 20:00 y
// la medianoche en La Paz da MAÑANA: un cobro de las nueve de la noche quedaba
// fechado al día siguiente, en otro mes y, si el mes estaba por cerrarse, del
// lado equivocado del cierre. Estas pruebas fijan justamente ese borde.

import { describe, expect, it } from 'vitest';
import { laPazDateOf } from './lapaz';

describe('laPazDateOf — el día de Bolivia, no el de UTC', () => {
  it('a las 21:00 de La Paz todavía es el mismo día', () => {
    // 2026-09-05 21:00 en La Paz === 2026-09-06 01:00 UTC
    expect(laPazDateOf('2026-09-06T01:00:00.000Z')).toBe('2026-09-05');
    // el atajo viejo habría dicho 2026-09-06
    expect('2026-09-06T01:00:00.000Z'.slice(0, 10)).toBe('2026-09-06');
  });

  it('a las 19:59 y a las 20:01 de La Paz sigue siendo el mismo día', () => {
    expect(laPazDateOf('2026-09-05T23:59:00.000Z')).toBe('2026-09-05');
    expect(laPazDateOf('2026-09-06T00:01:00.000Z')).toBe('2026-09-05');
  });

  it('el día cambia a las 00:00 de La Paz (04:00 UTC), no antes', () => {
    expect(laPazDateOf('2026-09-06T03:59:00.000Z')).toBe('2026-09-05');
    expect(laPazDateOf('2026-09-06T04:00:00.000Z')).toBe('2026-09-06');
  });

  it('cruza fin de mes y fin de año por el huso correcto', () => {
    // 31/08 20:00 La Paz === 01/09 00:00 UTC: para la oficina sigue siendo agosto
    expect(laPazDateOf('2026-09-01T00:00:00.000Z')).toBe('2026-08-31');
    expect(laPazDateOf('2027-01-01T02:00:00.000Z')).toBe('2026-12-31');
  });
});
