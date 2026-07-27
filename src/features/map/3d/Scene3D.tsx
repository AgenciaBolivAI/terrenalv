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
const MAX_DISTANCE = 900;
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

  // Elevated oblique view from the south-east taking in the whole site.
  // Plan SE = (+x, −y) → three (+x, +z).
  const cam = useMemo(() => {
    const [x0, y0, x1, y1] = planBbox;
    const cx = (x0 + x1) / 2;
    const cz = -(y0 + y1) / 2;
    const span = Math.max(x1 - x0, y1 - y0, 100);
    const dist = Math.min(MAX_DISTANCE * 0.97, Math.max(180, span * 0.68));
    const len = Math.hypot(0.46, 1, 0.5);
    const position: [number, number, number] = [
      cx + (0.46 / len) * dist,
      (1 / len) * dist,
      cz + (0.5 / len) * dist,
    ];
    return { position, target: [cx, 0, cz] as [number, number, number] };
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
      camera={{ position: cam.position, fov: 55, near: 5, far: 6000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={(e) => {
        const down = missDownRef.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
        const store = useMapStore.getState();
        if (store.selectedLotId) store.selectLot(null);
      }}
    >
      <color attach="background" args={[SKY_COLOR]} />
      <fog attach="fog" args={[SKY_COLOR, 1400, 4800]} />
      <hemisphereLight args={['#eaf4fb', '#c9c0a8', 1.9]} />
      <directionalLight position={[320, 640, -260]} intensity={1.5} />

      <ContextLossGuard onUnsupported={onUnsupported} />
      <SceneControls planBbox={planBbox} target={cam.target} />

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
}: {
  planBbox: [number, number, number, number];
  target: [number, number, number];
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
      maxDistance={MAX_DISTANCE}
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
