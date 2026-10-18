import { useFrame } from '@react-three/fiber';
import { DepthOfField, EffectComposer, SSAO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
import { useRef } from 'react';
import { focusFx } from './FocusBook.tsx';

/**
 * Restrained post: subtle SSAO for contact darkening, a gentle vignette, and depth of field that
 * only comes in while a book is pulled out.
 */
export function Effects() {
  const dof = useRef<DepthOfFieldEffect>(null);
  useFrame(() => {
    const d = dof.current;
    if (!d) return;
    d.bokehScale = 5 * focusFx.amount;
    d.target = focusFx.amount > 0.001 ? focusFx.position : null;
  });
  return (
    <EffectComposer multisampling={4} enableNormalPass>
      <SSAO
        samples={16}
        rings={5}
        radius={0.06}
        intensity={14}
        luminanceInfluence={0.55}
        bias={0.02}
        worldDistanceThreshold={2000}
        worldDistanceFalloff={600}
        worldProximityThreshold={20}
        worldProximityFalloff={12}
        color="#2a2016"
      />
      <DepthOfField ref={dof} focusRange={260} bokehScale={0} resolutionScale={0.5} />
      <Vignette offset={0.32} darkness={0.42} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}
