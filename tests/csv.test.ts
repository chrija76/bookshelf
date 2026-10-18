import { describe, expect, it } from 'vitest';
import { parseDate, parseGoodreadsCsv, stripExcelWrap } from '../pipeline/csv.ts';

const HEADER =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';

describe('stripExcelWrap', () => {
  it('removes the ="..." wrapper', () => {
    expect(stripExcelWrap('="0735211299"')).toBe('0735211299');
    expect(stripExcelWrap('="9780735211292"')).toBe('9780735211292');
  });
  it('returns null for empty wrappers', () => {
    expect(stripExcelWrap('=""')).toBeNull();
    expect(stripExcelWrap('')).toBeNull();
    expect(stripExcelWrap(undefined)).toBeNull();
  });
});

describe('parseDate', () => {
  it('normalises Goodreads dates to ISO', () => {
    expect(parseDate('2023/5/4')).toBe('2023-05-04');
    expect(parseDate('2021/12/31')).toBe('2021-12-31');
    expect(parseDate('')).toBeNull();
    expect(parseDate('garbage')).toBeNull();
  });
});

describe('parseGoodreadsCsv', () => {
  const csv = [
    HEADER,
    '40121378,"Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones",James Clear,"Clear, James",,="0735211299",="9780735211292",5,4.37,Avery,Hardcover,320,2018,2018,2023/05/14,2023/01/02,"business, favourites","business (#3)",read,"Great <br/>book, ""really""",,,1,0',
    '1,"Untitled, with comma",Jane Doe,"Doe, Jane","A. Writer, B. Writer",="",="",0,3.9,,Kindle Edition,,,,,2024/02/01,,,to-read,,,,0,0',
    '2,No shelf given,Someone,,,="",="",3,4.0,,Paperback,200,2001,1999,,2020/1/1,,,weird-shelf,,,,0,0',
    ',Missing id,Nobody,,,,,0,0,,,,,,,,,,read,,,,0,0',
  ].join('\n');
  const books = parseGoodreadsCsv(csv);

  it('skips rows without a book id', () => {
    expect(books.map((b) => b.bookId)).toEqual(['40121378', '1', '2']);
  });

  it('parses identifiers, numbers and dates', () => {
    const b = books[0]!;
    expect(b.title).toBe('Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones');
    expect(b.isbn).toBe('0735211299');
    expect(b.isbn13).toBe('9780735211292');
    expect(b.myRating).toBe(5);
    expect(b.avgRating).toBeCloseTo(4.37);
    expect(b.pages).toBe(320);
    expect(b.binding).toBe('Hardcover');
    expect(b.dateRead).toBe('2023-05-14');
    expect(b.dateAdded).toBe('2023-01-02');
    expect(b.bookshelves).toEqual(['business', 'favourites']);
    expect(b.shelf).toBe('read');
    expect(b.review).toBe('Great <br/>book, "really"');
  });

  it('handles empty fields and additional authors', () => {
    const b = books[1]!;
    expect(b.title).toBe('Untitled, with comma');
    expect(b.additionalAuthors).toEqual(['A. Writer', 'B. Writer']);
    expect(b.isbn).toBeNull();
    expect(b.pages).toBeNull();
    expect(b.yearPublished).toBeNull();
    expect(b.dateRead).toBeNull();
    expect(b.shelf).toBe('to-read');
    expect(b.review).toBeNull();
  });

  it('falls back to read for unknown exclusive shelves and keeps original year', () => {
    expect(books[2]!.shelf).toBe('read');
    expect(books[2]!.originalYear).toBe(1999);
    expect(books[2]!.dateAdded).toBe('2020-01-01');
  });
});
