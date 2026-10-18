import { forwardRef, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { Book } from '../types.ts';
import { boardMm } from './Books.tsx';
import { paperEdgeTexture } from './textures.ts';

// ── Covers: loaded lazily, cached, placeholder colour until ready ──────────────────────
const coverCache = new Map<string, Promise<THREE.Texture>>();
const loader = new THREE.TextureLoader();

export function useCover(url: string | null): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let p = coverCache.get(url);
    if (!p) {
      p = loader.loadAsync(url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      });
      coverCache.set(url, p);
    }
    p.then((t) => alive && setTex(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

const paperEdges = new Map<number, THREE.Texture>();
const plane = new THREE.PlaneGeometry(1, 1);

/** A plane gently bowed along its width: the page rises out of the gutter, then flattens. */
function bentPlane(lift: number, gutter: 'left' | 'right'): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 24, 1);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 0.5;
    const u = gutter === 'left' ? x : 1 - x; // distance from the gutter, 0..1
    pos.setZ(i, Math.sin(Math.min(u * 1.25, 1) * Math.PI * 0.5) * lift * (1 - u * 0.35));
  }
  g.computeVertexNormals();
  return g;
}

export interface FullBookProps {
  book: Book;
  atlas: THREE.Texture | null;
  /** Inside pages; only needed when the book can be opened. */
  pages?: { left: THREE.Texture; right: THREE.Texture } | null;
  glow?: number;
}

/**
 * A book built from parts, for when it's close to the camera: boards, page block, spine, and a
 * front cover hinged at the spine (the forwarded ref) so it can swing open. Local frame as the
 * instanced books: x = thickness with the front cover on +x, y = height, z = depth, spine on +z.
 */
export const FullBook = forwardRef<THREE.Group, FullBookProps>(function FullBook({ book, atlas, pages, glow = 0 }, coverRef) {
  const { t, h, w } = book.dims;
  const b = Math.max(0.9, boardMm(book));
  const hard = book.binding === 'hardcover';
  const sq = hard ? 2.4 : 0.3; // boards overhang the pages ("squares") on hardcovers
  const blockT = Math.max(0.6, t - 2 * b);
  const cover = useCover(book.coverUrl);

  const mats = useMemo(() => {
    const mm = Math.round(blockT);
    let edge = paperEdges.get(mm);
    if (!edge) paperEdges.set(mm, (edge = paperEdgeTexture(mm)));
    const boardCol = new THREE.Color(book.palette.dominant);
    let spine: THREE.Texture | null = null;
    if (atlas) {
      // Address this book's region of the atlas; v runs from the top in the atlas.
      const [u0, v0, du, dv] = book.spineAtlas.uv;
      spine = atlas.clone();
      spine.offset.set(u0, v0 + dv);
      spine.repeat.set(du, -dv);
      spine.needsUpdate = true;
    }
    return {
      board: new THREE.MeshStandardMaterial({ color: boardCol, roughness: 0.7 }),
      paper: new THREE.MeshStandardMaterial({ map: edge, color: '#ffffff', roughness: 0.9 }),
      spine: new THREE.MeshStandardMaterial({ map: spine, color: spine ? '#ffffff' : boardCol, roughness: 0.66 }),
      cover: new THREE.MeshStandardMaterial({ color: boardCol, roughness: 0.62 }),
      left: new THREE.MeshStandardMaterial({ color: '#f4eee2', roughness: 0.92 }),
      right: new THREE.MeshStandardMaterial({ color: '#f4eee2', roughness: 0.92 }),
    };
  }, [book, atlas, blockT]);

  useEffect(() => {
    mats.cover.map = cover;
    mats.cover.color.set(cover ? '#ffffff' : book.palette.dominant);
    mats.cover.needsUpdate = true;
  }, [cover, mats, book.palette.dominant]);
  useEffect(() => {
    mats.left.map = pages?.left ?? null;
    mats.right.map = pages?.right ?? null;
    mats.left.needsUpdate = mats.right.needsUpdate = true;
  }, [pages, mats]);
  useEffect(() => {
    for (const m of [mats.board, mats.spine, mats.cover]) {
      m.emissive.set(m === mats.cover && cover ? '#ffffff' : book.palette.dominant);
      m.emissiveIntensity = 0.1 * glow;
      if (m.map) m.emissiveMap = m.map;
    }
  }, [glow, mats, cover, book.palette.dominant]);

  // In page-plane space the right page's gutter is at -x and the left page's at +x.
  // The right page bows less than the board is thick, so it stays hidden while the cover is shut.
  const rightGeo = useMemo(() => bentPlane(Math.min(1.2, b - 0.25), 'left'), [b]);
  const leftGeo = useMemo(() => bentPlane(1.6, 'right'), []);

  const hingeX = t / 2 - b / 2;
  const hingeZ = w / 2 - 0.5;
  return (
    <group>
      {/* Back board */}
      <mesh material={mats.board} position={[-t / 2 + b / 2, 0, 0]}>
        <boxGeometry args={[b, h, w]} />
      </mesh>
      {/* Page block, inset from the boards on hardcovers */}
      <mesh material={mats.paper} position={[0, 0, -sq / 2 - 0.5]}>
        <boxGeometry args={[blockT, h - sq * 2, w - sq - 1]} />
      </mesh>
      {/* First right-hand page: my notes */}
      {pages && (
        <mesh
          geometry={rightGeo}
          material={mats.right}
          position={[blockT / 2 + 0.15, 0, -sq / 2 - 0.5]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[w - sq - 3, h - sq * 2 - 2, 1]}
        />
      )}
      {/* Spine */}
      <mesh geometry={plane} material={mats.spine} position={[0, 0, w / 2 + 0.2]} scale={[t, h, 1]} />
      {/* Front cover, hinged at the spine edge */}
      <group ref={coverRef} position={[hingeX, 0, hingeZ]}>
        <group position={[0, 0, -hingeZ]}>
          <mesh material={mats.board}>
            <boxGeometry args={[b, h, w]} />
          </mesh>
          <mesh
            geometry={plane}
            material={mats.cover}
            position={[b / 2 + 0.12, 0, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[w, h, 1]}
          />
          {/* Title page, glued to the inside of the cover as it swings over */}
          {pages && (
            <mesh
              geometry={leftGeo}
              material={mats.left}
              position={[-b / 2 - 0.15, 0, -sq / 2 - 0.5]}
              rotation={[0, -Math.PI / 2, 0]}
              scale={[w - sq - 3, h - sq * 2 - 2, 1]}
            />
          )}
        </group>
      </group>
    </group>
  );
});
