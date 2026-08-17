import { describe, expect, it } from 'vitest';
import { captionHeadline } from './caption';

// Instagram captions are written for Instagram: several lines, emoji, and a
// block of hashtags at the end. The landing page shows one line under a
// thumbnail, so this picks the line a human would read out loud.
describe('captionHeadline', () => {
  it('devuelve null cuando no hay caption', () => {
    expect(captionHeadline(null)).toBeNull();
    expect(captionHeadline('')).toBeNull();
    expect(captionHeadline('   ')).toBeNull();
  });

  it('toma la primera línea con texto', () => {
    expect(captionHeadline('¿Ya tenés tu terreno propio?\nEscribinos hoy.')).toBe(
      '¿Ya tenés tu terreno propio?',
    );
  });

  it('salta líneas vacías al principio', () => {
    expect(captionHeadline('\n\n  Terrenos desde Bs 24.800  \nmás info')).toBe(
      'Terrenos desde Bs 24.800',
    );
  });

  it('salta una primera línea que es solo hashtags', () => {
    expect(captionHeadline('#terrenalv #santacruz\nTu lote en Prados del Sur')).toBe(
      'Tu lote en Prados del Sur',
    );
  });

  it('quita los hashtags del final de la línea', () => {
    expect(captionHeadline('Tu terreno propio #terrenalv #bolivia')).toBe('Tu terreno propio');
  });

  it('conserva acentos y ñ en los hashtags que quita', () => {
    expect(captionHeadline('Lotes en Zanja Honda #urbanización #cabezas')).toBe(
      'Lotes en Zanja Honda',
    );
  });

  it('no corta un # que va en medio de la frase', () => {
    expect(captionHeadline('Lote #12 disponible')).toBe('Lote #12 disponible');
  });

  it('devuelve null si la caption es solo hashtags', () => {
    expect(captionHeadline('#terrenalv\n#santacruz')).toBeNull();
  });

  it('trunca con puntos suspensivos y respeta el máximo', () => {
    const long = 'a'.repeat(200);
    const out = captionHeadline(long, 20)!;
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('no trunca lo que ya entra', () => {
    expect(captionHeadline('Terreno propio', 20)).toBe('Terreno propio');
  });
});
