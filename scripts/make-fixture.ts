// Builds fixtures/sample/: a ~40-book Goodreads-style CSV with real book ids, plus a
// hand-written taxonomy, so the pipeline and scene can be developed without a real export
// or an API key. Usage: npx tsx scripts/make-fixture.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Row = [title: string, author: string, binding: string, rating: number, dateRead: string, shelf: string, cat: string];
const R: Row[] = [
  ['Zero to One', 'Peter Thiel', 'Hardcover', 4, '2015/03/02', 'read', 'company-building'],
  ['The Hard Thing About Hard Things', 'Ben Horowitz', 'Hardcover', 5, '2014/08/11', 'read', 'company-building'],
  ['High Output Management', 'Andrew S. Grove', 'Paperback', 5, '2016/02/20', 'read', 'company-building'],
  ['The Lean Startup', 'Eric Ries', 'Hardcover', 3, '2012/01/15', 'read', 'company-building'],
  ['Crossing the Chasm', 'Geoffrey A. Moore', 'Paperback', 4, '2011/06/03', 'read', 'company-building'],
  ['The Innovator\'s Dilemma', 'Clayton M. Christensen', 'Paperback', 5, '2010/09/12', 'read', 'company-building'],
  ['Shoe Dog', 'Phil Knight', 'Hardcover', 5, '2017/07/30', 'read', 'lives-and-founders'],
  ['Steve Jobs', 'Walter Isaacson', 'Hardcover', 4, '2012/04/01', 'read', 'lives-and-founders'],
  ['Elon Musk', 'Ashlee Vance', 'Kindle Edition', 4, '2016/01/05', 'read', 'lives-and-founders'],
  ['The Everything Store', 'Brad Stone', 'Kindle Edition', 4, '2014/02/14', 'read', 'lives-and-founders'],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Hardcover', 5, '2013/05/22', 'read', 'mind-and-behaviour'],
  ['Atomic Habits', 'James Clear', 'Hardcover', 4, '2019/03/10', 'read', 'mind-and-behaviour'],
  ['Influence', 'Robert B. Cialdini', 'Paperback', 4, '2015/10/18', 'read', 'mind-and-behaviour'],
  ['Deep Work', 'Cal Newport', 'Hardcover', 3, '2017/02/11', 'read', 'mind-and-behaviour'],
  ['The Psychology of Money', 'Morgan Housel', 'Paperback', 5, '2021/04/02', 'read', 'money-and-markets'],
  ['The Intelligent Investor', 'Benjamin Graham', 'Paperback', 4, '2009/08/08', 'read', 'money-and-markets'],
  ['The Power Law', 'Sebastian Mallaby', 'Hardcover', 5, '2022/03/03', 'read', 'money-and-markets'],
  ['Flash Boys', 'Michael Lewis', 'Kindle Edition', 4, '2014/06/21', 'read', 'money-and-markets'],
  ['Sapiens', 'Yuval Noah Harari', 'Hardcover', 4, '2016/08/14', 'read', 'big-history'],
  ['Guns, Germs, and Steel', 'Jared Diamond', 'Paperback', 4, '2008/12/27', 'read', 'big-history'],
  ['The Rise and Fall of the Third Reich', 'William L. Shirer', 'Paperback', 5, '2011/12/30', 'read', 'big-history'],
  ['SPQR', 'Mary Beard', 'Hardcover', 4, '2018/01/19', 'read', 'big-history'],
  ['The Code Breaker', 'Walter Isaacson', 'Hardcover', 4, '2021/09/09', 'read', 'science-and-future'],
  ['The Gene', 'Siddhartha Mukherjee', 'Hardcover', 5, '2017/11/04', 'read', 'science-and-future'],
  ['Superintelligence', 'Nick Bostrom', 'Hardcover', 3, '2015/05/05', 'read', 'science-and-future'],
  ['The Beginning of Infinity', 'David Deutsch', 'Paperback', 5, '2019/10/12', 'read', 'science-and-future'],
  ['Project Hail Mary', 'Andy Weir', 'Hardcover', 5, '2021/07/07', 'read', 'fiction'],
  ['The Three-Body Problem', 'Liu Cixin', 'Paperback', 4, '2017/04/23', 'read', 'fiction'],
  ['Klara and the Sun', 'Kazuo Ishiguro', 'Hardcover', 4, '2021/05/01', 'read', 'fiction'],
  ['Der Process', 'Franz Kafka', 'Mass Market Paperback', 4, '2005/02/02', 'read', 'fiction'],
  ['Die Verwandlung', 'Franz Kafka', 'Paperback', 3, '2004/11/11', 'read', 'fiction'],
  ['Dune', 'Frank Herbert', 'Mass Market Paperback', 5, '2010/07/14', 'read', 'fiction'],
  ['The Remains of the Day', 'Kazuo Ishiguro', 'Paperback', 5, '2013/09/09', 'read', 'fiction'],
  ['Infinite Jest', 'David Foster Wallace', 'Paperback', 3, '2012/12/12', 'read', 'fiction'],
  ['Working Backwards', 'Colin Bryar', 'Hardcover', 0, '', 'currently-reading', 'company-building'],
  ['The Lord of the Rings', 'J.R.R. Tolkien', 'Hardcover', 0, '', 'to-read', 'fiction'],
  ['Chip War', 'Chris Miller', 'Hardcover', 0, '', 'to-read', 'science-and-future'],
  ['The Making of the Atomic Bomb', 'Richard Rhodes', 'Paperback', 0, '', 'to-read', 'big-history'],
  ['Poor Charlie\'s Almanack', 'Charlie Munger', 'Hardcover', 0, '', 'to-read', 'money-and-markets'],
  ['Antifragile', 'Nassim Nicholas Taleb', 'Paperback', 0, '', 'to-read', 'mind-and-behaviour'],
  ['Stubborn Attachments', 'Tyler Cowen', 'Hardcover', 0, '', 'to-read', 'money-and-markets'],
];

// Goodreads search sits behind a bot challenge, so resolve ids via Open Library, which stores them.
let nextSynthetic = 1;
async function resolveId(title: string, author: string): Promise<{ id: string; isbn: string | null }> {
  const q = new URLSearchParams({ title, author, fields: 'id_goodreads,isbn,edition_count', limit: '10' });
  const res = await fetch(`https://openlibrary.org/search.json?${q}`, { headers: { 'User-Agent': 'Bookshelf fixture builder' } });
  const json = (await res.json()) as { docs: { id_goodreads?: string[]; isbn?: string[] }[] };
  const doc = json.docs.find((d) => d.id_goodreads?.length);
  const isbn = (doc ?? json.docs[0])?.isbn?.find((i) => i.length === 13 && i.startsWith('978')) ?? null;
  // Fixture only: a synthetic id when Open Library has no Goodreads id on record.
  return { id: doc?.id_goodreads?.[0] ?? String(900000000 + nextSynthetic++), isbn };
}

const HEADER = 'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lines = [HEADER];
const assignments: Record<string, { primary: string; secondary: null }> = {};
let added = 2015;
for (const [i, [title, author, binding, rating, dateRead, shelf, cat]] of R.entries()) {
  const { id, isbn } = await resolveId(title, author);
  assignments[id] = { primary: cat, secondary: null };
  const dateAdded = dateRead || `2025/${String((i % 12) + 1).padStart(2, '0')}/${String((i % 27) + 1).padStart(2, '0')}`;
  lines.push([id, q(title), q(author), q(author), '', '=""', isbn ? `="${isbn}"` : '=""', rating, '4.1', '', binding, '', '', '', dateRead, dateAdded, '', '', shelf, rating >= 5 ? q('Loved it. <br/>Would reread.') : '', '', '', shelf === 'read' ? 1 : 0, 0].join(','));
  process.stdout.write(`${id} ${title}\n`);
  added++;
}
const dir = path.resolve(import.meta.dirname, '../fixtures/sample');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'goodreads_library_export.csv'), lines.join('\n') + '\n');
await writeFile(path.join(dir, 'assignments.json'), JSON.stringify(assignments, null, 2) + '\n');
await writeFile(
  path.join(dir, 'categories.json'),
  JSON.stringify(
    [
      ['company-building', 'Company Building', 'Startups, management and the craft of building companies.'],
      ['lives-and-founders', 'Lives & Founders', 'Biographies and memoirs of people who built things.'],
      ['mind-and-behaviour', 'Mind & Behaviour', 'Psychology, decision-making and habits.'],
      ['money-and-markets', 'Money & Markets', 'Investing, finance and venture capital.'],
      ['big-history', 'Big History', 'Civilisations, empires and the long arc of the past.'],
      ['science-and-future', 'Science & Future', 'Biology, AI, physics and where it is all going.'],
      ['fiction', 'Fiction', 'Novels, from Kafka to hard science fiction.'],
    ].map(([slug, name, description]) => ({ slug, name, description })),
    null,
    2,
  ) + '\n',
);
