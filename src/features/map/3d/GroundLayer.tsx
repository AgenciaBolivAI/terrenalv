'use client';

// Terrain + merged roads + merged green areas + merged amenity pads.
// Exactly 4 draw calls, built once per geometry snapshot.

import { useEffect, useMemo } from 'react';
import { useMapStore } from '../store/useMapStore';
import { GREEN_COLOR, ROAD_COLOR } from './palette';
import { buildGround } from './world';

export function GroundLayer({ terrainSegments }: { terrainSegments: number }) {
  const planBbox = useMapStore((s) => s.planBbox);
  const maxY = useMapStore((s) => s.maxY);
  const manzanas = useMapStore((s) => s.manzanas);
  const elements = useMapStore((s) => s.elements);

  const built = useMemo(
    () => buildGround({ planBbox, maxY, manzanas, elements, terrainSegments }),
    [planBbox, maxY, manzanas, elements, terrainSegments],
  );

  useEffect(
    () => () => {
      built.terrain.dispose();
      built.roads?.dispose();
      built.greens?.dispose();
      built.pads?.dispose();
    },
    [built],
  );

  return (
    <group>
      <mesh geometry={built.terrain}>
        <meshLambertMaterial vertexColors />
      </mesh>
      {built.roads ? (
        <mesh geometry={built.roads}>
          <meshLambertMaterial color={ROAD_COLOR} />
        </mesh>
      ) : null}
      {built.greens ? (
        <mesh geometry={built.greens}>
          <meshLambertMaterial color={GREEN_COLOR} />
        </mesh>
      ) : null}
      {built.pads ? (
        <mesh geometry={built.pads}>
          <meshLambertMaterial vertexColors />
        </mesh>
      ) : null}
    </group>
  );
}
