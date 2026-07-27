// Layout of the urbanización, transcribed from Terrenalv's physical maqueta and
// the printed plano sheets.
//
// SITE READING (corrected — the first pass had the highway alongside the site):
// walking in from the road you cross, in this order:
//
//   1. Carretera Internacional Argentina–Paraguay (Ruta 9) — crosses the site's
//      SOUTH END, perpendicular to the long axis.
//   2. Two blocks — a shallow band between the highway and the tracks.
//   3. Vía férrea (train tracks) — crosses the strip parallel to the highway.
//      This is the corridor labelled "TRILLO" on the plano sheets; it is a
//      railway, NOT an avenue.
//   4. The rest of the project — a long narrow strip running north, away from
//      the highway: rows of manzanas flanking a central longitudinal avenue,
//      with cross-streets between rows.
//
// All lots sit on ONE side of the highway (nothing across it).
//
// Plan-space: meters, +X east, +Y north, origin at the site's SW corner.
// The SITE's long axis is +Y, but each MANZANA is a band running ACROSS the
// strip (long axis +X, 50 m deep = two back-to-back 25 m lot rows), exactly as
// the maqueta shows. So blocks keep the 'S' hint: row A fronts the street to
// the south, row B the street to the north.
//
// Fidelity: the highway → 2 blocks → railway → body sequence, the central
// avenue, and the frontage pattern (10.00 m fronts × 25 m depth, wider corner
// lots) follow the photos. Exact per-manzana lot counts are only legible for
// M-23/24/25, so the rest use the dominant pattern and EVERY manzana is seeded
// needs_review = true for the team to correct in the admin Map Builder.

export type SideHint = 'S' | 'N' | 'E' | 'W';

export interface BlockSpec {
  code: string;
  sector: string;
  kind: 'residencial' | 'area_verde' | 'equipamiento' | 'amenidad';
  /** [x, y, width, height] in meters, axis-aligned. */
  rect: [number, number, number, number];
  rows?: 1 | 2;
  /** Frontage spec DSL for row A (the side the hint points at) and row B. */
  frontA?: string;
  frontB?: string;
  depthA?: number;
  /** Which side row A fronts. Bands run E–W here, so 'S'. */
  hint?: SideHint;
}

export interface ElementSpec {
  kind: 'calle' | 'avenida' | 'ciclovia' | 'area_verde' | 'equipamiento' | 'amenidad' | 'perimetro';
  name: string;
  rect: [number, number, number, number];
  props?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Dimensions — proportions matched to the maqueta (~7:1 long strip).
// ---------------------------------------------------------------------------

const LOT_DEPTH = 25; // m — dominant depth on the plano
const CALLE = 13; // m — "13.00 CALLE S/N"
const AVENIDA = 26; // m — the central spine
const RAILWAY_W = 24; // m — vía férrea corridor
const HIGHWAY_W = 30; // m — Ruta 9

/** Each manzana: a band 170 m long (across the strip) × 50 m deep (two lot rows). */
const BLOCK_LEN = 170;
const BLOCK_DEPTH = LOT_DEPTH * 2; // 50
/** 17 lots per row → 34 per manzana (10 m fronts, 10 m corner lots). */
const FRONTS = '10; 15x10; 10';
/** Short bands at the tapered north end: 11 lots per row. */
const FRONTS_SHORT = '10; 9x10; 10';
const BLOCK_LEN_SHORT = 110;

const X_WEST = CALLE;
const X_AVE = CALLE + BLOCK_LEN;
const X_EAST = X_AVE + AVENIDA;
/** calle | manzana | avenida | manzana | calle */
export const SITE_WIDTH = CALLE * 2 + BLOCK_LEN * 2 + AVENIDA; // 392 m

const BAND_PITCH = BLOCK_DEPTH + CALLE; // 63 m per row of manzanas

// South end: highway, the 2-block entry band, then the railway.
const HIGHWAY_Y = -HIGHWAY_W;
const ENTRY_Y = 0;
const RAILWAY_Y = ENTRY_Y + BLOCK_DEPTH + CALLE;
const BODY_Y = RAILWAY_Y + RAILWAY_W + CALLE;

/** 47 bands × 2 manzanas = 94, plus the 2 entry blocks = 96 (matches the planos). */
const BODY_BANDS = 47;
// The strip holds a constant width end to end. (An earlier taper at the north
// end was invented, not read off the maqueta — the team refines the real
// boundary in the Map Builder.)
const SHORT_FROM = Number.POSITIVE_INFINITY;

// Special-purpose bands, following the plano sheets.
const POOL_BAND = 9; // Mega Piscina — west manzana
const CLUB_BAND = 23; // Club House — east manzana
const GREEN_BANDS = new Set([5, 18, 31, 42]); // área verde, west
const EQUIP_BANDS = new Set([12, 27, 38]); // área de equipamiento, east

const bandLen = (band: number) => (band >= SHORT_FROM ? BLOCK_LEN_SHORT : BLOCK_LEN);
const bandFronts = (band: number) => (band >= SHORT_FROM ? FRONTS_SHORT : FRONTS);
const bandY = (band: number) => BODY_Y + band * BAND_PITCH;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function buildBlocks(): BlockSpec[] {
  const blocks: BlockSpec[] = [];
  const residencial = (code: string, sector: string, rect: BlockSpec['rect'], fronts: string): BlockSpec => ({
    code,
    sector,
    kind: 'residencial',
    rect,
    rows: 2,
    hint: 'S',
    frontA: fronts,
    frontB: fronts,
  });

  // --- The 2 blocks between the Carretera and the tracks ---
  blocks.push(residencial('M-1', 'Acceso', [X_WEST, ENTRY_Y, BLOCK_LEN, BLOCK_DEPTH], FRONTS));
  blocks.push(residencial('M-2', 'Acceso', [X_EAST, ENTRY_Y, BLOCK_LEN, BLOCK_DEPTH], FRONTS));

  // --- The body: bands stacked north of the railway ---
  let code = 3;
  for (let band = 0; band < BODY_BANDS; band++) {
    const y = bandY(band);
    const len = bandLen(band);
    const fronts = bandFronts(band);
    const sector = band < BODY_BANDS / 2 ? 'Sur' : 'Norte';
    // Tapered bands stay flush with the avenue; the strip narrows outward.
    const inset = BLOCK_LEN - len;
    const xEast = X_AVE + AVENIDA;

    const westKind =
      band === POOL_BAND ? 'amenidad' : GREEN_BANDS.has(band) ? 'area_verde' : 'residencial';
    const eastKind =
      band === CLUB_BAND ? 'amenidad' : EQUIP_BANDS.has(band) ? 'equipamiento' : 'residencial';

    const westRect: BlockSpec['rect'] = [X_WEST + inset, y, len, BLOCK_DEPTH];
    const eastRect: BlockSpec['rect'] = [xEast, y, len, BLOCK_DEPTH];

    blocks.push(
      westKind === 'residencial'
        ? residencial(`M-${code++}`, sector, westRect, fronts)
        : { code: `M-${code++}`, sector, kind: westKind, rect: westRect },
    );
    blocks.push(
      eastKind === 'residencial'
        ? residencial(`M-${code++}`, sector, eastRect, fronts)
        : { code: `M-${code++}`, sector, kind: eastKind, rect: eastRect },
    );
  }

  return blocks;
}

export const BLOCKS: BlockSpec[] = buildBlocks();

/** North edge of the built area. */
const SITE_TOP = bandY(BODY_BANDS - 1) + BLOCK_DEPTH;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function buildElements(): ElementSpec[] {
  const els: ElementSpec[] = [];
  const overhang = 220; // roads run past the property line

  // Carretera Internacional: crosses the SOUTH end, perpendicular to the strip.
  els.push({
    kind: 'avenida',
    name: 'Carretera Internacional Ruta 9',
    rect: [-overhang, HIGHWAY_Y, SITE_WIDTH + overhang * 2, HIGHWAY_W],
    props: { width_m: HIGHWAY_W, highway: true },
  });

  // Vía férrea: crosses the strip parallel to the highway (the plano's "TRILLO").
  els.push({
    kind: 'avenida',
    name: 'Vía férrea',
    rect: [-overhang, RAILWAY_Y, SITE_WIDTH + overhang * 2, RAILWAY_W],
    props: { width_m: RAILWAY_W, railway: true },
  });

  // Central avenue: the spine, running the full length of the urbanización.
  els.push({
    kind: 'avenida',
    name: 'Avenida Principal',
    rect: [X_AVE, ENTRY_Y, AVENIDA, SITE_TOP - ENTRY_Y],
    props: { width_m: AVENIDA },
  });

  // Perimeter streets down both flanks.
  els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, ENTRY_Y, CALLE, SITE_TOP - ENTRY_Y] });
  els.push({
    kind: 'calle',
    name: 'Calle S/N',
    rect: [SITE_WIDTH - CALLE, ENTRY_Y, CALLE, SITE_TOP - ENTRY_Y],
  });

  // Cross-streets: after the entry band and after every body band.
  els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, ENTRY_Y + BLOCK_DEPTH, SITE_WIDTH, CALLE] });
  for (let band = 0; band < BODY_BANDS; band++) {
    els.push({
      kind: 'calle',
      name: 'Calle S/N',
      rect: [0, bandY(band) + BLOCK_DEPTH, SITE_WIDTH, CALLE],
    });
  }

  // Amenity footprints (billboards in 3D), inside their manzanas.
  els.push({
    kind: 'amenidad',
    name: 'Mega Piscina',
    rect: [X_WEST + 8, bandY(POOL_BAND) + 6, BLOCK_LEN - 16, BLOCK_DEPTH - 12],
    props: { billboard: 'mega-piscina', pad: true },
  });
  els.push({
    kind: 'amenidad',
    name: 'Club House',
    rect: [X_EAST + 8, bandY(CLUB_BAND) + 6, BLOCK_LEN - 16, BLOCK_DEPTH - 12],
    props: { billboard: 'club-house', pad: true },
  });

  return els;
}

export const ELEMENTS: ElementSpec[] = buildElements();

/** Provisional UTM 20S anchor (refined later via Builder calibration). */
export const UTM_ANCHOR = { epsg: 32720, offsetE: 479250.0, offsetN: 7972500.0 };
