// Playwright screenshots of the key states. Usage: npx tsx scripts/screenshots.ts [baseUrl] [outDir]
// Needs the dev server (it uses a dev-only hook to find books on screen).
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Library } from '../src/types.ts';

const base = process.argv[2] ?? 'http://localhost:5317';
const out = path.resolve(process.argv[3] ?? 'screenshots');
const only = process.env.SHOTS?.split(',');

const library = JSON.parse(await readFile('public/data/books.json', 'utf8')) as Library;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const logs: string[] = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await mkdir(out, { recursive: true });

const wait = (ms: number) => page.waitForTimeout(ms);
async function shot(name: string) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  ${name}`);
}
async function load(hash = '') {
  await page.goto(`${base}/${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('.app.ready', { timeout: 30000 });
  await wait(3200);
}
async function bookPos(id: string): Promise<{ x: number; y: number }> {
  const p = await page.evaluate((bid) => (globalThis as unknown as { __bookPos: (i: string) => { x: number; y: number } | null }).__bookPos(bid), id);
  if (!p) throw new Error(`book ${id} not placed`);
  return p;
}
const want = (name: string) => !only || only.some((o) => name.startsWith(o));

// A well-known read book in the second category, for hover/pull-out/open.
const sample = library.books.find((b) => b.shelf === 'read' && b.rating >= 4 && b.category === library.categories[1]!.slug && !b.favourite)!;

if (want('01')) {
  await load();
  await shot('01-overview');
}
if (want('02')) {
  await load();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await wait(1800);
  await shot('02-dolly');
}
if (want('03') || want('04') || want('05') || want('06')) {
  await load(`#category/${library.categories[1]!.slug}`);
  await wait(1500);
  if (want('03')) await shot('03-bay');
  const id = await page.evaluate(() => (globalThis as unknown as { __centreBook: () => string | null }).__centreBook());
  const p = await bookPos(id ?? sample.id);
  await page.mouse.move(p.x, p.y);
  await wait(900);
  if (want('04')) await shot('04-hover');
  await page.mouse.click(p.x, p.y);
  await wait(1600);
  if (want('05')) await shot('05-pulled-out');
  await page.click('.focus-panel .pill');
  await wait(1600);
  if (want('06')) await shot('06-open');
}
if (want('07')) {
  await load();
  await page.click('.chip:has-text("Want to read")');
  await wait(1800);
  await shot('07-side-table');
}
if (want('08')) {
  await load('?view=covers');
  await shot('08-covers');
  await load(`?view=covers#category/${library.categories[1]!.slug}`);
  await wait(1500);
  await shot('08-covers-close');
}
if (want('09')) {
  await load();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await wait(1800);
  await shot('09-close-up');
}
if (want('10')) {
  // Zoom right in on the bottom-left corner with the trackpad pinch (ctrl+wheel), then pull a book out:
  // it must come clear of the shelf and be held in front of everything.
  await load();
  const box = (await page.locator('canvas').boundingBox())!;
  const bl = await page.evaluate(() => {
    const g = globalThis as unknown as { __layoutCorner?: () => { x: number; y: number } };
    return g.__layoutCorner?.() ?? null;
  });
  const at = bl ?? { x: box.x + box.width * 0.42, y: box.y + box.height * 0.86 };
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -40);
    await page.keyboard.up('Control');
    await wait(40);
  }
  await wait(1800);
  await shot('10-zoom-corner');
  await page.mouse.wheel(0, 300);
  await wait(1500);
  await shot('10-scroll-down');
  await page.mouse.wheel(0, -700);
  await wait(1500);
  await shot('10-scroll-up');
  const id = await page.evaluate(() => (globalThis as unknown as { __centreBook: () => string | null }).__centreBook());
  if (id) {
    const p = await bookPos(id);
    await page.mouse.move(p.x, p.y);
    await wait(900);
    await shot('10-hover-close');
    await page.mouse.click(p.x, p.y);
    await wait(500);
    await shot('10-pulling');
    await wait(1400);
    await shot('10-pulled-close');
  }
}
if (want('11')) {
  // The right end of the covers view, and a hovered cover lifting over the lip.
  await load('?view=covers');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await wait(2500);
  await shot('11-covers-end');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await wait(1800);
  const id = await page.evaluate(() => (globalThis as unknown as { __centreBook: () => string | null }).__centreBook());
  if (id) {
    const p = await bookPos(id);
    await page.mouse.move(p.x, p.y);
    await wait(900);
    await shot('11-covers-hover');
  }
}

await browser.close();
const relevant = logs.filter((l) => !l.includes('[vite]') && !l.includes('React DevTools') && !l.includes('GSUB'));
if (relevant.length) console.log(relevant.join('\n'));
console.log(`Screenshots in ${out}`);
