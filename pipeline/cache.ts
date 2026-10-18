import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { config } from './config.ts';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.BOOKSHELF_DATA ? path.resolve(ROOT, process.env.BOOKSHELF_DATA) : path.join(ROOT, 'data');
export const CACHE_DIR = path.join(DATA_DIR, '.cache');
export const PUBLIC_DIR = path.join(ROOT, 'public');

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

export async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

/** Per-step, per-key JSON cache. The `version` lets a step invalidate itself when its logic changes. */
export function stepCache<T>(step: string, version = 1) {
  const dir = path.join(CACHE_DIR, step);
  const file = (key: string) => path.join(dir, `${key.replace(/[^\w.-]/g, '_')}.json`);
  return {
    async get(key: string): Promise<T | null> {
      const hit = await readJson<{ v: number; data: T }>(file(key));
      return hit && hit.v === version ? hit.data : null;
    },
    async set(key: string, data: T): Promise<void> {
      await writeJson(file(key), { v: version, data });
    },
  };
}

const limiters = new Map<string, ReturnType<typeof pLimit>>();
/** Goodreads sits behind a bot wall: one request at a time, spaced out. */
const SLOW_HOSTS: Record<string, number> = { 'www.goodreads.com': 1500 };
function limiterFor(url: string) {
  const host = new URL(url).host;
  let l = limiters.get(host);
  if (!l) {
    l = pLimit(SLOW_HOSTS[host] ? 1 : config.HTTP_CONCURRENCY);
    limiters.set(host, l);
  }
  return l;
}

/** After repeated challenges from a host, stop asking it for the rest of the run. */
const blockedStreak = new Map<string, number>();
const BLOCK_AFTER = 5;
export const blockedHosts = new Set<string>();

export interface FetchResult {
  status: number;
  contentType: string | null;
  body: Buffer;
}

/** Cached, per-host rate-limited GET. 404s and other failures are cached too, so reruns are fast. */
export async function cachedFetch(url: string, opts: { headers?: Record<string, string> } = {}): Promise<FetchResult> {
  const key = sha(url);
  const metaFile = path.join(CACHE_DIR, 'http', `${key}.json`);
  const bodyFile = path.join(CACHE_DIR, 'http', `${key}.bin`);
  const meta = await readJson<{ status: number; contentType: string | null }>(metaFile);
  if (meta) return { ...meta, body: existsSync(bodyFile) ? await readFile(bodyFile) : Buffer.alloc(0) };

  const host = new URL(url).host;
  if (blockedHosts.has(host)) return { status: 0, contentType: null, body: Buffer.alloc(0) };
  const result = await limiterFor(url)(async (): Promise<FetchResult> => {
    if (blockedHosts.has(host)) return { status: 0, contentType: null, body: Buffer.alloc(0) };
    if (SLOW_HOSTS[host]) await new Promise((r) => setTimeout(r, SLOW_HOSTS[host]));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': config.USER_AGENT, ...opts.headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          body: Buffer.from(await res.arrayBuffer()),
        };
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    return { status: 0, contentType: null, body: Buffer.alloc(0) };
  });

  // Bot challenges (Goodreads answers 202 with an empty JS page) count towards blocking the host.
  if (result.status === 202 || result.status === 403) {
    const n = (blockedStreak.get(host) ?? 0) + 1;
    blockedStreak.set(host, n);
    if (n >= BLOCK_AFTER && !blockedHosts.has(host)) {
      blockedHosts.add(host);
      console.warn(`\n  ! ${host} is challenging our requests; skipping it for the rest of this run`);
    }
  } else if (result.status === 200) blockedStreak.set(host, 0);

  // Only cache definitive answers; challenges and server errors are retried on the next run.
  if (result.status === 200 || result.status === 404 || result.status === 410) {
    await mkdir(path.dirname(metaFile), { recursive: true });
    await writeFile(bodyFile, result.body);
    await writeJson(metaFile, { status: result.status, contentType: result.contentType });
  }
  return result;
}

export async function fetchJson<T>(url: string): Promise<T | null> {
  const r = await cachedFetch(url);
  if (r.status !== 200) return null;
  try {
    return JSON.parse(r.body.toString('utf8')) as T;
  } catch {
    return null;
  }
}
