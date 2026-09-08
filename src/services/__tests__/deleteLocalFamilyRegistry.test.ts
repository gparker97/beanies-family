/**
 * Regression guard for the 2026-09-08 registry-ownership defect.
 *
 * `deleteLocalFamily` is a PER-DEVICE action: "Delete Local Family Data" on the
 * login picker, whose own confirm copy promises "The original file is not
 * affected". Until 2026-09-08 it also called `registry.removeFamily`, which
 * deletes the family's SHARED registry row. The next write from any member then
 * recreated the row, and because the Lambda's owner fields are write-once,
 * whoever wrote first was stamped as the owner. That is how greg's pod reported
 * an owner it had never been transferred to.
 *
 * The row must only ever be removed by the owner-gated full-family deletion.
 *
 * See docs/investigations/2026-09-08-compaction-fallout.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deleteLocalFamily and the shared registry row', () => {
  // Asserted against the source rather than by driving the function, because
  // `deleteLocalFamily` touches IndexedDB, passkeys and file handles, and the
  // property under test is simply that this call site does not exist. A source
  // assertion cannot be satisfied by a mock that happens not to be reached.
  it('never calls removeFamily — the row is shared, the action is per-device', () => {
    const source = readFileSync('src/services/familyContext.ts', 'utf8');
    // Comments are stripped first: the tombstone comment left at the old call
    // site names `removeFamily` on purpose, and must not itself trip the guard.
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/\bremoveFamily\s*\(/);
    expect(source).toContain('THE REMOTE REGISTRY ROW IS DELIBERATELY NOT TOUCHED HERE');
  });

  it('keeps the remote removal on the owner-gated full deletion, awaited and surfaced', () => {
    const source = readFileSync('src/pages/SettingsPage.vue', 'utf8');
    // The one place allowed to remove it. Awaited and surfaced, because the user
    // is simultaneously being told their family is gone from everywhere.
    expect(source).toContain('await removeFamily(familyId)');
    expect(source).toContain('registryRemoved');
  });

  it('removeFamily reports failure rather than swallowing it', () => {
    const source = readFileSync('src/services/registry/registryService.ts', 'utf8');
    // It used to discard the Response entirely, so a 403 was perfectly silent.
    expect(source).toMatch(/removeFamily\([^)]*\):\s*Promise<boolean>/);
    expect(source).toContain("action: 'delete-failed'");
  });
});
