// Layout spec hand-transcribed from Terrenalv's printed plano photos (the green
// master sheet M-1…M-25 with the sales pinboard, plus the M-23/M-24/M-25 detail
// close-up). Plan-space: meters, origin at the SW corner of the west field,
// +X east, +Y north. Anchored provisionally to UTM 20S at (479250, 7972500).
//
// Fidelity notes:
//  * Block positions, codes, street pattern, and the área-verde placements follow
//    the photo. Lot counts/frontages are exact where legible (M-23/24/25 detail:
//    10.00 / 11.00 / 11.50 / 12.00 m fronts, 25–30 m depths, wider corner lots),
//    pattern-inferred elsewhere → every manzana is seeded needs_review = true.
//  * The team corrects geometry in the admin Map Builder afterwards; lots start
//    unpriced, so nothing is reservable until each manzana gets its pricing pass.

export type SideHint = 'S' | 'N' | 'E' | 'W';

export interface BlockSpec {
  code: string;
  sector: 'Oeste' | 'Este';
  kind: 'residencial' | 'area_verde' | 'equipamiento' | 'amenidad';
  /** [x, y, width, height] in meters, axis-aligned. */
  rect: [number, number, number, number];
  rows?: 1 | 2;
  /** Frontage spec DSL for row A (street side per hint) and row B. */
  frontA?: string;
  frontB?: string;
  depthA?: number;
  /** Which side row A fronts. Default 'S'. */
  hint?: SideHint;
}

export interface ElementSpec {
  kind: 'calle' | 'avenida' | 'ciclovia' | 'area_verde' | 'equipamiento' | 'amenidad' | 'perimetro';
  name: string;
  /** [x, y, width, height] axis-aligned band/footprint. */
  rect: [number, number, number, number];
  props?: Record<string, unknown>;
}

// Row grid (south → north). Row pitch = block depth + 13 m street.
//   Row 5  y   0– 50   M-25 (long) · M-11
//   Row 4  y  63–113   M-24 (long) · M-12 · M-10
//   Row 3  y 126–186   M-23 (long, 30 m lots) · M-13 · M-9
//   Row 2  y 199–249   M-21 · M-22 · M-14 · M-8
//   Row 1  y 262–312   M-20 · M-19 · M-18 · M-17
//   North  y 325–375   M-16 ÁREA VERDE · M-15 · (M-7 · M-6 · M-5 cluster)
// Columns: west long span x 0–294 (split 0–140 / 154–294 in rows 1–2),
// middle x 307–457, east x 470–620, then AVENIDA x 620–650, NE cluster beyond.

export const BLOCKS: BlockSpec[] = [
  // --- Row 5 (south edge, fronting the Carretera side) ---
  { code: 'M-25', sector: 'Oeste', kind: 'residencial', rect: [0, 0, 277, 50], rows: 2, frontA: '12; 22x11.5; 12', frontB: '12; 22x11.5; 12' },
  { code: 'M-11', sector: 'Oeste', kind: 'residencial', rect: [307, 0, 150, 50], rows: 2, frontA: '10; 13x10; 10' },

  // --- Row 4 ---
  { code: 'M-24', sector: 'Oeste', kind: 'residencial', rect: [0, 63, 294, 50], rows: 2, frontA: '12; 27x10; 12', frontB: '12; 27x10; 12' },
  { code: 'M-12', sector: 'Oeste', kind: 'residencial', rect: [307, 63, 150, 50], rows: 2, frontA: '10; 13x10; 10' },
  { code: 'M-10', sector: 'Oeste', kind: 'residencial', rect: [470, 63, 150, 50], rows: 2, frontA: '10; 13x10; 10' },

  // --- Row 3 (M-23 has the 30 m-deep lots per the detail sheet) ---
  { code: 'M-23', sector: 'Oeste', kind: 'residencial', rect: [0, 126, 294, 60], rows: 2, depthA: 30, frontA: '12; 27x10; 12', frontB: '12; 27x10; 12' },
  { code: 'M-13', sector: 'Oeste', kind: 'residencial', rect: [307, 126, 150, 60], rows: 2, depthA: 30, frontA: '10; 13x10; 10' },
  { code: 'M-9', sector: 'Oeste', kind: 'residencial', rect: [470, 126, 150, 60], rows: 2, depthA: 30, frontA: '10; 13x10; 10' },

  // --- Row 2 ---
  { code: 'M-21', sector: 'Oeste', kind: 'residencial', rect: [0, 199, 140, 50], rows: 2, frontA: '10; 12x10; 10' },
  { code: 'M-22', sector: 'Oeste', kind: 'residencial', rect: [154, 199, 140, 50], rows: 2, frontA: '10; 12x10; 10' },
  { code: 'M-14', sector: 'Oeste', kind: 'residencial', rect: [307, 199, 150, 50], rows: 2, frontA: '10; 13x10; 10' },
  { code: 'M-8', sector: 'Oeste', kind: 'residencial', rect: [470, 199, 150, 50], rows: 2, frontA: '10; 13x10; 10' },

  // --- Row 1 ---
  { code: 'M-20', sector: 'Oeste', kind: 'residencial', rect: [0, 262, 140, 50], rows: 2, frontA: '10; 12x10; 10' },
  { code: 'M-19', sector: 'Oeste', kind: 'residencial', rect: [154, 262, 140, 50], rows: 2, frontA: '10; 12x10; 10' },
  { code: 'M-18', sector: 'Oeste', kind: 'residencial', rect: [307, 262, 150, 50], rows: 2, frontA: '10; 13x10; 10' },
  { code: 'M-17', sector: 'Oeste', kind: 'residencial', rect: [470, 262, 150, 50], rows: 2, frontA: '10; 13x10; 10' },

  // --- North strip ---
  { code: 'M-16', sector: 'Oeste', kind: 'area_verde', rect: [307, 325, 150, 50] },
  { code: 'M-15', sector: 'Oeste', kind: 'residencial', rect: [470, 325, 150, 50], rows: 2, frontA: '10; 13x10; 10' },

  // --- NE cluster (smaller blocks near the Trillo) ---
  { code: 'M-7', sector: 'Oeste', kind: 'residencial', rect: [663, 262, 90, 50], rows: 2, frontA: '9x10' },
  { code: 'M-6', sector: 'Oeste', kind: 'residencial', rect: [663, 325, 90, 50], rows: 2, frontA: '9x10' },
  { code: 'M-5', sector: 'Oeste', kind: 'residencial', rect: [766, 325, 90, 50], rows: 2, frontA: '9x10' },

  // --- Sector Este (across the Trillo, per the right section of the sheet) ---
  { code: 'AV-E1', sector: 'Este', kind: 'area_verde', rect: [940, 262, 100, 50] },
  { code: 'M-4', sector: 'Este', kind: 'residencial', rect: [1053, 262, 150, 50], rows: 2, frontA: '10; 13x10; 10' },
  { code: 'M-1', sector: 'Este', kind: 'residencial', rect: [1216, 262, 80, 50], rows: 2, frontA: '8x10' },
  { code: 'AV-E2', sector: 'Este', kind: 'area_verde', rect: [940, 199, 100, 50] },
  { code: 'M-3', sector: 'Este', kind: 'residencial', rect: [1053, 199, 150, 50], rows: 2, frontA: '10; 13x10; 10' },
  { code: 'M-2', sector: 'Este', kind: 'residencial', rect: [1216, 199, 80, 50], rows: 2, frontA: '8x10' },
];

export const ELEMENTS: ElementSpec[] = [
  // Horizontal streets between block rows (west field span).
  { kind: 'calle', name: 'Calle S/N', rect: [-13, 50, 646, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [-13, 113, 646, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [-13, 186, 646, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [-13, 249, 646, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [-13, 312, 646, 13] },
  // Vertical streets between columns.
  { kind: 'calle', name: 'Calle S/N', rect: [140, 199, 14, 126] },
  { kind: 'calle', name: 'Calle S/N', rect: [294, -13, 13, 401] },
  { kind: 'calle', name: 'Calle S/N', rect: [457, -13, 13, 401] },
  { kind: 'calle', name: 'Calle S/N', rect: [-13, -13, 13, 401] },
  // Main avenue on the east edge of the west field.
  { kind: 'avenida', name: 'Avenida S/N', rect: [620, -13, 30, 401] },
  // NE cluster streets.
  { kind: 'calle', name: 'Calle S/N', rect: [650, 249, 220, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [650, 312, 220, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [753, 249, 13, 139] },
  { kind: 'calle', name: 'Calle S/N', rect: [856, 249, 13, 76] },
  // The Trillo corridor separating the sectors.
  { kind: 'avenida', name: 'Trillo', rect: [900, -13, 20, 401] },
  // Sector Este streets.
  { kind: 'calle', name: 'Calle S/N', rect: [920, 186, 389, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [920, 249, 389, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [920, 312, 389, 13] },
  { kind: 'calle', name: 'Calle S/N', rect: [1040, 186, 13, 139] },
  { kind: 'calle', name: 'Calle S/N', rect: [1203, 186, 13, 139] },
  // Carretera Internacional Ruta 9 along the south edge (site fronts it).
  { kind: 'avenida', name: 'Carretera Internacional Ruta 9 (Argentina–Paraguay)', rect: [-60, -55, 1420, 30], props: { width_m: 30, highway: true } },
  // Amenities (renders exist → billboards in 3D; footprints on the plat).
  { kind: 'amenidad', name: 'Mega Piscina', rect: [330, 335, 100, 32], props: { billboard: 'mega-piscina', pad: true } },
  { kind: 'amenidad', name: 'Club House', rect: [955, 272, 70, 30], props: { billboard: 'club-house', pad: true } },
];

/** Provisional UTM 20S anchor (refined later via Builder calibration). */
export const UTM_ANCHOR = { epsg: 32720, offsetE: 479250.0, offsetN: 7972500.0 };
