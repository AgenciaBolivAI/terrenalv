// Shared SVG-space helpers for the 2D plat. SVG user units == plan meters
// (y already flipped by parseSnapshot), and the <svg> element is sized 1 unit
// = 1 CSS px, so the react-zoom-pan-pinch scale IS "screen px per plan meter".

export interface ViewBoxSpec {
  minX: number;
  minY: number;
  width: number;
  height: number;
  pad: number;
}

/** Padded viewBox around the plan bbox (padding shows streets at the border). */
export function getViewBox(planBbox: [number, number, number, number]): ViewBoxSpec {
  const w = planBbox[2] - planBbox[0];
  const h = planBbox[3] - planBbox[1];
  const pad = Math.min(60, Math.max(15, Math.max(w, h) * 0.05));
  return {
    minX: planBbox[0] - pad,
    // Flipped space: top edge of the plan is y=0 (maxY - planBbox[3]).
    minY: -pad,
    width: w + 2 * pad,
    height: h + 2 * pad,
    pad,
  };
}

export type Bbox = [number, number, number, number];

/** Does `a` intersect `b` after padding `b` outward by `padFrac` of its size? */
export function intersectsPadded(a: Bbox, b: Bbox, padFrac = 0): boolean {
  const px = (b[2] - b[0]) * padFrac;
  const py = (b[3] - b[1]) * padFrac;
  return a[0] <= b[2] + px && a[2] >= b[0] - px && a[1] <= b[3] + py && a[3] >= b[1] - py;
}

/** Imperative camera controls PlanViewport exposes to the search box. */
export interface ViewportController {
  zoomToLot: (lotId: string) => void;
  zoomToManzana: (manzanaId: string) => void;
}
