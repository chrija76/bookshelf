import { describe, expect, it } from 'vitest';
import { config } from '../pipeline/config.ts';
import { bookDims, classifyBinding } from '../pipeline/dims.ts';

describe('classifyBinding', () => {
  it.each([
    ['Hardcover', 'hardcover'],
    ['Paperback', 'paperback'],
    ['Trade Paperback', 'paperback'],
    ['Mass Market Paperback', 'massMarket'],
    ['Kindle Edition', 'ebook'],
    ['ebook', 'ebook'],
    [null, 'unknown'],
    ['Spiral-bound', 'unknown'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(classifyBinding(input)).toBe(expected);
  });
});

describe('bookDims', () => {
  it('thickness = pages * 0.06 + board', () => {
    expect(bookDims('a', 400, 'hardcover', 0.66).t).toBeCloseTo(400 * 0.06 + 5);
    expect(bookDims('a', 400, 'paperback', 0.66).t).toBeCloseTo(400 * 0.06 + 1);
    expect(bookDims('a', 400, 'ebook', 0.66).t).toBeCloseTo(400 * 0.06 + 3);
  });

  it('clamps thickness to 7-70 mm', () => {
    expect(bookDims('a', 20, 'paperback', 0.66).t).toBe(7);
    expect(bookDims('a', 3000, 'hardcover', 0.66).t).toBe(70);
  });

  it('uses the page thickness constant from config', () => {
    const cfg = { ...config, PAGE_THICKNESS_MM: 0.1 };
    expect(bookDims('a', 300, 'paperback', 0.66, cfg).t).toBeCloseTo(31);
  });

  it('height by binding', () => {
    expect(bookDims('a', 300, 'hardcover', 0.66).h).toBe(235);
    expect(bookDims('a', 300, 'paperback', 0.66).h).toBe(215);
    expect(bookDims('a', 300, 'massMarket', 0.66).h).toBe(175);
  });

  it('random height for ebooks is in range and deterministic per book id', () => {
    const heights = Array.from({ length: 50 }, (_, i) => bookDims(`id${i}`, 300, 'ebook', 0.66).h);
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(215);
      expect(h).toBeLessThanOrEqual(240);
    }
    expect(new Set(heights).size).toBeGreaterThan(5);
    expect(bookDims('stable', 300, 'unknown', 0.66).h).toBe(bookDims('stable', 300, 'unknown', 0.66).h);
  });

  it('depth = height * aspect, clamped 120-170', () => {
    expect(bookDims('a', 300, 'paperback', 0.66).w).toBeCloseTo(215 * 0.66, 0);
    expect(bookDims('a', 300, 'hardcover', 0.3).w).toBe(120);
    expect(bookDims('a', 300, 'hardcover', 1.2).w).toBe(170);
  });
});
