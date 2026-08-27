// Exportación de cualquier tabla del panel a CSV o PDF.
//
// Un solo módulo para todo el sistema, no una función por pantalla: el contador
// tiene que recibir el libro mayor, el balance y la cartera con la misma pinta,
// el mismo encabezado y el mismo formato de números. Cuando cada pantalla arma
// su propio archivo, terminan con seis formatos distintos y ninguno cuadra con
// otro.
//
// El PDF se carga bajo demanda (import dinámico): jspdf pesa varios cientos de
// kilobytes y no tiene por qué descargarse en cada visita al panel para quedar
// esperando por si alguien exporta algo.

export interface ExportColumn {
  /** Encabezado que ve el contador. */
  header: string;
  /** Alineación: los números van a la derecha o las columnas no se leen. */
  align?: 'left' | 'right' | 'center';
  /** Ancho relativo sugerido para el PDF. */
  width?: number;
}

export type Cell = string | number | null | undefined;

export interface ExportMeta {
  /** Ej. "Libro Mayor". */
  title: string;
  /** Ej. "Prados del Sur · 01/08/2026 a 31/08/2026". */
  subtitle?: string;
  /** Nombre de archivo sin extensión. */
  filename: string;
  /** Nota al pie: aclaraciones contables que deben viajar con el papel. */
  footnote?: string;
}

/** es-BO: 1.234.567,89 — el formato que espera un contador boliviano. */
export function num(n: number, decimals = 2): string {
  return new Intl.NumberFormat('es-BO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(n) || 0);
}

function stamp(): string {
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/La_Paz',
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * CSV que Excel boliviano abre bien.
 *
 * Separador ';' y coma decimal: Excel configurado en es-BO lee un archivo
 * separado por comas como UNA sola columna, que lo vuelve inútil justo donde se
 * lo va a usar. El BOM al principio mantiene los acentos.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const cell = (v: Cell): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}`;
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// XLSX — Excel de verdad
// ---------------------------------------------------------------------------

/**
 * Un es-BO como «1.234,56» de vuelta a número, para que Excel reciba una
 * CELDA NUMÉRICA y no un texto. Los montos del panel llegan pre-formateados
 * (fnum) y un número real se ordena, se suma y se filtra en cualquier Excel.
 */
function desformatear(v: Cell): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const t = v.trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+(,\d+)?$/.test(t)) {
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/**
 * Excel nativo (.xlsx), no CSV.
 *
 * El CSV dependía de cómo estuviera configurado el Excel de quien lo abre:
 * con separador de listas en coma, un archivo separado por punto y coma caía
 * ENTERO en la columna A y los decimales quedaban regados por B, C y D. Un
 * .xlsx no tiene separador que adivinar: cada dato llega en su celda, en
 * cualquier máquina, y los montos llegan como números de verdad.
 *
 * La librería se carga bajo demanda, igual que el PDF.
 */
export async function exportXlsx(
  meta: ExportMeta,
  columns: ExportColumn[],
  rows: Cell[][],
): Promise<void> {
  const XLSX = await import('xlsx');

  const encabezado = columns.map((c) => c.header);
  const datos = rows.map((r) => r.map(desformatear));

  const hoja = XLSX.utils.aoa_to_sheet([
    [meta.title],
    ...(meta.subtitle ? [[meta.subtitle]] : []),
    [`Generado ${stamp()}`],
    [],
    encabezado,
    ...datos,
  ]);

  // Anchos: que los nombres no salgan cortados.
  hoja['!cols'] = columns.map((c, i) => {
    const largo = Math.max(
      c.header.length,
      ...datos.slice(0, 200).map((r) => String(r[i] ?? '').length),
    );
    return { wch: Math.min(42, Math.max(9, largo + 2)) };
  });

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, meta.title.slice(0, 31));
  if (meta.footnote) {
    const notas = XLSX.utils.aoa_to_sheet([['Notas'], [meta.footnote]]);
    notas['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(libro, notas, 'Notas');
  }
  XLSX.writeFile(libro, `${meta.filename}.xlsx`);
}

export function exportCsv(meta: ExportMeta, columns: ExportColumn[], rows: Cell[][]): void {
  const csv = toCsv(
    columns.map((c) => c.header),
    rows,
  );
  save(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${meta.filename}.csv`);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * PDF con membrete, fecha de emisión y numeración de páginas.
 *
 * Lleva "emitido el <fecha>" a propósito: un balance sin fecha de emisión
 * circulando por correo es imposible de ordenar cuando hay tres versiones del
 * mismo mes, y en contabilidad siempre hay tres versiones del mismo mes.
 */
export async function exportPdf(
  meta: ExportMeta,
  columns: ExportColumn[],
  rows: Cell[][],
  opts: { orientation?: 'portrait' | 'landscape'; company?: string } = {},
): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableMod as unknown as { default: typeof autoTableMod.default }).default;

  const doc = new jsPDF({
    orientation: opts.orientation ?? 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const empresa = opts.company ?? 'TERRENALV S.R.L.';
  const width = doc.internal.pageSize.getWidth();

  autoTable(doc, {
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    startY: 96,
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 83, 45], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 247, 245] },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [
        i,
        { halign: c.align ?? 'left', ...(c.width ? { cellWidth: c.width } : {}) },
      ]),
    ),
    didDrawPage: () => {
      // Membrete en cada página: las hojas sueltas de un balance se separan.
      doc.setFontSize(14);
      doc.setTextColor(20, 83, 45);
      doc.text(empresa, 32, 40);

      doc.setFontSize(12);
      doc.setTextColor(28, 25, 23);
      doc.text(meta.title, 32, 60);

      if (meta.subtitle) {
        doc.setFontSize(9);
        doc.setTextColor(120, 113, 108);
        doc.text(meta.subtitle, 32, 74);
      }

      doc.setFontSize(8);
      doc.setTextColor(120, 113, 108);
      doc.text(`Emitido el ${stamp()}`, width - 32, 40, { align: 'right' });

      const page = doc.getNumberOfPages();
      doc.text(`Página ${page}`, width - 32, doc.internal.pageSize.getHeight() - 24, {
        align: 'right',
      });

      if (meta.footnote) {
        doc.setFontSize(7.5);
        doc.text(meta.footnote, 32, doc.internal.pageSize.getHeight() - 24, {
          maxWidth: width - 140,
        });
      }
    },
  });

  doc.save(`${meta.filename}.pdf`);
}

/** Fecha corta para nombres de archivo: 2026-08-20. */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
