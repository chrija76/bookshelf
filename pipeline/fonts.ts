import path from 'node:path';
import { GlobalFonts } from '@napi-rs/canvas';
import { ROOT } from './cache.ts';

/** Spine typefaces. The same files are self-hosted for the site via @fontsource. */
export const FACES = {
  serif: { family: 'BS Garamond', pkg: 'eb-garamond', weights: [500, 600] },
  caslon: { family: 'BS Caslon', pkg: 'libre-caslon-text', weights: [400, 700] },
  sans: { family: 'BS Jost', pkg: 'jost', weights: [400, 500] },
  condensed: { family: 'BS Barlow Condensed', pkg: 'barlow-condensed', weights: [500, 600] },
} as const;

export type FaceKey = keyof typeof FACES;

let registered = false;
export function registerFonts(): void {
  if (registered) return;
  for (const face of Object.values(FACES)) {
    for (const w of face.weights) {
      const file = path.join(ROOT, 'node_modules/@fontsource', face.pkg, 'files', `${face.pkg}-latin-${w}-normal.woff2`);
      GlobalFonts.registerFromPath(file, face.family);
      const ext = path.join(ROOT, 'node_modules/@fontsource', face.pkg, 'files', `${face.pkg}-latin-ext-${w}-normal.woff2`);
      GlobalFonts.registerFromPath(ext, face.family);
    }
  }
  registered = true;
}

export const font = (face: FaceKey, weight: number, px: number) => `${weight} ${px}px "${FACES[face].family}"`;
