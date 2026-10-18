import { describe, expect, it } from 'vitest';
import { compX, computeLayout, groupSeries } from '../src/scene/layout.ts';
import type { Book, Category } from '../src/types.ts';

let next = 1;
function book(over: Partial<Book> = {}): Book {
  const id = String(next++);
  return {
    id,
    title: `Book ${id}`,
    author: 'A. Author',
    shelf: 'read',
    favourite: false,
    rating: 4,
    avgRating: 4,
    dateRead: `2020-01-${String((next % 28) + 1).padStart(2, '0')}`,
    dateAdded: null,
    year: 2000,
    publisher: null,
    pages: 300,
    pagesEstimated: false,
    binding: 'paperback',
    dims: { h: 215, w: 140, t: 24 },
    palette: { dominant: '#335577', accent: '#eeeeee', text: '#ffffff' },
    category: 'a',
    secondaryCategory: null,
    coverUrl: '',
    coverPlaceholder: '',
    coverAspect: 0.65,
    spineAtlas: { sheet: 0, uv: [0, 0, 0.01, 0.1] },
    coverAtlas: { sheet: 0, uv: [0, 0, 0.05, 0.1] },
    links: { goodreads: '', amazon: '' },
    ...over,
  };
}

describe('groupSeries', () => {
  it('keeps annual anthologies together in year order, whoever edited them', () => {
    const books = [
      book({ title: 'The Best American Science and Nature Writing 2014: Riveting Essays', author: 'Deborah Blum' }),
      book({ title: 'Something Else' }),
      book({ title: 'The Best American Science and Nature Writing 2002', author: 'Natalie Angier' }),
      book({ title: 'The Best American Science and Nature Writing 2006', author: 'Brian Greene' }),
    ];
    expect(groupSeries(books).map((b) => b.title.slice(0, 50))).toEqual([
      'The Best American Science and Nature Writing 2002',
      'The Best American Science and Nature Writing 2006',
      'The Best American Science and Nature Writing 2014:',
      'Something Else',
    ]);
  });

  it('orders a numbered series by volume', () => {
    const books = [
      book({ title: 'The Rosie Result (Don Tillman, #3)' }),
      book({ title: 'Other' }),
      book({ title: 'The Rosie Project (Don Tillman, #1)' }),
      book({ title: 'The Rosie Effect (Don Tillman, #2)' }),
    ];
    expect(groupSeries(books).map((b) => b.title)).toEqual([
      'The Rosie Project (Don Tillman, #1)',
      'The Rosie Effect (Don Tillman, #2)',
      'The Rosie Result (Don Tillman, #3)',
      'Other',
    ]);
  });

  it('leaves short shared titles by different authors apart', () => {
    const a = book({ title: 'Nexus', author: 'Yuval Noah Harari' });
    const b = book({ title: 'Other' });
    const c = book({ title: 'Nexus', author: 'Mark Buchanan' });
    expect(groupSeries([a, b, c])).toEqual([a, b, c]);
  });
});

describe('computeLayout', () => {
  const categories: Category[] = ['a', 'b', 'c'].map((slug) => ({ slug, name: slug.toUpperCase(), description: '' }));
  // Uneven category sizes and some very wide books, so compartments can't all be filled evenly.
  const books = [
    ...Array.from({ length: 140 }, () => book({ category: 'a' })),
    ...Array.from({ length: 25 }, () => book({ category: 'b', dims: { h: 235, w: 165, t: 48 } })),
    ...Array.from({ length: 90 }, () => book({ category: 'c' })),
  ];

  it.each(['spines', 'covers'] as const)('never puts a book outside its compartment (%s)', (view) => {
    const layout = computeLayout(books, categories, 'dateRead', view);
    const c = layout.bookcase;
    for (const p of layout.placements.filter((pl) => pl.row)) {
      const col = Number(p.row!.split(':')[0]);
      const half = p.kind === 'shelf' ? p.book.dims.t / 2 : p.book.dims.w / 2;
      expect(p.position[0] - half).toBeGreaterThanOrEqual(compX(c, col) - 0.5);
      expect(p.position[0] + half).toBeLessThanOrEqual(compX(c, col) + c.compW + 0.5);
    }
  });

  it.each(['spines', 'covers'] as const)('gives each category its own compartments, filled down each column (%s)', (view) => {
    const layout = computeLayout(books, categories, 'dateRead', view);
    const rows = layout.bookcase.rows;
    const byComp = new Map<number, Set<string>>();
    for (const p of layout.placements.filter((pl) => pl.kind !== 'table' && pl.kind !== 'reading')) {
      const comp = p.bay;
      if (!byComp.has(comp)) byComp.set(comp, new Set());
      byComp.get(comp)!.add(p.book.category);
    }
    for (const cats of byComp.values()) expect(cats.size).toBe(1);
    // Compartment order is column-major, and categories follow the category order through it.
    const order = [...byComp.keys()].sort((a, b) => a - b).map((c) => [...byComp.get(c)!][0]!);
    expect([...new Set(order)]).toEqual(['a', 'b', 'c']);
    const first = layout.placements.find((p) => p.bay === 1)!;
    expect(first.row).toBe(`0:1`); // the second compartment is below the first, not beside it
    expect(rows).toBeGreaterThan(1);
  });

  it('labels every category on every shelf it occupies, with one start label each', () => {
    const layout = computeLayout(books, categories, 'dateRead', 'spines');
    for (const cat of categories) expect(layout.labels.filter((l) => l.slug === cat.slug && l.start)).toHaveLength(1);
    // Every shelf whose first book continues a category from the previous shelf names it too.
    const shelves = new Set(layout.placements.filter((p) => p.row).map((p) => p.row));
    const labelledShelves = new Set(layout.labels.map((l) => `${l.position[1]}`));
    expect(labelledShelves.size).toBe(new Set([...shelves].map((r) => r!.split(':')[1])).size);
    expect(layout.labels.length).toBeGreaterThanOrEqual(shelves.size);
  });
});
