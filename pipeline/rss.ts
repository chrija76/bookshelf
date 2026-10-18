import path from 'node:path';
import { CACHE_DIR, readJson, writeJson } from './cache.ts';
import { config } from './config.ts';
import { stripHtml } from './enrich.ts';

/** What the Goodreads list RSS knows about a book that the CSV export doesn't. */
export interface RssBook {
  imageUrl: string | null;
  pages: number | null;
  description: string | null;
  isbn10: string | null;
  avgRating: number | null;
}

const PER_PAGE = 200;
const SNAPSHOT = path.join(CACHE_DIR, 'rss.json');

function field(item: string, tag: string): string | null {
  const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  const v = m?.[1]?.trim();
  return v ? v : null;
}

export function parseRss(xml: string): Map<string, RssBook> {
  const out = new Map<string, RssBook>();
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const id = field(item!, 'book_id');
    if (!id) continue;
    const image = field(item!, 'book_large_image_url') ?? field(item!, 'book_image_url');
    const pages = Number(field(item!, 'num_pages'));
    const avg = Number(field(item!, 'average_rating'));
    const desc = field(item!, 'book_description');
    out.set(id, {
      imageUrl: image && !/nophoto/i.test(image) ? image : null,
      pages: pages > 0 ? pages : null,
      description: desc ? stripHtml(desc) || null : null,
      isbn10: field(item!, 'isbn'),
      avgRating: avg > 0 ? avg : null,
    });
  }
  return out;
}

/**
 * Fetch the whole library from the user's list RSS (paged, 200 per page). The feed URL carries a
 * private key, so it lives in .env and never reaches the client. If Goodreads is unreachable we fall
 * back to the last snapshot.
 */
export async function fetchRss(): Promise<Map<string, RssBook>> {
  const { GOODREADS_USER_ID: user, GOODREADS_RSS_KEY: key } = config;
  if (!user) return new Map();
  const all = new Map<string, RssBook>();
  try {
    for (let page = 1; page < 50; page++) {
      const q = new URLSearchParams({ shelf: '#ALL#', per_page: String(PER_PAGE), page: String(page) });
      if (key) q.set('key', key);
      const res = await fetch(`https://www.goodreads.com/review/list_rss/${user}?${q}`, {
        headers: { 'User-Agent': config.USER_AGENT },
      });
      if (!res.ok) throw new Error(`RSS page ${page}: HTTP ${res.status}`);
      const batch = parseRss(await res.text());
      for (const [id, b] of batch) all.set(id, b);
      if (batch.size < PER_PAGE) break;
    }
    await writeJson(SNAPSHOT, Object.fromEntries(all));
    return all;
  } catch (err) {
    const snap = await readJson<Record<string, RssBook>>(SNAPSHOT);
    console.warn(`  RSS unavailable (${(err as Error).message}); ${snap ? 'using last snapshot' : 'continuing without it'}`);
    return new Map(Object.entries(snap ?? {}));
  }
}
