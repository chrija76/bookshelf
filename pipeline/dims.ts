import { config } from './config.ts';
import { rng } from '../src/lib/random.ts';
import type { BindingClass, Dims } from '../src/types.ts';

export interface DimsConfig {
  PAGE_THICKNESS_MM: number;
  BOARD_MM: { hardcover: number; paperback: number; unknown: number };
  THICKNESS_MIN_MM: number;
  THICKNESS_MAX_MM: number;
  HEIGHT_MM: { hardcover: number; paperback: number; massMarket: number };
  HEIGHT_RANDOM_MM: readonly [number, number];
  DEPTH_MIN_MM: number;
  DEPTH_MAX_MM: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Map the free-text Goodreads binding to one of our classes. */
export function classifyBinding(binding: string | null): BindingClass {
  const b = (binding ?? '').toLowerCase();
  if (!b) return 'unknown';
  if (b.includes('mass market')) return 'massMarket';
  if (b.includes('kindle') || b.includes('ebook') || b.includes('e-book') || b.includes('audio')) return 'ebook';
  if (b.includes('hardcover') || b.includes('hardback') || b.includes('library binding') || b.includes('board book'))
    return 'hardcover';
  if (b.includes('paperback') || b.includes('softcover') || b.includes('trade')) return 'paperback';
  return 'unknown';
}

export function bookDims(
  bookId: string,
  pages: number,
  binding: BindingClass,
  coverAspect: number,
  cfg: DimsConfig = config,
): Dims {
  const board =
    binding === 'hardcover'
      ? cfg.BOARD_MM.hardcover
      : binding === 'paperback' || binding === 'massMarket'
        ? cfg.BOARD_MM.paperback
        : cfg.BOARD_MM.unknown;
  const t = clamp(pages * cfg.PAGE_THICKNESS_MM + board, cfg.THICKNESS_MIN_MM, cfg.THICKNESS_MAX_MM);

  let h: number;
  if (binding === 'hardcover') h = cfg.HEIGHT_MM.hardcover;
  else if (binding === 'paperback') h = cfg.HEIGHT_MM.paperback;
  else if (binding === 'massMarket') h = cfg.HEIGHT_MM.massMarket;
  else {
    const [lo, hi] = cfg.HEIGHT_RANDOM_MM;
    h = Math.round(lo + rng(`height:${bookId}`)() * (hi - lo));
  }

  const w = clamp(h * coverAspect, cfg.DEPTH_MIN_MM, cfg.DEPTH_MAX_MM);
  return { h: round1(h), w: round1(w), t: round1(t) };
}
