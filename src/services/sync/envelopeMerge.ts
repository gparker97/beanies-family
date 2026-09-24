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
 * Deletions: a plain union cannot express one, so a revoked wrap would be restored by the
 * next merge. Revocations are therefore recorded as TOMBSTONES in `revokedKeys` (tracker
 * #77) — a grow-only set merged by union — and every merge through `mergeEnvelopes` drops
 * the entries they name (`applyRevokedKeys`). Removing an entry locally without a
 * tombstone still does nothing durable.
 *
 * ⚠️ Keep this module PURE (no telemetry, no stores): the Automerge worker imports it
 * (`worker/cache.ts`). Callers log what `mergeEnvelopes` reports.
 */

import type { BeanpodFileV4, EnvelopeTombstone } from '@/types/syncFileV4';

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
 * How an entry in a dict names the member it belongs to, for `member:<id>` tombstones:
 *  - `'key'`            : the dict KEY is the memberId.
 *  - `'value.memberId'` : the value carries an (optional) `memberId`.
 *  - `null`             : family-scoped or unattributable — never touched by a member
 *                         tombstone (only a slot tombstone can revoke these).
 */
export type MemberAttribution = 'key' | 'value.memberId' | null;

/**
 * Every envelope wrap dict, how its collisions resolve, whether the field is REQUIRED on
 * `BeanpodFileV4`, and how its entries are attributed to a member (`attributedBy`).
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
  { rule: MergeRule; required: boolean; attributedBy: MemberAttribution }
> = {
  wrappedKeys: { rule: 'local-wins', required: true, attributedBy: 'key' },
  passkeyWrappedKeys: { rule: 'local-wins', required: true, attributedBy: 'value.memberId' },
  // Keyed by token hash; a package carries no memberId, so it can only be revoked by slot.
  inviteKeys: { rule: 'local-wins', required: true, attributedBy: null },
  recoveryKeys: { rule: 'local-wins', required: false, attributedBy: null },
  // ⚠️ MUST be 'newest-wins'. Under 'local-wins' a peer still holding the pre-rotation
  // entry wins the merge and republishes the dead wrap — the Settings "create a new
  // link" action becomes a no-op that looks like it worked. This is the whole of
  // revocation; see envelopeMerge.test.ts, which asserts the rule directly.
  memberLinkKeys: { rule: 'newest-wins', required: false, attributedBy: 'key' },
  // ⚠️ MUST be 'newest-wins' for the same reason as memberLinkKeys: entries are replaced
  // in place at one key per member, so under 'local-wins' a peer holding a stale approval
  // would win the merge and republish it. `required: false` because every dict added after
  // the original three is optional — an envelope that gains `deviceApprovalKeys: {}` where
  // it previously had no key at all serialises differently and is a different file on Drive.
  deviceApprovalKeys: { rule: 'newest-wins', required: false, attributedBy: 'key' },
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
  // Not a wrap dict (no `wrapped`), so not in the registry: merged explicitly, like the
  // passphrase. A union — a tombstone either side has seen must survive.
  const revokedKeys = mergeRevokedKeys(incoming.revokedKeys, local.revokedKeys);

  return {
    ...incoming,
    ...dicts,
    ...(passphrase ? { recoveryPassphrase: passphrase } : {}),
    ...(revokedKeys ? { revokedKeys } : {}),
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

// ── Revocation tombstones (tracker #77) ─────────────────────────────────────────

/** `member:<memberId>` — every entry attributed to the member, in every attributing dict. */
export function memberRevocationKey(memberId: string): string {
  return `member:${memberId}`;
}

/**
 * `<field>:<entryKey>` (slot-wide) or `<field>:<entryKey>:<wrapped>` (value-pinned).
 * The pinned value is IN the key so two tombstones pinning different wraps of one slot
 * can never collide and shadow each other (unclaim → re-claim → unclaim).
 */
export function revocationKey(
  field: EnvelopeKeyDictField,
  entryKey: string,
  pinnedWrapped?: string
): string {
  return pinnedWrapped === undefined
    ? `${field}:${entryKey}`
    : `${field}:${entryKey}:${pinnedWrapped}`;
}

/**
 * The inverse of `revocationKey` for SLOT-WIDE tombstones only: the entry key of a
 * `<field>:<entryKey>` tombstone on `field`, or `null` for a value-pinned key, a member
 * key, or another field. Lives beside `revocationKey` so the two cannot drift (tracker
 * #99 reads kit tombstones back into the Manage Kits list). Safe because entry keys
 * (hex kit ids, member ids, base64url hashes) never contain `:`.
 */
export function slotTombstoneEntryKey(
  field: EnvelopeKeyDictField,
  tombstoneKey: string
): string | null {
  const parts = tombstoneKey.split(':');
  return parts.length === 2 && parts[0] === field && parts[1] !== '' ? parts[1] : null;
}

/** Union of two tombstone sets; on a key collision the EARLIEST `revokedAt` wins. */
export function mergeRevokedKeys(
  a: Record<string, EnvelopeTombstone> | undefined,
  b: Record<string, EnvelopeTombstone> | undefined
): Record<string, EnvelopeTombstone> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, EnvelopeTombstone> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) {
    // eslint-disable-next-line security/detect-object-injection -- keys come from the tombstone set itself
    const existing = out[k];
    // eslint-disable-next-line security/detect-object-injection -- as above
    if (!existing || v.revokedAt < existing.revokedAt) out[k] = v;
  }
  return out;
}

function entryMemberId(
  attributedBy: MemberAttribution,
  entryKey: string,
  value: unknown
): string | undefined {
  if (attributedBy === 'key') return entryKey;
  if (attributedBy === 'value.memberId') {
    const id = (value as { memberId?: unknown } | null)?.memberId;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/**
 * Drop every entry `revokedKeys` names. Pure; returns a fresh envelope and how many
 * entries it dropped (the caller's signal that a file still carried revoked wraps).
 *
 * An entry whose `wrapped` is `''` holds no key material and is NEVER dropped: that is
 * the shape of the `memberLinkKeys` newest-wins revocation overwrite, and it has to stay
 * in the file for an OLD client — which ignores `revokedKeys` — to lose the merge to it.
 */
export function applyRevokedKeys(envelope: BeanpodFileV4): {
  envelope: BeanpodFileV4;
  filtered: number;
} {
  const revoked = envelope.revokedKeys;
  if (!revoked || Object.keys(revoked).length === 0) return { envelope, filtered: 0 };

  let filtered = 0;
  const next: BeanpodFileV4 = { ...envelope };
  for (const field of Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[]) {
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    const dict = envelope[field] as Record<string, { wrapped: string }> | undefined;
    if (!dict) continue;
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    const { attributedBy } = ENVELOPE_KEY_DICTS[field];
    let kept: Record<string, { wrapped: string }> | null = null;
    for (const [entryKey, value] of Object.entries(dict)) {
      const memberId = entryMemberId(attributedBy, entryKey, value);
      const drop =
        value.wrapped !== '' &&
        (revocationKey(field, entryKey) in revoked ||
          revocationKey(field, entryKey, value.wrapped) in revoked ||
          (memberId !== undefined && memberRevocationKey(memberId) in revoked));
      if (drop) {
        filtered++;
        kept ??= { ...dict };
        // eslint-disable-next-line security/detect-object-injection -- entryKey is an own key of dict
        delete kept[entryKey];
      }
    }
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    if (kept) (next as unknown as Record<string, unknown>)[field] = kept;
  }
  return filtered === 0 ? { envelope, filtered: 0 } : { envelope: next, filtered };
}

/**
 * THE envelope merge (tracker #77): `preserveLocalKeyDicts` (union + tombstone union),
 * then `applyRevokedKeys`, plus whether the result must be PUBLISHED.
 *
 * `needsPublish` is true when this side holds something the incoming file lacks — more
 * key entries (the old `keyDictSize >` signal), a tombstone the file has not got — or when
 * the incoming file still carried revoked entries (an old client re-published them), so
 * a save cleans the file. A count alone can never see a revocation: filtering one entry
 * and adding one tombstone leaves every count where it was.
 *
 * `filtered` counts entries the incoming file carries against ITS OWN tombstones — the
 * old-client resurrection metric. Pure; the caller logs it (the worker imports this module).
 */
export function mergeEnvelopes(
  incoming: BeanpodFileV4,
  local: BeanpodFileV4 | null | undefined
): { envelope: BeanpodFileV4; needsPublish: boolean; filtered: number } {
  // ⚠️ FILTER EACH SIDE BEFORE THE UNION, not after. `local-wins` would otherwise let a
  // REVOKED local entry shadow a LIVE incoming one in the same slot — a stale peer's
  // pre-unclaim wrap beating the re-claimed member's new one — and the filter would then
  // drop the survivor, leaving the slot empty and publishing that loss.
  const revokedKeys = mergeRevokedKeys(incoming.revokedKeys, local?.revokedKeys);
  const incomingClean = applyRevokedKeys({ ...incoming, revokedKeys });
  const localClean = local ? applyRevokedKeys({ ...local, revokedKeys }).envelope : local;
  const envelope = preserveLocalKeyDicts(incomingClean.envelope, localClean);
  const incomingTombstones = incoming.revokedKeys ?? {};
  const hasNewTombstone = Object.keys(revokedKeys ?? {}).some((k) => !(k in incomingTombstones));
  // `incomingClean.filtered` is what the file still carries that it should not; its
  // surviving size is the fair baseline for "this side holds more" (the raw file's size
  // would hide a local addition behind a revoked entry).
  const needsPublish =
    keyDictSize(envelope) > keyDictSize(incomingClean.envelope) ||
    hasNewTombstone ||
    incomingClean.filtered > 0;
  // The METRIC counts only what the file's OWN tombstones drop — an entry an old client
  // re-published against a revocation the file already records. Entries dropped by a
  // tombstone only this side holds are just an ordinary revocation on its way out.
  return { envelope, needsPublish, filtered: applyRevokedKeys(incoming).filtered };
}

/**
 * The tombstones that revoke a member's key material.
 *
 * - `'remove'`: `member:<id>` (every attributed entry, seen or not) plus a slot tombstone
 *   for EVERY `inviteKeys` entry — invites carry no memberId, and expiry is only a client
 *   check, so an expired wrap still opens with its token.
 * - `'unclaim'`: VALUE-PINNED tombstones for the member's current `wrappedKeys` entry and
 *   attributed passkey wraps only. The member stays, and re-claiming re-wraps the same
 *   slots; a slot-wide or member tombstone would lock them out for good.
 *
 * `unattributedPasskeys` counts passkey wraps with no `memberId` (legacy): they cannot be
 * attributed and are left alone, but the count is logged.
 */
export function revocationTombstonesForMember(
  envelope: BeanpodFileV4,
  memberId: string,
  opts: { mode: 'remove' | 'unclaim'; now: string }
): { tombstones: Record<string, EnvelopeTombstone>; unattributedPasskeys: number } {
  const tombstones: Record<string, EnvelopeTombstone> = {};
  const stamp = (key: string, wrapped?: string) => {
    // eslint-disable-next-line security/detect-object-injection -- key built by revocationKey
    tombstones[key] =
      wrapped === undefined ? { revokedAt: opts.now } : { revokedAt: opts.now, wrapped };
  };
  const unattributedPasskeys = Object.values(envelope.passkeyWrappedKeys ?? {}).filter(
    (p) => !p.memberId
  ).length;

  if (opts.mode === 'remove') {
    stamp(memberRevocationKey(memberId));
    for (const hash of Object.keys(envelope.inviteKeys ?? {})) {
      stamp(revocationKey('inviteKeys', hash));
    }
    return { tombstones, unattributedPasskeys };
  }

  // eslint-disable-next-line security/detect-object-injection -- memberId is the caller's member
  const own = envelope.wrappedKeys?.[memberId];
  if (own?.wrapped) stamp(revocationKey('wrappedKeys', memberId, own.wrapped), own.wrapped);
  for (const [credId, p] of Object.entries(envelope.passkeyWrappedKeys ?? {})) {
    if (p.memberId === memberId && p.wrapped) {
      stamp(revocationKey('passkeyWrappedKeys', credId, p.wrapped), p.wrapped);
    }
  }
  return { tombstones, unattributedPasskeys };
}

/**
 * Does the envelope hold ANY key material attributed to this member, in any dict the
 * registry says can attribute one? Registry-driven, so a new attributed dict is covered
 * without touching the callers.
 */
export function memberHasKeyMaterial(envelope: BeanpodFileV4, memberId: string): boolean {
  for (const field of Object.keys(ENVELOPE_KEY_DICTS) as EnvelopeKeyDictField[]) {
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    const { attributedBy } = ENVELOPE_KEY_DICTS[field];
    if (!attributedBy) continue;
    // eslint-disable-next-line security/detect-object-injection -- key is from the literal registry
    const dict = (envelope[field] ?? {}) as Record<string, { wrapped: string }>;
    for (const [key, value] of Object.entries(dict)) {
      if (value.wrapped !== '' && entryMemberId(attributedBy, key, value) === memberId) return true;
    }
  }
  return false;
}
