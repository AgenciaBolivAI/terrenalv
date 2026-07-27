// Builder-specific RPC error codes → Spanish copy, with the detail payload the
// server embeds after the colon (lot numbers, pairs) surfaced to the user.

import { adminErrorCopy } from '@/features/admin/lib/errors-extra';

function detailAfter(message: string, code: string): string {
  const idx = message.indexOf(code);
  if (idx === -1) return '';
  const rest = message.slice(idx + code.length).replace(/^[:\s]+/, '');
  // PostgREST sometimes appends context after a newline.
  return rest.split('\n')[0].trim();
}

export function builderErrorCopy(message: string | undefined | null): string {
  if (message) {
    if (message.includes('VERSION_CONFLICT')) {
      return 'Otra persona editó esta manzana; recarga para ver la versión actual.';
    }
    if (message.includes('LOTS_GEOMETRY_LOCKED')) {
      const d = detailAfter(message, 'LOTS_GEOMETRY_LOCKED');
      return d
        ? `Geometría bloqueada — lotes reservados/vendidos o con historial: ${d}`
        : 'No se puede cambiar la geometría de lotes reservados, vendidos o con historial.';
    }
    if (message.includes('LOTS_OVERLAP_GLOBAL')) {
      return 'Hay lotes superpuestos entre manzanas distintas. Corrige la superposición antes de publicar.';
    }
    if (message.includes('LOTS_OVERLAP')) {
      const d = detailAfter(message, 'LOTS_OVERLAP');
      return d ? `Los lotes se superponen: ${d}.` : 'Hay lotes que se superponen entre sí.';
    }
    if (message.includes('LOT_OUTSIDE_MANZANA')) {
      const d = detailAfter(message, 'LOT_OUTSIDE_MANZANA');
      return d
        ? `El lote ${d} queda fuera del contorno de la manzana (tolerancia 5 cm).`
        : 'Hay un lote fuera del contorno de la manzana.';
    }
    if (message.includes('INVALID_GEOMETRY')) {
      return 'La geometría no es válida (el contorno se cruza a sí mismo o está degenerado).';
    }
    if (message.includes('ELEMENT_NEEDS_RING_OR_LINE')) {
      return 'El elemento del mapa necesita un contorno o una línea.';
    }
  }
  return adminErrorCopy(message);
}
