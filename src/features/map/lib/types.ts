// Plan-space geometry types. Coordinates are meters, +X east, +Y north,
// origin per project (calibrated as offset-UTM EPSG:32720).

export type Pt = [number, number];

/** Open ring (first point NOT repeated at the end), counterclockwise. */
export type Ring = Pt[];

export interface EdgeDim {
  x: number;
  y: number;
  ang: number; // degrees
  len: number;
  text: string;
}

export interface GeneratedLot {
  number: string;
  ring: Ring;
  frontage_m: number;
  depth_m: number;
  area_m2: number;
  is_corner: boolean;
}

export interface SubdivideResult {
  lots: GeneratedLot[];
  /** Meters of front chain not covered by the frontage spec (0 when it fits). */
  leftoverA: number;
  leftoverB: number;
  warnings: string[];
}

export interface SubdivideOptions {
  /** A point near the street that fronts row A (chooses which long chain is A). */
  sideAHint: Pt;
  rows: 1 | 2;
  /**
   * Depth of row A in meters. Omit for a midline split (each row gets half the
   * block depth). For rows: 1 this is ignored — the row spans the full depth.
   */
  depthA?: number;
  frontagesA: number[];
  /** Defaults to frontagesA. Ignored when rows === 1. */
  frontagesB?: number[];
  numbering?: {
    start?: number; // default 1
    /** 'per-row': A gets 1..n then B continues. Default. */
    pattern?: 'per-row';
    /** Walk row A forward (spec order) or reversed. Default 'forward'. */
    directionA?: 'forward' | 'reverse';
    /** Walk row B in the same screen direction as A ('mirror') or opposite. */
    directionB?: 'forward' | 'reverse';
  };
}
