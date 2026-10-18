import { Environment, Lightformer } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { roomLight } from './starLight.ts';
import { floorTexture, plasterTexture } from './textures.ts';

const WALL_HEIGHT = 3000;
const FLOOR_DEPTH = 6000;

/** Plaster wall, oak floor, skirting, and the light: a soft window from the left plus a warm key. */
export function Room({ x0, x1, focusX0, focusX1 }: { x0: number; x1: number; focusX0: number; focusX1: number }) {
  const width = x1 - x0;
  const cx = (x0 + x1) / 2;
  // The shadow frustum covers the furniture, not the whole wall, to keep shadows crisp.
  const keyX = (focusX0 + focusX1) / 2;
  const span = (focusX1 - focusX0) / 2 + 900;
  const mats = useMemo(() => {
    const plaster = plasterTexture();
    plaster.repeat.set(width / 1100, WALL_HEIGHT / 1100);
    const floor = floorTexture();
    floor.repeat.set(width / 1440, FLOOR_DEPTH / 1440);
    return {
      wall: new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.96, color: '#ffffff' }),
      floor: new THREE.MeshStandardMaterial({ map: floor, roughness: 0.55, color: '#ffffff', envMapIntensity: 0.7 }),
      skirting: new THREE.MeshStandardMaterial({ color: '#f3f0ea', roughness: 0.7 }),
    };
  }, [width]);
  // The five-star switch dims the whole room.
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  useFrame(({ scene }) => {
    const k = roomLight();
    if (hemi.current) hemi.current.intensity = 0.7 * k;
    if (key.current) key.current.intensity = 1.9 * k;
    scene.environmentIntensity = 0.85 * k;
  });

  return (
    <group>
      <mesh position={[cx, WALL_HEIGHT / 2, 0]} material={mats.wall} receiveShadow>
        <planeGeometry args={[width, WALL_HEIGHT]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, FLOOR_DEPTH / 2]} material={mats.floor} receiveShadow>
        <planeGeometry args={[width, FLOOR_DEPTH]} />
      </mesh>
      <mesh position={[cx, 35, 6]} material={mats.skirting}>
        <boxGeometry args={[width, 70, 12]} />
      </mesh>

      <hemisphereLight ref={hemi} args={['#fbfaf7', '#d9cdbb', 0.7]} />
      {/* Warm key from the upper left, like late-morning sun through a window. */}
      <directionalLight
        ref={key}
        position={[keyX - 4200, 3600, 3200]}
        intensity={1.9}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0002}
        shadow-normalBias={1.5}
        shadow-radius={6}
        shadow-camera-near={100}
        shadow-camera-far={12000}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={3000}
        shadow-camera-bottom={-1500}
      >
        <object3D attach="target" position={[keyX, 1100, 0]} />
      </directionalLight>
      <Environment resolution={256} frames={1} environmentIntensity={0.85}>
        {/* Window on the left: the main soft source. */}
        <Lightformer form="rect" intensity={4} color="#fff8ee" position={[-5000, 1700, 2600]} rotation-y={Math.PI / 2} scale={[3800, 2400, 1]} />
        {/* Room bounce from the right and behind the viewer. */}
        <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[5000, 1600, 2600]} rotation-y={-Math.PI / 2} scale={[3600, 2200, 1]} />
        <Lightformer form="rect" intensity={1.3} color="#fbf6ee" position={[0, 1500, 6000]} rotation-y={Math.PI} scale={[9000, 3000, 1]} />
        {/* Ceiling and a warm floor bounce, so shelf undersides aren't muddy. */}
        <Lightformer form="rect" intensity={0.9} color="#f6efe4" position={[0, 4500, 1500]} rotation-x={Math.PI / 2} scale={[9000, 5000, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#ece2d2" position={[0, -800, 1500]} rotation-x={-Math.PI / 2} scale={[9000, 5000, 1]} />
      </Environment>
    </group>
  );
}
