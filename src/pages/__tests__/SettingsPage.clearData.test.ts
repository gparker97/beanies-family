/**
 * C6: Settings "Clear Data" used to delete the family cache with no save at all, so a
 * pending debounce or a failed autosave went with it, and it never asked about work the
 * family data file had not got. It now saves first, asks before discarding, and runs the
 * same teardown-and-force-save the sign-out tiers open with, in that order, before the
 * delete. Pinned on the handler's source (the page is too heavy to mount for one handler,
 * and the ORDER is the contract): the probe, the confirm and the teardown are each
 * covered behaviourally in `dataClearingSecurity` / `useSignOut`.
 */
import { describe, it, expect } from 'vitest';
import { repoFile } from '@/test/repoFile';

function handler(): string {
  const src = repoFile('src/pages/SettingsPage.vue');
  const start = src.indexOf('async function handleClearData()');
  const end = src.indexOf('function resetDeleteFamilyState()', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('Settings Clear Data (C6)', () => {
  it('saves first, asks before discarding, tears down and force-saves, THEN deletes', () => {
    const fn = handler();
    const probe = fn.indexOf("measureUnsavedWork({ save: true, scope: 'active' })");
    const ask = fn.indexOf("confirmDiscardUnsavedWork(unsaved, 'clear-data')");
    const teardown = fn.indexOf('teardownForLocalClear()');
    const del = fn.indexOf('deleteFamilyDatabase(');
    for (const at of [probe, ask, teardown, del]) expect(at).toBeGreaterThan(-1);
    expect(probe).toBeLessThan(ask);
    expect(ask).toBeLessThan(teardown);
    expect(teardown).toBeLessThan(del);
  });

  it('a declined discard returns before anything is cleared', () => {
    expect(handler()).toMatch(
      /if \(!\(await confirmDiscardUnsavedWork\(unsaved, 'clear-data'\)\)\) return;/
    );
  });
});
