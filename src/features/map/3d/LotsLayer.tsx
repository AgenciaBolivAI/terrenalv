'use client';

// The critical layer: ALL lots extruded and merged into ONE mesh (1 draw call)
// + ONE merged outline LineSegments. Status changes arrive via a transient
// zustand subscription (outside React) and are written straight into the
// vertex-color buffer — zero React re-renders in the hot path. Picking maps
// raycast faceIndex → lotId through binary search over merged tri ranges.

import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useMapStore } from '../store/useMapStore';
import { OUTLINE_COLOR, SELECT_BASE_Y, SELECT_FILL, SELECT_HEIGHT, SELECT_STROKE, lotColor } from './palette';
import { buildLots, extrudeRingGeometry, lotIdForFace, paintLotRange } from './world';

const CLICK_SLOP_PX = 6;

export function LotsLayer() {
  const lots = useMapStore((s) => s.lots); // identity stable until setGeometry
  const invalidate = useThree((s) => s.invalidate);

  const build = useMemo(
    () => buildLots(lots.values(), useMapStore.getState().statusByLotId),
    [lots],
  );

  useEffect(
    () => () => {
      if (build) {
        build.geometry.dispose();
        build.outlineGeometry?.dispose();
      }
    },
    [build],
  );

  // ---- Transient status → vertex color patches (no React reconciliation) ---
  useEffect(() => {
    if (!build) return;
    const attr = build.geometry.getAttribute('color') as THREE.BufferAttribute;

    // Repaint once on mount: statuses may have moved between memo and effect.
    const current = useMapStore.getState().statusByLotId;
    for (const [id, range] of build.lotRanges) paintLotRange(attr, range, lotColor(current[id]));
    attr.needsUpdate = true;
    invalidate();

    return useMapStore.subscribe(
      (s) => s.statusByLotId,
      (next, prev) => {
        let dirty = false;
        for (const id in next) {
          if (next[id] !== prev[id]) {
            const range = build.lotRanges.get(id);
            if (range) {
              paintLotRange(attr, range, lotColor(next[id]));
              dirty = true;
            }
          }
        }
        if (dirty) {
          attr.needsUpdate = true;
          invalidate();
        }
      },
    );
  }, [build, invalidate]);

  // ---- Picking: pointer-up with drag guard (MapControls owns real drags) ---
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const pick = (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) => {
    if (!build || e.faceIndex == null) return;
    const lotId = lotIdForFace(build.triRanges, e.faceIndex);
    if (lotId) useMapStore.getState().selectLot(lotId);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    downRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const down = downRef.current;
    downRef.current = null;
    if (!down) return;
    const dx = e.nativeEvent.clientX - down.x;
    const dy = e.nativeEvent.clientY - down.y;
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) return; // it was a camera drag
    pick(e);
  };

  if (!build) return null;

  return (
    <group>
      <mesh
        geometry={build.geometry}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onDoubleClick={pick}
      >
        {/* Basic material: status colors render EXACTLY as the CSS hex values. */}
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      {build.outlineGeometry ? (
        <lineSegments geometry={build.outlineGeometry}>
          <lineBasicMaterial color={OUTLINE_COLOR} />
        </lineSegments>
      ) : null}
      <SelectionHighlight />
    </group>
  );
}

// One highlight mesh (extruded ring + blue edges), rebuilt on selection. React
// involvement here is fine — selection already re-renders the bottom sheet.
function SelectionHighlight() {
  const selectedLotId = useMapStore((s) => s.selectedLotId);
  const lots = useMapStore((s) => s.lots);

  const data = useMemo(() => {
    const lot = selectedLotId ? lots.get(selectedLotId) : undefined;
    if (!lot || lot.ring.length < 3) return null;
    const fill = extrudeRingGeometry(lot.ring, SELECT_HEIGHT, SELECT_BASE_Y);
    const edges = new THREE.EdgesGeometry(fill, 25);
    return { fill, edges };
  }, [selectedLotId, lots]);

  useEffect(
    () => () => {
      if (data) {
        data.fill.dispose();
        data.edges.dispose();
      }
    },
    [data],
  );

  if (!data) return null;
  return (
    <group>
      <mesh geometry={data.fill}>
        <meshBasicMaterial color={SELECT_FILL} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <lineSegments geometry={data.edges}>
        <lineBasicMaterial color={SELECT_STROKE} />
      </lineSegments>
    </group>
  );
}
