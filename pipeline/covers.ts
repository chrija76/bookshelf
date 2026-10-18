import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { cachedFetch, PUBLIC_DIR, stepCache } from './cache.ts';
import { config } from './config.ts';
import { font, registerFonts } from './fonts.ts';
import { fallbackPalette } from './palette.ts';

export type CoverSource = 'goodreads' | 'amazon' | 'openlibrary' | 'googlebooks' | 'override' | 'generated';

export interface CoverResult {
  source: CoverSource;
  /** Public URL path, e.g. /covers/123.webp */
  url: string;
  placeholderUrl: string;
  /** Absolute path of the written webp, for palette extraction. */
  file: string;
  aspect: number;
}

export const COVERS_DIR = path.join(PUBLIC_DIR, 'covers');

/** Goodreads serves thumbnails like 123._SY75_.jpg; dropping the suffix returns the original. */
export function stripGoodreadsSize(url: string): string {
  return url.replace(/\._[A-Z0-9,_]+_(?=\.\w+$)/, '');
}

async function realImage(url: string): Promise<Buffer | null> {
  // Goodreads answers an unknown book with its logo (gr-assets.com/assets/…) as the page image.
  if (/nophoto|no-cover|nocover|gr-assets\.com\/assets\//i.test(url)) return null;
  const r = await cachedFetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', Accept: 'image/*' },
  });
  if (r.status !== 200 || r.body.length < config.COVER_MIN_BYTES) return null;
  try {
    const meta = await sharp(r.body).metadata();
    if (!meta.width || !meta.height || meta.width < 40 || meta.height < 40) return null;
    // Covers are portrait; a wide image is a site banner or logo, not a book.
    if (meta.width > meta.height * 1.15) return null;
    return r.body;
  } catch {
    return null;
  }
}

function wrapLines(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Last-resort cover: title and author set on a curated colour. */
export function typographicCover(bookId: string, title: string, author: string): Buffer {
  registerFonts();
  const W = 400;
  const H = 600;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const pal = fallbackPalette(bookId);
  ctx.fillStyle = pal.dominant;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = pal.text;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.text;
  ctx.textAlign = 'center';
  ctx.font = font('serif', 600, 40);
  const lines = wrapLines(ctx, title, W - 100).slice(0, 5);
  let y = 200 - (lines.length - 1) * 22;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += 48;
  }
  ctx.font = font('sans', 400, 20);
  ctx.fillText(author.toUpperCase(), W / 2, H - 80);
  return c.toBuffer('image/png');
}

const cache = stepCache<Omit<CoverResult, 'file'> & { inputs: string }>('covers', 2);

export async function resolveCover(opts: {
  bookId: string;
  title: string;
  author: string;
  isbn10: string | null;
  isbn13: string | null;
  goodreadsCover: string | null;
  googleCover: string | null;
  override: string | null;
}): Promise<CoverResult> {
  const out = path.join(COVERS_DIR, `${opts.bookId}.webp`);
  const ph = path.join(COVERS_DIR, `${opts.bookId}-ph.webp`);
  // Re-resolve when the candidate list changes, e.g. Goodreads was blocked last run but answered now.
  const inputs = [opts.override, opts.goodreadsCover, opts.isbn10, opts.isbn13, opts.googleCover].join('|');
  const hit = await cache.get(opts.bookId);
  if (hit && hit.inputs === inputs && existsSync(out)) {
    const { inputs: _inputs, ...rest } = hit;
    return { ...rest, file: out };
  }

  const candidates: [CoverSource, string | null][] = [
    ['override', opts.override],
    ['goodreads', opts.goodreadsCover ? stripGoodreadsSize(opts.goodreadsCover) : null],
    ['amazon', opts.isbn10 ? `https://images-na.ssl-images-amazon.com/images/P/${opts.isbn10}.01.LZZZZZZZ.jpg` : null],
    ...([opts.isbn13, opts.isbn10]
      .filter((i): i is string => !!i)
      .map((i) => ['openlibrary', `https://covers.openlibrary.org/b/isbn/${i}-L.jpg?default=false`]) as [
      CoverSource,
      string,
    ][]),
    ['googlebooks', opts.googleCover],
  ];

  let source: CoverSource = 'generated';
  let buf: Buffer | null = null;
  for (const [src, url] of candidates) {
    if (!url) continue;
    buf = await realImage(url);
    if (buf) {
      source = src;
      break;
    }
  }
  if (!buf) buf = typographicCover(opts.bookId, opts.title, opts.author);

  await mkdir(COVERS_DIR, { recursive: true });
  const img = sharp(buf).rotate().flatten({ background: '#ffffff' });
  const info = await img
    .resize({ height: config.COVER_MAX_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(out);
  const placeholder = await sharp(buf).resize({ height: 64 }).blur(2.5).webp({ quality: 40 }).toBuffer();
  await writeFile(ph, placeholder);

  const result = {
    source,
    url: `/covers/${opts.bookId}.webp`,
    placeholderUrl: `/covers/${opts.bookId}-ph.webp`,
    aspect: Math.round((info.width / info.height) * 1000) / 1000,
  };
  await cache.set(opts.bookId, { ...result, inputs });
  return { ...result, file: out };
}
