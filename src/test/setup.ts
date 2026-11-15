// Global vitest setup (wired in vitest.config.ts `setupFiles`).
//
// ⚠️ IMPORT NOTHING FROM `src/` HERE. A module a setup file imports is already in the graph when
// the test file's `vi.mock` runs, so it could not be mocked there. The load-phase guard records
// on `globalThis` for exactly this reason (see `noteLoadPhaseWrite` in loadMaintenance.ts).
import { afterEach } from 'vitest';

const VIOLATIONS_KEY = '__beaniesLoadPhaseWrites';

// A store loader that writes to the document fails the test that ran it. `docClient.mutate`
// throws inside a load phase in test mode, but store actions swallow throws (`wrapAsync`), so
// the record is what makes the failure visible.
afterEach(() => {
  const holder = globalThis as { [VIOLATIONS_KEY]?: string[] };
  const recorded = holder[VIOLATIONS_KEY] ?? [];
  holder[VIOLATIONS_KEY] = [];
  if (recorded.length > 0) {
    throw new Error(
      `[load-phase] ${recorded.length} document write(s) issued while store loaders were running ` +
        `(${recorded.join(', ')}). Loaders must be read-only: register the writer with ` +
        'registerLoadMaintenance (src/services/automerge/loadMaintenance.ts).'
    );
  }
});
