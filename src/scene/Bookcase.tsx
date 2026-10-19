import { Text } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { rng } from '../lib/random.ts';
import { useStore } from '../store.ts';
import { caseHeight, caseWidth, compX, compY, LABEL, labelWidth, type CaseSpec, type Decor, type Layout } from './layout.ts';
import { starFx } from './starLight.ts';
import { compartmentAOTexture, lightWashTexture, walnutTextures } from './textures.ts';

/** Physical size of one walnut texture tile, mm: long along the grain. */
const TILE_LEN = 2000;
const TILE_WID = 500;

/**
 * A box whose UVs are in millimetres with the grain running along `grain` on every long face,
 * offset per board so neighbouring panels don't repeat the same figure.
 */
function woodBox(w: number, h: number, d: number, grain: 0 | 1 | 2, seed: string): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position!;
  const nrm = g.attributes.normal!;
  const uv = g.attributes.uv!;
  const r = rng(seed);
  const offU = r() * TILE_LEN;
  const offV = r() * TILE_WID;
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    const n = [Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i))];
    const normalAxis = n.indexOf(Math.max(...n));
    const plane = [0, 1, 2].filter((a) => a !== normalAxis);
    const along = plane.includes(grain) ? grain : plane[0]!;
    const across = plane.find((a) => a !== along)!;
    uv.setXY(i, (p[along]! + offU) / TILE_LEN, (p[across]! + offV) / TILE_WID);
  }
  uv.needsUpdate = true;
  return g;
}

export function useCaseMaterials() {
  return useMemo(() => {
    const walnut = (seed: string, tint: string) => {
      const { map, bump } = walnutTextures(seed);
      return new THREE.MeshPhysicalMaterial({
        map,
        bumpMap: bump,
        bumpScale: 0.35,
        color: tint,
        roughness: 0.56,
        clearcoat: 0.08,
        clearcoatRoughness: 0.5,
        envMapIntensity: 0.7,
      });
    };
    return {
      walnut: [walnut('walnut-a', '#ffffff'), walnut('walnut-b', '#f4eeea')],
      // The back panel is a single book-matched veneer, a shade darker.
      back: walnut('walnut-back', '#d9cdc6'),
      ao: new THREE.MeshBasicMaterial({ map: compartmentAOTexture(), color: '#000', transparent: true, opacity: 0.55, depthWrite: false }),
      aluminium: new THREE.MeshStandardMaterial({ color: '#c9cbcc', roughness: 0.32, metalness: 0.85 }),
      brass: new THREE.MeshStandardMaterial({ color: '#c3a064', roughness: 0.3, metalness: 1 }),
      labelCard: new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.85 }),
      ceramic: new THREE.MeshStandardMaterial({ color: '#efebe4', roughness: 0.72 }),
      stoneware: new THREE.MeshStandardMaterial({ color: '#b9ab98', roughness: 0.85 }),
      leaf: new THREE.MeshStandardMaterial({ color: '#7f9073', roughness: 0.7, side: THREE.DoubleSide }),
      stem: new THREE.MeshStandardMaterial({ color: '#6a5a44', roughness: 0.8 }),
      travertine: new THREE.MeshStandardMaterial({ color: '#e3d7c3', roughness: 0.8 }),
    };
  }, []);
}
type Mats = ReturnType<typeof useCaseMaterials>;

interface Panel {
  key: string;
  size: [number, number, number];
  position: [number, number, number];
  grain: 0 | 1 | 2;
}

/** Every board of the case: sides, dividers, top, bottom, shelves, plinth, lips. */
function panels(c: CaseSpec): Panel[] {
  const W = caseWidth(c);
  const H = caseHeight(c);
  const out: Panel[] = [];
  const t = c.panel;
  const front = c.depth / 2;
  // Sides and dividers run the full height above the plinth; grain vertical.
  for (let i = 0; i <= c.cols; i++) {
    const x = c.x0 + t / 2 + i * (c.compW + t);
    const outer = i === 0 || i === c.cols;
    out.push({ key: `v${i}`, size: [t, outer ? H : H - c.plinth - t * 2, c.depth], position: [x, outer ? H / 2 : c.plinth + t + (H - c.plinth - t * 2) / 2, front], grain: 1 });
  }
  // Top and bottom span between the sides.
  out.push({ key: 'top', size: [W - t * 2, t, c.depth], position: [c.x0 + W / 2, H - t / 2, front], grain: 0 });
  out.push({ key: 'bottom', size: [W - t * 2, t, c.depth], position: [c.x0 + W / 2, c.plinth + t / 2, front], grain: 0 });
  // Recessed plinth.
  out.push({ key: 'plinth', size: [W - t * 2, c.plinth, t], position: [c.x0 + W / 2, c.plinth / 2, c.depth - 30], grain: 0 });
  // Fixed shelves between the dividers.
  for (let col = 0; col < c.cols; col++)
    for (let row = 0; row < c.rows - 1; row++) {
      const y = compY(c, row) - t / 2;
      out.push({ key: `s${col}-${row}`, size: [c.compW, t, c.depth - 4], position: [compX(c, col) + c.compW / 2, y, front - 2], grain: 0 });
    }
  if (c.lip)
    for (let col = 0; col < c.cols; col++)
      for (let row = 0; row < c.rows; row++) {
        out.push({ key: `l${col}-${row}`, size: [c.compW, 26, 12], position: [compX(c, col) + c.compW / 2, compY(c, row) + 13, c.depth - 6], grain: 0 });
      }
  return out;
}

function Case({ spec, mats }: { spec: CaseSpec; mats: Mats }) {
  const list = useMemo(() => panels(spec), [spec]);
  const geos = useMemo(() => list.map((p, i) => woodBox(...p.size, p.grain, `${p.key}:${i}`)), [list]);
  const W = caseWidth(spec);
  const H = caseHeight(spec);
  const backGeo = useMemo(() => woodBox(W - spec.panel * 2, H - spec.plinth - spec.panel * 2, 10, 1, 'back'), [W, H, spec]);
  return (
    <group>
      {list.map((p, i) => (
        <mesh key={p.key} geometry={geos[i]} material={mats.walnut[i % 2]} position={p.position} castShadow receiveShadow />
      ))}
      <mesh
        geometry={backGeo}
        material={mats.back}
        position={[spec.x0 + W / 2, spec.plinth + spec.panel + (H - spec.plinth - spec.panel * 2) / 2, 5]}
        receiveShadow
      />
      {/* Baked occlusion on the back panel of every compartment. */}
      {Array.from({ length: spec.cols * spec.rows }, (_, i) => {
        const col = i % spec.cols;
        const row = Math.floor(i / spec.cols);
        return (
          <mesh
            key={i}
            material={mats.ao}
            position={[compX(spec, col) + spec.compW / 2, compY(spec, row) + spec.compH / 2, 10.5]}
            scale={[spec.compW, spec.compH, 1]}
          >
            <planeGeometry />
          </mesh>
        );
      })}
    </group>
  );
}

/** A clip-on brass label holder on the shelf's front edge, hanging a little below it. */
function BrassLabel({ text, position, mats }: { text: string; position: [number, number, number]; mats: Mats }) {
  const width = labelWidth(text);
  const h = LABEL.height;
  return (
    <group position={position}>
      <mesh material={mats.brass} position={[width / 2, -h / 2 - 1, 0.6]}>
        <boxGeometry args={[width, h, 1.2]} />
      </mesh>
      {/* Card behind a slightly raised rim. */}
      <mesh material={mats.labelCard} position={[width / 2, -h / 2 - 1, 1.25]}>
        <planeGeometry args={[width - 6, h - 6]} />
      </mesh>
      <Text
        font="/fonts/inter-tight-500.woff"
        fontSize={LABEL.fontSize}
        letterSpacing={LABEL.letterSpacing}
        color="#2f2416"
        anchorX="center"
        anchorY="middle"
        position={[width / 2, -h / 2 - 0.6, 1.4]}
      >
        {text.toUpperCase()}
      </Text>
    </group>
  );
}

const vaseProfile = [
  [0, 0], [34, 0], [40, 6], [44, 40], [42, 90], [30, 130], [18, 150], [16, 172], [19, 180], [15, 180],
].map(([x, y]) => new THREE.Vector2(x, y));
const bowlProfile = [[0, 0], [38, 0], [62, 12], [84, 38], [88, 52], [84, 52], [80, 40], [58, 16], [0, 8]].map(
  ([x, y]) => new THREE.Vector2(x, y),
);
const potProfile = [[0, 0], [44, 0], [50, 96], [46, 96], [44, 10], [0, 10]].map(([x, y]) => new THREE.Vector2(x, y));
const vaseGeo = new THREE.LatheGeometry(vaseProfile, 48);
const bowlGeo = new THREE.LatheGeometry(bowlProfile, 48);
const potGeo = new THREE.LatheGeometry(potProfile, 40);
const leafGeo = new THREE.SphereGeometry(1, 12, 8);

/** A branch of small leaves, seeded. */
function Branch({ seed, mats, height }: { seed: number; mats: Mats; height: number }) {
  const parts = useMemo(() => {
    const r = rng(`branch:${seed}`);
    const stems: { curve: THREE.CatmullRomCurve3; leaves: { p: THREE.Vector3; rot: THREE.Euler; s: number }[] }[] = [];
    for (let s = 0; s < 3; s++) {
      const lean = (r() - 0.5) * 0.9;
      const turn = r() * Math.PI * 2;
      const pts = [0, 0.35, 0.7, 1].map(
        (k) =>
          new THREE.Vector3(
            Math.sin(lean) * height * k * k * Math.cos(turn),
            height * (0.55 + 0.45 * k) * (0.8 + s * 0.12),
            Math.sin(lean) * height * k * k * Math.sin(turn) * 0.5,
          ),
      );
      pts[0]!.set(0, 60, 0);
      const curve = new THREE.CatmullRomCurve3(pts);
      const leaves = Array.from({ length: 9 }, (_, i) => {
        const k = 0.25 + (i / 9) * 0.75;
        const p = curve.getPoint(k);
        const side = i % 2 ? 1 : -1;
        return {
          p: p.add(new THREE.Vector3(side * 9, 0, (r() - 0.5) * 8)),
          rot: new THREE.Euler((r() - 0.5) * 0.6, r() * Math.PI, side * (0.7 + r() * 0.4)),
          s: 0.8 + r() * 0.5,
        };
      });
      stems.push({ curve, leaves });
    }
    return stems;
  }, [seed, height]);
  return (
    <group>
      {parts.map((st, i) => (
        <group key={i}>
          <mesh material={mats.stem}>
            <tubeGeometry args={[st.curve, 24, 1.3, 5, false]} />
          </mesh>
          {st.leaves.map((l, j) => (
            <mesh key={j} geometry={leafGeo} material={mats.leaf} position={l.p} rotation={l.rot} scale={[14 * l.s, 1.2, 6.5 * l.s]} />
          ))}
        </group>
      ))}
    </group>
  );
}

function DecorItem({ item, mats }: { item: Decor; mats: Mats }) {
  const [x, y, z] = item.position;
  switch (item.kind) {
    case 'bookend':
      // Aluminium L: an upright plate, with the base running under the last books.
      return (
        <group position={[x, y, z]}>
          <mesh material={mats.aluminium} position={[1, 80, 0]}>
            <boxGeometry args={[2, 160, 120]} />
          </mesh>
          <mesh material={mats.aluminium} position={[-45, 0.6, 0]}>
            <boxGeometry args={[92, 1.2, 120]} />
          </mesh>
        </group>
      );
    case 'vase':
      return (
        <group position={[x, y, z]} rotation-y={item.rotationY}>
          <mesh geometry={vaseGeo} material={mats.ceramic} />
          <Branch seed={item.seed} mats={mats} height={230} />
        </group>
      );
    case 'plant':
      return (
        <group position={[x, y, z]} rotation-y={item.rotationY}>
          <mesh geometry={potGeo} material={mats.stoneware} />
          <Branch seed={item.seed + 1} mats={mats} height={170} />
        </group>
      );
    case 'bowl':
      return <mesh geometry={bowlGeo} material={mats.stoneware} position={[x, y, z]} />;
    case 'sphere':
      return (
        <group position={[x, y, z]}>
          <mesh material={mats.travertine} position={[0, 22, 0]}>
            <boxGeometry args={[86, 44, 86]} />
          </mesh>
          <mesh material={mats.brass} position={[0, 44 + 34, 0]}>
            <sphereGeometry args={[34, 48, 32]} />
          </mesh>
        </group>
      );
  }
}

const WARM = '#ffe2b8';

/**
 * A spotlight beam in slightly hazy air: an open cone from the spot to where the light lands.
 * Brightest where the cone is seen edge-on to its axis, fading towards its foot.
 */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(WARM) }, uOpacity: { value: 0 } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vAlong = 1.0 - uv.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
        // Fades in below the spot and out before its foot, so neither end shows an edge.
        float fall = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.45, 1.0, vAlong));
        gl_FragColor = vec4(uColor * facing * fall * uOpacity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Where a five-star spot hangs and what its beam lights: the top edge of the leaning cover. */
function spotFor(p: Layout['placements'][number], c: CaseSpec) {
  const row = Number(p.row!.split(':')[1]);
  const top = compY(c, row) + c.compH;
  const { h, t } = p.book.dims;
  const lean = -p.rotation[0];
  const [x, y, z] = p.position;
  // Front edge of the cover's head, which leans back from the book's centre.
  const headY = y + (h / 2) * Math.cos(lean) + (t / 2) * Math.sin(lean);
  const headZ = z - (h / 2) * Math.sin(lean) + (t / 2) * Math.cos(lean);
  // The spot sits a little in front of that edge, so it shines down onto the cover.
  const spot = new THREE.Vector3(x, top - 8, Math.min(c.depth - 30, headZ + 26));
  const target = new THREE.Vector3(x, headY - 6, headZ + 4);
  const axis = target.clone().sub(spot);
  const length = axis.length();
  const beam = {
    position: spot.clone().addScaledVector(axis, 0.5),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis.normalize()),
    length,
    radius: Math.min(p.book.dims.w * 0.4, 18 + length * 0.75),
  };
  return { top, spot, beam, headY };
}

/**
 * Display lighting for the covers view: a slim aluminium LED profile under the front of every
 * shelf with its wash on the back panel, and for each five-star book a small spot in the shelf
 * above. Its beam runs from the spot to the head of the cover, with a soft spill on the panel
 * behind. The light on the books themselves is in their shader.
 */
function ShelfLighting({ layout, mats }: { layout: Layout; mats: Mats }) {
  const c = layout.bookcase;
  const lm = useMemo(
    () => ({
      // Lit diffusers glow; switched off they are plain opal plastic in the room light.
      led: new THREE.MeshStandardMaterial({ color: '#e9e5de', emissive: '#fff6e8', roughness: 0.6 }),
      spotLed: new THREE.MeshStandardMaterial({ color: '#e9e5de', emissive: '#fff6e8', roughness: 0.6, emissiveIntensity: 0 }),
      wash: new THREE.MeshBasicMaterial({
        map: lightWashTexture('wash'),
        color: WARM,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      beam: beamMaterial(),
      spill: new THREE.MeshBasicMaterial({
        map: lightWashTexture('spill'),
        color: WARM,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      puck: new THREE.MeshStandardMaterial({ color: '#2b2824', roughness: 0.45, metalness: 0.6 }),
    }),
    [],
  );
  // The five-star switch: strips and their wash fade out, the spots and their beams fade in.
  useFrame(() => {
    const a = starFx.amount;
    lm.led.emissiveIntensity = 1 - a;
    lm.spotLed.emissiveIntensity = a;
    lm.wash.opacity = 0.2 * (1 - a);
    lm.beam.uniforms.uOpacity!.value = 0.38 * a;
    lm.spill.opacity = 0.3 * a;
    lm.wash.visible = a < 0.999;
    lm.beam.visible = lm.spill.visible = a > 0.001;
  });
  const stars = layout.placements.filter((p) => p.kind === 'face' && p.book.rating === 5 && p.row);
  return (
    <group>
      {Array.from({ length: c.cols * c.rows }, (_, i) => {
        const col = i % c.cols;
        const row = Math.floor(i / c.cols);
        const x = compX(c, col) + c.compW / 2;
        const top = compY(c, row) + c.compH;
        return (
          <group key={i}>
            {/* Profile and diffuser, recessed just behind the front edge of the shelf above. */}
            <mesh material={mats.aluminium} position={[x, top - 3, c.depth - 22]}>
              <boxGeometry args={[c.compW - 30, 6, 14]} />
            </mesh>
            <mesh material={lm.led} position={[x, top - 6.1, c.depth - 22]} rotation-x={Math.PI / 2}>
              <planeGeometry args={[c.compW - 36, 9]} />
            </mesh>
            <mesh material={lm.wash} position={[x, top - c.compH / 2, 11]} scale={[c.compW, c.compH, 1]}>
              <planeGeometry />
            </mesh>
          </group>
        );
      })}
      {stars.map((p) => {
        const { top, spot, beam, headY } = spotFor(p, c);
        const x = p.position[0];
        const w = p.book.dims.w;
        return (
          <group key={p.book.id}>
            <mesh material={lm.puck} position={[x, top - 4, spot.z]}>
              <cylinderGeometry args={[17, 17, 8, 32]} />
            </mesh>
            <mesh material={lm.spotLed} position={[x, top - 8.1, spot.z]} rotation-x={Math.PI / 2}>
              <circleGeometry args={[11, 32]} />
            </mesh>
            <mesh material={lm.beam} position={beam.position} quaternion={beam.quaternion}>
              <cylinderGeometry args={[9, beam.radius, beam.length, 40, 1, true]} />
            </mesh>
            {/* Light spilling past the book onto the back panel, centred on its head. */}
            <mesh material={lm.spill} position={[x, headY - 20, 11.5]} scale={[w * 1.5, (top - headY) * 2 + 160, 1]}>
              <planeGeometry />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * A wall switch left of the bookcase for the five-star lighting, with a brass plate to say so.
 * The rocker tips over and a small pilot light glows amber when it is on.
 */
function LightSwitch({ spec, mats }: { spec: CaseSpec; mats: Mats }) {
  const on = useStore((s) => s.starLight);
  const toggle = useStore((s) => s.toggleStarLight);
  const invalidate = useThree((s) => s.invalidate);
  const sm = useMemo(
    () => ({
      plate: new THREE.MeshStandardMaterial({ color: '#f3f0ea', roughness: 0.5, emissive: '#f3f0ea', emissiveIntensity: 0 }),
      pilotOff: new THREE.MeshStandardMaterial({ color: '#8a8278', roughness: 0.4 }),
      pilotOn: new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ffa53a', emissiveIntensity: 2.2 }),
    }),
    [],
  );
  // In the dimmed room the switch stays findable, as a pale plate with an amber pilot.
  useFrame(() => {
    sm.plate.emissiveIntensity = 0.16 * starFx.amount;
  });
  const label = 'Five stars';
  const lw = labelWidth(label);
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta > 6 || useStore.getState().focused) return;
      toggle();
      invalidate();
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
    },
  };
  return (
    <group position={[spec.x0 - 190, 1050, 0]} scale={1.5}>
      <group {...handlers}>
        <mesh material={sm.plate} position={[0, 0, 5]} castShadow>
          <boxGeometry args={[86, 86, 10]} />
        </mesh>
        <mesh material={sm.plate} position={[0, 0, 12]} rotation-x={on ? -0.14 : 0.14}>
          <boxGeometry args={[40, 58, 8]} />
        </mesh>
        <mesh material={on ? sm.pilotOn : sm.pilotOff} position={[0, on ? -20 : -18, 16.4]} rotation-x={on ? -0.14 : 0.14}>
          <circleGeometry args={[3.4, 20]} />
        </mesh>
      </group>
      <BrassLabel text={label} position={[-lw / 2, -60, 0.5]} mats={mats} />
    </group>
  );
}

export function Bookcase({ layout }: { layout: Layout }) {
  const mats = useCaseMaterials();
  return (
    <group>
      <Case spec={layout.bookcase} mats={mats} />
      {layout.view === 'covers' && <ShelfLighting layout={layout} mats={mats} />}
      <LightSwitch spec={layout.bookcase} mats={mats} />
      {layout.labels.map((l) => (
        <BrassLabel key={`${l.slug}:${l.position[0]}:${l.position[1]}`} text={l.text} position={l.position} mats={mats} />
      ))}
      {layout.decor.map((d, i) => (
        <DecorItem key={i} item={d} mats={mats} />
      ))}
    </group>
  );
}
