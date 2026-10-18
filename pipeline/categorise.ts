import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import path from 'node:path';
import { DATA_DIR, readJson, writeJson } from './cache.ts';
import { config } from './config.ts';
import type { Category } from '../src/types.ts';

export const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
export const ASSIGNMENTS_FILE = path.join(DATA_DIR, 'assignments.json');

export interface CategorisableBook {
  id: string;
  title: string;
  author: string;
  description: string | null;
  subjects: string[];
}

export interface Assignment {
  primary: string;
  secondary: string | null;
}
export type Assignments = Record<string, Assignment>;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const TaxonomySchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        description: z.string().min(1).max(200),
      }),
    )
    .min(6)
    .max(9),
});

const AssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      id: z.string(),
      primary: z.string(),
      secondary: z.string().nullable(),
    }),
  ),
});

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/**
 * Structured outputs accept only a subset of JSON Schema (no length bounds, minItems 0 or 1 only).
 * Strip those keywords for the API; zod still enforces them locally, and a violation triggers the retry.
 */
type JsonSchema = { [key: string]: unknown };
const UNSUPPORTED = new Set(['minLength', 'maxLength', 'maxItems', 'minimum', 'maximum']);
export function apiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(apiSchema);
  if (!node || typeof node !== 'object') return node;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node as JsonSchema)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    out[k] = apiSchema(v);
  }
  return out;
}

/** One structured call, validated with zod. Retries once on a parse or validation failure. */
async function askJson<T>(schema: z.ZodType<T>, system: string, prompt: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic()
      .beta.messages.stream({
        model: config.CLAUDE_MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: apiSchema(z.toJSONSchema(schema)) as JsonSchema },
        },
        system,
        messages: [{ role: 'user', content: prompt }],
      })
      .finalMessage();
    if (res.stop_reason === 'refusal') throw new Error('Claude declined the categorisation request');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    try {
      return schema.parse(JSON.parse(text));
    } catch (err) {
      lastError = err;
      console.warn(`  ! invalid JSON from Claude (attempt ${attempt + 1}), retrying`);
    }
  }
  throw new Error(`Claude returned invalid JSON twice: ${String(lastError)}`);
}

const line = (b: CategorisableBook, descLen: number) => {
  const desc = (b.description ?? '').replace(/\s+/g, ' ').slice(0, descLen);
  const subj = b.subjects.slice(0, 4).join(', ');
  return `- [${b.id}] ${b.title} by ${b.author}${subj ? ` | ${subj}` : ''}${desc ? ` | ${desc}` : ''}`;
};

async function buildTaxonomy(books: CategorisableBook[]): Promise<Category[]> {
  console.log(`  pass 1: asking ${config.CLAUDE_MODEL} for a taxonomy of ${books.length} books`);
  const result = await askJson(
    TaxonomySchema,
    'You organise personal libraries into shelves. You are precise, concise and have good taste.',
    `Here is someone's reading library. Propose 6 to 9 interest-area categories that best describe THIS library — the way a thoughtful person would arrange their own shelves by theme, not a bookshop's generic genres.

Rules:
- Each name is at most 3 words, title case, no ampersands unless natural.
- Each description is one line.
- Together they should cover every book, with reasonably balanced sizes; avoid a catch-all "Miscellaneous".

Library:
${books.map((b) => line(b, 160)).join('\n')}`,
  );
  const seen = new Set<string>();
  return result.categories.map((c) => {
    let slug = slugify(c.name);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    return { slug, name: c.name, description: c.description };
  });
}

async function assignBatch(books: CategorisableBook[], categories: Category[]): Promise<Assignments> {
  const slugs = new Set(categories.map((c) => c.slug));
  const result = await askJson(
    AssignmentSchema,
    'You assign books to the shelves of a personal library. Return exactly one assignment per input book.',
    `Categories (use the slug):
${categories.map((c) => `- ${c.slug}: ${c.name} — ${c.description}`).join('\n')}

For each book, choose a "primary" category slug and optionally a "secondary" slug (or null) when the book clearly straddles two.

Books:
${books.map((b) => line(b, 240)).join('\n')}`,
  );
  const out: Assignments = {};
  const fallback = categories[0]!.slug;
  for (const a of result.assignments) {
    if (!books.some((b) => b.id === a.id)) continue;
    out[a.id] = {
      primary: slugs.has(a.primary) ? a.primary : fallback,
      secondary: a.secondary && slugs.has(a.secondary) && a.secondary !== a.primary ? a.secondary : null,
    };
  }
  return out;
}

/**
 * Pass 1 runs only when data/categories.json is missing. Pass 2 runs only for books
 * without an entry in data/assignments.json. Both files are human-editable.
 */
export async function categorise(books: CategorisableBook[]): Promise<{ categories: Category[]; assignments: Assignments }> {
  let categories = await readJson<Category[]>(CATEGORIES_FILE);
  const assignments = (await readJson<Assignments>(ASSIGNMENTS_FILE)) ?? {};

  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!categories) {
    if (!hasKey) throw new Error('ANTHROPIC_API_KEY is not set and data/categories.json does not exist yet.');
    categories = await buildTaxonomy(books);
    await writeJson(CATEGORIES_FILE, categories);
  }

  const slugs = new Set(categories.map((c) => c.slug));
  // Re-assign books whose category was deleted or renamed by hand.
  const todo = books.filter((b) => !assignments[b.id] || !slugs.has(assignments[b.id]!.primary));
  if (todo.length > 0) {
    if (!hasKey) {
      console.warn(`  ! ${todo.length} books need categories but ANTHROPIC_API_KEY is not set; using "${categories[0]!.slug}"`);
      for (const b of todo) assignments[b.id] = { primary: categories[0]!.slug, secondary: null };
    } else {
      for (let i = 0; i < todo.length; i += config.CATEGORY_BATCH_SIZE) {
        const batch = todo.slice(i, i + config.CATEGORY_BATCH_SIZE);
        console.log(`  pass 2: assigning books ${i + 1}-${i + batch.length} of ${todo.length}`);
        Object.assign(assignments, await assignBatch(batch, categories));
        const missing = batch.filter((b) => !assignments[b.id]);
        if (missing.length) Object.assign(assignments, await assignBatch(missing, categories));
        await writeJson(ASSIGNMENTS_FILE, sortKeys(assignments));
      }
    }
    await writeJson(ASSIGNMENTS_FILE, sortKeys(assignments));
  }
  return { categories, assignments };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}
