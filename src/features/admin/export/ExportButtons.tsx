'use client';

// Par de botones CSV / PDF, iguales en todas las pantallas.
//
// Va como componente y no como dos botones sueltos por pantalla para que el
// contador encuentre la exportación siempre en el mismo lugar y con el mismo
// nombre, y para que ninguna pantalla se olvide del PDF.

import { useState } from 'react';
import { btnSecondary } from '@/features/admin/ui/bits';
import { exportCsv, exportPdf, type Cell, type ExportColumn, type ExportMeta } from './index';

export function ExportButtons({
  meta,
  columns,
  rows,
  orientation = 'portrait',
  disabled,
}: {
  meta: ExportMeta;
  columns: ExportColumn[];
  /** Se calculan al hacer clic, no en cada render: una tabla larga no tiene por
   *  qué armarse en memoria mientras nadie exporta nada. */
  rows: () => Cell[][];
  orientation?: 'portrait' | 'landscape';
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function pdf() {
    setBusy(true);
    try {
      await exportPdf(meta, columns, rows(), { orientation });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={btnSecondary}
        disabled={disabled}
        onClick={() => exportCsv(meta, columns, rows())}
      >
        CSV
      </button>
      <button type="button" className={btnSecondary} disabled={disabled || busy} onClick={() => void pdf()}>
        {busy ? 'Generando…' : 'PDF'}
      </button>
    </div>
  );
}
