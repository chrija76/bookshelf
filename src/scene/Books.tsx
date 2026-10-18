import { useKTX2 } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useStore } from '../store.ts';
import type { AtlasSheet, Book } from '../types.ts';
import { createBookMaterial, type ShelfLight } from './bookMaterial.ts';
import { compY, type CaseSpec, type Placement } from './layout.ts';
import { starFx } from './starLight.ts';

const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.1);
const TILT = THREE.MathUtils.degToRad(8);
const INTRO_MS = 700;
/** How far the five-star switch pulls a spine out past its neighbours, mm. */
const STAR_PULL = 38;

export const boardMm = (b: Book) => (b.binding === 'hardcover' ? 2.6 : b.binding === 'paperback' || b.binding === 'massMarket' ? 0.5 : 1.2);
export const cornerRadius = (b: Book) => Math.min(b.binding === 'hardcover' ? 2.2 : 1.4, b.dims.t / 2 - 0.1);

/** World pose of a placement, without scale. */
export function placementPose(p: Placement): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  return {
    position: new THREE.Vector3(...p.position),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation, 'XYZ')),
  };
}

/** Per-instance animation state, eased every frame towards its targets. */
interface Anim {
  tilt: number;
  slide: number;
  lean: number;
  glow: number;
  intro: number;
  pull: number;
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));

function SheetBooks({
  texture,
  mode,
  placements,
  introDelay,
  shelfLight,
}: {
  texture: THREE.Texture;
  mode: 'spine' | 'cover';
  placements: Placement[];
  introDelay: (p: Placement) => number;
  shelfLight?: ShelfLight;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => createBookMaterial(texture, mode, shelfLight), [texture, mode, shelfLight]);
  const geo = useMemo(() => geometry.clone(), []);
  const invalidate = useThree((s) => s.invalidate);
  const start = useRef(performance.now());
  const composed = useRef<boolean[]>([]);
  const introDone = useRef(false);
  const anims = useMemo<Anim[]>(() => placements.map(() => ({ tilt: 0, slide: 0, lean: 0, glow: 0, intro: 0, pull: 0 })), [placements]);
  const poses = useMemo(() => placements.map(placementPose), [placements]);
  const highlight = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(placements.length), 1), [placements]);
  const index = useMemo(() => new Map(placements.map((p, i) => [p.book.id, i])), [placements]);

  useLayoutEffect(() => {
    const n = placements.length;
    const dims = new Float32Array(n * 3);
    const rect = new Float32Array(n * 4);
    const color = new Float32Array(n * 3);
    const radius = new Float32Array(n);
    const board = new Float32Array(n);
    const star = new Float32Array(n);
    placements.forEach((p, i) => {
      const b = p.book;
      dims.set([b.dims.t, b.dims.h, b.dims.w], i * 3);
      rect.set(mode === 'cover' ? b.coverAtlas.uv : b.spineAtlas.uv, i * 4);
      new THREE.Color(b.palette.dominant).toArray(color, i * 3);
      radius[i] = cornerRadius(b);
      board[i] = boardMm(b);
      star[i] = b.rating === 5 ? 1 : 0;
    });
    geo.setAttribute('aDims', new THREE.InstancedBufferAttribute(dims, 3));
    geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 1));
    geo.setAttribute('aBoardMm', new THREE.InstancedBufferAttribute(board, 1));
    geo.setAttribute('aStar', new THREE.InstancedBufferAttribute(star, 1));
    highlight.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHighlight', highlight);
    start.current = performance.now();
    composed.current = [];
    introDone.current = false;
    invalidate();
  }, [placements, geo, highlight, invalidate, mode]);

  const m = useMemo(
    () => ({
      mat: new THREE.Matrix4(),
      tmp: new THREE.Matrix4(),
      pos: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      pivot: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.1);
    const { hovered, focused } = useStore.getState();
    const now = performance.now() - start.current;
    const focusedP = focused ? placements[index.get(focused.id) ?? -1] : undefined;
    let moving = false;

    placements.forEach((p, i) => {
      const a = anims[i]!;
      const b = p.book;
      const isHover = hovered === b.id && !focused;
      // Neighbours lean a little into the gap left by a pulled-out book.
      let leanTarget = 0;
      if (focusedP && focusedP.row && focusedP.row === p.row && focusedP.book.id !== b.id) {
        const d = p.slot - focusedP.slot;
        if (Math.abs(d) === 1) leanTarget = Math.sign(d) * Math.asin(Math.min(focusedP.book.dims.t * 0.45, 18) / b.dims.h);
      }
      const introT = Math.min(1, Math.max(0, (now - introDelay(p)) / INTRO_MS));
      const targets = {
        tilt: isHover && p.kind === 'shelf' ? 1 : 0,
        slide: isHover && p.kind !== 'shelf' ? 1 : 0,
        lean: leanTarget,
        glow: isHover ? 1 : 0,
      };
      const before = a.tilt + a.slide + a.lean + a.glow + a.intro + a.pull;
      // The five-star switch pulls those spines a little proud of the shelf.
      a.pull = mode === 'spine' && b.rating === 5 && p.kind !== 'table' ? starFx.amount : 0;
      a.tilt = approach(a.tilt, targets.tilt, 14, dt);
      a.slide = approach(a.slide, targets.slide, 14, dt);
      a.lean = approach(a.lean, targets.lean, 9, dt);
      a.glow = approach(a.glow, targets.glow, 12, dt);
      a.intro = easeOut(introT);
      const changed = Math.abs(a.tilt + a.slide + a.lean + a.glow + a.intro + a.pull - before) > 1e-4;
      const settledTargets =
        Math.abs(a.tilt - targets.tilt) < 1e-3 && Math.abs(a.slide - targets.slide) < 1e-3 && Math.abs(a.lean - leanTarget) < 1e-4;
      if (!settledTargets || introT < 1) moving = true;
      const hidden = focused?.id === b.id;
      if (!changed && !hidden && composed.current[i]) return;

      const pose = poses[i]!;
      const { t, h, w } = b.dims;
      m.mat.compose(pose.position, pose.quaternion, m.scale.set(1, 1, 1));
      // Slide in from the front during the intro. On hover, stacked books slide out a little;
      // face-out books lift clear of the shelf lip first and only then come forward.
      const faceOut = p.kind === 'face';
      const forward = faceOut ? Math.max(0, (a.slide - 0.6) / 0.4) * 10 : a.slide * 22;
      m.tmp.makeTranslation(0, faceOut ? a.slide * 30 : 0, (1 - a.intro) * 160 + forward + a.pull * (p.kind === 'shelf' ? STAR_PULL : 24));
      m.mat.premultiply(m.tmp);
      if (a.tilt > 1e-4) {
        // Tilt out around the bottom edge at the spine, as if a finger hooked the top of the spine:
        // the back of the book lifts off the shelf, nothing sinks into it.
        m.pivot.set(0, -h / 2, w / 2);
        m.mat.multiply(m.tmp.makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z));
        m.mat.multiply(m.tmp.makeRotationX(TILT * a.tilt));
        m.mat.multiply(m.tmp.makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z));
      }
      if (Math.abs(a.lean) > 1e-5) {
        const side = a.lean > 0 ? -1 : 1;
        m.pivot.set((side * t) / 2, -h / 2, 0);
        m.mat.multiply(m.tmp.makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z));
        m.mat.multiply(m.tmp.makeRotationZ(a.lean));
        m.mat.multiply(m.tmp.makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z));
      }
      m.mat.multiply(m.tmp.makeScale(hidden ? 1e-4 : t, hidden ? 1e-4 : h, hidden ? 1e-4 : w));
      mesh.setMatrixAt(i, m.mat);
      highlight.setX(i, a.glow);
      composed.current[i] = !hidden;
      mesh.instanceMatrix.needsUpdate = true;
      highlight.needsUpdate = true;
    });
    // Raycasting uses a bounding sphere over all instances; refresh it once everything has landed.
    if (!introDone.current && now > INTRO_MS + Math.max(...placements.map(introDelay))) {
      introDone.current = true;
      mesh.computeBoundingSphere();
    }
    if (moving) invalidate();
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const p = e.instanceId !== undefined ? placements[e.instanceId] : undefined;
    const s = useStore.getState();
    if (p && !s.focused && s.hovered !== p.book.id) {
      s.setHovered(p.book.id);
      invalidate();
    }
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const p = e.instanceId !== undefined ? placements[e.instanceId] : undefined;
    const s = useStore.getState();
    if (p && s.hovered === p.book.id) s.setHovered(null);
    invalidate();
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // a drag, not a click
    const p = e.instanceId !== undefined ? placements[e.instanceId] : undefined;
    if (p && !useStore.getState().focused) useStore.getState().focus(p.book.id);
  };

  return (
    <instancedMesh
      ref={ref}
      args={[geo, material, placements.length]}
      frustumCulled={false}
      castShadow
      receiveShadow
      onPointerMove={onMove}
      onPointerOut={onOut}
      onClick={onClick}
    />
  );
}

function useSheets(sheets: AtlasSheet[]): THREE.Texture[] {
  const textures = useKTX2(
    sheets.map((s) => s.url),
    '/basis/',
  ) as THREE.Texture[];
  useMemo(() => {
    for (const t of textures) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
  }, [textures]);
  return textures;
}

/** Books lying or standing with the spine out, from the spine atlas. */
function SpineBooks({ atlas, placements, introDelay }: { atlas: AtlasSheet[]; placements: Placement[]; introDelay: (p: Placement) => number }) {
  const textures = useSheets(atlas);
  const bySheet = useMemo(() => atlas.map((_, i) => placements.filter((p) => p.book.spineAtlas.sheet === i)), [atlas, placements]);
  return (
    <>
      {bySheet.map((list, i) =>
        list.length ? (
          <SheetBooks key={`s${i}-${list.length}`} texture={textures[i]!} mode="spine" placements={list} introDelay={introDelay} />
        ) : null,
      )}
    </>
  );
}

/** Shelf lighting for a case: the strip under each shelf lights the compartment below it. */
export const shelfLightFor = (c: CaseSpec): ShelfLight => [compY(c, c.rows - 1), c.compH + c.panel, c.compH, 1];

/** Face-out books, from the cover atlas. Only loaded in the covers view; lit by the shelf lighting. */
function CoverBooks({
  atlas,
  placements,
  introDelay,
  bookcase,
}: {
  atlas: AtlasSheet[];
  placements: Placement[];
  introDelay: (p: Placement) => number;
  bookcase: CaseSpec;
}) {
  const textures = useSheets(atlas);
  const shelfLight = useMemo(() => shelfLightFor(bookcase), [bookcase]);
  const bySheet = useMemo(() => atlas.map((_, i) => placements.filter((p) => p.book.coverAtlas.sheet === i)), [atlas, placements]);
  return (
    <>
      {bySheet.map((list, i) =>
        list.length ? (
          <SheetBooks
            key={`c${i}-${list.length}`}
            texture={textures[i]!}
            mode="cover"
            placements={list}
            introDelay={introDelay}
            shelfLight={shelfLight}
          />
        ) : null,
      )}
    </>
  );
}

/** All books that are instanced boxes: upright, in stacks, and face-out in the covers view. */
export function Books({
  atlas,
  coverAtlas,
  placements,
  bookcase,
}: {
  atlas: AtlasSheet[];
  coverAtlas: AtlasSheet[];
  placements: Placement[];
  bookcase: CaseSpec;
}) {
  const spines = useMemo(() => placements.filter((p) => p.kind === 'shelf' || p.kind === 'stack' || p.kind === 'table'), [placements]);
  const faces = useMemo(() => placements.filter((p) => p.kind === 'face'), [placements]);
  // Books slide in compartment by compartment; the side table comes first.
  const introDelay = (p: Placement) => 250 + (p.bay + 1) * 70 + p.slot * 7;
  return (
    <group>
      <SpineBooks atlas={atlas} placements={spines} introDelay={introDelay} />
      {faces.length > 0 && <CoverBooks atlas={coverAtlas} placements={faces} introDelay={introDelay} bookcase={bookcase} />}
    </group>
  );
}
