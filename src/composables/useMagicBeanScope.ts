/**
 * Which family is a magic-bean read billed to?
 *
 * ONE answer, because there are TWO callers and a fence written twice is a fence with one live
 * half. `useSharedDocumentIngest`'s `read()` is the obvious one; `useRecipeCapture.processUrl`
 * is the other — recipe refetch calls it directly and never enters the spine at all, so a check
 * written only in `runIngest` would leave the loophole open on the one path that most obviously
 * has a family (a saved recipe being refreshed).
 *
 * WHY A REFUSAL AND NOT A FALLBACK
 * Before the meter, an absent family id degraded to the proxy's IP limit — a documented,
 * supported state. Under the meter it would be an **uncounted read**: the Lambda has no
 * partition key to write under, so the read happens, costs us money, and leaves no row. That is
 * precisely the loophole the meter exists to close, so it becomes a refusal BEFORE the model,
 * which costs nothing.
 *
 * `awaitReadiness` already establishes `currentMember` on the share path and the in-app doors
 * only render for a signed-in member, so this is a should-not-happen on both. That is exactly
 * why it must be LOUD rather than a `?? undefined`: the log line is how we find out it can
 * happen, and its rate is what tells us whether the fence is holding before enforcement ships.
 *
 * ⚠️ Never write `familyId: … ?? undefined` at a call site again. The optional-with-fallback
 * shape is what made the type say one thing and the runtime do another.
 */

import type { IngestEnv } from '@/composables/useSharedDocumentIngest';
import { notReady } from '@/composables/useSharedDocumentIngest';
import { useFamilyContextStore } from '@/stores/familyContextStore';

/**
 * The family this read is billed to, or `null` if there is none.
 *
 * A `null` return has ALREADY logged and toasted, so a caller simply returns — there is no
 * second message to write and no way to refuse silently by forgetting one.
 */
export function resolveBillableFamilyId(env: IngestEnv): string | null {
  const familyId = useFamilyContextStore().activeFamilyId;
  if (!familyId) {
    notReady(env, 'no_family', 'shareTarget.notReady.title', 'shareTarget.notReady.message');
    return null;
  }
  return familyId;
}
