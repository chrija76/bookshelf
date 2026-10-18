// Pipeline configuration. Everything here is read at build time only.
// Env vars override the defaults so CI can flip flags without code changes.

const env = process.env;
const flag = (name: string, fallback: boolean): boolean =>
  env[name] === undefined ? fallback : ['1', 'true', 'yes'].includes(env[name]!.toLowerCase());

export const config = {
  /** Paper thickness per page in mm. Tune to taste: 0.05 is thin bible paper, 0.08 is pulpy. */
  PAGE_THICKNESS_MM: 0.06,
  /** Board thickness by binding class, mm (both covers combined). */
  BOARD_MM: { hardcover: 5, paperback: 1, unknown: 3 },
  THICKNESS_MIN_MM: 7,
  THICKNESS_MAX_MM: 70,
  HEIGHT_MM: { hardcover: 235, paperback: 215, massMarket: 175 },
  /** Kindle / unknown binding: seeded random height in this range. */
  HEIGHT_RANDOM_MM: [215, 240] as const,
  DEPTH_MIN_MM: 120,
  DEPTH_MAX_MM: 170,
  /** Cover aspect (w/h) used when no cover could be measured. */
  DEFAULT_COVER_ASPECT: 0.66,

  /** Amazon marketplace for search / product links. */
  MARKETPLACE: env.BOOKSHELF_MARKETPLACE ?? 'amazon.de',

  /** When false, reviews are stripped from books.json at build time. */
  SHOW_REVIEWS: flag('SHOW_REVIEWS', false),
  /** Shelves (exclusive or custom) whose books are dropped entirely at build time. */
  HIDDEN_SHELVES: (env.HIDDEN_SHELVES ?? 'did-not-finish').split(',').map((s) => s.trim()).filter(Boolean),
  /** Custom shelf that marks favourites (they get the ledge in phase 2). */
  FAVOURITES_SHELF: env.FAVOURITES_SHELF ?? 'favorites',

  /** Goodreads list RSS: covers, page counts and descriptions the CSV lacks. Server-side only. */
  GOODREADS_USER_ID: env.GOODREADS_USER_ID ?? null,
  GOODREADS_RSS_KEY: env.GOODREADS_RSS_KEY ?? null,

  CLAUDE_MODEL: env.CLAUDE_MODEL ?? 'claude-sonnet-5-5',
  CATEGORY_BATCH_SIZE: 50,

  /** Spine texture resolution, pixels per millimetre. */
  SPINE_PX_PER_MM: 4,
  /** The KTX2 encoder caps a slice at ~12 Mpix, so 3072² is the largest square that fits. */
  ATLAS_SIZE: 3072,
  /** 'etc1s' is ~5x smaller; 'uastc' is sharper. Both transcode to the GPU's native format. */
  ATLAS_CODEC: (env.ATLAS_CODEC ?? 'etc1s') as 'etc1s' | 'uastc',
  COVER_MAX_HEIGHT: 600,
  /** Height of the cover thumbnails in the face-out atlas, px. */
  COVER_ATLAS_HEIGHT: 320,
  /** Images smaller than this are treated as placeholders. */
  COVER_MIN_BYTES: 5000,

  HTTP_CONCURRENCY: 4,
  USER_AGENT: 'Bookshelf/1.0 (personal library visualisation)',
} as const;

export type Config = typeof config;
