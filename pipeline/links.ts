import { config } from './config.ts';
import type { BookLinks } from '../src/types.ts';

export function buildLinks(opts: {
  bookId: string;
  title: string;
  author: string;
  asin: string | null;
  isbn10: string | null;
  marketplace?: string;
}): BookLinks {
  const market = opts.marketplace ?? config.MARKETPLACE;
  // Main title (no series tag or subtitle) and author: specific enough, and still matches other editions.
  const mainTitle = opts.title.replace(/\s*\(.*?\)\s*$/, '').split(/:\s|\s-\s/)[0]!;
  const query = encodeURIComponent(`${mainTitle} ${opts.author}`.replace(/\s+/g, ' ').trim()).replace(/%20/g, '+');
  const amazon = opts.asin
    ? `https://www.${market}/dp/${opts.asin}`
    : opts.isbn10
      ? `https://www.${market}/dp/${opts.isbn10}`
      : `https://www.${market}/s?k=${query}&i=stripbooks`;
  return {
    goodreads: `https://www.goodreads.com/book/show/${opts.bookId}`,
    amazon,
  };
}
