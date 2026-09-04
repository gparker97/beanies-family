/**
 * Envelope key-dict merge helpers.
 *
 * `BeanpodFileV4` carries these key holders outside the encrypted payload:
 *   - `wrappedKeys`         — per-member password-wrapped family keys
 *   - `inviteKeys`          — per-token invite-wrapped family keys
 *   - `passkeyWrappedKeys`  — per-credential PRF-wrapped family keys
 *   - `recoveryKeys`        — per-kit recovery wraps (Phase 3, additive optional)
 *   - `recoveryPassphrase`  — the single optional passphrase wrap (Phase 3)
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
 * The same envelope WITHOUT its encrypted payload.
 *
 * A long-lived or CACHED in-memory envelope has no business holding the bytes:
 * the payload is the worker's concern, and re-serialisation always supplies
 * fresh bytes via `reEncryptEnvelope`, which overwrites the field anyway.
 * Keeping it pinned a ~5.5MB base64 string for the whole session — and worse,
 * `cache.persistEnvelope` JSON.stringify'd the entire thing into IndexedDB on
 * every key change, so it was a multi-megabyte write on the poll path too.
 *
 * Returns a fresh envelope — never mutates its input, matching `mergeKeyDict`.
 *
 * Guarded at both boundaries so a stripped envelope can never be mistaken for a
 * real one: `parseBeanpodV4` rejects an empty payload from a FILE, and
 * `docClient.postRaw` rejects one crossing the worker RPC.
 */
export function withoutPayload(env: BeanpodFileV4): BeanpodFileV4 {
  return { ...env, encryptedPayload: '' };
}

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
    // A kit generated on this device must survive an old-writer envelope arriving —
    // preserveLocalKeyDicts' shape SILENTLY DROPS any dict it doesn't name (Pass-4).
    ...(mergeKeyDict(incoming.recoveryKeys, local.recoveryKeys)
      ? { recoveryKeys: mergeKeyDict(incoming.recoveryKeys, local.recoveryKeys) }
      : {}),
    // Scalar: NEWEST-wins by createdAt (review F2 — unconditional local-wins let any
    // device still holding the old wrap in memory revert a passphrase changed elsewhere
    // on its next fetch+push). A wrap with no createdAt sorts oldest; a side missing the
    // field entirely loses to any present wrap, so a local-only passphrase still
    // survives an incoming envelope that lacks one.
    ...(pickNewerPassphrase(incoming.recoveryPassphrase, local.recoveryPassphrase)
      ? {
          recoveryPassphrase: pickNewerPassphrase(
            incoming.recoveryPassphrase,
            local.recoveryPassphrase
          ),
        }
      : {}),
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
function pickNewerPassphrase(
  incoming: BeanpodFileV4['recoveryPassphrase'],
  local: BeanpodFileV4['recoveryPassphrase']
): BeanpodFileV4['recoveryPassphrase'] {
  if (!incoming) return local;
  if (!local) return incoming;
  const ts = (w: NonNullable<BeanpodFileV4['recoveryPassphrase']>) => w.createdAt ?? '';
  return ts(local) > ts(incoming) ? local : incoming;
}

export function keyDictSize(envelope: BeanpodFileV4 | null | undefined): number {
  if (!envelope) return 0;
  return (
    Object.keys(envelope.wrappedKeys ?? {}).length +
    Object.keys(envelope.passkeyWrappedKeys ?? {}).length +
    Object.keys(envelope.inviteKeys ?? {}).length +
    // Kit/passphrase wraps are key material too: one set offline must trigger a
    // publish exactly like an offline passkey enrolment (this count is that signal).
    Object.keys(envelope.recoveryKeys ?? {}).length +
    (envelope.recoveryPassphrase ? 1 : 0)
  );
}
