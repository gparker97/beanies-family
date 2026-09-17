/**
 * Envelope key-dict merge helpers.
 *
 * `BeanpodFileV4` carries key holders outside the encrypted payload. They are
 * enumerated in ONE place — `ENVELOPE_KEY_DICTS` below — which both
 * `preserveLocalKeyDicts` and `keyDictSize` iterate. Do not restate the list here or
 * anywhere else: a second list is a second thing to forget, and forgetting one used to
 * mean silently destroying key material on the first merge. The one holder NOT in that
 * registry is `recoveryPassphrase`, which is a scalar wrap rather than a map and keeps
 * its own explicit line in both functions.
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
/**
 * Envelope fields that are MAPS of wraps — DERIVED FROM THE TYPE, not from a list.
 * Selects exactly the dicts whose values carry a `wrapped: string`.
 */
export type EnvelopeKeyDictField = {
  [K in keyof BeanpodFileV4]-?: NonNullable<BeanpodFileV4[K]> extends Record<
    string,
    { wrapped: string }
  >
    ? K
    : never;
}[keyof BeanpodFileV4];

/**
 * How collisions on the same key resolve.
 *  - `local-wins`  : the just-mutated local entry is the truth we are about to push.
 *  - `newest-wins` : per-entry `createdAt` arbitration. REQUIRED for any dict whose
 *                    entries are ROTATED in place, because under `local-wins` a peer
 *                    still holding the pre-rotation entry wins the merge and
 *                    republishes the dead wrap — i.e. the rotation silently un-happens.
 */
export type MergeRule = 'local-wins' | 'newest-wins';

/**
 * Every envelope wrap dict, how its collisions resolve, and whether the field is
 * REQUIRED on `BeanpodFileV4`.
 *
 * ⚠️ Adding a dict to `BeanpodFileV4` without adding it here is a TYPE ERROR —
 * `satisfies Record<EnvelopeKeyDictField, …>` demands every field be present. That is
 * the whole point: this used to be two hand-written lists (one here, one in
 * `keyDictSize`) and omitting a dict from either failed silently.
 *
 * `required` preserves an asymmetry that predates the registry and must not drift: the
 * three original dicts are written as `{}` when absent on both sides, while an optional
 * dict absent on both sides is OMITTED ENTIRELY — the key must not appear at all.
 *
 * ⚠️ What the guard does NOT prove: a future dict whose package has no `wrapped` field
 * (tombstones, say) is not selected by `EnvelopeKeyDictField` and escapes the check.
 *
 * Annotated rather than `as const satisfies` on purpose. The annotation gives the same
 * exhaustiveness (every field of the union must be present, and an unknown key is an
 * excess-property error) while WIDENING `rule` to `MergeRule`. Under `as const`, TS
 * narrows `spec.rule` to the literals the registry happens to hold today, so the
 * `newest-wins` branch below becomes an "unintentional comparison" type error until some
 * dict uses it — which would force a new dict to add a branch as well as a line, the
 * exact coupling this registry exists to remove.
 */
export const ENVELOPE_KEY_DICTS: Record<
  EnvelopeKeyDictField,
  { rule: MergeRule; required: boolean }
> = {
  wrappedKeys: { rule: 'local-wins', required: true },
  passkeyWrappedKeys: { rule: 'local-wins', required: true },
  inviteKeys: { rule: 'local-wins', required: true },
  recoveryKeys: { rule: 'local-wins', required: false },
  // ⚠️ MUST be 'newest-wins'. Under 'local-wins' a peer still holding the pre-rotation
  // entry wins the merge and republishes the dead wrap — the Settings "create a new
  // link" action becomes a no-op that looks like it worked. This is the whole of
  // revocation; see envelopeMerge.test.ts, which asserts the rule directly.
  memberLinkKeys: { rule: 'newest-wins', required: false },
};

/**
 * Union of keys; per key the NEWER `createdAt` wins. Delegates to
 * `pickNewerByCreatedAt`, so a missing `createdAt` sorts oldest and a one-sided entry
 * survives — identical semantics to the scalar passphrase arbitration.
 */
export function mergeNewestWinsDict<T extends { createdAt?: string }>(
  remote: Record<string, T> | undefined,
  local: Record<string, T> | undefined
): Record<string, T> | undefined {
  if (!remote && !local) return undefined;
  const out: Record<string, T> = { ...(remote ?? {}) };
  for (const [k, v] of Object.entries(local ?? {})) {
    const winner = pickNewerByCreatedAt(out[k], v);
    if (winner) out[k] = winner;
  }
  return out;
}

export function preserveLocalKeyDicts(
  incoming: BeanpodFileV4,
  local: BeanpodFileV4 | null | undefined
): BeanpodFileV4 {
  if (!local) return incoming;

  // Every dict comes from the ONE registry. A dict added to the type but not to
  // `ENVELOPE_KEY_DICTS` fails type-check rather than being silently dropped here.
  const dicts: Partial<Pick<BeanpodFileV4, EnvelopeKeyDictField>> = {};
  for (const field of Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[]) {
    const spec = ENVELOPE_KEY_DICTS[field];
    // The registry's keys are a closed union, but indexing with it produces a union of
    // Record types that no single generic call can accept. Both helpers only read keys
    // and spread values, so the shape is irrelevant to them.
    const incomingDict = incoming[field] as Record<string, never> | undefined;
    const localDict = local[field] as Record<string, never> | undefined;
    const merged =
      spec.rule === 'newest-wins'
        ? mergeNewestWinsDict(incomingDict, localDict)
        : mergeKeyDict(incomingDict, localDict);

    if (merged) {
      // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
      dicts[field] = merged as never;
    } else if (spec.required) {
      // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
      dicts[field] = {} as never;
    }
    // Optional + absent on both sides: deliberately NOT written, so the key stays
    // absent rather than appearing as `{}`. Asserted in envelopeMerge.test.ts.
  }

  // Scalar, so it is not in the registry: NEWEST-wins by createdAt (review F2 —
  // unconditional local-wins let any device still holding the old wrap in memory revert
  // a passphrase changed elsewhere on its next fetch+push). A wrap with no createdAt
  // sorts oldest; a side missing the field entirely loses to any present wrap, so a
  // local-only passphrase still survives an incoming envelope that lacks one.
  const passphrase = pickNewerByCreatedAt(incoming.recoveryPassphrase, local.recoveryPassphrase);

  return {
    ...incoming,
    ...dicts,
    ...(passphrase ? { recoveryPassphrase: passphrase } : {}),
  };
}

/**
 * Newest-wins arbitration by `createdAt`, for one wrap on each side.
 *
 * Generalised from the passphrase-only version so the scalar passphrase and every
 * `newest-wins` dict entry share ONE rule rather than two that can drift. Semantics are
 * unchanged and pinned by the existing passphrase tests: a wrap with no `createdAt`
 * sorts oldest, a one-sided wrap survives, and an exact tie goes to `incoming`.
 */
function pickNewerByCreatedAt<T extends { createdAt?: string }>(
  incoming: T | undefined,
  local: T | undefined
): T | undefined {
  if (!incoming) return local;
  if (!local) return incoming;
  const ts = (w: T) => w.createdAt ?? '';
  return ts(local) > ts(incoming) ? local : incoming;
}

/**
 * Total number of entries across every envelope key dict, plus the scalar passphrase.
 *
 * Used to detect whether `preserveLocalKeyDicts` carried local-only key entries into a
 * merged envelope — i.e. whether this device holds key material the remote file does
 * not yet have. That state cannot show up in the Automerge-heads-derived `dirty` flag
 * (keys live in the envelope, not the document), so it needs its own signal or a passkey
 * enrolled while offline would never be published. See the "rides the next successful
 * save" contract in `PasskeySettings.vue`.
 *
 * ⚠️ THIS IS A COUNT, AND ITS CALLER COMPARES IT WITH A STRICT `>`
 * (`syncStore`: `keyDictSize(merged) > keyDictSize(remoteEnvelope)`). So it detects an
 * ADDED entry and nothing else. Overwriting an existing key — every rotation, every
 * revocation — leaves the count IDENTICAL and is invisible here. Anything that replaces
 * an entry in place must publish explicitly; do not rely on this signal for it.
 */
export function keyDictSize(envelope: BeanpodFileV4 | null | undefined): number {
  if (!envelope) return 0;
  let n = 0;
  for (const field of Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[]) {
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    n += Object.keys(envelope[field] ?? {}).length;
  }
  // Scalar, so it is not in the registry.
  return n + (envelope.recoveryPassphrase ? 1 : 0);
}
