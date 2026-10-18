import { parse } from 'csv-parse/sync';
import type { ExclusiveShelf } from '../src/types.ts';

export interface RawBook {
  bookId: string;
  title: string;
  author: string;
  additionalAuthors: string[];
  isbn: string | null;
  isbn13: string | null;
  myRating: number;
  avgRating: number;
  publisher: string | null;
  binding: string | null;
  pages: number | null;
  yearPublished: number | null;
  originalYear: number | null;
  dateRead: string | null;
  dateAdded: string | null;
  bookshelves: string[];
  shelf: ExclusiveShelf;
  review: string | null;
}

/** Goodreads wraps identifiers as ="0123456789" so Excel keeps leading zeros. */
export function stripExcelWrap(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim().replace(/^="?/, '').replace(/"$/, '').trim();
  return v === '' ? null : v;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** Goodreads exports dates as YYYY/MM/DD. Normalise to ISO YYYY-MM-DD. */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
}

function text(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

const SHELVES: readonly ExclusiveShelf[] = ['read', 'currently-reading', 'to-read'];

export function parseGoodreadsCsv(csv: string): RawBook[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  const books: RawBook[] = [];
  for (const row of rows) {
    const bookId = row['Book Id']?.trim();
    const title = text(row['Title']);
    if (!bookId || !title) continue;
    const shelfRaw = row['Exclusive Shelf']?.trim() as ExclusiveShelf | undefined;
    const shelf: ExclusiveShelf = shelfRaw && SHELVES.includes(shelfRaw) ? shelfRaw : 'read';
    books.push({
      bookId,
      title,
      author: text(row['Author']) ?? 'Unknown',
      additionalAuthors: (row['Additional Authors'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      isbn: stripExcelWrap(row['ISBN']),
      isbn13: stripExcelWrap(row['ISBN13']),
      myRating: num(row['My Rating']) ?? 0,
      avgRating: num(row['Average Rating']) ?? 0,
      publisher: text(row['Publisher']),
      binding: text(row['Binding']),
      pages: num(row['Number of Pages']) || null,
      yearPublished: num(row['Year Published']),
      originalYear: num(row['Original Publication Year']),
      dateRead: parseDate(row['Date Read']),
      dateAdded: parseDate(row['Date Added']),
      bookshelves: (row['Bookshelves'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      shelf,
      review: text(row['My Review']),
    });
  }
  return books;
}
