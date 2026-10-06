import type { PushHashContext } from '../../activityToGoogleEvent';

/**
 * The neutral push-hash context for tests that are not ABOUT the context: no member
 * names, no home zone (`hashZone: ''`, the no-fold, pre-home-zone payload).
 *
 * Test-only on purpose. Production must build its context with
 * `makePushHashContext()`; a default exported from production code is exactly the
 * optional-resolver trap the required parameter exists to remove.
 */
export const TEST_HASH_CTX: PushHashContext = Object.freeze({
  memberName: () => undefined,
  hashZone: '',
});
