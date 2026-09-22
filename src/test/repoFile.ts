import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a repo file by its path relative to the repo root, for drift-tripwire suites.
 *
 * ⚠️ RESOLVED FROM `process.cwd()` (vitest's cwd), NOT from `import.meta.url`. These
 * suites run under happy-dom, where `import.meta.url` is an `http://` URL and
 * `fileURLToPath` rejects it outright. That is the whole reason this helper exists in one
 * place rather than being re-derived per suite.
 *
 * A bare `.ts` under `src/test/` is a helper, not a collected suite: vitest's `include` is
 * `src/**` + `*.{test,spec}.ts` (`vitest.config.ts`), so this file is never run as a test.
 */
export const repoFile = (relative: string): string =>
  readFileSync(join(process.cwd(), relative), 'utf8');
