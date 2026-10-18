// Hovers every shelf book in each view and checks the tooltip names it. Usage: npx tsx scripts/hover-audit.ts [baseUrl] [outDir]
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Library } from '../src/types.ts';

const base = process.argv[2] ?? 'http://localhost:5317';
const out = path.resolve(process.argv[3] ?? 'screenshots');
await mkdir(out, { recursive: true });
const library = JSON.parse(await readFile('public/data/books.json', 'utf8')) as Library;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
const wait = (ms: number) => page.waitForTimeout(ms);
const clean = (t: string) => t.replace(/\s*\(.*?\)\s*$/, '');
let checked = 0;
const wrong: string[] = [];
const seen = new Set<string>();
for (const view of ['spines', 'covers'] as const) {
  await page.goto(`${base}/?view=${view}`, { waitUntil: 'load' });
  await page.waitForSelector('.app.ready', { timeout: 30000 });
  await wait(3000);
  await page.screenshot({ path: path.join(out, `audit-${view}-overview.png`) });
  for (const cat of library.categories) {
    await page.evaluate((s) => ((globalThis as any).location.hash = `#category/${s}`), cat.slug);
    await wait(2200);
    if (view === 'spines' && (cat.slug === 'ethics-and-ideas' || cat.slug === 'ai-and-future'))
      await page.screenshot({ path: path.join(out, `audit-${view}-${cat.slug}.png`) });
    const books = library.books.filter((b) => b.shelf === 'read' && b.category === cat.slug);
    for (const b of books) {
      const p = await page.evaluate((id) => (globalThis as any).__bookPos(id), b.id);
      if (!p || p.x < 20 || p.y < 60 || p.x > 1490 || p.y > 880) continue;
      // Let the previous book settle back first: while it is still tilted out it can cover this one.
      await page.mouse.move(5, 5);
      await wait(350);
      await page.mouse.move(p.x, p.y);
      await wait(150);
      const tt = await page.evaluate(() => (globalThis as any).document.querySelector('.tooltip.visible .tt-title')?.textContent ?? null);
      checked++;
      seen.add(`${view}:${b.id}`);
      if (tt !== clean(b.title)) wrong.push(`${view} ${b.id} expected "${clean(b.title)}" got "${tt}"`);
    }
    await page.mouse.move(5, 5);
  }
  // Books the category views didn't show: bring each to the middle of the screen and check it there.
  for (const b of library.books.filter((x) => x.shelf === 'read' && !seen.has(`${view}:${x.id}`))) {
    await page.evaluate((id) => (globalThis as any).__lookAt(id), b.id);
    await wait(1400);
    const p = await page.evaluate((id) => (globalThis as any).__bookPos(id), b.id);
    await page.mouse.move(p.x, p.y);
    await wait(250);
    const tt = await page.evaluate(() => (globalThis as any).document.querySelector('.tooltip.visible .tt-title')?.textContent ?? null);
    checked++;
    seen.add(`${view}:${b.id}`);
    if (tt !== clean(b.title)) wrong.push(`${view} ${b.id} expected "${clean(b.title)}" got "${tt}" (centred)`);
    await page.mouse.move(5, 5);
    await wait(300);
  }
}
console.log(`checked ${checked} hovers (${seen.size} book/view pairs), ${wrong.length} wrong`);
for (const w of wrong) console.log('  ' + w);
await browser.close();
