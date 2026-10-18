import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store.ts';

/**
 * How far the five-star switch has gone, 0 (room lit) to 1 (room dimmed, five-star books lit).
 * `uniform` is shared by every book material so one write reaches them all.
 */
export const starFx = { amount: 0, uniform: { value: 0 } };

/** How much of the room light is left with the switch on. */
export const DIMMED = 0.045;
export const roomLight = () => 1 - (1 - DIMMED) * starFx.amount;

/** Eases the switch in and out. Pulling a book out brings the room light back up to read by. */
export function StarLightDriver() {
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    const { starLight, focused } = useStore.getState();
    const target = starLight && !focused ? 1 : 0;
    const next = starFx.amount + (target - starFx.amount) * (1 - Math.exp(-5 * Math.min(delta, 0.1)));
    starFx.amount = Math.abs(next - target) < 1e-3 ? target : next;
    starFx.uniform.value = starFx.amount;
    if (starFx.amount !== target) invalidate();
  }, -1);
  return null;
}
