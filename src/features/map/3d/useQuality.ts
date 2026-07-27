'use client';

// Device quality gate for the 3D scene, run once per session:
//  * no WebGL2 or GPU tier 0  → blocked (caller falls back to 2D for good)
//  * tier 1 or deviceMemory ≤ 2 GB → low preset (dpr 1, coarse terrain, no labels)
//  * otherwise → full preset
// detect-gpu fetches its benchmark table from a CDN; if that fails (offline,
// blocked) we do NOT punish the device — WebGL2 presence already passed.

import { getGPUTier } from 'detect-gpu';
import { useEffect, useState } from 'react';

export type Scene3DQuality =
  | { status: 'blocked' }
  | {
      status: 'ready';
      low: boolean;
      dpr: number | [number, number];
      terrainSegments: number;
      showLabels: boolean;
    };

let cached: Scene3DQuality | null = null;

export function useQuality(): Scene3DQuality | null {
  const [quality, setQuality] = useState<Scene3DQuality | null>(cached);

  useEffect(() => {
    if (cached) {
      setQuality(cached);
      return;
    }
    let alive = true;
    (async () => {
      let webgl2 = false;
      try {
        const canvas = document.createElement('canvas');
        webgl2 = canvas.getContext('webgl2') !== null;
      } catch {
        webgl2 = false;
      }
      if (!webgl2) {
        cached = { status: 'blocked' };
        if (alive) setQuality(cached);
        return;
      }

      let tier: number | null = null;
      try {
        tier = (await getGPUTier()).tier;
      } catch {
        tier = null; // benchmark fetch failed → assume capable
      }
      if (!alive) return;
      if (tier === 0) {
        cached = { status: 'blocked' };
        setQuality(cached);
        return;
      }

      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const low = tier === 1 || (typeof mem === 'number' && mem <= 2);
      cached = low
        ? { status: 'ready', low: true, dpr: 1, terrainSegments: 48, showLabels: false }
        : { status: 'ready', low: false, dpr: [1, 2], terrainSegments: 96, showLabels: true };
      setQuality(cached);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return quality;
}
