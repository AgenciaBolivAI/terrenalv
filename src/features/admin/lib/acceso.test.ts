import { describe, expect, it } from 'vitest';
import { puedeVer, seccionDe, SECCIONES } from './acceso';

describe('seccionDe', () => {
  it('el dashboard es su propia sección', () => {
    expect(seccionDe('/admin')).toBe('panel');
    expect(seccionDe('/admin/')).toBe('panel');
  });

  it('cada ruta de primer nivel es su sección', () => {
    expect(seccionDe('/admin/lotes')).toBe('lotes');
    expect(seccionDe('/admin/planes')).toBe('planes');
    expect(seccionDe('/admin/mi-cuenta')).toBe('mi-cuenta');
    expect(seccionDe('/admin/contabilidad')).toBe('contabilidad');
  });

  it('los papeles heredan la sección desde la que se abren', () => {
    expect(seccionDe('/admin/plan/9f8faed9-8581')).toBe('planes');
    expect(seccionDe('/admin/recibo/abc')).toBe('contabilidad');
    expect(seccionDe('/admin/contrato/abc')).toBe('ventas');
  });

  it('las subrutas siguen a su sección', () => {
    expect(seccionDe('/admin/ventas?open=x'.split('?')[0])).toBe('ventas');
    expect(seccionDe('/admin/clientes/detalle')).toBe('clientes');
  });

  it('toda sección declarada resuelve a sí misma', () => {
    for (const s of SECCIONES) {
      expect(seccionDe(`/admin/${s.clave}`)).toBe(s.clave === 'panel' ? 'panel' : s.clave);
    }
  });
});

describe('puedeVer', () => {
  const acceso = { lotes: 've', planes: 'edita', ventas: 'no', analitica: 'propia' };

  it('«no» bloquea; «ve», «edita» y «propia» dejan pasar', () => {
    expect(puedeVer(acceso, 'ventas')).toBe(false);
    expect(puedeVer(acceso, 'lotes')).toBe(true);
    expect(puedeVer(acceso, 'planes')).toBe(true);
    expect(puedeVer(acceso, 'analitica')).toBe(true);
  });

  it('sin acceso cargado o sección desconocida, no bloquea (manda el rol)', () => {
    expect(puedeVer(null, 'ventas')).toBe(true);
    expect(puedeVer(acceso, 'ruta-nueva')).toBe(true);
  });
});
