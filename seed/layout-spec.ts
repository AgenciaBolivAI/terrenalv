// Layout of the urbanización, transcribed from Terrenalv's physical maqueta and
// the full wall plano (photo 2026-07-28 — the complete sheet).
//
// SITE READING:
//   1. Carretera Internacional Ruta 9 crosses the site's SOUTH END,
//      perpendicular to the long axis.
//   2. Two entry blocks (M-1, M-2) between the highway and the tracks.
//   3. Vía férrea crosses the strip parallel to the highway (the plano's
//      "TRILLO" corridor — a railway, not an avenue).
//   4. The body: a long strip. Per the FULL plano sheet, the manzanas run
//      ALONG the strip — six double-loaded bands across the width, cut by
//      cross-streets into segments — NOT bands across it. The width works out
//      exactly: 6 bands × 50 m + streets ≈ the strip's width. The maqueta's
//      central spine is the wider avenue between bands 3 and 4.
//
// Plan-space: meters, +X east, +Y north, origin at the SW corner. The strip's
// long axis is +Y, so each body manzana is 50 m wide × ~174 m tall (two
// back-to-back lot columns fronting the streets to its west and east) and
// declares hint 'W' — the vertical-block case covered by the subdivision
// regression test.
//
// Fidelity: topology and proportions follow the photos. Per-manzana lot counts
// are the plano's dominant pattern (10.00 m fronts × 25 m depth, 12 m corner
// lots); only M-23/24/25 were legible individually. EVERY manzana is seeded
// needs_review = true and unpriced — the admin Map Builder + CSV import are the
// correction tools.

export type SideHint = 'S' | 'N' | 'E' | 'W';

export interface BlockSpec {
  code: string;
  sector: string;
  kind: 'residencial' | 'area_verde' | 'equipamiento' | 'amenidad';
  /** [x, y, width, height] in meters, axis-aligned. */
  rect: [number, number, number, number];
  rows?: 1 | 2;
  frontA?: string;
  frontB?: string;
  depthA?: number;
  /** Side row A fronts: 'W' for body columns, 'S' for the entry bands. */
  hint?: SideHint;
}

export interface ElementSpec {
  kind: 'calle' | 'avenida' | 'ciclovia' | 'area_verde' | 'equipamiento' | 'amenidad' | 'perimetro';
  name: string;
  rect: [number, number, number, number];
  props?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

const LOT_DEPTH = 25; // m
const CALLE = 13; // m — "13.00 CALLE S/N"
const AVENIDA = 26; // m — the central spine between bands 3 and 4
const RAILWAY_W = 24;
const HIGHWAY_W = 30;

const BAND_W = LOT_DEPTH * 2; // 50 — one double-loaded band
const BANDS = 6; // across the width, per the full sheet

/** Segment along the strip: corner 12 + 15×10 + corner 12 = 174 m of frontage. */
const SEG_LEN = 174;
const SEG_FRONTS = '12; 15x10; 12';
const SEG_PITCH = SEG_LEN + CALLE;
/** Full-length body segments; the final partial segment covers 4 of 6 bands. */
const BODY_SEGMENTS = 15;
const TAIL_BANDS = 4; // narrower far end, as on the sheet's tail

// Band x-positions: calle | band1 | calle | band2 | calle | band3 | AVENIDA |
// band4 | calle | band5 | calle | band6 | calle
const BAND_X: number[] = (() => {
  const xs: number[] = [];
  let x = CALLE;
  for (let b = 0; b < BANDS; b++) {
    xs.push(x);
    x += BAND_W + (b === 2 ? AVENIDA : CALLE);
  }
  return xs;
})();
export const SITE_WIDTH = BAND_X[BANDS - 1] + BAND_W + CALLE; // 404

// South end: highway, entry band (M-1/M-2), railway, then the body.
const HIGHWAY_Y = -HIGHWAY_W;
const ENTRY_Y = 0;
const ENTRY_DEPTH = BAND_W; // two horizontal entry blocks, 50 m deep
const RAILWAY_Y = ENTRY_Y + ENTRY_DEPTH + CALLE;
const BODY_Y = RAILWAY_Y + RAILWAY_W + CALLE;

const SITE_TOP = BODY_Y + BODY_SEGMENTS * SEG_PITCH + SEG_LEN; // partial tail row

// Special cells (band index 0..5, segment index 0..15), echoing the sheet's
// scattered áreas verdes / equipamiento and the two amenities.
const POOL_CELL = '1:3'; // Mega Piscina
const CLUB_CELL = '4:8'; // Club House
const GREEN_CELLS = new Set(['0:6', '2:11', '5:2', '3:14']);
const EQUIP_CELLS = new Set(['5:9', '0:12', '2:5']);

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function buildBlocks(): BlockSpec[] {
  const blocks: BlockSpec[] = [];

  // --- The 2 entry blocks between the Carretera and the tracks ---
  // Horizontal bands (lots front the highway-parallel streets), flanking the avenue.
  const entryLen = BAND_X[2] + BAND_W - CALLE; // west half up to the avenue
  blocks.push({
    code: 'M-1',
    sector: 'Acceso',
    kind: 'residencial',
    rect: [CALLE, ENTRY_Y, entryLen, ENTRY_DEPTH],
    rows: 2,
    hint: 'S',
    frontA: '12; 15x10; 12',
    frontB: '12; 15x10; 12',
  });
  const eastStart = BAND_X[3];
  blocks.push({
    code: 'M-2',
    sector: 'Acceso',
    kind: 'residencial',
    rect: [eastStart, ENTRY_Y, SITE_WIDTH - CALLE - eastStart, ENTRY_DEPTH],
    rows: 2,
    hint: 'S',
    frontA: '12; 15x10; 12',
    frontB: '12; 15x10; 12',
  });

  // --- Body: 6 bands × 15 full segments + a 4-band tail segment ---
  let code = 3;
  for (let seg = 0; seg <= BODY_SEGMENTS; seg++) {
    const y = BODY_Y + seg * SEG_PITCH;
    const isTail = seg === BODY_SEGMENTS;
    const bandCount = isTail ? TAIL_BANDS : BANDS;
    const sector = seg < BODY_SEGMENTS / 2 ? 'Sur' : 'Norte';
    // The tail hugs the avenue: bands 1..4 (skip the outermost two).
    const bandOffset = isTail ? 1 : 0;

    for (let b = 0; b < bandCount; b++) {
      const band = b + bandOffset;
      const key = `${band}:${seg}`;
      const kind =
        key === POOL_CELL
          ? 'amenidad'
          : key === CLUB_CELL
            ? 'amenidad'
            : GREEN_CELLS.has(key)
              ? 'area_verde'
              : EQUIP_CELLS.has(key)
                ? 'equipamiento'
                : 'residencial';
      const rect: BlockSpec['rect'] = [BAND_X[band], y, BAND_W, SEG_LEN];
      blocks.push(
        kind === 'residencial'
          ? {
              code: `M-${code++}`,
              sector,
              kind,
              rect,
              rows: 2,
              hint: 'W',
              frontA: SEG_FRONTS,
              frontB: SEG_FRONTS,
            }
          : { code: `M-${code++}`, sector, kind, rect },
      );
    }
  }

  return blocks;
}

export const BLOCKS: BlockSpec[] = buildBlocks();

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function buildElements(): ElementSpec[] {
  const els: ElementSpec[] = [];
  const overhang = 220;

  els.push({
    kind: 'avenida',
    name: 'Carretera Internacional Ruta 9',
    rect: [-overhang, HIGHWAY_Y, SITE_WIDTH + overhang * 2, HIGHWAY_W],
    props: { width_m: HIGHWAY_W, highway: true },
  });

  els.push({
    kind: 'avenida',
    name: 'Vía férrea',
    rect: [-overhang, RAILWAY_Y, SITE_WIDTH + overhang * 2, RAILWAY_W],
    props: { width_m: RAILWAY_W, railway: true },
  });

  // Central avenue between bands 3 and 4, running the full length.
  els.push({
    kind: 'avenida',
    name: 'Avenida Principal',
    rect: [BAND_X[2] + BAND_W, ENTRY_Y, AVENIDA, SITE_TOP - ENTRY_Y],
    props: { width_m: AVENIDA },
  });

  // Longitudinal streets: perimeter + between bands (except the avenue slot).
  els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, ENTRY_Y, CALLE, SITE_TOP - ENTRY_Y] });
  for (let b = 0; b < BANDS - 1; b++) {
    if (b === 2) continue; // that slot is the avenue
    const x = BAND_X[b] + BAND_W;
    els.push({ kind: 'calle', name: 'Calle S/N', rect: [x, ENTRY_Y, CALLE, SITE_TOP - ENTRY_Y] });
  }
  els.push({
    kind: 'calle',
    name: 'Calle S/N',
    rect: [SITE_WIDTH - CALLE, ENTRY_Y, CALLE, SITE_TOP - ENTRY_Y],
  });

  // Cross-streets: after the entry band and between body segments.
  els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, ENTRY_Y + ENTRY_DEPTH, SITE_WIDTH, CALLE] });
  for (let seg = 0; seg < BODY_SEGMENTS; seg++) {
    const y = BODY_Y + seg * SEG_PITCH + SEG_LEN;
    els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, y, SITE_WIDTH, CALLE] });
  }

  // Amenity footprints (billboards in 3D).
  const [poolBand, poolSeg] = POOL_CELL.split(':').map(Number);
  els.push({
    kind: 'amenidad',
    name: 'Mega Piscina',
    rect: [BAND_X[poolBand] + 5, BODY_Y + poolSeg * SEG_PITCH + 10, BAND_W - 10, SEG_LEN - 20],
    props: { billboard: 'mega-piscina', pad: true },
  });
  const [clubBand, clubSeg] = CLUB_CELL.split(':').map(Number);
  els.push({
    kind: 'amenidad',
    name: 'Club House',
    rect: [BAND_X[clubBand] + 5, BODY_Y + clubSeg * SEG_PITCH + 10, BAND_W - 10, SEG_LEN - 20],
    props: { billboard: 'club-house', pad: true },
  });

  return els;
}

export const ELEMENTS: ElementSpec[] = buildElements();

/** Provisional UTM 20S anchor (refined later via Builder calibration). */
export const UTM_ANCHOR = { epsg: 32720, offsetE: 479250.0, offsetN: 7972500.0 };
