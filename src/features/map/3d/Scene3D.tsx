'use client';

// 3D exploration mode root. Loaded ONLY via next/dynamic({ ssr: false }) from
// MapShell so 2D visitors pay zero three.js bytes. Reads geometry once from
// the shared map store (hydrated by MapShell before this can ever mount).
//
// Render budget (overview frame): terrain 1 + roads 1 + greens 1 + pads 1 +
// amenity cards 2 + amenity texts 2 + lots 1 + outlines 1 = 10 draw calls.
// Worst case (zoomed, ≤12 labels visible, lot selected) = 24 ≤ 25.
// Verified in dev by the DrawCallLogger console line.

import { MapControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useMapStore } from '../store/useMapStore';
import { GroundLayer } from './GroundLayer';
import { LabelsLayer } from './LabelsLayer';
import { LotsLayer } from './LotsLayer';
import { SKY_COLOR } from './palette';
import { useQuality } from './useQuality';

const MIN_DISTANCE = 40;
// Must clear the whole site: this urbanización is a ~3 km strip, and a fixed
// 900 m cap made it impossible to frame (it rendered cropped to a hairline).
// Derived from the site extent at mount instead, with a floor for small plats.
const MAX_DISTANCE_FLOOR = 900;
const FOV = 55;
const MAX_POLAR = (78 * Math.PI) / 180;

export interface Scene3DProps {
  /** Device can't run the scene (no WebGL2, GPU tier 0, or context lost). */
  onUnsupported: () => void;
}

export function Scene3D({ onUnsupported }: Scene3DProps) {
  const quality = useQuality();
  const ready = useMapStore((s) => s.ready);
  const planBbox = useMapStore((s) => s.planBbox);

  const blocked = quality?.status === 'blocked';
  useEffect(() => {
    if (blocked) onUnsupported();
  }, [blocked, onUnsupported]);

  // Tap on empty ground closes the lot sheet (same gesture as the 2D map).
  // Guarded by pointer travel so camera drags never deselect.
  const missDownRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      missDownRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Elevated oblique view down the site's LONG axis, framed from the site's own
  // extent and the camera fov. A fixed azimuth + max(w,h) fit only worked for a
  // squarish plat; this urbanización is a long narrow strip and needs to be
  // approached from its short end (the highway) looking along its length.
  const cam = useMemo(() => {
    const [x0, y0, x1, y1] = planBbox;
    const w = Math.max(x1 - x0, 1);
    const h = Math.max(y1 - y0, 1);
    const cx = (x0 + x1) / 2;
    const cz = -(y0 + y1) / 2;

    // Distance that fits the longer dimension in view at this fov, with margin.
    const half = Math.max(w, h, 100) / 2;
    const fit = (half * 1.25) / Math.tan(((FOV / 2) * Math.PI) / 180);
    const dist = Math.max(180, fit);

    // Look along the long axis: for a tall (north–south) site, come in low over
    // the southern end where the Carretera and the entrance are.
    const alongY = h >= w;
    const dir = alongY
      ? { x: 0.22, y: 0.72, z: 0.66 } // from the south, looking north
      : { x: -0.66, y: 0.72, z: 0.22 }; // from the west, looking east
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const position: [number, number, number] = [
      cx + (dir.x / len) * dist,
      (dir.y / len) * dist,
      cz + (dir.z / len) * dist,
    ];
    return {
      position,
      target: [cx, 0, cz] as [number, number, number],
      maxDistance: Math.max(MAX_DISTANCE_FLOOR, dist * 1.3),
      /** Fog/light scale with the site so a long strip isn't swallowed. */
      extent: Math.max(w, h),
    };
  }, [planBbox]);

  if (blocked) return null;
  if (!ready || quality === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-stone-100 text-sm font-medium text-stone-500">
        Preparando vista 3D…
      </div>
    );
  }

  return (
    <Canvas
      frameloop="demand"
      dpr={quality.dpr}
      flat
      camera={{ position: cam.position, fov: FOV, near: 5, far: Math.max(6000, cam.extent * 3) }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={(e) => {
        const down = missDownRef.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
        const store = useMapStore.getState();
        if (store.selectedLotId) store.selectLot(null);
      }}
    >
      <color attach="background" args={[SKY_COLOR]} />
      {/* Fog and sun scale with the site: fixed distances hid the far end of a
          long strip and put the sun off-property entirely. */}
      <fog attach="fog" args={[SKY_COLOR, cam.extent * 0.9, cam.extent * 2.6]} />
      <hemisphereLight args={['#eaf4fb', '#c9c0a8', 1.9]} />
      <directionalLight
        position={[
          cam.target[0] + cam.extent * 0.35,
          cam.extent * 0.7,
          cam.target[2] - cam.extent * 0.3,
        ]}
        intensity={1.5}
      />

      <ContextLossGuard onUnsupported={onUnsupported} />
      <SceneControls planBbox={planBbox} target={cam.target} maxDistance={cam.maxDistance} />

      <Suspense fallback={null}>
        <GroundLayer terrainSegments={quality.terrainSegments} />
        <LotsLayer />
        <LabelsLayer showManzanaLabels={quality.showLabels} />
      </Suspense>

      {process.env.NODE_ENV !== 'production' ? <DrawCallLogger /> : null}
    </Canvas>
  );
}

export default Scene3D;

// ---------------------------------------------------------------------------

function SceneControls({
  planBbox,
  target,
  maxDistance,
}: {
  planBbox: [number, number, number, number];
  target: [number, number, number];
  maxDistance: number;
}) {
  const controlsRef = useRef<MapControlsImpl | null>(null);

  // Clamp the orbit target to the plan bbox; shift the camera by the same
  // delta so a pan against the edge slides instead of snapping.
  const handleChange = () => {
    const c = controlsRef.current;
    if (!c) return;
    const [x0, y0, x1, y1] = planBbox;
    const t = c.target;
    const nx = Math.min(Math.max(t.x, x0), x1);
    const nz = Math.min(Math.max(t.z, -y1), -y0);
    if (nx !== t.x || nz !== t.z) {
      c.object.position.x += nx - t.x;
      c.object.position.z += nz - t.z;
      t.x = nx;
      t.z = nz;
    }
  };

  return (
    <MapControls
      ref={controlsRef}
      makeDefault
      target={target}
      minDistance={MIN_DISTANCE}
      maxDistance={maxDistance}
      maxPolarAngle={MAX_POLAR}
      enableDamping
      dampingFactor={0.08}
      onChange={handleChange}
    />
  );
}

function ContextLossGuard({ onUnsupported }: { onUnsupported: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const handler = (e: Event) => {
      e.preventDefault();
      onUnsupported();
    };
    el.addEventListener('webglcontextlost', handler);
    return () => el.removeEventListener('webglcontextlost', handler);
  }, [gl, onUnsupported]);
  return null;
}

// DEV-only: renders one frame with info accumulation frozen and logs the
// draw-call count (budget ≤ 25). Never mounted in production builds.
function DrawCallLogger() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    let raf = 0;
    const timer = setTimeout(() => {
      gl.info.autoReset = false;
      gl.info.reset();
      const frame0 = gl.info.render.frame;
      invalidate();
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const frames = Math.max(1, gl.info.render.frame - frame0);
          console.log(
            `[Scene3D] draw calls: ${Math.round(gl.info.render.calls / frames)} ` +
              `(tris ${gl.info.render.triangles}, frames sampled ${frames})`,
          );
          gl.info.autoReset = true;
        });
      });
    }, 1200);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      gl.info.autoReset = true;
    };
  }, [gl, invalidate]);
  return null;
}
