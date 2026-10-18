import { create } from 'zustand';
import type { Library } from './types.ts';
import type { SortKey, View } from './scene/layout.ts';

export type FocusPhase = 'out' | 'open';

interface AppState {
  library: Library | null;
  setLibrary: (l: Library) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  view: View;
  setView: (v: View) => void;
  /** Camera dolly target along the wall, in mm. */
  targetX: number;
  setTargetX: (x: number) => void;
  /** Height the camera looks at; null means the framing default for the layout. */
  targetY: number | null;
  setTargetY: (y: number | null) => void;
  /** Distance of the camera from the wall, in mm. */
  distance: number;
  setDistance: (d: number) => void;
  /** The five-star switch: room light down, spots on the five-star books. */
  starLight: boolean;
  toggleStarLight: () => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  /** The book pulled out of the shelf, if any. `closing` while it flies back to its slot. */
  focused: { id: string; phase: FocusPhase; closing: boolean } | null;
  focus: (id: string) => void;
  open: () => void;
  close: () => void;
  /** Called by the focus animation once the book is back in its slot. */
  settle: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  library: null,
  setLibrary: (library) => set({ library }),
  sort: 'dateRead',
  setSort: (sort) => set({ sort }),
  view: new URLSearchParams(location.search).get('view') === 'covers' ? 'covers' : 'spines',
  setView: (view) => set({ view, focused: null, hovered: null, targetX: 0, targetY: null }),
  targetX: 0,
  setTargetX: (targetX) => set({ targetX }),
  targetY: null,
  setTargetY: (targetY) => set({ targetY }),
  distance: 3000,
  setDistance: (distance) => set({ distance }),
  starLight: false,
  toggleStarLight: () => set({ starLight: !get().starLight }),
  hovered: null,
  setHovered: (hovered) => set({ hovered }),
  focused: null,
  focus: (id) => set({ focused: { id, phase: 'out', closing: false }, hovered: null }),
  open: () => {
    const f = get().focused;
    if (f && !f.closing) set({ focused: { ...f, phase: f.phase === 'open' ? 'out' : 'open' } });
  },
  close: () => {
    const f = get().focused;
    if (f && !f.closing) set({ focused: { ...f, phase: 'out', closing: true } });
  },
  settle: () => set({ focused: null }),
}));
