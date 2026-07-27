'use client';

// Manzana code labels (flat drei <Text> on the ground) + amenity billboards
// (rounded label card + name — props.billboard names future images; until
// those assets exist we render a tasteful card). Label visibility is culled
// imperatively in useFrame (throttled): only the nearest few labels within
// LABEL_MAX_DIST render, keeping the draw-call budget intact. Total drei Text
// instances = manzanas + amenities (seed: 27 + 2 ≤ 40).

import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { useMapStore } from '../store/useMapStore';
import { LABEL_COLOR, LABEL_Y } from './palette';
import { amenityBillboards, roundedRectGeometry } from './world';

// Minimum reach. On a long site the effective radius grows with how far the
// camera has pulled back, otherwise the whole-site overview shows zero labels.
const LABEL_MIN_DIST = 480;
const LABEL_MAX_VISIBLE = 12; // hard cap keeps total draw calls ≤ 25
const CULL_INTERVAL_S = 0.15;

export function LabelsLayer({ showManzanaLabels }: { showManzanaLabels: boolean }) {
  const manzanas = useMapStore((s) => s.manzanas);
  const elements = useMapStore((s) => s.elements);
  const maxY = useMapStore((s) => s.maxY);

  const mzLabels = useMemo(
    () =>
      manzanas
        .filter((m) => m.code)
        .map((m) => ({
          id: m.id,
          code: m.code,
          // labelCenter is SVG-space: z = −planY = svgY − maxY.
          position: [m.labelCenter[0], LABEL_Y, m.labelCenter[1] - maxY] as [number, number, number],
        })),
    [manzanas, maxY],
  );

  const amenities = useMemo(() => amenityBillboards(elements, maxY), [elements, maxY]);

  // ---- Distance culling, throttled, no React involved ----------------------
  const groupRef = useRef<Group>(null);
  const accRef = useRef(CULL_INTERVAL_S); // evaluate on the first frame
  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    if (!group) return;
    accRef.current += delta;
    if (accRef.current < CULL_INTERVAL_S) return;
    accRef.current = 0;

    // Scale the cull radius with the camera's height above the plat, so the
    // nearest labels stay legible whether you're zoomed into one manzana or
    // looking down the length of the whole strip.
    const reach = Math.max(LABEL_MIN_DIST, camera.position.y * 1.6);
    const near: { i: number; d: number }[] = [];
    for (let i = 0; i < group.children.length; i++) {
      const child = group.children[i];
      const d = camera.position.distanceTo(child.position);
      child.visible = false;
      if (d < reach) near.push({ i, d });
    }
    near.sort((a, b) => a.d - b.d);
    const n = Math.min(LABEL_MAX_VISIBLE, near.length);
    for (let k = 0; k < n; k++) group.children[near[k].i].visible = true;
  });

  return (
    <group>
      {showManzanaLabels ? (
        <group ref={groupRef}>
          {mzLabels.map((l) => (
            <Text
              key={l.id}
              position={l.position}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={13}
              color={LABEL_COLOR}
              anchorX="center"
              anchorY="middle"
              visible={false}
            >
              {l.code}
            </Text>
          ))}
        </group>
      ) : null}
      {amenities.map((a) => (
        <AmenityBillboard key={a.id} name={a.name} position={a.position} />
      ))}
    </group>
  );
}

function AmenityBillboard({ name, position }: { name: string; position: [number, number, number] }) {
  const card = useMemo(() => {
    const width = Math.max(24, name.length * 2.2 + 8);
    return { geometry: roundedRectGeometry(width, 9, 2.5), width };
  }, [name]);

  useEffect(() => () => card.geometry.dispose(), [card]);

  return (
    <Billboard position={position}>
      <mesh geometry={card.geometry}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.92} />
      </mesh>
      <Text
        position={[0, 0, 0.2]}
        fontSize={3.4}
        color="#1c1917"
        anchorX="center"
        anchorY="middle"
        maxWidth={card.width - 5}
        textAlign="center"
      >
        {name}
      </Text>
    </Billboard>
  );
}
