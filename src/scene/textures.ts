// Procedural canvas textures for the room. Generated once on load; all seeded, so stable between visits.
import * as THREE from 'three';
import { rng } from '../lib/random.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number] } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(...opts.repeat);
  t.anisotropy = 8;
  return t;
}

/** Long wavy grain lines, drawn along x. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, density: number, dark: string) {
  const r = rng(seed);
  for (let i = 0; i < density; i++) {
    const y0 = r() * h;
    const amp = 1 + r() * 4;
    const freq = 0.002 + r() * 0.006;
    const phase = r() * 10;
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.04 + r() * 0.1;
    ctx.lineWidth = 0.5 + r() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Light white-oiled oak, grain along u. */
export function oakTexture(seed = 'oak'): THREE.CanvasTexture {
  const [c, ctx] = canvas(2048, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#e2cba6');
  g.addColorStop(0.5, '#e8d4b2');
  g.addColorStop(1, '#ddc49c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 256);
  grain(ctx, 2048, 256, seed, 220, '#8a6a42');
  // A few medullary flecks, typical of quarter-sawn oak.
  const r = rng(`${seed}:fleck`);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,246,228,${0.12 + r() * 0.15})`;
    ctx.fillRect(r() * 2048, r() * 256, 6 + r() * 26, 1 + r() * 2);
  }
  return finish(c);
}

/** Oak floor: 180 mm planks of varying tone. One texture tile = 1440 × 1440 mm. */
export function floorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(2048, 2048);
  const r = rng('floor');
  const planks = 8;
  const ph = 2048 / planks;
  for (let p = 0; p < planks; p++) {
    let x = -r() * 1200;
    while (x < 2048) {
      const len = 900 + r() * 1300;
      const tone = 0.9 + r() * 0.16;
      ctx.fillStyle = `rgb(${Math.round(206 * tone)},${Math.round(182 * tone)},${Math.round(150 * tone)})`;
      ctx.fillRect(x, p * ph, len, ph);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, p * ph, len, ph);
      ctx.clip();
      ctx.translate(x, p * ph);
      grain(ctx, len, ph, `floor:${p}:${x}`, 26, '#6e5233');
      ctx.restore();
      ctx.fillStyle = 'rgba(70,50,30,0.35)';
      ctx.fillRect(x, p * ph, 2, ph);
      x += len;
    }
    ctx.fillStyle = 'rgba(70,50,30,0.32)';
    ctx.fillRect(0, p * ph, 2048, 2);
  }
  return finish(c);
}

/** Warm off-white plaster: very low-contrast mottling, so the wall isn't a flat colour. */
export function plasterTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  ctx.fillStyle = '#f5f2ed';
  ctx.fillRect(0, 0, 1024, 1024);
  const r = rng('plaster');
  for (let i = 0; i < 900; i++) {
    const x = r() * 1024;
    const y = r() * 1024;
    const rad = 6 + r() * 40;
    const light = r() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, light ? 'rgba(255,255,255,0.03)' : 'rgba(150,140,125,0.012)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    // Draw wrapped so the tile is seamless.
    for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) ctx.fillRect(x - rad + dx, y - rad + dy, rad * 2, rad * 2);
  }
  const img = ctx.getImageData(0, 0, 1024, 1024);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 4;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
}

/** Honed travertine: cream with soft horizontal veining and small pores. */
export function travertineTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  ctx.fillStyle = '#ece4d6';
  ctx.fillRect(0, 0, 1024, 512);
  const r = rng('travertine');
  for (let i = 0; i < 26; i++) {
    const y = r() * 512;
    const hgt = 10 + r() * 40;
    const g = ctx.createLinearGradient(0, y - hgt, 0, y + hgt);
    const col = r() < 0.6 ? '214,199,176' : '246,240,230';
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(0.5, `rgba(${col},${0.25 + r() * 0.3})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, y - hgt, 1024, hgt * 2);
  }
  // Characteristic travertine pores: small elongated voids along the bedding.
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(168,148,118,${0.18 + r() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(r() * 1024, r() * 512, 1 + r() * 7, 0.5 + r() * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** 606 track face: brushed aluminium with the central slotted channel, tiled vertically every 32 mm. */
export function trackTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 128);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#b9bcbe');
  g.addColorStop(0.18, '#d9dbdc');
  g.addColorStop(0.3, '#c9cbcc');
  g.addColorStop(0.7, '#c9cbcc');
  g.addColorStop(0.82, '#dcdedf');
  g.addColorStop(1, '#b4b7b9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#7d8083';
  ctx.fillRect(25, 0, 14, 128);
  ctx.fillStyle = '#2b2d2f';
  ctx.fillRect(27, 18, 10, 92);
  return finish(c);
}

/** Page-edge striping for the paper block. */
/**
 * The edge of a page block `mm` thick, across its whole thickness (u = 0..1 from board to board):
 * fine page lines, a slightly darker seam between signatures, and shading where the boards meet.
 */
export function paperEdgeTexture(mm: number): THREE.CanvasTexture {
  const W = 512;
  const [c, ctx] = canvas(W, 16);
  ctx.fillStyle = '#f1eadb';
  ctx.fillRect(0, 0, W, 16);
  const r = rng(`paper:${Math.round(mm)}`);
  const pages = Math.max(8, mm * 9); // roughly 0.1 mm per leaf
  const step = W / pages;
  for (let i = 0; i < pages; i++) {
    const x = i * step;
    const seam = i % 16 === 0;
    ctx.fillStyle = `rgba(110,92,64,${seam ? 0.16 + r() * 0.06 : 0.03 + r() * 0.07})`;
    ctx.fillRect(x, 0, Math.max(0.6, step * (seam ? 0.9 : 0.45)), 16);
  }
  // Soft shading towards the boards, where the light can't quite reach.
  for (const [x0, x1] of [[0, 0.08], [1, 0.92]] as const) {
    const g = ctx.createLinearGradient(x0 * W, 0, x1 * W, 0);
    g.addColorStop(0, 'rgba(70,58,40,0.28)');
    g.addColorStop(1, 'rgba(70,58,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 16);
  }
  const t = finish(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft rectangular shadow (white = shadow), for baked contact AO under shelves and objects. */
export function softShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const dx = Math.max(0, Math.abs(x - 127.5) / 128 - 0.5) / 0.5;
      const dy = Math.max(0, Math.abs(y - 127.5) / 128 - 0.5) / 0.5;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 2.2);
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Oiled American walnut, 2000 × 500 mm per tile, grain along u. Returns the colour map and a
 * matching height map (pores and grain lines sunk) for bump. Seeded, so boards can differ.
 */
export function walnutTextures(seed = 'walnut'): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 2048;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const [bc, bctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = '#5d3c27';
  ctx.fillRect(0, 0, W, H);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, W, H);

  // Broad colour streaks along the grain: chocolate to warm honey, with walnut's slight purple cast.
  const tones = ['62,38,24', '96,64,41', '120,82,52', '74,46,34', '140,98,62', '52,33,24'];
  for (let i = 0; i < 34; i++) {
    const y = r() * H;
    const hgt = 6 + r() * 60;
    const g = ctx.createLinearGradient(0, y - hgt, 0, y + hgt);
    const col = tones[Math.floor(r() * tones.length)]!;
    const a = 0.18 + r() * 0.32;
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(0.5, `rgba(${col},${a})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, y - hgt, W, hgt * 2);
  }

  // Grain lines. Some boards show cathedral figure: lines that bow into long arches.
  const arches = r() < 0.6;
  const archX = W * (0.25 + r() * 0.5);
  const lineCount = 520;
  for (let i = 0; i < lineCount; i++) {
    const y0 = r() * H;
    const amp = 0.6 + r() * 3.5;
    const f1 = 0.0015 + r() * 0.004;
    const ph = r() * 10;
    const bow = arches ? (r() * 0.5 + 0.2) * (y0 / H) * 140 : 0;
    const dark = r() < 0.8;
    const alpha = dark ? 0.05 + r() * 0.16 : 0.04 + r() * 0.07;
    const lw = 0.5 + r() * 1.4;
    ctx.strokeStyle = dark ? `rgba(36,20,12,${alpha})` : `rgba(190,140,92,${alpha})`;
    ctx.lineWidth = lw;
    bctx.strokeStyle = `rgba(0,0,0,${alpha * 1.2})`;
    bctx.lineWidth = lw;
    for (const k of [ctx, bctx]) {
      k.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const arch = bow * Math.exp(-Math.pow((x - archX) / (W * 0.28), 2));
        const y = y0 + Math.sin(x * f1 + ph) * amp + Math.sin(x * f1 * 3.3 + ph * 2) * amp * 0.25 - arch;
        if (x === 0) k.moveTo(x, y);
        else k.lineTo(x, y);
      }
      k.stroke();
    }
  }

  // Open pores: short dark dashes along the grain.
  for (let i = 0; i < 9000; i++) {
    const x = r() * W;
    const y = r() * H;
    const len = 2 + r() * 9;
    const a = 0.12 + r() * 0.28;
    ctx.fillStyle = `rgba(30,16,9,${a})`;
    ctx.fillRect(x, y, len, 0.9);
    bctx.fillStyle = `rgba(0,0,0,${a * 1.6})`;
    bctx.fillRect(x, y, len, 1);
  }

  const map = finish(c);
  const bump = finish(bc, { srgb: false });
  return { map, bump };
}

/** Ambient occlusion for the inside of a compartment: dark into the corners, clear in the middle. */
export function compartmentAOTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  const img = ctx.createImageData(256, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++) {
      const dx = Math.min(x, 255 - x) / 256;
      const dyTop = y / 128;
      const dyBottom = (127 - y) / 128;
      // Strongest under the shelf above, a little at the sides and along the bottom.
      const a = 0.75 * Math.exp(-dyTop * 9) + 0.35 * Math.exp(-dx * 26) + 0.3 * Math.exp(-dyBottom * 14);
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Light thrown on a compartment's back panel (white = light, in alpha). `cone` false: the wash of
 * an LED strip along the top, even across and fading down. `cone` true: a spot's pool, a soft
 * beam widening downwards from a point at the top centre.
 */
export function lightWashTexture(cone: boolean): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = y / (H - 1); // 0 at the top
      const u = (x / (W - 1)) * 2 - 1; // -1..1 across
      let a: number;
      if (cone) {
        const half = 0.18 + 0.8 * v; // the beam widens as it falls
        const across = Math.max(0, 1 - Math.pow(Math.abs(u) / half, 2));
        a = across * Math.pow(1 - v, 0.9) * (0.55 + 0.45 * Math.exp(-v * 6));
      } else {
        const sides = Math.min(1, (1 - Math.abs(u)) * 7);
        a = sides * (0.18 + 0.82 * Math.exp(-v * 3.2)) * (1 - v * 0.6);
      }
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = finish(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
