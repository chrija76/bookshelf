import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { buildAtlas, buildCoverAtlas, pruneAtlas } from './atlas.ts';
import { DATA_DIR, PUBLIC_DIR, readJson, writeJson } from './cache.ts';
import { categorise } from './categorise.ts';
import { config } from './config.ts';
import { resolveCover, type CoverSource } from './covers.ts';
import { parseGoodreadsCsv, type RawBook } from './csv.ts';
import { bookDims, classifyBinding } from './dims.ts';
import { enrich, stripHtml, type Enriched } from './enrich.ts';
import { buildLinks } from './links.ts';
import { extractPalette } from './palette.ts';
import { fetchRss } from './rss.ts';
import type { Book, Library } from '../src/types.ts';

const OverrideSchema = z.record(
  z.string(),
  z
    .object({
      /** Corrects a title or author that Goodreads has garbled; it shows on the spine and in the UI. */
      title: z.string(),
      author: z.string(),
      /** Moves a book to another shelf than the export says, e.g. what you're reading right now. */
      shelf: z.enum(['read', 'currently-reading', 'to-read']),
      category: z.string(),
      secondaryCategory: z.string().nullable(),
      coverUrl: z.string().url(),
      pages: z.number().int().positive(),
      asin: z.string(),
      /** The ISBN/ASIN product page doesn't exist on the marketplace: link to a title search instead. */
      amazonSearch: z.boolean(),
      hide: z.boolean(),
    })
    .partial(),
);

/** Books that aren't in the Goodreads export yet, added by hand in data/extra-books.json. */
const ExtraSchema = z.array(
  z.object({
    bookId: z.string(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().nullable().default(null),
    isbn13: z.string().nullable().default(null),
    publisher: z.string().nullable().default(null),
    binding: z.string().nullable().default(null),
    pages: z.number().int().positive().nullable().default(null),
    yearPublished: z.number().int().nullable().default(null),
    dateAdded: z.string().nullable().default(null),
    shelf: z.enum(['read', 'currently-reading', 'to-read']),
  }),
);

function findCsv(): string {
  const preferred = path.join(DATA_DIR, 'goodreads_library_export.csv');
  if (existsSync(preferred)) return preferred;
  const csvs = readdirSync(DATA_DIR).filter((f) => f.endsWith('.csv'));
  if (csvs.length === 0) throw new Error('No CSV found. Export from Goodreads (My Books › Import/Export) into data/.');
  return path.join(DATA_DIR, csvs.sort().at(-1)!);
}

async function mapWithProgress<T, R>(label: string, items: T[], fn: (item: T) => Promise<R>, concurrency = 8): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const tty = process.stdout.isTTY;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
        done++;
        if (tty) process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
      }
    }),
  );
  console.log(tty ? '' : `  ${label}: ${done}/${items.length}`);
  return out;
}

const tidyName = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Goodreads exports some authors as URL slugs ("stefan-klein"). */
const tidyAuthor = (s: string) =>
  /^[a-z]+(-[a-z]+)+$/.test(s.trim())
    ? s.trim().split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
    : tidyName(s);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 300;
};

async function main() {
  const t0 = Date.now();
  const csvPath = findCsv();
  console.log(`▸ Reading ${path.relative(process.cwd(), csvPath)}`);
  const overrides = OverrideSchema.parse((await readJson<unknown>(path.join(DATA_DIR, 'overrides.json'))) ?? {});

  const exported = parseGoodreadsCsv(await readFile(csvPath, 'utf8'));
  const known = new Set(exported.map((b) => b.bookId));
  const extra: RawBook[] = ExtraSchema.parse((await readJson<unknown>(path.join(DATA_DIR, 'extra-books.json'))) ?? [])
    .filter((e) => !known.has(e.bookId))
    .map((e) => ({
      ...e,
      additionalAuthors: [],
      myRating: 0,
      avgRating: 0,
      originalYear: e.yearPublished,
      dateRead: null,
      bookshelves: [],
      review: null,
    }));
  const all = [...exported, ...extra];
  const hiddenShelf = (b: RawBook) => [b.shelf, ...b.bookshelves].some((s) => config.HIDDEN_SHELVES.includes(s));
  const raw: RawBook[] = all
    .filter((b) => !overrides[b.bookId]?.hide && !hiddenShelf(b))
    .map((b) => ({
      ...b,
      title: overrides[b.bookId]?.title ?? tidyName(b.title),
      author: overrides[b.bookId]?.author ?? tidyAuthor(b.author),
      shelf: overrides[b.bookId]?.shelf ?? b.shelf,
    }));
  console.log(`  ${exported.length} rows + ${extra.length} extra, ${raw.length} after hide flags`);

  console.log('▸ Goodreads RSS');
  const rss = await fetchRss();
  console.log(`  ${rss.size} books in feed, ${raw.filter((b) => rss.has(b.bookId)).length} matched`);

  console.log('▸ Enriching metadata (RSS, Goodreads page, Open Library, Google Books)');
  const enriched = await mapWithProgress('enrich', raw, (b) => enrich(b, rss.get(b.bookId) ?? null), 6);
  const meta = new Map<string, Enriched>(raw.map((b, i) => [b.bookId, enriched[i]!]));

  const knownPages = raw.map((b) => overrides[b.bookId]?.pages ?? meta.get(b.bookId)!.pages).filter((p): p is number => !!p);
  const medianPages = median(knownPages);

  console.log('▸ Covers');
  const covers = await mapWithProgress(
    'covers',
    raw,
    (b) => {
      const m = meta.get(b.bookId)!;
      return resolveCover({
        bookId: b.bookId,
        title: b.title,
        author: b.author,
        isbn10: m.isbn10,
        isbn13: m.isbn13,
        goodreadsCover: m.goodreadsCover,
        googleCover: m.googleCover,
        override: overrides[b.bookId]?.coverUrl ?? null,
      });
    },
    6,
  );

  console.log('▸ Palettes');
  const palettes = await mapWithProgress('palette', raw, (b) => extractPalette(b.bookId, covers[raw.indexOf(b)]!.file), 4);

  console.log('▸ Categorising');
  const { categories, assignments } = await categorise(
    raw.map((b) => ({
      id: b.bookId,
      title: b.title,
      author: b.author,
      description: meta.get(b.bookId)!.description,
      subjects: meta.get(b.bookId)!.subjects,
    })),
  );
  const slugs = new Set(categories.map((c) => c.slug));

  const books: Book[] = raw.map((b, i) => {
    const m = meta.get(b.bookId)!;
    const o = overrides[b.bookId] ?? {};
    const pagesKnown = o.pages ?? m.pages;
    const pages = pagesKnown ?? medianPages;
    const binding = classifyBinding(b.binding);
    const cover = covers[i]!;
    const a = assignments[b.bookId];
    const category = o.category && slugs.has(o.category) ? o.category : (a?.primary ?? categories[0]!.slug);
    const secondary = o.secondaryCategory !== undefined ? o.secondaryCategory : (a?.secondary ?? null);
    const asin = o.asin ?? m.asin;
    const book: Book = {
      id: b.bookId,
      title: b.title,
      author: b.author,
      shelf: b.shelf,
      favourite: b.bookshelves.includes(config.FAVOURITES_SHELF),
      rating: b.myRating,
      avgRating: b.avgRating || rss.get(b.bookId)?.avgRating || 0,
      dateRead: b.dateRead,
      dateAdded: b.dateAdded,
      year: b.originalYear ?? b.yearPublished,
      publisher: b.publisher,
      pages,
      pagesEstimated: !pagesKnown,
      binding,
      dims: bookDims(b.bookId, pages, binding, cover.aspect || config.DEFAULT_COVER_ASPECT),
      palette: palettes[i]!,
      category,
      secondaryCategory: secondary && slugs.has(secondary) && secondary !== category ? secondary : null,
      coverUrl: cover.url,
      coverPlaceholder: cover.placeholderUrl,
      coverAspect: cover.aspect,
      spineAtlas: { sheet: 0, uv: [0, 0, 0, 0] },
      coverAtlas: { sheet: 0, uv: [0, 0, 0, 0] },
      links: o.amazonSearch
        ? buildLinks({ bookId: b.bookId, title: b.title, author: b.author, asin: null, isbn10: null })
        : buildLinks({ bookId: b.bookId, title: b.title, author: b.author, asin, isbn10: m.isbn10 }),
    };
    // Privacy: reviews only ship when explicitly enabled. Stripped here, not hidden in the UI.
    if (config.SHOW_REVIEWS && b.review) book.review = stripHtml(b.review);
    return book;
  });

  console.log('▸ Spine textures + atlas');
  const catName = new Map(categories.map((c) => [c.slug, c.name]));
  const { refs, sheets, pxPerMm } = await buildAtlas(
    books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      dims: b.dims,
      palette: b.palette,
      binding: b.binding,
      genreHint: `${catName.get(b.category) ?? ''} ${meta.get(b.id)!.subjects.slice(0, 6).join(' ')}`,
    })),
  );
  for (const b of books) b.spineAtlas = refs.get(b.id)!;

  console.log('▸ Cover atlas');
  const coverAtlas = await buildCoverAtlas(raw.map((b, i) => ({ id: b.bookId, file: covers[i]!.file })));
  for (const b of books) b.coverAtlas = coverAtlas.refs.get(b.id)!;
  await pruneAtlas([...sheets, ...coverAtlas.sheets].map((s) => s.url));

  const library: Library = {
    generatedAt: new Date().toISOString(),
    categories,
    atlas: sheets,
    coverAtlas: coverAtlas.sheets,
    books,
  };
  await writeJson(path.join(PUBLIC_DIR, 'data', 'books.json'), library);

  // Summary
  const coverCounts = new Map<CoverSource, number>();
  for (const c of covers) coverCounts.set(c.source, (coverCounts.get(c.source) ?? 0) + 1);
  const shelfCounts = new Map<string, number>();
  for (const b of books) shelfCounts.set(b.shelf, (shelfCounts.get(b.shelf) ?? 0) + 1);
  const catCounts = new Map<string, number>();
  for (const b of books) catCounts.set(b.category, (catCounts.get(b.category) ?? 0) + 1);
  const estimated = books.filter((b) => b.pagesEstimated);
  const shelfLength = books.filter((b) => b.shelf === 'read').reduce((s, b) => s + b.dims.t, 0);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log('\n──────────── Summary ────────────');
  console.log(`Books processed      ${books.length}  (${[...shelfCounts].map(([k, v]) => `${k} ${v}`).join(', ')})`);
  console.log(`Covers by source     ${[...coverCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`Missing page counts  ${estimated.length}  (estimated at median ${medianPages})`);
  console.log(`Shelf length (read) ${(shelfLength / 1000).toFixed(2)} m`);
  console.log(`Atlas                ${sheets.length} spine sheet(s) at ${pxPerMm} px/mm, ${coverAtlas.sheets.length} cover sheet(s)`);
  console.log('Categories:');
  for (const c of categories) console.log(`  ${pad(c.name, 26)} ${String(catCounts.get(c.slug) ?? 0).padStart(4)}   ${c.description}`);
  if (estimated.length && estimated.length <= 25) console.log(`Estimated pages: ${estimated.map((b) => b.title).join(' · ')}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
