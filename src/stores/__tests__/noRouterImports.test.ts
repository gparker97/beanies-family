/**
 * Guard: no store imports the router or a `.vue` file, statically or dynamically.
 *
 * The doc worker bundle (`services/automerge/worker/docWorker.ts`, built without the
 * Vue plugin) reaches stores through telemetry -> diagnosticContext -> syncStore ->
 * authStore -> ... A store that imports `@/router` (even with a lazy
 * `await import('@/router')`) puts the router, and through it every `.vue` page, in
 * the worker's module graph, and the production build fails to parse them. A store
 * orchestrates; navigation belongs to the view layer (see
 * `composables/useCalendarViewHealthToast.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const STORES_DIR = join(process.cwd(), 'src/stores');

function storeSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...storeSources(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Every module specifier in `from '...'`, `import '...'` and `import('...')`. */
function specifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  return [...source.matchAll(re)].map((m) => m[1]!);
}

const FORBIDDEN = /^(?:@|\.{1,2})\/router(?:\/|$)|\.vue$/;

describe('stores have no path to the router', () => {
  const files = storeSources(STORES_DIR);

  it('finds the store sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith('calendarViewStore.ts'))).toBe(true);
  });

  it('no store imports @/router or a .vue file (static or dynamic)', () => {
    const offenders = files.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => FORBIDDEN.test(spec))
        .map((spec) => `${relative(STORES_DIR, file)}: ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it('the scan recognises the shapes it guards against', () => {
    const sample = [
      "import router from '@/router';",
      "const { default: router } = await import('@/router');",
      "import Page from '@/pages/LoginPage.vue';",
    ].join('\n');
    expect(specifiers(sample).filter((s) => FORBIDDEN.test(s))).toHaveLength(3);
  });
});
