// Test-only minter for the ADR-030 `ConsentGrant` (#64).
//
// `ConsentGrant` is a branded type whose only production constructor is `requestConsent()`,
// which is exactly what makes an ungated call to the extraction funnel a compile error. Tests
// still need to call `extract*` directly, so the back door lives HERE — in test utils, never
// in `src/composables` or `src/services` — so production code cannot reach it.
//
// If you find yourself importing this outside a test, the code under construction is skipping
// the consent gate and the type is doing its job.

import type { ConsentGrant } from '@/composables/useDocumentConsent';

/** A grant for tests. Never import this from production code. */
export const __testConsentGrant = {} as ConsentGrant;
