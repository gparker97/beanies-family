/**
 * Drift guard: for every action in the QUICK_ADD_ITEMS config, assert
 * that SOMETHING in `src/` references it. This catches the "added a
 * new action to the config but forgot to wire a handler" case without
 * requiring a full integration test.
 *
 * Implementation: grep the entire src/ tree (excluding the config
 * file itself and this test) for the literal action string. One match
 * is sufficient — the action has a handler somewhere. Zero matches
 * fails CI.
 *
 * Phase 1 scope: not every action has a wired handler yet (Phase 2
 * wires 12 more). The test skips actions tagged in `PHASE_2_ACTIONS`
 * below — remove entries from that list as handlers are added.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QUICK_ADD_ITEMS } from '@/constants/quickAddItems';

// vitest runs from the repo root; use cwd for portability across
// Node's file:// URL-scheme quirks (test runner can pass a non-file URL).
const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, 'src');
const EXCLUDE_FILES = new Set<string>([
  join(SRC_DIR, 'constants', 'quickAddItems.ts'),
  join(SRC_DIR, 'constants', '__tests__', 'quickAddCoverage.test.ts'),
  join(SRC_DIR, 'constants', '__tests__', 'quickAddItems.test.ts'),
]);

/**
 * Actions currently deferred — intentionally empty after Phase 2.
 * Re-add entries here temporarily if a future action lands in the
 * config ahead of its handler; keeping the set empty by default means
 * the drift guard fires immediately on unhandled additions.
 */
const PHASE_2_ACTIONS: ReadonlySet<string> = new Set([]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|vue)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const ALL_SOURCE_FILES = walk(SRC_DIR).filter((f) => !EXCLUDE_FILES.has(f));

describe('Quick-add action coverage — drift guard', () => {
  it.each(QUICK_ADD_ITEMS.map((i) => [i.id, i.action]))(
    '%s → "%s" is handled by at least one page or component',
    (_id, action) => {
      if (PHASE_2_ACTIONS.has(action)) {
        // Phase 2 deferred — skip coverage check for now.
        return;
      }
      const needle = `'${action}'`; // match the exact string literal
      const matches = ALL_SOURCE_FILES.filter((file) => {
        const content = readFileSync(file, 'utf-8');
        return content.includes(needle);
      });
      expect(
        matches.length,
        `No handler found for action "${action}". Add a case to the target page's useQuickAddIntent switch, or add the action id to PHASE_2_ACTIONS if deferring.`
      ).toBeGreaterThan(0);
    }
  );

  it('no PHASE_2_ACTIONS entry references an unknown action', () => {
    const configActions: Set<string> = new Set(QUICK_ADD_ITEMS.map((i) => i.action));
    for (const action of PHASE_2_ACTIONS) {
      expect(
        configActions.has(action),
        `PHASE_2_ACTIONS contains stale entry "${action}" — remove it`
      ).toBe(true);
    }
  });
});
