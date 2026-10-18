import { useKTX2 } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.ts';
import type { AtlasSheet } from '../types.ts';
import { placementPose } from './Books.tsx';
import { FullBook } from './FullBook.tsx';
import { LAYOUT, type Layout, type Placement } from './layout.ts';
import { starFx } from './starLight.ts';
import { softShadowTexture, travertineTexture } from './textures.ts';

/** Shared hover/click wiring for books that are individual meshes rather than instances. */
function useLooseBook(id: string) {
  const hovered = useStore((s) => s.hovered === id && !s.focused);
  const hidden = useStore((s) => s.focused?.id === id);
  const invalidate = useThree((s) => s.invalidate);
  const handlers = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const s = useStore.getState();
      if (!s.focused && s.hovered !== id) s.setHovered(id);
    },
    onPointerOut: () => {
      const s = useStore.getState();
      if (s.hovered === id) s.setHovered(null);
      invalidate();
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta <= 6 && !useStore.getState().focused) useStore.getState().focus(id);
    },
  };
  return { hovered, hidden, handlers };
}

/** Eases a 0..1 value towards a target inside the frame loop. */
function useEased(target: number, rate = 12): RefObject<number> {
  const v = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, dt) => {
    const next = v.current + (target - v.current) * (1 - Math.exp(-rate * Math.min(dt, 0.1)));
    if (Math.abs(next - v.current) > 1e-4) invalidate();
    v.current = next;
  });
  return v;
}

/** A face-out favourite in the bookcase, or a book being read lying on its table. Hover lifts it a little. */
function LooseBook({ placement, atlas }: { placement: Placement; atlas: THREE.Texture | null }) {
  const { hovered, hidden, handlers } = useLooseBook(placement.book.id);
  const pose = useMemo(() => placementPose(placement), [placement]);
  const lift = useEased(hovered ? 1 : 0);
  const group = useRef<THREE.Group>(null);
  const [glow, setGlow] = useState(0);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.copy(pose.position);
    if (placement.kind === 'reading') g.position.y += lift.current * 12;
    else {
      g.position.z += lift.current * 14;
      g.position.y += lift.current * 4;
    }
    // Five-star books stay lit when the switch dims the room.
    const star = placement.book.rating === 5 ? starFx.amount * 7 : 0;
    const ng = Math.round((lift.current + star) * 20) / 20;
    if (ng !== glow) setGlow(ng);
  });
  return (
    <group ref={group} quaternion={pose.quaternion} visible={!hidden} {...handlers}>
      <FullBook book={placement.book} atlas={atlas} glow={glow} />
    </group>
  );
}

const shadowTex = { current: null as THREE.Texture | null };

/** A low travertine table. */
function Table({ spec }: { spec: { x: number; z: number; width: number; depth: number; height: number } }) {
  const mats = useMemo(() => {
    const trav = travertineTexture();
    trav.repeat.set(spec.width / 930, 1);
    shadowTex.current ??= softShadowTexture();
    return {
      top: new THREE.MeshStandardMaterial({ map: trav, color: '#ffffff', roughness: 0.62 }),
      leg: new THREE.MeshStandardMaterial({ map: trav, color: '#f7f2ea', roughness: 0.7 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTex.current, color: '#000', transparent: true, opacity: 0.32, depthWrite: false }),
    };
  }, [spec.width]);
  const top = 36;
  const leg = 38;
  return (
    <group position={[spec.x, 0, spec.z]}>
      <mesh material={mats.top} position={[0, spec.height - top / 2, 0]}>
        <boxGeometry args={[spec.width, top, spec.depth]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.leg} position={[s * (spec.width / 2 - leg / 2 - 30), (spec.height - top) / 2, 0]}>
          <boxGeometry args={[leg, spec.height - top, spec.depth - 50]} />
        </mesh>
      ))}
      <mesh material={mats.shadow} rotation-x={-Math.PI / 2} position={[0, 0.8, 0]} scale={[spec.width + 260, spec.depth + 260, 1]}>
        <planeGeometry />
      </mesh>
    </group>
  );
}

/** Books drawn individually (face-out favourites, the books being read) and the two tables. */
export function Loose({ layout, atlas }: { layout: Layout; atlas: AtlasSheet[] }) {
  const textures = useKTX2(
    atlas.map((s) => s.url),
    '/basis/',
  ) as THREE.Texture[];
  const loose = layout.placements.filter((p) => p.kind === 'display' || p.kind === 'reading');
  return (
    <group>
      {loose.map((p) => (
        <LooseBook key={p.book.id} placement={p} atlas={textures[p.book.spineAtlas.sheet] ?? null} />
      ))}
      <Table spec={LAYOUT.table} />
      <Table spec={LAYOUT.readingTable} />
    </group>
  );
}
