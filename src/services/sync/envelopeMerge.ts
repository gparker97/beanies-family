/**
 * Envelope key-dict merge helpers.
 *
 * `BeanpodFileV4` carries three dictionaries outside the encrypted payload:
 *   - `wrappedKeys`         — per-member password-wrapped family keys
 *   - `inviteKeys`          — per-token invite-wrapped family keys
 *   - `passkeyWrappedKeys`  — per-credential PRF-wrapped family keys
 *
 * They're not CRDT-merged. Whenever an in-memory envelope is replaced by a
 * fetched one (Drive read, cache load, background sync), the just-mutated
 * local entries must be preserved or the corresponding member/invite/passkey
 * becomes unusable — that's the divergence root cause we're closing. The
 * helpers below are the single source of truth for that merge.
 *
 * Known limitation: deletions don't propagate either direction. A revoked
 * passkey or wrappedKey on one device won't disappear from remote via this
 * merge — requires tombstones, tracked separately.
 */

import type { BeanpodFileV4 } from '@/types/syncFileV4';

/**
 * Merge two key dictionaries with local-wins semantics. Returns a fresh
 * object — never mutates inputs. Either side may be undefined.
 */
export function mergeKeyDict<T>(
  remote: Record<string, T> | undefined,
  local: Record<string, T> | undefined
): Record<string, T> | undefined {
  if (!remote && !local) return undefined;
  return { ...(remote ?? {}), ...(local ?? {}) };
}

/**
 * Local-wins merge of the three envelope key dicts. Returns a fresh envelope.
 *
 * Use whenever an in-memory envelope is replaced by a fetched one — preserves
 * any locally-added entries the fetched source doesn't have yet (e.g. a
 * wrappedKey added in this session but not yet pushed). The local side is by
 * definition the just-mutated truth we're about to push; remote-only entries
 * still survive.
 *
 * `local` may be null/undefined (initial decrypt, fresh sign-in) — in that
 * case `incoming` is returned unchanged.
 */
export function preserveLocalKeyDicts(
  incoming: BeanpodFileV4,
  local: BeanpodFileV4 | null | undefined
): BeanpodFileV4 {
  if (!local) return incoming;
  return {
    ...incoming,
    inviteKeys: mergeKeyDict(incoming.inviteKeys, local.inviteKeys) ?? {},
    wrappedKeys: mergeKeyDict(incoming.wrappedKeys, local.wrappedKeys) ?? {},
    passkeyWrappedKeys: mergeKeyDict(incoming.passkeyWrappedKeys, local.passkeyWrappedKeys) ?? {},
  };
}

/**
 * Total number of entries across the three key dicts.
 *
 * Used to detect whether `preserveLocalKeyDicts` carried local-only key entries
 * into a merged envelope — i.e. whether this device holds key material the remote
 * file does not yet have. That state cannot show up in the Automerge-heads-derived
 * `dirty` flag (keys live in the envelope, not the document), so it needs its own
 * signal or a passkey enrolled while offline would never be published. See the
 * "rides the next successful save" contract in `PasskeySettings.vue`.
 */
export function keyDictSize(envelope: BeanpodFileV4 | null | undefined): number {
  if (!envelope) return 0;
  return (
    Object.keys(envelope.wrappedKeys ?? {}).length +
    Object.keys(envelope.passkeyWrappedKeys ?? {}).length +
    Object.keys(envelope.inviteKeys ?? {}).length
  );
}
