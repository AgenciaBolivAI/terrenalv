'use client';

// El dibujo del plano, debajo de los lotes.
//
// Para qué: nuestros polígonos de lote son una aproximación en las
// urbanizaciones que se migraron del sistema anterior — sabemos dónde está
// cada lote y cuánto mide, pero no la forma exacta del levantamiento. El
// dibujo del topógrafo sí la tiene, con las cotas impresas en cada lado, que
// es exactamente lo que el comprador mira para saber dónde termina su lote.
//
// Así que el dibujo va de fondo y encima van los lotes clicables: el plano
// dice la verdad de los límites, y la capa de arriba dice el estado y permite
// reservar.
//
// El SVG se baja de la CDN, no viene en el HTML: son entre 0,7 y 2,5 MB y
// servido con la versión en la ruta se cachea para siempre.

import { useEffect, useState } from 'react';

export * from './planoFondo-core';
import { contenidoDelSvg, transformDeFondo, type PlanoFondoSpec } from './planoFondo-core';

export function PlanoFondo({ spec }: { spec: PlanoFondoSpec | null }) {
  const [contenido, setContenido] = useState<string | null>(null);

  useEffect(() => {
    if (!spec?.url) return;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(spec.url);
        if (!r.ok) return;
        const t = await r.text();
        if (vivo) setContenido(contenidoDelSvg(t));
      } catch {
        // Sin fondo el mapa sigue siendo usable: los lotes, sus áreas y sus
        // precios no dependen de este dibujo. No se muestra un error por algo
        // que no impide reservar.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [spec?.url]);

  if (!spec || !contenido) return null;

  return (
    <g
      transform={transformDeFondo(spec)}
      // El dibujo es referencia visual: no debe robarle el clic a los lotes.
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: contenido }}
    />
  );
}
