// Layout of the urbanización, TRANSCRIBED from the six close-up photographs of
// the wall plano (2026-07-28) plus the maqueta.
//
// This replaces an earlier parametric guess (6 bands × 16 segments = 96
// manzanas, 250 m² lots, two invented amenities). The plano disagrees with all
// of that, so the numbers below come from the sheet itself wherever legible.
//
// WHAT THE SHEET SAYS
//   • 88 manzanas, M-1 … M-88. Numbering starts at the EAST end (beside the
//     Santa Cruz–Camiri highway) and climbs westward, snaking down and up each
//     column of blocks.
//   • The site is a long EAST–WEST strip: UTM E 477 400 → 480 200 (≈2 800 m)
//     by N 7 979 700 → 7 980 100 (≈400 m). The earlier model ran the strip
//     north–south — rotated 90° from reality.
//   • Cross-section, north to south: five rows of manzanas, each 60 m deep
//     (two 30 m lots back to back), separated by 13 m "CALLE S/N", with one
//     30 m "AVENIDA S/N" between rows 2 and 3 — the maqueta's central spine.
//     13 + 60 + 13 + 60 + 30 + 60 + 13 + 60 + 13 + 60 + 13 = 395 m ✔
//   • The dominant lot is 10.00 m × 30.00 m = 300 m² (the per-lot tables repeat
//     "300.00"), NOT the 250 m² previously seeded.
//   • East end, in order: highway → M-1/M-2 → M-3/M-4 (each with an ÁREA VERDE
//     at its west end) → TRILLO (the 30 m railway corridor) → the five-row body.
//   • There is no Mega Piscina and no Club House anywhere on the sheet. Both
//     were invented by the earlier model and are gone.
//
// CONFIDENCE
//   HIGH   — manzana inventory and codes, which are área verde / equipamiento,
//            their official areas, the cross-section above, the east-end order,
//            the 300 m² lot.
//   MEDIUM — each manzana's row and its west-to-east position, read off the
//            photos. The count closes at exactly 88, which is a good sign.
//   LOW    — lot subdivision inside each manzana. The sheet's per-lot frontages
//            are not all legible, so blocks are cut with the dominant 10 m
//            pattern and 12 m corners.
//
// Every manzana is seeded needs_review = true and unpriced. /admin/mapa (draw,
// subdivide, CSV import, publish) is the correction tool.
//
// Plan-space: metres, +X east, +Y north, origin at the SW corner of the body.

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
  /** Side row A fronts. Body blocks are wide and shallow, so 'S'. */
  hint?: SideHint;
  /** First lot number printed on the sheet for this manzana. */
  startNumber?: number;
  directionA?: 'forward' | 'reverse';
  directionB?: 'forward' | 'reverse';
  /**
   * True when the lots come from SHEET below — i.e. read off the plano rather
   * than generated from the dominant pattern. Drives `needs_review`, so the
   * panel shows at a glance which manzanas are still approximate.
   */
  transcribed?: boolean;
}

/**
 * A manzana read VERBATIM off the plano.
 *
 * Everything not listed here is cut with the dominant pattern (12 m corners,
 * 10 m lots between), which makes every lot the same size — and on the real
 * sheet they are not. Frontages run 10, 11.50, 12, 13, 14.50, 15, 17, 18, 20,
 * 22, 25… and depths 25, 30, 30.41, 36.41, 42.x depending on the block. A
 * pattern cannot invent that; it has to be transcribed.
 *
 * The fastest source is NOT the drawing — it is the per-lot area tables printed
 * along the top of the sheet (lot number → superficie). With the row depth,
 * `frente = superficie ÷ fondo`, so one table gives the lot count, the numbering
 * and every frontage for that manzana at once.
 *
 * Example, once M-87's table is legible:
 *   'M-87': {
 *     frontsA: '13.95; 12.47; 12.00; 16x10.00; 14.00',
 *     frontsB: '13.93; 12.25; 12.00; 16x10.00; 14.12',
 *     depth: 30.41,
 *     start: 1,
 *   },
 */
export interface SheetManzana {
  /** Frontages along the outer edge, west → east, verbatim. */
  frontsA: string;
  /** The opposite edge. Defaults to frontsA when the sheet shows them equal. */
  frontsB?: string;
  /** Lot depth where it is not the usual 30.00. */
  depth?: number;
  /** First lot number printed for this manzana. */
  start?: number;
  directionA?: 'forward' | 'reverse';
  directionB?: 'forward' | 'reverse';
}

/**
 * Transcribed manzanas. EMPTY on purpose: the close-up photographs available so
 * far resolve the manzana outlines, the áreas verdes/equipamiento and the
 * summary area table, but not the individual lot frontages — counting a run of
 * "10.00" labels off them is guesswork, and guessing is what produced the
 * uniform lots in the first place. Entries land here as the tables become
 * legible, and each one stops being `needs_review` the moment it does.
 */
export const SHEET: Record<string, SheetManzana> = {};

export interface ElementSpec {
  kind: 'calle' | 'avenida' | 'ciclovia' | 'area_verde' | 'equipamiento' | 'amenidad' | 'perimetro';
  name: string;
  rect: [number, number, number, number];
  props?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cross-section — every figure below is a label printed on the sheet
// ---------------------------------------------------------------------------

const LOT_DEPTH = 30; // "30.00" — was 25 in the old guess
const ROW_H = LOT_DEPTH * 2; // 60 — a double-loaded row
const CALLE = 13; // "13.00 CALLE S/N"
const AVENIDA = 30; // "30.00 AVENIDA S/N" — between rows 2 and 3
const TRILLO_W = 30; // the railway corridor, labelled TRILLO 30.00
const HIGHWAY_W = 100; // Santa Cruz–Camiri right-of-way
const EAST_AVE = 22; // "22.00 AVENIDA S/N" between M-1/M-4 and M-2/M-3

/** Row bottom edges, R1 = northernmost. */
const ROW_Y = {
  R5: CALLE, // 13
  R4: CALLE + ROW_H + CALLE, // 86
  R3: CALLE + ROW_H + CALLE + ROW_H + CALLE, // 159
  R2: CALLE + ROW_H + CALLE + ROW_H + CALLE + ROW_H + AVENIDA, // 249
  R1: CALLE + ROW_H + CALLE + ROW_H + CALLE + ROW_H + AVENIDA + ROW_H + CALLE, // 322
} as const;

export const SITE_HEIGHT = ROW_Y.R1 + ROW_H + CALLE; // 395

/**
 * Length of the five-row body, west of the railway. From the sheet's grid
 * ticks: the west boundary sits at E 477 400 and the TRILLO corridor at
 * E ≈ 479 880, so the body runs ≈2 480 m.
 */
const BODY_LEN = 2480;

// East end, west → east: railway, M-3/M-4 column, M-1/M-2 column, highway.
const TRILLO_X = BODY_LEN + CALLE; // 2493
const EAST_A_X = TRILLO_X + TRILLO_W + CALLE; // 2536 — M-3 / M-4
const EAST_A_W = 170;
const EAST_B_X = EAST_A_X + EAST_A_W + CALLE; // 2719 — M-1 / M-2
const EAST_B_W = 60;
const HIGHWAY_X = EAST_B_X + EAST_B_W + CALLE; // 2792

export const SITE_WIDTH = HIGHWAY_X + HIGHWAY_W; // 2892

// The east end is a narrower strip than the body: two 70 m bands either side of
// the 22 m avenue.
const EAST_BAND_H = 70;
const EAST_S_Y = 123;
const EAST_N_Y = EAST_S_Y + EAST_BAND_H + EAST_AVE; // 215

// ---------------------------------------------------------------------------
// The manzana table
// ---------------------------------------------------------------------------

type Kind = BlockSpec['kind'];

interface Cell {
  code: string;
  kind: Kind;
  /** Metres along the row. Given where the sheet states an area. */
  len?: number;
  /** The empty half of a block that spans two rows. */
  hueco?: boolean;
  /** Block extends into the row below (R1→R2, or R4→R5). */
  span2?: boolean;
}

const R = (code: string, len?: number): Cell => ({ code, kind: 'residencial', len });
const V = (code: string, len?: number, span2 = false): Cell => ({
  code,
  kind: 'area_verde',
  len,
  span2,
});
const E = (code: string, len?: number, span2 = false): Cell => ({
  code,
  kind: 'equipamiento',
  len,
  span2,
});
const HUECO = (code: string, len: number): Cell => ({
  code,
  kind: 'residencial',
  len,
  hueco: true,
});

/**
 * Official manzana areas, read off the summary table printed on the sheet
 * (legible for M-60 … M-88). Length = area ÷ 60 m row depth, which reproduces
 * the sheet's own measured edges: M-88 computes to 219 m against a printed
 * 214.94, and M-79 to 79 m against a printed 80.86.
 */
const ROWS: Record<'R1' | 'R2' | 'R3' | 'R4' | 'R5', Cell[]> = {
  // ---- Row 1, north edge. Many short blocks through the east half. --------
  R1: [
    V('M-88', 219), //            13 146.60 m² área verde
    R('M-80', 252), //            15 121.83 m²
    E('M-79', 79, true), //       10 559.88 m² equipamiento, spans R1–R2
    R('M-72', 81), //              4 864.46 m²
    R('M-71', 83), //              4 962.19 m²
    R('M-70', 104), //             6 219.10 m²
    R('M-69', 88), //              5 253.84 m²
    R('M-68', 94), //              5 617.69 m²
    E('M-67', 83, true), //       11 040.96 m² equipamiento, spans R1–R2
    R('M-57'),
    R('M-56'),
    R('M-55'),
    V('M-54', 62, true), //        8 271.84 m² área verde, spans R1–R2
    R('M-46'),
    R('M-45'),
    R('M-44'),
    R('M-43'),
    R('M-42'),
    R('M-41'),
    R('M-32'),
    E('M-31', 55, true), //        7 311.72 m² equipamiento, spans R1–R2
    R('M-30'),
    R('M-29'),
    R('M-20'),
    R('M-19'),
    R('M-18'),
    R('M-17'),
    V('M-16', 54, true), //        7 163.25 m² área verde, spans R1–R2
    R('M-15'),
    R('M-7'),
    R('M-6'),
    R('M-5'),
  ],
  // ---- Row 2 -------------------------------------------------------------
  R2: [
    R('M-87', 211), //            12 677.63 m²
    R('M-81', 207), //            12 433.09 m²
    HUECO('M-79', 79),
    R('M-73', 206), //            12 330.32 m²
    R('M-66', 271), //            16 271.03 m²
    HUECO('M-67', 83),
    R('M-58'),
    R('M-53'),
    HUECO('M-54', 62),
    R('M-47'),
    R('M-40'),
    R('M-33'),
    HUECO('M-31', 55),
    R('M-21'),
    R('M-22'),
    HUECO('M-16', 54),
    R('M-14'),
    R('M-8'),
  ],
  // ---- Row 3, immediately south of the 30 m avenida ----------------------
  R3: [
    R('M-86', 211), //            12 637.85 m²
    R('M-82', 207), //            12 412.96 m²
    R('M-78', 68), //              4 057.40 m²
    R('M-74', 190), //            11 417.58 m²
    R('M-65', 198), //            11 870.16 m²
    R('M-59'),
    R('M-52'),
    R('M-48'),
    R('M-39'),
    R('M-34'),
    R('M-28'),
    R('M-23'),
    R('M-13'),
    R('M-9'),
  ],
  // ---- Row 4 -------------------------------------------------------------
  R4: [
    E('M-85', 144), //             8 641.31 m² equipamiento
    R('M-83', 144), //             8 643.24 m²
    V('M-77', 169, true), //      22 422.23 m² área verde, spans R4–R5
    R('M-75', 206), //            12 330.32 m²
    R('M-64', 257), //            15 434.14 m²
    R('M-60', 105), //             6 324.33 m²
    R('M-51'),
    E('M-49', 69, true), //        9 202.53 m² equipamiento, spans R4–R5
    R('M-38'),
    R('M-35'),
    R('M-27'),
    R('M-24'),
    R('M-12'),
    R('M-10'),
  ],
  // ---- Row 5, south edge -------------------------------------------------
  R5: [
    R('M-84', 32), //              1 891.29 m²
    HUECO('M-77', 169),
    R('M-76', 149), //             8 938.44 m²
    R('M-63', 153), //             9 182.05 m²
    R('M-62', 106), //             6 336.90 m²
    R('M-61', 106), //             6 337.95 m²
    R('M-50'),
    HUECO('M-49', 69),
    R('M-37'),
    R('M-36'),
    R('M-26'),
    R('M-25'),
    R('M-11'),
  ],
};

const ROW_KEYS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

/** Sector label, by position along the strip. */
function sectorFor(x: number): string {
  if (x > BODY_LEN) return 'Acceso';
  if (x > (BODY_LEN * 2) / 3) return 'Este';
  if (x > BODY_LEN / 3) return 'Centro';
  return 'Oeste';
}

interface Placed {
  cell: Cell;
  x: number;
  len: number;
}

/**
 * Lay a row out west → east across BODY_LEN.
 *
 * `pins` fixes the x and length of cells that belong to a block spanning this
 * row and the one below (M-79, M-67, M-54, M-31, M-16, M-77, M-49). Without
 * pinning, the two rows size their unknown cells differently, the block and its
 * gap land at different x, and the block overlaps its neighbour underneath —
 * which is exactly what the first generated pass did, eight times.
 *
 * Length the sheet does not give is shared out between pins, so each stretch
 * closes exactly and nothing overlaps.
 */
function layoutRow(cells: Cell[], pins?: Map<string, { x: number; len: number }>): Placed[] {
  const out: Placed[] = [];
  const pinAt = new Map<number, { x: number; len: number }>();
  cells.forEach((c, i) => {
    const p = pins?.get(c.code);
    if (p) pinAt.set(i, p);
  });

  /**
   * Narrowest manzana we will draw. Row 1 carries the most blocks (the north
   * edge is cut into many short ones), so a generous floor left it packed solid
   * and a spanning slot could never be honoured — the rows then disagreed on
   * where that slot was and the block landed on its neighbour. 22 m still holds
   * two 10 m lots.
   */
  const MIN_LEN = 22;

  // Segment boundaries: [start index, end index) between consecutive pins.
  let segStart = 0;
  let cursor = 0;

  /** Space this stretch cannot go below, so a pin is never placed on top of it. */
  const needs = (endExclusive: number) => {
    const seg = cells.slice(segStart, endExclusive);
    const known = seg.reduce((s, c) => s + (c.len ?? 0), 0);
    const unknown = seg.filter((c) => c.len === undefined).length;
    return known + unknown * MIN_LEN + seg.length * CALLE;
  };

  const flush = (endExclusive: number, limit: number) => {
    const seg = cells.slice(segStart, endExclusive);
    if (seg.length === 0) return;
    const known = seg.reduce((s, c) => s + (c.len ?? 0), 0);
    const unknown = seg.filter((c) => c.len === undefined).length;
    const gaps = seg.length * CALLE; // one calle after each cell in the stretch
    const fill = unknown > 0 ? Math.max(MIN_LEN, (limit - cursor - known - gaps) / unknown) : 0;
    for (const c of seg) {
      const len = c.len ?? fill;
      out.push({ cell: c, x: cursor, len });
      cursor += len + CALLE;
    }
  };

  for (let i = 0; i < cells.length; i++) {
    const pin = pinAt.get(i);
    if (!pin) continue;
    // The pin must clear everything queued ahead of it. Clamping against the
    // cursor alone was not enough: flush() then laid those cells out and ran
    // straight through the pinned block.
    const px = Math.max(pin.x, cursor + needs(i));
    flush(i, px);
    out.push({ cell: cells[i], x: px, len: pin.len });
    cursor = px + pin.len + CALLE;
    segStart = i + 1;
  }
  flush(cells.length, BODY_LEN + CALLE);
  return out;
}

/** Rows laid out once, shared by the block and element builders. */
const LAYOUT: Record<'R1' | 'R2' | 'R3' | 'R4' | 'R5', Placed[]> = (() => {
  const slotsOf = (placed: Placed[], codes: Set<string>) =>
    new Map(placed.filter((p) => codes.has(p.cell.code)).map((p) => [p.cell.code, { x: p.x, len: p.len }]));

  /**
   * A spanning block occupies the same slot in both rows, so both must agree on
   * where that slot is. Each row is laid out, the shared slots are moved to
   * whichever x is furthest east, and the rows are laid out again — repeated to
   * a fixed point.
   *
   * One pass is not enough: layoutRow may push a pin further east to clear the
   * cells ahead of it, and it can push by a different amount in each row, which
   * puts the block back on top of its neighbour underneath. Slots only ever
   * move east, so this converges.
   */
  const pair = (upper: Cell[], lower: Cell[]): [Placed[], Placed[]] => {
    const spanning = new Set(upper.filter((c) => c.span2).map((c) => c.code));
    let pins = new Map<string, { x: number; len: number }>();
    let a = layoutRow(upper);
    let b = layoutRow(lower);
    for (let iter = 0; iter < 8; iter++) {
      const sa = slotsOf(a, spanning);
      const sb = slotsOf(b, spanning);
      let settled = true;
      const next = new Map<string, { x: number; len: number }>();
      for (const code of spanning) {
        const x = Math.max(sa.get(code)?.x ?? 0, sb.get(code)?.x ?? 0);
        const len = sa.get(code)?.len ?? sb.get(code)?.len ?? 0;
        next.set(code, { x, len });
        if (Math.abs((pins.get(code)?.x ?? Number.NaN) - x) > 0.01) settled = false;
      }
      pins = next;
      a = layoutRow(upper, pins);
      b = layoutRow(lower, pins);
      if (settled) break;
    }
    return [a, b];
  };

  const [r1, r2] = pair(ROWS.R1, ROWS.R2);
  const [r4, r5] = pair(ROWS.R4, ROWS.R5);
  return { R1: r1, R2: r2, R3: layoutRow(ROWS.R3), R4: r4, R5: r5 };
})();

/**
 * Frontage spec for a block of the given length: 12 m corner lots at each end,
 * 10 m lots between — the sheet's dominant pattern.
 */
function frontsFor(len: number): string {
  const inner = Math.floor((len - 24) / 10);
  if (inner <= 0) return `${Math.round((len / 2) * 100) / 100}; ${Math.round((len / 2) * 100) / 100}`;
  return `12; ${inner}x10; 12`;
}

/**
 * A residential manzana: transcribed from the sheet when SHEET has it, cut with
 * the dominant pattern when it does not. Only the pattern case is
 * `needs_review`.
 */
function residencial(
  code: string,
  sector: string,
  rect: BlockSpec['rect'],
  len: number,
): BlockSpec {
  const sheet = SHEET[code];
  if (sheet) {
    return {
      code,
      sector,
      kind: 'residencial',
      rect,
      rows: 2,
      hint: 'S',
      frontA: sheet.frontsA,
      frontB: sheet.frontsB ?? sheet.frontsA,
      depthA: sheet.depth,
      startNumber: sheet.start,
      directionA: sheet.directionA,
      directionB: sheet.directionB,
      transcribed: true,
    };
  }
  return {
    code,
    sector,
    kind: 'residencial',
    rect,
    rows: 2,
    hint: 'S',
    frontA: frontsFor(len),
    frontB: frontsFor(len),
    transcribed: false,
  };
}

function buildBlocks(): BlockSpec[] {
  const blocks: BlockSpec[] = [];

  for (const key of ROW_KEYS) {
    const y = ROW_Y[key];
    for (const { cell, x, len } of LAYOUT[key]) {
      if (cell.hueco) continue;
      // A spanning block reaches into the row below (R1→R2, R4→R5).
      const h = cell.span2 ? ROW_H + CALLE + ROW_H : ROW_H;
      const yy = cell.span2 ? y - CALLE - ROW_H : y;
      const rect: BlockSpec['rect'] = [x, yy, len, h];
      blocks.push(
        cell.kind === 'residencial'
          ? residencial(cell.code, sectorFor(x), rect, len)
          : { code: cell.code, sector: sectorFor(x), kind: cell.kind, rect },
      );
    }
  }

  // --- East end: M-1 … M-4, between the railway and the highway ------------
  // M-4 / M-3 each carry an ÁREA VERDE at their WEST end (2 733.38 / 2 966.12 m²).
  const greenN = Math.round((2733.38 / EAST_BAND_H) * 100) / 100; // ≈ 39 m
  const greenS = Math.round((2966.12 / EAST_BAND_H) * 100) / 100; // ≈ 42 m

  const east: [string, number, number, number][] = [
    ['M-4', EAST_A_X + greenN, EAST_N_Y, EAST_A_W - greenN],
    ['M-3', EAST_A_X + greenS, EAST_S_Y, EAST_A_W - greenS],
    ['M-1', EAST_B_X, EAST_N_Y, EAST_B_W],
    ['M-2', EAST_B_X, EAST_S_Y, EAST_B_W],
  ];
  for (const [code, x, y, w] of east) {
    blocks.push(residencial(code, 'Acceso', [x, y, w, EAST_BAND_H], w));
  }

  return blocks;
}

export const BLOCKS: BlockSpec[] = buildBlocks();

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function buildElements(): ElementSpec[] {
  const els: ElementSpec[] = [];
  const overhang = 260;

  // The highway crosses the EAST end, perpendicular to the strip.
  els.push({
    kind: 'avenida',
    name: 'Carretera Santa Cruz — Camiri',
    rect: [HIGHWAY_X, -overhang, HIGHWAY_W, SITE_HEIGHT + overhang * 2],
    props: { width_m: HIGHWAY_W, highway: true },
  });

  // TRILLO — the railway corridor, parallel to the highway.
  els.push({
    kind: 'avenida',
    name: 'Trillo',
    rect: [TRILLO_X, -overhang, TRILLO_W, SITE_HEIGHT + overhang * 2],
    props: { width_m: TRILLO_W, railway: true },
  });

  // The 30 m spine between rows 2 and 3, the length of the body.
  els.push({
    kind: 'avenida',
    name: 'Avenida S/N',
    rect: [0, ROW_Y.R3 + ROW_H, BODY_LEN, AVENIDA],
    props: { width_m: AVENIDA },
  });

  // The 22 m avenue splitting the east-end blocks.
  els.push({
    kind: 'avenida',
    name: 'Avenida S/N',
    rect: [EAST_A_X, EAST_S_Y + EAST_BAND_H, HIGHWAY_X - CALLE - EAST_A_X, EAST_AVE],
    props: { width_m: EAST_AVE },
  });

  // Longitudinal calles: the perimeter pair and the three between rows.
  for (const y of [0, ROW_Y.R5 + ROW_H, ROW_Y.R4 + ROW_H, ROW_Y.R2 + ROW_H, ROW_Y.R1 + ROW_H]) {
    els.push({ kind: 'calle', name: 'Calle S/N', rect: [0, y, BODY_LEN, CALLE] });
  }

  // Cross calles: one in every gap between adjacent manzanas, per row.
  for (const key of ROW_KEYS) {
    const y = ROW_Y[key];
    const placed = LAYOUT[key];
    for (let i = 0; i < placed.length - 1; i++) {
      const gapX = placed[i].x + placed[i].len;
      const gapW = placed[i + 1].x - gapX;
      if (gapW > 0.5) els.push({ kind: 'calle', name: 'Calle S/N', rect: [gapX, y, gapW, ROW_H] });
    }
  }

  // The two áreas verdes at the west end of M-4 and M-3.
  els.push({
    kind: 'area_verde',
    name: 'Área Verde',
    rect: [EAST_A_X, EAST_N_Y, Math.round((2733.38 / EAST_BAND_H) * 100) / 100, EAST_BAND_H],
  });
  els.push({
    kind: 'area_verde',
    name: 'Área Verde',
    rect: [EAST_A_X, EAST_S_Y, Math.round((2966.12 / EAST_BAND_H) * 100) / 100, EAST_BAND_H],
  });

  els.push({ kind: 'perimetro', name: 'Perímetro', rect: [0, 0, BODY_LEN, SITE_HEIGHT] });

  return els;
}

export const ELEMENTS: ElementSpec[] = buildElements();

/**
 * Plan-space origin in offset-UTM (EPSG:32720, zone 20S), from the grid ticks
 * printed on the sheet: E 477 400 at the west edge, N 7 979 700 at the south.
 */
export const UTM_ANCHOR = { epsg: 32720, offsetE: 477400.0, offsetN: 7979700.0 };
