// Pure layout: where the bookcase, every book and every object sits. Units are millimetres.
// World axes: x along the wall, y up, z out of the wall towards the viewer (wall at z = 0).
// Book local frame: x = thickness (front cover on +x), y = height, z = depth (spine on +z).

import { rng } from '../lib/random.ts';
import type { Book, Category } from '../types.ts';

/** Two ways to show the library: spines out in a bookcase, or every cover face-out on display shelves. */
export type View = 'spines' | 'covers';
export type SortKey = 'dateRead' | 'rating' | 'author' | 'colour' | 'pages';
export type PlacementKind = 'shelf' | 'stack' | 'table' | 'display' | 'face' | 'reading';
export type Vec3 = [number, number, number];

/** A walnut case: a grid of compartments. Row 0 is the top row. */
export interface CaseSpec {
  x0: number;
  cols: number;
  rows: number;
  /** Interior size of one compartment. */
  compW: number;
  compH: number;
  panel: number;
  depth: number;
  plinth: number;
  /** Display shelves have a small front lip to stop face-out books sliding. */
  lip: boolean;
}

export const caseWidth = (c: CaseSpec) => c.cols * c.compW + (c.cols + 1) * c.panel;
export const caseHeight = (c: CaseSpec) => c.plinth + c.rows * c.compH + (c.rows + 1) * c.panel;
/** Left edge of a compartment's interior. */
export const compX = (c: CaseSpec, col: number) => c.x0 + c.panel + col * (c.compW + c.panel);
/** Top surface of the shelf a compartment's books stand on. */
export const compY = (c: CaseSpec, row: number) => c.plinth + c.panel + (c.rows - 1 - row) * (c.compH + c.panel);

const CASES: Record<View, Omit<CaseSpec, 'x0' | 'cols'> & { fill: number; minCols: number }> = {
  spines: { rows: 6, compW: 720, compH: 318, panel: 24, depth: 320, plinth: 78, lip: false, fill: 0.85, minCols: 2 },
  covers: { rows: 7, compW: 1060, compH: 292, panel: 24, depth: 180, plinth: 78, lip: true, fill: 0.93, minCols: 2 },
};

export const LAYOUT = {
  bookGap: 0.8,
  /** Gap between the spine and the front edge of the shelf. */
  spineInset: 18,
  sidePadding: 10,
  leanDeg: 7,
  /** Low table left of the bookcase with every want-to-read book, in two rows of stacks. */
  table: { x: -1010, z: 470, width: 1340, depth: 600, height: 420 },
  /** Stacks per row on the table; stacks grow taller rather than leave books off it. */
  stacksPerRow: 4,
  stackMin: 12,
  /** Small table further left with the books being read, lying open. */
  readingTable: { x: -2400, z: 540, width: 1040, depth: 560, height: 460 },
} as const;

export interface Placement {
  book: Book;
  kind: PlacementKind;
  /** Centre of the book box. */
  position: Vec3;
  /** Euler angles, XYZ order. */
  rotation: Vec3;
  /** Order for the intro stagger (compartment index; -1 on the side table). */
  bay: number;
  /** Shelf row (`col:row`) and position in it, for neighbours settling into a gap. */
  row: string | null;
  slot: number;
}

export type DecorKind = 'bookend' | 'vase' | 'bowl' | 'sphere' | 'plant';
export interface Decor {
  kind: DecorKind;
  /** Base centre, standing on a shelf. */
  position: Vec3;
  rotationY: number;
  seed: number;
}

/** A shelf-edge label. Every compartment names what's on it, so a category may be labelled many times. */
export interface Label {
  text: string;
  slug: string;
  position: Vec3;
  /** True where the category begins; false where it continues from the previous compartment. */
  start: boolean;
}

export interface Layout {
  view: View;
  bookcase: CaseSpec;
  placements: Placement[];
  decor: Decor[];
  labels: Label[];
  /** Camera dolly range. */
  minX: number;
  maxX: number;
}

function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.08) return 400 + (1 - max) * 100; // greys and near-neutrals go at the end, light to dark
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const surname = (a: string) => a.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
/** Goodreads often has no read date; the date added is the next best signal. */
export const readDate = (b: Book) => b.dateRead ?? b.dateAdded ?? '';

export function sortBooks(books: Book[], key: SortKey): Book[] {
  const s = [...books];
  switch (key) {
    case 'dateRead':
      return s.sort((a, b) => readDate(a).localeCompare(readDate(b)));
    case 'rating':
      return s.sort((a, b) => b.rating - a.rating || b.avgRating - a.avgRating);
    case 'author':
      return s.sort((a, b) => surname(a.author).localeCompare(surname(b.author)) || a.title.localeCompare(b.title));
    case 'colour':
      return s.sort((a, b) => hue(a.palette.dominant) - hue(b.palette.dominant));
    case 'pages':
      return s.sort((a, b) => b.pages - a.pages);
  }
}

/** Shelf-edge label size (mm), shared with the renderer. */
export const LABEL = { height: 30, fontSize: 14, letterSpacing: 0.12, pad: 13 } as const;
export const labelWidth = (text: string) => text.length * LABEL.fontSize * 0.8 + LABEL.pad * 2;

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * Something that takes up shelf width: an upright book, a face-out book, or a horizontal stack.
 * `label` marks the first item of a category.
 */
interface Item {
  kind: 'upright' | 'face' | 'stack';
  books: Book[];
  width: number;
  category: Category;
  label: Category | null;
}

/** What a series' volumes share: the title without its volume number, year or series tag. */
export const seriesKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s*\(([^)]*?),?\s*#\d+\)\s*$/, ' ($1)')
    .replace(/\b(19|20)\d\d\b|\b\d+\b/g, '')
    .replace(/:.*$/, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();

/**
 * Volumes of a series stand together, in order, where the first of them would have gone, as on a
 * real shelf. A series here is two or more books with the same key (and, for short titles, the same author).
 */
export function groupSeries(books: Book[]): Book[] {
  const key = (b: Book) => {
    const series = b.title.match(/\(([^)]*?),?\s*#\d+\)\s*$/)?.[1];
    if (series) return `s:${series.toLowerCase()}`;
    // Long shared titles are a series even with a different editor each year (annual anthologies).
    const k = seriesKey(b.title);
    return k.split(' ').length >= 4 ? k : `${k}|${b.author.toLowerCase()}`;
  };
  const counts = new Map<string, number>();
  for (const b of books) counts.set(key(b), (counts.get(key(b)) ?? 0) + 1);
  // Order within a series: by the volume number or year in the title.
  const vol = (b: Book) => Number(b.title.match(/#(\d+)\)/)?.[1] ?? b.title.match(/\b((?:19|20)\d\d)\b/)?.[1] ?? 0);
  const out: Book[] = [];
  const done = new Set<string>();
  for (const b of books) {
    const k = key(b);
    if ((counts.get(k) ?? 0) < 2) out.push(b);
    else if (!done.has(k)) {
      done.add(k);
      out.push(...books.filter((o) => key(o) === k).sort((x, y) => vol(x) - vol(y)));
    }
  }
  return out;
}

function items(view: View, read: Book[], categories: Category[], sort: SortKey): Item[] {
  const L = LAYOUT;
  const out: Item[] = [];
  for (const category of categories) {
    const inCat = groupSeries(
      sortBooks(
        read.filter((b) => b.category === category.slug),
        sort,
      ),
    );
    if (!inCat.length) continue;
    const start = out.length;
    if (view === 'covers') {
      for (const b of inCat) out.push({ kind: 'face', books: [b], width: b.dims.w + 22, category, label: null });
    } else {
      // A favourite stands face-out at the start of its category, as a bookshop would do it.
      const fav = [...inCat.filter((b) => b.favourite)].sort((a, b) => readDate(b).localeCompare(readDate(a)))[0];
      // A few large-format books lie flat in a stack at the end of the category.
      const stack =
        inCat.length >= 12
          ? [...inCat]
              .filter((b) => b !== fav)
              .sort((a, b) => b.dims.h * b.dims.w - a.dims.h * a.dims.w)
              .slice(0, 2 + Math.floor(rng(`stack:${category.slug}`)() * 2))
          : [];
      if (fav) out.push({ kind: 'face', books: [fav], width: fav.dims.w + 26, category, label: null });
      for (const b of inCat) {
        if (b === fav || stack.includes(b)) continue;
        out.push({ kind: 'upright', books: [b], width: b.dims.t + L.bookGap, category, label: null });
      }
      if (stack.length)
        out.push({ kind: 'stack', books: stack, width: Math.max(...stack.map((b) => b.dims.h)) + 24, category, label: null });
    }
    out[start]!.label = category;
  }
  return out;
}

export function computeLayout(books: Book[], categories: Category[], sort: SortKey = 'dateRead', view: View = 'spines'): Layout {
  const L = LAYOUT;
  const spec = CASES[view];
  const read = books.filter((b) => b.shelf === 'read');
  const seq = items(view, read, categories, sort);
  const interior = spec.compW - L.sidePadding * 2;
  const byCat: Item[][] = [];
  for (const it of seq) {
    if (it.label) byCat.push([]);
    byCat.at(-1)!.push(it);
  }
  const widthOf = (its: Item[]) => its.reduce((s, it) => s + it.width, 0);
  // Split one category over n compartments, each aiming for an even share and never taking more
  // than fits. Null when n compartments aren't enough.
  const split = (its: Item[], n: number): Item[][] | null => {
    const out: Item[][] = [[]];
    let cursor = 0;
    let remaining = widthOf(its);
    let share = remaining / n;
    for (const it of its) {
      if (it.width > interior) return null;
      if (cursor > 0 && (cursor + it.width > interior || cursor + it.width / 2 > share)) {
        if (out.length === n) return null;
        out.push([]);
        cursor = 0;
        share = remaining / (n - out.length + 1);
      }
      out.at(-1)!.push(it);
      cursor += it.width;
      remaining -= it.width;
    }
    return out;
  };
  // Every category starts in a compartment of its own, as a library starts each section on a fresh
  // shelf. Each takes as many compartments as it needs at the target fill.
  // A category that fits in one compartment stays together in it, however full that makes it.
  const need = byCat.map((its) => {
    if (split(its, 1)) return 1;
    let n = Math.max(2, Math.ceil(widthOf(its) / (interior * spec.fill)));
    while (!split(its, n)) n++;
    return n;
  });
  const taken = need.reduce((s, n) => s + n, 0);
  const cols = Math.max(spec.minCols, Math.ceil(taken / spec.rows));
  // Spare compartments in the last column go to the fullest of the categories that already span
  // several, so shelves even out without splitting one that fits on a single shelf.
  const spreadable = byCat.map((_, i) => i).filter((i) => need[i]! > 1);
  for (let spare = cols * spec.rows - taken; spare > 0 && spreadable.length; spare--) {
    let k = spreadable[0]!;
    for (const i of spreadable) if (widthOf(byCat[i]!) / need[i]! > widthOf(byCat[k]!) / need[k]!) k = i;
    need[k]!++;
  }
  // Compartments fill down each column, top to bottom, then the next column to the right.
  const groups = byCat.flatMap((its, i) => {
    const parts = split(its, need[i]!)!;
    while (parts.length < need[i]!) parts.push([]);
    return parts;
  });
  const bookcase: CaseSpec = { ...spec, x0: 0, cols };
  const comps = cols * spec.rows;

  const placements: Placement[] = [];
  const decor: Decor[] = [];
  const labels: Label[] = [];

  let objects = 0;
  groups.forEach((group, ci) => {
    const col = Math.floor(ci / spec.rows);
    const row = ci % spec.rows;
    const x0 = compX(bookcase, col) + L.sidePadding;
    const y = compY(bookcase, row);
    const rowKey = `${col}:${row}`;
    const r = rng(`comp:${view}:${rowKey}`);
    const used = group.reduce((s, it) => s + it.width, 0);
    const free = interior - used;
    const last = group.at(-1);
    // The last upright book leans when there's room for it to tip over.
    const leanLast =
      view === 'spines' && last?.kind === 'upright' && group.length > 3 && free > last.books[0]!.dims.h * 0.16 && r() < 0.65;
    let x = x0;
    let slot = 0;
    // Face-out displays look curated when the covers are spaced evenly across the shelf.
    const spread = view === 'covers' && group.length > 1 ? Math.max(0, free) / (group.length - 1) : 0;
    group.forEach((it, ii) => {
      // Every compartment is labelled with its category, as libraries do; `start` marks where it begins.
      if (ii === 0) {
        labels.push({
          text: it.category.name,
          slug: it.category.slug,
          position: [Math.max(x, x0) + 2, y, bookcase.depth + 0.8],
          start: it.label !== null,
        });
      }
      const b = it.books[0]!;
      if (it.kind === 'upright') {
        const z = bookcase.depth - L.spineInset - b.dims.w / 2;
        if (leanLast && ii === group.length - 1) {
          const a = deg(L.leanDeg + r() * 3);
          const px = x + b.dims.h * Math.sin(a) + 1; // pivot: bottom-left corner, top resting on its neighbour
          placements.push({
            book: b,
            kind: 'shelf',
            position: [
              px + (b.dims.t / 2) * Math.cos(a) - (b.dims.h / 2) * Math.sin(a),
              y + (b.dims.t / 2) * Math.sin(a) + (b.dims.h / 2) * Math.cos(a),
              z,
            ],
            rotation: [0, 0, a],
            bay: ci,
            row: rowKey,
            slot: slot++,
          });
          x = px + b.dims.t + 2;
          return;
        }
        placements.push({
          book: b,
          kind: 'shelf',
          position: [x + b.dims.t / 2, y + b.dims.h / 2, z],
          rotation: [0, 0, 0],
          bay: ci,
          row: rowKey,
          slot: slot++,
        });
      } else if (it.kind === 'face') {
        // Face-out: a -90° turn about y puts the front cover forward, then it leans back.
        const { h, t, w } = b.dims;
        const lean = deg(view === 'covers' ? -9 : -12);
        const bottomZ = view === 'covers' ? bookcase.depth - 16 - t / 2 : 16 + h * Math.sin(-lean) + t / 2;
        placements.push({
          book: b,
          kind: view === 'covers' ? 'face' : 'display',
          position: [x + 12 + w / 2, y + (h / 2) * Math.cos(lean) + 1, bottomZ + (h / 2) * Math.sin(lean)],
          rotation: [lean, -Math.PI / 2, 0],
          bay: ci,
          row: rowKey,
          slot: slot++,
        });
      } else {
        // Horizontal stack, biggest at the bottom; lying flat is a +90° turn about z.
        const cx = x + it.width / 2 - 2;
        let top = y;
        it.books.forEach((sb, si) => {
          placements.push({
            book: sb,
            kind: 'stack',
            position: [cx + (r() - 0.5) * 12, top + sb.dims.t / 2, bookcase.depth - L.spineInset - sb.dims.w / 2],
            rotation: [0, deg((r() - 0.5) * 5), Math.PI / 2],
            bay: ci,
            row: null,
            slot: si,
          });
          top += sb.dims.t;
        });
        slot++;
      }
      x += it.width + spread;
    });

    // Close the row with a bookend, or use a roomy end for a small object now and then.
    const room = x0 + interior - x;
    if (view === 'spines' && !leanLast && group.length) {
      if (room > 260 && objects < comps / 4 && r() < 0.5) {
        const kinds: DecorKind[] = ['vase', 'plant', 'bowl', 'sphere'];
        decor.push({
          kind: kinds[objects % kinds.length]!,
          position: [x + Math.min(room, 320) / 2 + 10, y, bookcase.depth * 0.45],
          rotationY: r() * Math.PI * 2,
          seed: r(),
        });
        objects++;
      } else if (last?.kind === 'upright') {
        decor.push({ kind: 'bookend', position: [x + 1.5, y, bookcase.depth - 90], rotationY: 0, seed: 0 });
      }
    }
  });

  // ── Tables: every want-to-read book in stacks, the books being read lying cover up ─────
  const T = L.table;
  const reading = books.filter((b) => b.shelf === 'currently-reading');
  const toRead = books
    .filter((b) => b.shelf === 'to-read')
    .sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''));
  const perStack = Math.max(L.stackMin, Math.ceil(toRead.length / (L.stacksPerRow * 2)));
  const stacks: Book[][] = [];
  for (let i = 0; i < toRead.length; i += perStack) stacks.push(toRead.slice(i, i + perStack));
  // Newest stacks in the front row; the back row's stacks fall between them.
  const front = stacks.slice(0, Math.ceil(stacks.length / 2));
  const back = stacks.slice(front.length);
  const usable = T.width - 160;
  [front, back].forEach((row, ri) => {
    row.forEach((stack, si) => {
      const r = rng(`table:${ri}:${si}`);
      const cx = T.x - usable / 2 + ((si + 0.5 + (ri ? 0.25 : 0)) * usable) / Math.max(row.length, L.stacksPerRow);
      // Newest on top: each stack is built bottom-up from its oldest book.
      let top = T.height;
      [...stack].reverse().forEach((b, i) => {
        const z = ri === 0 ? T.z + T.depth / 2 - 30 - b.dims.w / 2 : T.z - T.depth / 2 + 30 + b.dims.w / 2;
        placements.push({
          book: b,
          kind: 'table',
          position: [cx + (r() - 0.5) * 14, top + b.dims.t / 2, z],
          rotation: [0, deg((r() - 0.5) * 5), Math.PI / 2],
          bay: -1,
          row: null,
          slot: i,
        });
        top += b.dims.t;
      });
    });
  });
  const R = L.readingTable;
  reading.forEach((book, i) => {
    // Lying flat, cover up, side by side: the top edge points away from the room, the spine to the left.
    const r = rng(`reading:${book.id}`);
    const step = (R.width - 160) / Math.max(1, reading.length);
    placements.push({
      book,
      kind: 'reading',
      position: [R.x - (R.width - 160) / 2 + step * (i + 0.5), R.height + book.dims.t / 2, R.z + (r() - 0.5) * 50],
      rotation: [0, deg(-90 + (r() - 0.5) * 16), Math.PI / 2],
      bay: -1,
      row: null,
      slot: i,
    });
  });

  // A label that would run into the next one on the same shelf gives way: a continuation label is
  // dropped (the start label right after it says enough), a start label slides right.
  const tidy: Label[] = [];
  for (const l of labels) {
    const prev = tidy.at(-1);
    if (prev && prev.position[1] === l.position[1] && l.position[0] < prev.position[0] + labelWidth(prev.text) + 10) {
      if (!prev.start) tidy.pop();
      else if (!l.start) continue;
      else l.position[0] = prev.position[0] + labelWidth(prev.text) + 10;
    }
    tidy.push(l);
  }

  const width = caseWidth(bookcase);
  return {
    view,
    bookcase,
    placements,
    decor,
    labels: tidy,
    minX: R.x,
    maxX: Math.max(R.x, width - 600),
  };
}

/** Where a category starts, for the nav: x along the wall and the height of its first shelf. */
export function categorySpot(layout: Layout, slug: string): { x: number; y: number } | null {
  const l = layout.labels.find((lb) => lb.slug === slug && lb.start);
  return l ? { x: l.position[0], y: l.position[1] } : null;
}
