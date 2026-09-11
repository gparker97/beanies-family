/**
 * A memoized member-name resolver, shared by the reconcile engine and the one-time
 * import (#94).
 *
 * It matters that both use the SAME one. `computePushHash` folds resolved member
 * names into the hash when, and only when, a resolver is passed, so a caller that
 * omits it produces a different hash for the same activity. The import records that
 * hash on the link precisely so the next reconcile sees the hashes agree and does
 * nothing; a mismatch would push every imported event straight back to Google, and
 * for an ADOPTED event that push rewrites the user's real event body.
 *
 * Memoized because resolving 1-3 ids across N activities would otherwise re-scan
 * `familyStore.members` every time (O(N*M)). Preserves `undefined` for unknown ids
 * rather than inventing a placeholder, which the hash depends on.
 *
 * Must be called within a store action (Pinia active).
 */

import { useMemberInfo } from '@/composables/useMemberInfo';

export function makeMemberNameResolver(): (id: string) => string | undefined {
  const { getMemberById } = useMemberInfo();
  const cache = new Map<string, string | undefined>();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const name = getMemberById(id)?.name;
    cache.set(id, name);
    return name;
  };
}
