import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';
import { CACHE_DIR, PUBLIC_DIR } from './cache.ts';
import { config } from './config.ts';
import { drawSpine, type SpineInput } from './spines.ts';
import type { AtlasSheet, SpineAtlasRef } from '../src/types.ts';

const PAD = 4;
const MAX_SHEETS = 8;

interface Placement {
  id: string;
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf packing: spines are tall and thin, so rows of similar height pack almost perfectly. */
export function packSpines(
  items: { id: string; w: number; h: number }[],
  size: number,
): { placements: Placement[]; sheets: { width: number; height: number }[] } {
  const sorted = [...items].sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
  const placements: Placement[] = [];
  const used: number[] = [0];
  let sheet = 0;
  let x = 0;
  let rowY = 0;
  let rowH = 0;
  for (const it of sorted) {
    const w = it.w + PAD;
    const h = it.h + PAD;
    if (x + w > size) {
      rowY += rowH;
      x = 0;
      rowH = 0;
    }
    if (rowY + h > size) {
      sheet++;
      used.push(0);
      rowY = 0;
      x = 0;
      rowH = 0;
    }
    placements.push({ id: it.id, sheet, x: x + PAD / 2, y: rowY + PAD / 2, w: it.w, h: it.h });
    x += w;
    rowH = Math.max(rowH, h);
    used[sheet] = Math.max(used[sheet]!, rowY + rowH);
  }
  // Trim the height of each sheet to what's used, rounded up to a multiple of 4 for block compression.
  const sheets = used.map((u) => ({ width: size, height: Math.min(size, Math.ceil(u / 4) * 4) }));
  return { placements, sheets };
}

/**
 * Encode one sheet to KTX2 (Basis), skipping the work when the pixels haven't changed. The file name
 * carries a hash of the pixels, so browsers never pair a cached sheet with a newer books.json.
 */
async function encodeSheet(png: Buffer, name: string): Promise<string> {
  const outDir = path.join(PUBLIC_DIR, 'atlas');
  await mkdir(outDir, { recursive: true });
  const hash = createHash('sha1').update(png).update(config.ATLAS_CODEC).digest('hex').slice(0, 10);
  const fileName = `${name}.${hash}.ktx2`;
  // ATLAS_PNG=1 keeps a PNG of each sheet in the cache, to audit the atlas against books.json.
  if (process.env.ATLAS_PNG) {
    await mkdir(path.join(CACHE_DIR, 'atlas-png'), { recursive: true });
    await writeFile(path.join(CACHE_DIR, 'atlas-png', `${name}.png`), png);
  }
  const file = path.join(outDir, fileName);
  if (existsSync(file)) {
    console.log(`  ${name}: unchanged`);
    return `/atlas/${fileName}`;
  }
  process.stdout.write(`  encoding ${name} to KTX2… `);
  const codec =
    config.ATLAS_CODEC === 'uastc'
      ? { isUASTC: true, enableRDO: true, rdoQualityLevel: 1.5, needSupercompression: true }
      : { isUASTC: false, qualityLevel: 255, compressionLevel: 2 };
  // The encoder prints per-slice diagnostics; keep the pipeline output readable.
  const log = console.log;
  console.log = () => undefined;
  let ktx2: Uint8Array;
  try {
    ktx2 = await encodeToKTX2(new Uint8Array(png), {
      ...codec,
      generateMipmap: true,
      isPerceptual: true,
      enableDebug: false,
      imageDecoder: async (buffer: Uint8Array) => {
        const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { data: new Uint8Array(data), width: info.width, height: info.height };
      },
    });
  } finally {
    console.log = log;
  }
  await writeFile(file, ktx2);
  console.log(`${(ktx2.byteLength / 1024 / 1024).toFixed(1)} MB`);
  return `/atlas/${fileName}`;
}

/** Remove sheets from earlier runs that this run didn't produce. */
export async function pruneAtlas(keep: string[]): Promise<void> {
  const outDir = path.join(PUBLIC_DIR, 'atlas');
  if (!existsSync(outDir)) return;
  const names = new Set(keep.map((u) => path.basename(u)));
  for (const f of await readdir(outDir)) if (!names.has(f)) await rm(path.join(outDir, f));
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const uvOf = (p: Placement, width: number, height: number): SpineAtlasRef['uv'] => [
  round6(p.x / width),
  round6(p.y / height),
  round6(p.w / width),
  round6(p.h / height),
];

export async function buildAtlas(spines: SpineInput[]): Promise<{
  refs: Map<string, SpineAtlasRef>;
  sheets: AtlasSheet[];
  pxPerMm: number;
}> {
  const size = config.ATLAS_SIZE;
  let pxPerMm = config.SPINE_PX_PER_MM;
  let packed = packSpines(
    spines.map((s) => ({ id: s.id, w: Math.round(s.dims.t * pxPerMm), h: Math.round(s.dims.h * pxPerMm) })),
    size,
  );
  while (packed.sheets.length > MAX_SHEETS && pxPerMm > 1.5) {
    pxPerMm -= 0.25;
    packed = packSpines(
      spines.map((s) => ({ id: s.id, w: Math.round(s.dims.t * pxPerMm), h: Math.round(s.dims.h * pxPerMm) })),
      size,
    );
  }

  const byId = new Map(spines.map((s) => [s.id, s]));
  const refs = new Map<string, SpineAtlasRef>();
  const sheets: AtlasSheet[] = [];
  for (let i = 0; i < packed.sheets.length; i++) {
    const { width, height } = packed.sheets[i]!;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, width, height);
    for (const p of packed.placements.filter((pl) => pl.sheet === i)) {
      drawSpine(ctx, byId.get(p.id)!, p.x, p.y, p.w, p.h);
      refs.set(p.id, { sheet: i, uv: uvOf(p, width, height) });
    }
    const url = await encodeSheet(canvas.toBuffer('image/png'), `spines-${i}`);
    sheets.push({ url, width, height });
  }
  return { refs, sheets, pxPerMm };
}

/** Cover thumbnails for the face-out view, packed into sheets like the spines. */
export async function buildCoverAtlas(covers: { id: string; file: string }[]): Promise<{
  refs: Map<string, SpineAtlasRef>;
  sheets: AtlasSheet[];
}> {
  const size = config.ATLAS_SIZE;
  const H = config.COVER_ATLAS_HEIGHT;
  const thumbs = await Promise.all(
    covers.map(async (c) => {
      const { data, info } = await sharp(c.file).resize({ height: H }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { id: c.id, data, w: info.width, h: info.height };
    }),
  );
  const packed = packSpines(thumbs, size);
  const byId = new Map(thumbs.map((t) => [t.id, t]));
  const refs = new Map<string, SpineAtlasRef>();
  const sheets: AtlasSheet[] = [];
  for (let i = 0; i < packed.sheets.length; i++) {
    const { width, height } = packed.sheets[i]!;
    const mine = packed.placements.filter((pl) => pl.sheet === i);
    const png = await sharp({ create: { width, height, channels: 4, background: '#808080' } })
      .composite(
        mine.map((p) => {
          const t = byId.get(p.id)!;
          return { input: t.data, raw: { width: t.w, height: t.h, channels: 4 as const }, left: p.x, top: p.y };
        }),
      )
      .png()
      .toBuffer();
    for (const p of mine) refs.set(p.id, { sheet: i, uv: uvOf(p, width, height) });
    const url = await encodeSheet(png, `covers-${i}`);
    sheets.push({ url, width, height });
  }
  return { refs, sheets };
}
