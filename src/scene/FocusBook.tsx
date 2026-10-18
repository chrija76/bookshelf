import { useKTX2 } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.ts';
import type { AtlasSheet, Category } from '../types.ts';
import { placementPose } from './Books.tsx';
import { FullBook } from './FullBook.tsx';
import type { Layout, Placement } from './layout.ts';
import { fontsReady, infoPage, titlePage } from './pageTextures.ts';

/** Shared with the post-processing: how far a book is pulled out (0..1) and where it is. */
export const focusFx = { amount: 0, position: new THREE.Vector3() };

const FOCUS_DISTANCE = 2300;
const HOLD = 880; // mm in front of the camera
/** The dimming plane in front of the case. */
const DIM_Z = 720;
const OPEN_ANGLE = THREE.MathUtils.degToRad(-160);
const FACE_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Closed, the book turns a little so its spine and thickness show; open, it faces square on. */
const SPINE_TURN = 0.34;

/** Critically-damped-ish spring; interruptible because it carries velocity. */
function spring(s: { x: number; v: number }, target: number, dt: number, k = 150, c = 24) {
  const a = k * (target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Where a book starts from and returns to. */
function homePose(p: Placement) {
  return placementPose(p);
}

function catName(categories: Category[], slug: string | null) {
  return slug ? (categories.find((c) => c.slug === slug)?.name ?? null) : null;
}

export function FocusBook({ layout, atlas, categories }: { layout: Layout; atlas: AtlasSheet[]; categories: Category[] }) {
  const focused = useStore((s) => s.focused);
  const placement = useMemo(
    () => (focused ? layout.placements.find((p) => p.book.id === focused.id) : undefined),
    [focused, layout],
  );
  const textures = useKTX2(
    atlas.map((s) => s.url),
    '/basis/',
  ) as THREE.Texture[];
  return placement ? (
    <Focused
      key={placement.book.id}
      placement={placement}
      front={layout.bookcase.depth}
      atlas={textures[placement.book.spineAtlas.sheet] ?? null}
      categories={categories}
    />
  ) : null;
}

function Focused({
  placement,
  front,
  atlas,
  categories,
}: {
  placement: Placement;
  /** Front face of the bookcase (z). The book must clear it before it turns or rises. */
  front: number;
  atlas: THREE.Texture | null;
  categories: Category[];
}) {
  const book = placement.book;
  const group = useRef<THREE.Group>(null);
  const cover = useRef<THREE.Group>(null);
  const dim = useRef<THREE.MeshBasicMaterial>(null);
  const { camera, invalidate } = useThree();
  const state = useRef({ p: { x: 0, v: 0 }, o: { x: 0, v: 0 } });
  const home = useMemo(() => homePose(placement), [placement]);
  const [pages, setPages] = useState<{ left: THREE.Texture; right: THREE.Texture } | null>(null);

  // Inside pages, drawn once the fonts are ready.
  useEffect(() => {
    let alive = true;
    let made: { left: THREE.Texture; right: THREE.Texture } | null = null;
    void fontsReady().then(() => {
      if (!alive) return;
      const pw = book.dims.w - 6;
      const ph = book.dims.h - 6;
      made = {
        left: titlePage(book, pw, ph),
        right: infoPage(book, catName(categories, book.category) ?? '', catName(categories, book.secondaryCategory), pw, ph),
      };
      setPages(made);
      invalidate();
    });
    return () => {
      alive = false;
      made?.left.dispose();
      made?.right.dispose();
    };
  }, [book, categories, invalidate]);

  // Bring the camera to a fixed reading distance (in or out); put it back when the book goes home.
  // Fixed, so the book held in front of the camera is always well clear of the shelves.
  useEffect(() => {
    const s = useStore.getState();
    const prev = { x: s.targetX, y: s.targetY, d: s.distance };
    s.setTargetX(home.position.x);
    s.setTargetY(home.position.y);
    s.setDistance(FOCUS_DISTANCE);
    const unsub = useStore.subscribe((now, before) => {
      if (now.focused?.closing && !before.focused?.closing) {
        now.setTargetX(prev.x);
        now.setTargetY(prev.y);
        now.setDistance(prev.d);
      }
    });
    return unsub;
  }, [home]);

  // Where the book has fully left its shelf: its back edge in front of the case.
  const exit = useMemo(() => {
    const k = placement.kind;
    const faceOut = k === 'face' || k === 'display';
    const onCase = k === 'shelf' || k === 'stack' || faceOut;
    const reach = faceOut ? book.dims.h * 0.25 + book.dims.t : book.dims.w / 2;
    return {
      z: onCase ? Math.max(home.position.z, front + reach + 40) : home.position.z + book.dims.w + 40,
      lift: k === 'face' ? 36 : k === 'display' ? 8 : 0,
    };
  }, [placement, home, front, book]);

  const tmp = useMemo(
    () => ({
      dir: new THREE.Vector3(),
      right: new THREE.Vector3(),
      target: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      turn: new THREE.Quaternion(),
      out: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    const f = useStore.getState().focused;
    const st = state.current;
    const opening = f?.phase === 'open' && !f.closing;
    spring(st.p, f && !f.closing ? 1 : 0, dt);
    spring(st.o, opening ? 1 : 0, dt, 120, 21);
    const p = THREE.MathUtils.clamp(st.p.x, 0, 1.05);
    const o = THREE.MathUtils.clamp(st.o.x, -0.02, 1.02);

    // Target: held in front of the camera, front cover towards it; shifted right when open so the spread is centred.
    camera.getWorldDirection(tmp.dir);
    tmp.right.crossVectors(tmp.dir, camera.up).normalize();
    tmp.target
      .copy(camera.position)
      .addScaledVector(tmp.dir, HOLD - o * 60)
      .addScaledVector(tmp.right, (book.dims.w / 2) * o);
    // Never hold it inside the case or behind the dimming plane, whatever the camera is doing.
    tmp.target.z = Math.max(tmp.target.z, DIM_Z + book.dims.w / 2 + 60);
    tmp.turn.setFromAxisAngle(Y_AXIS, SPINE_TURN * (1 - THREE.MathUtils.clamp(o, 0, 1)));
    tmp.q.copy(camera.quaternion).multiply(tmp.turn).multiply(FACE_CAMERA);

    // Straight out of the shelf first, clear of the case, and only then up and round to face the viewer.
    // Face-out books lift over the shelf lip before they come forward.
    const pull = smooth(0, 0.3, p);
    tmp.out.copy(home.position);
    tmp.out.y += exit.lift * smooth(0, 0.4, pull);
    tmp.out.z = THREE.MathUtils.lerp(home.position.z, exit.z, smooth(0.25, 1, pull));
    g.position.lerpVectors(tmp.out, tmp.target, smooth(0.3, 1, p));
    g.quaternion.slerpQuaternions(home.quaternion, tmp.q, smooth(0.32, 0.9, p));
    if (cover.current) cover.current.rotation.y = OPEN_ANGLE * o;
    if (dim.current) dim.current.opacity = 0.16 * THREE.MathUtils.clamp(p, 0, 1);

    focusFx.amount = THREE.MathUtils.clamp(p, 0, 1);
    focusFx.position.copy(g.position);

    if (f?.closing && p < 0.004 && Math.abs(st.p.v) < 0.05) {
      focusFx.amount = 0;
      useStore.getState().settle();
    }
    invalidate();
  });

  const onBook = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useStore.getState().open();
  };
  const onOutside = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta < 6) useStore.getState().close();
  };

  return (
    <>
      {/* Dims the shelf behind the book and catches "click outside to close". */}
      <mesh position={[home.position.x, 1300, DIM_Z]} onClick={onOutside} renderOrder={5}>
        <planeGeometry args={[20000, 8000]} />
        <meshBasicMaterial ref={dim} color="#1d1813" transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={group} onClick={onBook} position={home.position} quaternion={home.quaternion}>
        <FullBook ref={cover} book={book} atlas={atlas} pages={pages} />
      </group>
    </>
  );
}
