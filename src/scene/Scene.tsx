import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.ts';
import type { Library } from '../types.ts';
import { Bookcase } from './Bookcase.tsx';
import { Books } from './Books.tsx';
import { CameraRig, EYE_HEIGHT, FOV } from './CameraRig.tsx';
import { Effects } from './Effects.tsx';
import { FocusBook } from './FocusBook.tsx';
import { caseWidth, LAYOUT, type Layout, type Placement } from './layout.ts';
import { Loose } from './Loose.tsx';
import { Room } from './Room.tsx';
import { StarLightDriver } from './starLight.ts';

export function Scene({ library, layout, onReady }: { library: Library; layout: Layout; onReady: () => void }) {
  const setHovered = useStore((s) => s.setHovered);
  const right = caseWidth(layout.bookcase);
  const left = LAYOUT.readingTable.x - LAYOUT.readingTable.width / 2;

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ fov: FOV, near: 60, far: 30000, position: [0, EYE_HEIGHT, 3500] }}
      gl={{ antialias: false, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.05 }}
      onPointerMissed={() => setHovered(null)}
      onCreated={({ gl }) => gl.setClearColor('#eeeae3')}
    >
      <Room x0={left - 4000} x1={right + 4000} focusX0={left} focusX1={right} />
      <Suspense fallback={null}>
        <Bookcase layout={layout} />
        <Books atlas={library.atlas} coverAtlas={library.coverAtlas} placements={layout.placements} bookcase={layout.bookcase} />
        <Loose layout={layout} atlas={library.atlas} />
        <FocusBook layout={layout} atlas={library.atlas} categories={library.categories} />
        <Ready onReady={onReady} />
      </Suspense>
      <StarLightDriver />
      <CameraRig layout={layout} />
      <DevProbe layout={layout} />
      <Effects />
    </Canvas>
  );
}

/** Dev-only hook for the screenshot script: where a book is on screen, in CSS pixels. */
function DevProbe({ layout }: { layout: Layout }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __bookPos?: (id: string) => { x: number; y: number } | null;
      __centreBook?: () => string | null;
      __lookAt?: (id: string) => void;
      __stars?: () => void;
      __frame?: (x: number, y: number, d: number) => void;
      __project?: (x: number, y: number, z: number) => { x: number; y: number };
    };
    w.__project = (x, y, z) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    w.__frame = (x, y, d) => {
      const st = useStore.getState();
      st.setTargetX(x);
      st.setTargetY(y);
      st.setDistance(d);
    };
    w.__stars = () => {
      useStore.getState().toggleStarLight();
      invalidate();
    };
    // The centre of the visible face: the spine for shelved and stacked books, the cover for face-out and reading ones.
    const screen = (p: Placement) => {
      const { t, w } = p.book.dims;
      const faceOut = p.kind === 'face' || p.kind === 'display' || p.kind === 'reading';
      const v = new THREE.Vector3(faceOut ? t / 2 : 0, 0, faceOut ? 0 : w / 2)
        .applyEuler(new THREE.Euler(...p.rotation))
        .add(new THREE.Vector3(...p.position))
        .project(camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    };
    w.__bookPos = (id) => {
      const p = layout.placements.find((pl) => pl.book.id === id);
      return p ? screen(p) : null;
    };
    // Move the camera so a book is in the middle of the screen.
    w.__lookAt = (id) => {
      const p = layout.placements.find((pl) => pl.book.id === id);
      if (!p) return;
      const st = useStore.getState();
      st.setDistance(2300);
      st.setTargetX(p.position[0]);
      st.setTargetY(p.position[1]);
    };
    // The upright book nearest the middle of the screen.
    w.__centreBook = () => {
      let best: { id: string; d: number } | null = null;
      for (const p of layout.placements) {
        if (p.kind !== 'shelf' && p.kind !== 'face') continue;
        const s = screen(p);
        const d = Math.hypot(s.x - size.width / 2, s.y - size.height / 2);
        if (!best || d < best.d) best = { id: p.book.id, d };
      }
      return best?.id ?? null;
    };
  }, [camera, size, layout, invalidate]);
  return null;
}

/** Rendered once everything inside the Suspense boundary has loaded. */
function Ready({ onReady }: { onReady: () => void }) {
  useMemo(() => queueMicrotask(onReady), [onReady]);
  return null;
}
