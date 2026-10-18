import { Vibrant } from 'node-vibrant/node';
import sharp from 'sharp';
import { stepCache } from './cache.ts';
import type { Palette } from '../src/types.ts';
import { rng } from '../src/lib/random.ts';

/** Curated, muted palette for typographic covers and as a fallback. */
export const CURATED = [
  '#2f3e46', '#7a2e2e', '#c9b79c', '#3d5a40', '#1f3a5f', '#b5651d', '#5b4b6b',
  '#e6dccb', '#8c7b5b', '#264653', '#a23b2a', '#d9c5a0', '#4a4e69', '#6b705c',
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Pick a readable type colour: the accent if it contrasts enough, else warm ivory or near-black. */
export function textColourFor(bg: string, accent: string): string {
  if (contrast(bg, accent) >= 4.5) return accent;
  const ivory = '#f3ece0';
  const ink = '#1d1b19';
  return contrast(bg, ivory) >= contrast(bg, ink) ? ivory : ink;
}

export function fallbackPalette(seed: string): Palette {
  const r = rng(`palette:${seed}`);
  const dominant = CURATED[Math.floor(r() * CURATED.length)]!;
  let accent = CURATED[Math.floor(r() * CURATED.length)]!;
  if (accent === dominant) accent = luminance(dominant) > 0.4 ? '#1d1b19' : '#f3ece0';
  return { dominant, accent, text: textColourFor(dominant, accent) };
}

const cache = stepCache<Palette>('palette', 2);

/**
 * The cover's background colour: the most common colour bucket, with the outer band counted
 * double (that's where the background shows). Unlike Vibrant, this keeps black and white.
 */
async function backgroundColour(png: Buffer): Promise<string> {
  const W = 48;
  const H = 72;
  const { data } = await sharp(png).removeAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const edge = x < W * 0.12 || x >= W * 0.88 || y < H * 0.08 || y >= H * 0.92;
      const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      const w = edge ? 2 : 1;
      e.n += w;
      e.r += r * w;
      e.g += g * w;
      e.b += b * w;
      buckets.set(k, e);
    }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0]!;
  return rgbToHex([top.r / top.n, top.g / top.n, top.b / top.n]);
}

export async function extractPalette(bookId: string, imagePath: string): Promise<Palette> {
  const hit = await cache.get(bookId);
  if (hit) return hit;
  let palette: Palette;
  try {
    // node-vibrant can't read WebP, which is what the covers are stored as.
    const png = await sharp(imagePath).png().toBuffer();
    const p = await Vibrant.from(png).quality(3).getPalette();
    const dominant = await backgroundColour(png);
    // Accent: the most saturated swatch that differs visibly from the dominant one.
    const accentSwatch =
      [p.Vibrant, p.LightVibrant, p.DarkVibrant, p.LightMuted, p.DarkMuted, p.Muted].find(
        (s) => s && s.hex !== dominant && contrast(s.hex, dominant) > 1.6,
      ) ?? null;
    const accent = accentSwatch?.hex ?? (luminance(dominant) > 0.4 ? '#1d1b19' : '#f3ece0');
    palette = { dominant, accent, text: textColourFor(dominant, accent) };
  } catch {
    palette = fallbackPalette(bookId);
  }
  await cache.set(bookId, palette);
  return palette;
}
