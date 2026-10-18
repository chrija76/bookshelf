import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.ts';
import { caseHeight, caseWidth, LAYOUT, type Layout } from './layout.ts';

export const EYE_HEIGHT = 1250;
/** Where the camera looks at the wall when it's back far enough to see the whole case. Set per layout. */
let lookHeight = 1100;
/** Over the tables the camera drops its gaze to the table tops. */
const TABLE_LOOK = 760;
export const MIN_DISTANCE = 1100;
export const MAX_DISTANCE = 6000;
export const DEFAULT_DISTANCE = 3500;
export const FOV = 35;

/** How much the camera is "at the tables", 0..1, from its x position. */
function tableWeight(x: number): number {
  const T = LAYOUT.table;
  const d = (x - (T.x + T.width / 2)) / 900;
  return THREE.MathUtils.clamp(1 - d, 0, 1) ** 2 * (3 - 2 * THREE.MathUtils.clamp(1 - d, 0, 1));
}

/** How much the camera is "at the reading table", 0..1, from its x position. */
function readingWeight(x: number): number {
  const R = LAYOUT.readingTable;
  const t = THREE.MathUtils.clamp(1 - (Math.abs(x - R.x) - R.width / 2) / 600, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Camera position and look-at point for a dolly position x and wall distance d. */
export function cameraPose(x: number, d: number, y: number, out: { eye: THREE.Vector3; look: THREE.Vector3 }) {
  // Only drop the gaze to the table when the camera has come in close to it.
  const tw = tableWeight(x) * THREE.MathUtils.clamp((3000 - d) / 700, 0, 1);
  const look = THREE.MathUtils.lerp(y, TABLE_LOOK, tw);
  // At the reading table the camera looks down onto the books lying there, so their covers read.
  const R = LAYOUT.readingTable;
  const rw = readingWeight(x) * THREE.MathUtils.clamp((3000 - d) / 700, 0, 1);
  // The eye sits a little above what it looks at, as a standing person's would.
  out.eye.set(x, look + 150 + (d - DEFAULT_DISTANCE) * 0.04 - tw * 120 + rw * 800, d);
  out.look.set(x, THREE.MathUtils.lerp(look, R.height + 60, rw), rw * R.z);
  return out;
}

/**
 * Dolly along the wall and up and down the case. Wheel / trackpad / drag / arrow and page keys move a target;
 * the camera eases towards it. The pointer nudges the eye a little for parallax.
 * Input is ignored while a book is pulled out.
 */
/** The opening view: the want-to-read table and as much of the case as fits, the case's full height in frame. */
export function homeView(layout: Layout, aspect: number): { x: number; d: number; look: number } {
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const H = caseHeight(layout.bookcase);
  const left = LAYOUT.table.x - LAYOUT.table.width / 2 - 250;
  const right = caseWidth(layout.bookcase) + 250;
  const look = H / 2 + 40;
  const dHeight = (H / 2 + 260) / tan;
  const dWidth = (right - left) / 2 / (tan * aspect);
  const d = THREE.MathUtils.clamp(Math.min(Math.max(dHeight, dWidth), dHeight * 1.25), MIN_DISTANCE, MAX_DISTANCE);
  const halfW = d * tan * aspect;
  const x = right - left <= halfW * 2 ? (left + right) / 2 : left + halfW;
  return { x, d, look };
}

export function CameraRig({ layout }: { layout: Layout }) {
  const { minX, maxX } = layout;
  // From the middle of the bottom compartments to the middle of the top ones.
  const yRange = useMemo<[number, number]>(() => {
    const c = layout.bookcase;
    return [c.plinth + c.panel + c.compH / 2, caseHeight(c) - c.panel - c.compH / 2];
  }, [layout]);
  const homeD = useRef(DEFAULT_DISTANCE);
  const { camera, gl, invalidate } = useThree();
  const pointer = useRef(new THREE.Vector2());
  const current = useRef<{ x: number; d: number; y: number; px: number; py: number } | null>(null);
  const pose = useRef({ eye: new THREE.Vector3(), look: new THREE.Vector3() });

  useEffect(() => {
    const el = gl.domElement;
    const clampX = (x: number) => Math.min(maxX, Math.max(minX, x));
    const clampD = (d: number) => Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
    const locked = () => useStore.getState().focused !== null;
    const clampY = (y: number) => Math.min(yRange[1], Math.max(yRange[0], y));

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (locked()) return;
      const s = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        // Pinch on a trackpad arrives as ctrl+wheel. Zoom towards the point under the cursor.
        zoomAt(e.clientX, e.clientY, clampD(s.distance * Math.exp(e.deltaY * 0.01)));
      } else {
        const k = s.distance / 1400;
        // Line-mode wheels (Firefox with a mouse) report lines, not pixels.
        const unit = e.deltaMode === 1 ? 40 : 1;
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
        const dy = e.shiftKey ? 0 : e.deltaY * unit;
        // Vertical scrolling moves up and down the case once it's taller than the view;
        // from further back the whole case is in frame, so it moves along the wall instead.
        const canScrollY = s.distance < homeD.current * 0.9;
        if (canScrollY) {
          s.setTargetX(clampX(s.targetX + dx * k));
          s.setTargetY(clampY((s.targetY ?? lookHeight) - dy * k));
        } else {
          s.setTargetX(clampX(s.targetX + (Math.abs(dx) > Math.abs(dy) ? dx : dy) * k));
        }
      }
      invalidate();
    };

    /** Change the distance keeping the point of the wall under the cursor where it is on screen. */
    const zoomAt = (clientX: number, clientY: number, d: number) => {
      const s = useStore.getState();
      const rect = el.getBoundingClientRect();
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const halfH = s.distance * tan;
      const k = 1 - d / s.distance;
      const y0 = s.targetY ?? lookHeight;
      s.setTargetX(clampX(s.targetX + nx * halfH * (rect.width / rect.height) * k));
      if (d >= homeD.current * 0.95) s.setTargetY(null);
      else s.setTargetY(clampY(y0 + ny * halfH * k));
      s.setDistance(d);
    };
    const onDouble = (e: MouseEvent) => {
      if (locked()) return;
      const s = useStore.getState();
      zoomAt(e.clientX, e.clientY, clampD(Math.min(s.distance * 0.55, 2000)));
      invalidate();
    };

    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const s = useStore.getState();
      drag = locked() ? null : { x: e.clientX, y: e.clientY, tx: s.targetX, ty: s.targetY ?? lookHeight };
    };
    const onMove = (e: PointerEvent) => {
      pointer.current.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      if (drag && e.buttons === 1) {
        const s = useStore.getState();
        const mmPerPx = (2 * s.distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / window.innerHeight;
        s.setTargetX(clampX(drag.tx - (e.clientX - drag.x) * mmPerPx));
        // Vertical drag only once the camera is close enough that the case doesn't fit.
        if (s.distance < homeD.current * 0.9) s.setTargetY(clampY(drag.ty + (e.clientY - drag.y) * mmPerPx));
      }
      invalidate();
    };
    const onUp = () => {
      drag = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || locked()) return;
      const s = useStore.getState();
      if (e.key === 'ArrowRight') s.setTargetX(clampX(s.targetX + 460));
      else if (e.key === 'ArrowLeft') s.setTargetX(clampX(s.targetX - 460));
      else if (e.key === 'PageUp') s.setTargetY(clampY((s.targetY ?? lookHeight) + 340));
      else if (e.key === 'PageDown') s.setTargetY(clampY((s.targetY ?? lookHeight) - 340));
      else if (e.key === 'ArrowUp' || e.key === '+') s.setDistance(clampD(s.distance * 0.85));
      else if (e.key === 'ArrowDown' || e.key === '-') s.setDistance(clampD(s.distance / 0.85));
      else return;
      e.preventDefault();
      invalidate();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('dblclick', onDouble);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('dblclick', onDouble);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, invalidate, minX, maxX, yRange]);

  // Frame the room for this layout on first load and after switching views; otherwise keep the target in range.
  useEffect(() => {
    const s = useStore.getState();
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1.6;
    const home = homeView(layout, aspect);
    lookHeight = home.look;
    homeD.current = home.d;
    if (s.targetX === 0) {
      s.setTargetX(home.x);
      s.setDistance(home.d);
      current.current = null;
    } else {
      s.setTargetX(Math.min(maxX, Math.max(minX, s.targetX)));
    }
    invalidate();
  }, [camera, layout, minX, maxX, invalidate]);

  // Subscriptions don't re-render; a change of target just needs a frame.
  useEffect(() => useStore.subscribe(() => invalidate()), [invalidate]);

  useFrame((_, dt) => {
    const s = useStore.getState();
    const ty = s.targetY === null ? lookHeight : Math.min(yRange[1], Math.max(yRange[0], s.targetY));
    const c = (current.current ??= { x: s.targetX, d: s.distance, y: ty, px: 0, py: 0 });
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    const kp = 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    c.x += (s.targetX - c.x) * k;
    c.d += (s.distance - c.d) * k;
    c.y += (ty - c.y) * k;
    const still = s.focused ? 0.25 : 1;
    const px = pointer.current.x * 45 * still;
    const py = -pointer.current.y * 30 * still;
    c.px += (px - c.px) * kp;
    c.py += (py - c.py) * kp;
    const { eye, look } = cameraPose(c.x, c.d, c.y, pose.current);
    camera.position.set(eye.x + c.px, eye.y + c.py, eye.z);
    camera.lookAt(look);
    const moving =
      Math.abs(s.targetX - c.x) > 0.3 || Math.abs(s.distance - c.d) > 0.3 || Math.abs(ty - c.y) > 0.3 || Math.abs(px - c.px) > 0.2 || Math.abs(py - c.py) > 0.2;
    if (moving) invalidate();
  });

  return null;
}
