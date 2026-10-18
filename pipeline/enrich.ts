import { cachedFetch, fetchJson, stepCache } from './cache.ts';
import type { RawBook } from './csv.ts';
import type { RssBook } from './rss.ts';

export interface Enriched {
  pages: number | null;
  isbn10: string | null;
  isbn13: string | null;
  asin: string | null;
  description: string | null;
  subjects: string[];
  /** Candidate cover URLs discovered while enriching, best first. */
  goodreadsCover: string | null;
  googleCover: string | null;
  sources: string[];
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function isbn13to10(isbn13: string): string | null {
  const d = isbn13.replace(/[^\dX]/gi, '');
  if (d.length !== 13 || !d.startsWith('978')) return null;
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

export { stripHtml };

interface GoodreadsPage {
  imageUrl: string | null;
  asin: string | null;
  numPages: number | null;
  isbn: string | null;
  isbn13: string | null;
  description: string | null;
  genres: string[];
}

/** The Goodreads API is gone, but the public book page embeds its Apollo state as JSON. */
let goodreadsMisses = 0;

async function goodreadsPage(bookId: string): Promise<GoodreadsPage | null> {
  const res = await cachedFetch(`https://www.goodreads.com/book/show/${bookId}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  if (res.status !== 200) {
    // 404 is a real answer; anything else (bot challenge, network) means "try again next run".
    if (res.status !== 404) goodreadsMisses++;
    return null;
  }
  const html = res.body.toString('utf8');
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  if (!m) return { imageUrl: ogImage, asin: null, numPages: null, isbn: null, isbn13: null, description: null, genres: [] };

  type ApolloBook = {
    __typename?: string;
    legacyId?: number;
    imageUrl?: string;
    details?: { asin?: string | null; numPages?: number | null; isbn?: string | null; isbn13?: string | null };
    bookGenres?: { genre?: { name?: string } }[];
    [key: string]: unknown;
  };
  let state: Record<string, ApolloBook> = {};
  try {
    state = (JSON.parse(m[1]!) as { props: { pageProps: { apolloState: Record<string, ApolloBook> } } }).props.pageProps
      .apolloState;
  } catch {
    /* fall through with og:image only */
  }
  const book = Object.values(state).find((v) => v.__typename === 'Book' && String(v.legacyId) === bookId);
  if (!book) return { imageUrl: ogImage, asin: null, numPages: null, isbn: null, isbn13: null, description: null, genres: [] };
  const descKey = Object.keys(book).find((k) => k.startsWith('description'));
  const desc = descKey ? book[descKey] : null;
  return {
    imageUrl: book.imageUrl ?? ogImage,
    asin: book.details?.asin ?? null,
    numPages: book.details?.numPages ?? null,
    isbn: book.details?.isbn ?? null,
    isbn13: book.details?.isbn13 ?? null,
    description: typeof desc === 'string' ? stripHtml(desc) : null,
    genres: (book.bookGenres ?? []).map((g) => g.genre?.name).filter((n): n is string => !!n),
  };
}

interface OLEdition {
  number_of_pages?: number;
  isbn_10?: string[];
  isbn_13?: string[];
  works?: { key: string }[];
  subjects?: string[];
}
interface OLWork {
  description?: string | { value: string };
  subjects?: string[];
}
interface OLSearch {
  docs?: { number_of_pages_median?: number; isbn?: string[]; subject?: string[]; key?: string }[];
}
interface GBVolumes {
  items?: {
    volumeInfo?: {
      pageCount?: number;
      description?: string;
      categories?: string[];
      industryIdentifiers?: { type: string; identifier: string }[];
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }[];
}

const cache = stepCache<Enriched>('enrich', 4);

export async function enrich(book: RawBook, rss: RssBook | null = null): Promise<Enriched> {
  const hit = await cache.get(book.bookId);
  if (hit) return hit;

  const out: Enriched = {
    pages: book.pages,
    isbn10: book.isbn,
    isbn13: book.isbn13,
    asin: null,
    description: null,
    subjects: [],
    goodreadsCover: null,
    googleCover: null,
    sources: [],
  };
  const fill = <K extends keyof Enriched>(k: K, v: Enriched[K] | null | undefined) => {
    if ((out[k] === null || (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0)) && v) out[k] = v;
  };

  // The RSS feed is the user's own data, so it beats everything scraped.
  if (rss) {
    out.sources.push('rss');
    out.goodreadsCover = rss.imageUrl;
    fill('pages', rss.pages);
    fill('isbn10', rss.isbn10);
    fill('description', rss.description);
  }

  const missesBefore = goodreadsMisses;
  const gr = await goodreadsPage(book.bookId);
  const goodreadsUnavailable = goodreadsMisses > missesBefore;
  if (gr) {
    out.sources.push('goodreads');
    out.goodreadsCover ??= gr.imageUrl;
    out.asin = gr.asin && /^B0/.test(gr.asin) ? gr.asin : null;
    fill('pages', gr.numPages);
    fill('isbn10', gr.isbn);
    fill('isbn13', gr.isbn13);
    fill('description', gr.description);
    fill('subjects', gr.genres);
  }
  if (!out.isbn10 && out.isbn13) out.isbn10 = isbn13to10(out.isbn13);

  const isbn = out.isbn13 ?? out.isbn10;
  if (isbn && (!out.pages || !out.description)) {
    const ed = await fetchJson<OLEdition>(`https://openlibrary.org/isbn/${isbn}.json`);
    if (ed) {
      out.sources.push('openlibrary');
      fill('pages', ed.number_of_pages);
      fill('isbn10', ed.isbn_10?.[0]);
      fill('isbn13', ed.isbn_13?.[0]);
      fill('subjects', ed.subjects);
      const workKey = ed.works?.[0]?.key;
      if (workKey && !out.description) {
        const work = await fetchJson<OLWork>(`https://openlibrary.org${workKey}.json`);
        const d = work?.description;
        fill('description', typeof d === 'string' ? d : d?.value);
        fill('subjects', work?.subjects?.slice(0, 12));
      }
    }
  }

  if (!out.pages || !out.isbn13) {
    const q = new URLSearchParams({ title: book.title.replace(/\s*\(.*\)\s*$/, ''), author: book.author, limit: '1' });
    const s = await fetchJson<OLSearch>(`https://openlibrary.org/search.json?${q}&fields=number_of_pages_median,isbn,subject,key`);
    const doc = s?.docs?.[0];
    if (doc) {
      out.sources.push('openlibrary-search');
      fill('pages', doc.number_of_pages_median);
      fill('isbn13', doc.isbn?.find((i) => i.length === 13));
      fill('isbn10', doc.isbn?.find((i) => i.length === 10));
      fill('subjects', doc.subject?.slice(0, 12));
    }
  }

  const gbQuery = isbn ? `isbn:${isbn}` : `intitle:${book.title} inauthor:${book.author}`;
  const gb = await fetchJson<GBVolumes>(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gbQuery)}&maxResults=1`);
  const vi = gb?.items?.[0]?.volumeInfo;
  if (vi) {
    out.sources.push('googlebooks');
    fill('pages', vi.pageCount);
    fill('description', vi.description ? stripHtml(vi.description) : null);
    fill('subjects', vi.categories);
    fill('isbn13', vi.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier);
    fill('isbn10', vi.industryIdentifiers?.find((i) => i.type === 'ISBN_10')?.identifier);
    const thumb = vi.imageLinks?.thumbnail ?? vi.imageLinks?.smallThumbnail;
    if (thumb) {
      const u = new URL(thumb.replace(/^http:/, 'https:'));
      u.searchParams.set('zoom', '1');
      u.searchParams.delete('edge');
      out.googleCover = u.toString();
    }
  }
  if (!out.isbn10 && out.isbn13) out.isbn10 = isbn13to10(out.isbn13);

  // Don't freeze a result that is missing Goodreads data only because Goodreads blocked us.
  // With RSS data the only thing the page adds is the ASIN and genres, so cache anyway.
  if (!goodreadsUnavailable || rss) await cache.set(book.bookId, out);
  return out;
}
