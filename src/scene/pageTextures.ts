// Inside pages of an opened book, drawn on a canvas in a book-like serif.
import * as THREE from 'three';
import type { Book } from '../types.ts';

const SERIF = '"EB Garamond", Georgia, serif';
const SANS = '"Inter Tight", system-ui, sans-serif';
const INK = '#2c2620';
const MUTED = '#8b7f6e';
const PAPER = '#f4eee2';

export async function fontsReady(): Promise<void> {
  await Promise.all([
    document.fonts.load(`400 40px ${SERIF}`),
    document.fonts.load(`italic 400 40px ${SERIF}`),
    document.fonts.load(`500 40px ${SERIF}`),
    document.fonts.load(`500 20px ${SANS}`),
  ]);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function page(widthMm: number, heightMm: number): [HTMLCanvasElement, CanvasRenderingContext2D, number, number] {
  const W = 1024;
  const H = Math.round((W * heightMm) / widthMm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  // Faint gutter shadow near the spine side is added per page by the caller.
  return [c, ctx, W, H];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function gutter(ctx: CanvasRenderingContext2D, W: number, H: number, side: 'left' | 'right') {
  const g = side === 'right' ? ctx.createLinearGradient(W, 0, W - 90, 0) : ctx.createLinearGradient(0, 0, 90, 0);
  g.addColorStop(0, 'rgba(90,70,40,0.16)');
  g.addColorStop(1, 'rgba(90,70,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

/** Left page: a classic title page. The spine is on its right. */
export function titlePage(book: Book, widthMm: number, heightMm: number): THREE.CanvasTexture {
  const [c, ctx, W, H] = page(widthMm, heightMm);
  gutter(ctx, W, H, 'right');
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  const mainTitle = book.title.replace(/\s*\(.*?\)\s*$/, '');
  const [title, subtitle] = mainTitle.split(/:\s+/, 2);
  let size = 78;
  ctx.font = `500 ${size}px ${SERIF}`;
  let lines = wrap(ctx, title!, W * 0.72);
  while (lines.length > 4 && size > 44) {
    size -= 6;
    ctx.font = `500 ${size}px ${SERIF}`;
    lines = wrap(ctx, title!, W * 0.72);
  }
  let y = H * 0.27;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += size * 1.12;
  }
  if (subtitle) {
    ctx.font = `italic 400 34px ${SERIF}`;
    ctx.fillStyle = MUTED;
    y += 10;
    for (const l of wrap(ctx, subtitle, W * 0.66).slice(0, 3)) {
      ctx.fillText(l, W / 2, y);
      y += 42;
    }
  }
  ctx.strokeStyle = 'rgba(44,38,32,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 40, y + 30);
  ctx.lineTo(W / 2 + 40, y + 30);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `400 46px ${SERIF}`;
  ctx.fillText(book.author.toUpperCase().split('').join(' '), W / 2, y + 100);

  ctx.font = `400 36px ${SERIF}`;
  ctx.fillStyle = MUTED;
  const foot = [book.publisher, book.year ? String(book.year) : null].filter(Boolean).join(' · ');
  if (foot) ctx.fillText(foot, W / 2, H * 0.86);
  ctx.fillText(`${book.pagesEstimated ? 'about ' : ''}${book.pages} pages`, W / 2, H * 0.86 + 52);
  return texture(c);
}

/** Right page: my reading notes. The spine is on its left. */
export function infoPage(book: Book, category: string, secondary: string | null, widthMm: number, heightMm: number): THREE.CanvasTexture {
  const [c, ctx, W, H] = page(widthMm, heightMm);
  gutter(ctx, W, H, 'left');
  const left = W * 0.16;
  const right = W * 0.86;
  let y = H * 0.18;

  ctx.textAlign = 'left';
  const label = (t: string) => {
    ctx.fillStyle = MUTED;
    ctx.font = `500 27px ${SANS}`;
    ctx.fillText(t.toUpperCase().split('').join(' '), left, y);
    y += 66;
  };
  const body = (t: string, size = 56) => {
    ctx.fillStyle = INK;
    ctx.font = `400 ${size}px ${SERIF}`;
    for (const l of wrap(ctx, t, right - left)) {
      ctx.fillText(l, left, y);
      y += size * 1.3;
    }
    y += 46;
  };

  label('My rating');
  if (book.rating > 0) {
    ctx.font = `400 72px ${SERIF}`;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < book.rating ? INK : 'rgba(44,38,32,0.18)';
      ctx.fillText('★', left + i * 78, y + 14);
    }
    y += 120;
  } else body(book.shelf === 'read' ? 'Not rated' : '—');

  if (book.shelf === 'read') {
    label(book.dateRead ? 'Read' : 'Shelved');
    body(fmtDate(book.dateRead ?? book.dateAdded) ?? 'Some time ago');
  } else if (book.shelf === 'currently-reading') {
    label('Status');
    body('Reading it now');
  } else {
    label('Want to read');
    body(`Since ${fmtDate(book.dateAdded) ?? 'a while'}`);
  }

  label('Shelved under');
  body(secondary ? `${category}, and ${secondary}` : category);

  if (book.review) {
    label('Notes');
    ctx.fillStyle = INK;
    ctx.font = `italic 400 40px ${SERIF}`;
    const lines = wrap(ctx, book.review.replace(/\s+/g, ' '), right - left);
    const room = Math.floor((H * 0.9 - y) / 52);
    lines.slice(0, room).forEach((l, i) => {
      const last = i === room - 1 && lines.length > room;
      ctx.fillText(last ? `${l.replace(/\s+\S*$/, '')} …` : l, left, y);
      y += 52;
    });
  } else {
    ctx.fillStyle = 'rgba(44,38,32,0.3)';
    ctx.font = `400 64px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('❦', (left + right) / 2, Math.max(y + 60, H * 0.8));
  }
  return texture(c);
}
