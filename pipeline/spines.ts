import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { hashString, rng } from '../src/lib/random.ts';
import type { BindingClass, Dims, Palette } from '../src/types.ts';
import { font, registerFonts, type FaceKey } from './fonts.ts';
import { hexToRgb } from './palette.ts';

export interface SpineInput {
  id: string;
  title: string;
  author: string;
  dims: Dims;
  palette: Palette;
  binding: BindingClass;
  /** Category name + subjects, used for the typeface heuristic. */
  genreHint: string;
}

/** Drop series markers and subtitles: "Dune (Dune, #1)" -> "Dune", "Sapiens: A Brief History" -> "Sapiens". */
export function spineTitle(title: string): string {
  let t = title.replace(/\s*\([^)]*#\s*[\d.]+[^)]*\)\s*$/, '').trim();
  const colon = t.indexOf(':');
  if (colon > 3) t = t.slice(0, colon).trim();
  return t;
}

const SERIF_HINT = /fiction|novel|literat|history|histor|biograph|memoir|poetry|philosoph|classic|essay|religio|art|culture|mytholog/i;
const SANS_HINT = /business|startup|tech|software|science|math|econom|finance|invest|venture|engineer|product|design|data|psycholog|management|leader|productiv|health/i;

export function chooseFace(input: Pick<SpineInput, 'id' | 'title' | 'genreHint'>): FaceKey {
  const title = spineTitle(input.title);
  if (title.length > 30) return 'condensed';
  const hint = input.genreHint;
  const serif = SERIF_HINT.test(hint);
  const sans = SANS_HINT.test(hint);
  if (sans && !serif) return 'sans';
  if (serif && !sans) return hashString(input.id) % 3 === 0 ? 'caslon' : 'serif';
  return hashString(input.id) % 2 === 0 ? 'serif' : 'sans';
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1).trimEnd();
  return t + '…';
}

const surname = (author: string) => author.trim().split(/\s+/).pop() ?? author;

/** Paper / cloth texture: fine per-pixel noise plus a faint weave on hardcovers. */
function texture(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, seed: string, cloth: boolean) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const r = rng(`noise:${seed}`);
  for (let py = 0; py < h; py++) {
    const rowWeave = cloth ? (py % 3 === 0 ? -5 : 0) : 0;
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const colWeave = cloth ? (px % 3 === 0 ? -4 : 0) : 0;
      const n = (r() - 0.5) * 14 + rowWeave + colWeave;
      d[i] = Math.max(0, Math.min(255, d[i]! + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
    }
  }
  ctx.putImageData(img, x, y);
}

/**
 * Draw one spine into `ctx` at (x, y), size w×h pixels (w = thickness, h = height).
 * Text runs top-to-bottom, the convention for English and most German books.
 */
export function drawSpine(ctx: SKRSContext2D, input: SpineInput, x: number, y: number, w: number, h: number): void {
  registerFonts();
  const { palette } = input;
  const face = chooseFace(input);
  const upper = face === 'sans' || face === 'condensed';
  const cloth = input.binding === 'hardcover';

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Base colour with a soft vertical gradient: light catches the rounded spine at the centre.
  const [r, g, b] = hexToRgb(palette.dominant);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, `rgb(${r * 0.86},${g * 0.86},${b * 0.86})`);
  grad.addColorStop(0.45, `rgb(${Math.min(255, r * 1.04)},${Math.min(255, g * 1.04)},${Math.min(255, b * 1.04)})`);
  grad.addColorStop(1, `rgb(${r * 0.82},${g * 0.82},${b * 0.82})`);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  texture(ctx, x, y, w, h, input.id, cloth);

  // Publisher-style bands: a thin accent rule near the top and bottom.
  const band = Math.max(2, Math.round(h * 0.006));
  const bandInset = Math.round(h * 0.045);
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x, y + bandInset, w, band);
  ctx.fillRect(x, y + h - bandInset - band, w, band);
  if (cloth) {
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y + bandInset + band * 2.5, w, Math.max(1, band / 2));
    ctx.fillRect(x, y + h - bandInset - band * 3, w, Math.max(1, band / 2));
  }
  ctx.globalAlpha = 1;

  // Rotate so that our local x axis runs down the spine.
  ctx.translate(x + w, y);
  ctx.rotate(Math.PI / 2);
  const L = h; // length along the spine
  const T = w; // thickness across
  const start = bandInset + band * 4;
  const end = L - bandInset - band * 4;
  const avail = end - start;
  const gap = T * 0.5;

  const titleText = upper ? spineTitle(input.title).toUpperCase() : spineTitle(input.title);
  const titleWeight = face === 'sans' ? 500 : face === 'condensed' ? 600 : face === 'caslon' ? 700 : 600;
  const authorFace: FaceKey = face === 'condensed' ? 'condensed' : face === 'caslon' ? 'caslon' : face === 'serif' ? 'serif' : 'sans';
  const minPx = Math.max(10, Math.min(T * 0.28, 22));
  let size = Math.min(T * 0.5, 64);

  // Author first: it gets a fixed, smaller size and sits at the bottom end.
  let authorText = upper ? input.author.toUpperCase() : input.author;
  let authorSize = Math.max(minPx * 0.85, Math.min(size * 0.62, 34));
  ctx.font = font(authorFace, 400, authorSize);
  if (upper) ctx.letterSpacing = `${authorSize * 0.08}px`;
  let authorW = ctx.measureText(authorText).width;
  if (authorW > avail * 0.34) {
    authorText = upper ? surname(input.author).toUpperCase() : surname(input.author);
    authorW = ctx.measureText(authorText).width;
  }
  if (authorW > avail * 0.34) {
    authorSize *= (avail * 0.34) / authorW;
    ctx.font = font(authorFace, 400, authorSize);
    authorW = ctx.measureText(authorText).width;
  }
  const titleMax = avail - authorW - gap;

  // Title: shrink to fit, then truncate gracefully.
  ctx.letterSpacing = upper ? `${size * 0.06}px` : '0px';
  ctx.font = font(face, titleWeight, size);
  while (ctx.measureText(titleText).width > titleMax && size > minPx) {
    size -= 1;
    ctx.font = font(face, titleWeight, size);
    if (upper) ctx.letterSpacing = `${size * 0.06}px`;
  }
  const title = fitText(ctx, titleText, titleMax);

  ctx.fillStyle = palette.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, start, T / 2 + size * 0.04);

  ctx.font = font(authorFace, 400, authorSize);
  ctx.letterSpacing = upper ? `${authorSize * 0.08}px` : '0px';
  ctx.globalAlpha = 0.82;
  ctx.textAlign = 'right';
  ctx.fillText(authorText, end, T / 2 + authorSize * 0.04);
  ctx.restore();
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

/** Render a single spine to PNG, for debugging and tests. */
export function renderSpinePng(input: SpineInput, pxPerMm: number): Buffer {
  const w = Math.round(input.dims.t * pxPerMm);
  const h = Math.round(input.dims.h * pxPerMm);
  const c = createCanvas(w, h);
  drawSpine(c.getContext('2d'), input, 0, 0, w, h);
  return c.toBuffer('image/png');
}
