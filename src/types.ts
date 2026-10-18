// Shared schema between the build-time pipeline and the client.

export type ExclusiveShelf = 'read' | 'currently-reading' | 'to-read';

export type BindingClass = 'hardcover' | 'paperback' | 'massMarket' | 'ebook' | 'unknown';

/** Millimetres. h = height, w = front-to-back depth on the shelf, t = spine thickness. */
export interface Dims {
  h: number;
  w: number;
  t: number;
}

export interface Palette {
  /** Dominant colour, used for the spine background and boards. */
  dominant: string;
  /** Accent colour, used for spine bands and type. */
  accent: string;
  /** Readable text colour on top of `dominant`. */
  text: string;
}

export interface SpineAtlasRef {
  sheet: number;
  /** Normalised [u, v, width, height], v measured from the top of the sheet. */
  uv: [number, number, number, number];
}

export interface BookLinks {
  goodreads: string;
  amazon: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  shelf: ExclusiveShelf;
  favourite: boolean;
  /** 0 = unrated. */
  rating: number;
  avgRating: number;
  /** ISO date (YYYY-MM-DD) or null. */
  dateRead: string | null;
  dateAdded: string | null;
  year: number | null;
  publisher: string | null;
  pages: number;
  pagesEstimated: boolean;
  binding: BindingClass;
  dims: Dims;
  palette: Palette;
  category: string;
  secondaryCategory: string | null;
  coverUrl: string;
  /** URL of a tiny blurred placeholder image. */
  coverPlaceholder: string;
  coverAspect: number;
  spineAtlas: SpineAtlasRef;
  /** Cover thumbnail in the face-out atlas. */
  coverAtlas: SpineAtlasRef;
  links: BookLinks;
  /** Only present when SHOW_REVIEWS is enabled at build time. */
  review?: string;
}

export interface Category {
  slug: string;
  name: string;
  description: string;
}

export interface AtlasSheet {
  url: string;
  width: number;
  height: number;
}

export interface Library {
  generatedAt: string;
  categories: Category[];
  atlas: AtlasSheet[];
  coverAtlas: AtlasSheet[];
  books: Book[];
}
