/**
 * Who the registry row says OWNS the family (`ownerMemberId`, `ownerEmail`), and when a PUT may
 * change that.
 *
 * WRITE-ONCE BY DEFAULT, OPT-IN SYNC
 * Both fields are write-once on every ordinary PUT (sign-in, country, rename, pointer moves,
 * pre-split clients): the first stamp sticks. They change ONLY on a PUT carrying the transient
 * `ownerSync: true` flag (never stored, like `isLoginEvent`), and then only when every condition
 * below holds. An ambient write therefore can never move ownership, however stale the roster
 * cache that built it. See `~/projects/beanies-ops/docs/plans/2026-10-06-registry-owner-sync.md`.
 *
 * A HANDOVER IS LOCKED AFTER THE FIRST ONE, EXCEPT FOR A DELIBERATE TRANSFER
 * Every owner sync says why it was sent (`ownerSyncReason`, transient like the flag):
 *  - `transfer`: the registered owner's device has just handed the pod on (it flushed the save
 *    that records the transfer first). Always allowed.
 *  - `drift` (or anything else / absent): the device noticed the roster and the row disagree.
 *    That judgement rests on how fresh the device's roster is, which nothing can prove, so a
 *    drift HANDOVER is allowed only ONCE per row (the one-time repair of a legacy row that
 *    latched the wrong person). A successful handover stamps `ownerHandoverAt`; after that a
 *    drift handover is `refused-handover-locked`, so a device on a stale roster can never hand
 *    ownership back. Email sync is never locked: it cannot move authority.
 *
 * THE POINTER IS MOVED BY PRESENCE, NEVER BY TRUTHINESS (`pointerPresent`, `resolvePointer`)
 * A PUT that carries none of `provider` / `fileId` / `displayPath` asks for NO pointer move, and
 * the stored pointer stays, whoever sends it. That is how a device that opened the pod without
 * its storage provider restored (a cold boot, a revoked Google grant) avoids rewriting a Drive
 * family's canonical pointer to `'local'`. The test is key PRESENCE, not truthiness, because a
 * genuine local family's `fileId: null` is a real pointer: `{ provider: 'local', fileId: null }`
 * is present and moves the pointer (from the owner). Precedent: `'writerEmail' in body` in
 * `index.mjs`. See `~/projects/beanies-ops/docs/plans/2026-10-23-disconnect-save-first-registry-pointer-leavers-channel.md`.
 *
 * PURE, ON PURPOSE (the `entitlement.mjs` pattern)
 * No AWS imports, no `process.env`, no clock (the caller passes `now`), no logging. `index.mjs`
 * owns the I/O: it logs the `registry_owner_sync` line from `sync`, and skips the PutItem when
 * `write` is false.
 */

/** A family / member id. Shared with `index.mjs`, which imports it from here (one definition). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Case-folded, trimmed email for comparison; null for a non-string. Shared with `index.mjs`. */
export const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : null);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_SUFFIXES = ['@temp.beanies.family', '@setup.local'];

/**
 * The address worth storing as the owner's contact email, or `null`: trimmed, at most 254 chars,
 * shaped like an address, and not one of the placeholders the app invents for members with no
 * address yet (`<ts>@temp.beanies.family`, `pending-*@setup.local`).
 *
 * ⚠️ TWIN of src/utils/email.ts realEmail — pinned by src/utils/__tests__/attributionTwinDrift.test.ts
 * (it cannot be imported: every Lambda here is its own zip). Change them together.
 */
export function realEmail(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return null;
  return trimmed;
}

/**
 * Does the body carry a pointer at all? Key PRESENCE, never truthiness: a local family's
 * `fileId: null` is a pointer (see the header). Absent means "no move asked for".
 */
export function pointerPresent(body) {
  return 'provider' in body || 'fileId' in body || 'displayPath' in body;
}

/**
 * Does the body's pointer name the row's stored canonical pod? Provider and fileId only, with the
 * PUT arm's own normalisation (`resolvePointer` below); `displayPath` is cosmetic and ignored
 * (adding it would make an `ownerSync` transfer `refused-off-canonical` after a mere file rename).
 * A body with no pointer (`!pointerPresent`) asks for no move, so it is on the canonical pointer.
 */
export function onCanonicalPointer(body, existing) {
  return (
    (body.provider || 'local') === (existing.provider || 'local') &&
    (body.fileId || null) === (existing.fileId ?? null)
  );
}

/**
 * The pointer the PUT arm stores, and whether the write's pointer was accepted.
 *
 * `accepted` is true for the owner, for a body with no pointer (nothing was asked for), and for a
 * body whose three fields equal the stored ones (a no-op echo, `displayPath` included, so a member
 * renaming the file is still a refused move). A refused or absent pointer keeps the stored one.
 *
 * @param {object} body the parsed PUT body
 * @param {object} existing the stored row (`{}` when there is none)
 * @param {boolean} isOwner the PUT arm's pointer-authority answer for this writer
 * @returns {{ provider: string, fileId: string|null, displayPath: string|null,
 *   present: boolean, accepted: boolean }}
 */
export function resolvePointer(body, existing, isOwner) {
  const present = pointerPresent(body);
  // ONE normalisation for provider + fileId (`onCanonicalPointer`); only the `displayPath`
  // term is this arm's own, the ownerSync arm deliberately ignores it.
  const samePointer =
    present &&
    onCanonicalPointer(body, existing) &&
    (body.displayPath || null) === (existing.displayPath ?? null);
  const accepted = isOwner || !present || samePointer;
  if (!present || !accepted) {
    return {
      provider: existing.provider || 'local',
      fileId: existing.fileId ?? null,
      displayPath: existing.displayPath ?? null,
      present,
      accepted,
    };
  }
  return {
    provider: body.provider || 'local',
    fileId: body.fileId || null,
    displayPath: body.displayPath || null,
    present,
    accepted,
  };
}

const tail = (id) => (typeof id === 'string' && id ? id.slice(-6) : null);

/**
 * The condition a PUT's whole-item write carries so it cannot land on a row whose OWNER VERSION
 * moved since it was read. `ownerHandoverAt` is that version: every handover stamps a new one and
 * no other write changes it. Returned unmarshalled (`index.mjs` marshals it; this module imports
 * nothing from AWS).
 *
 * @param {object|null} existing the row the PUT read, or null when there was none
 * @returns {{ expression: string, values: object|null }}
 *   - no row read: `attribute_not_exists(familyId)`, so a row created in between is re-read and
 *     merged into rather than overwritten (a create on an empty key is unchanged);
 *   - `ownerHandoverAt` read as a value: it must still be that value;
 *   - read as null or absent (never handed over; rows written since the lock shipped store
 *     `NULL`): it must still be absent or `NULL`.
 */
export function ownerVersionCondition(existing) {
  if (!existing) return { expression: 'attribute_not_exists(familyId)', values: null };
  const version = existing.ownerHandoverAt;
  if (version === undefined || version === null) {
    return {
      expression:
        'attribute_not_exists(ownerHandoverAt) OR attribute_type(ownerHandoverAt, :nullType)',
      values: { ':nullType': 'NULL' },
    };
  }
  return { expression: 'ownerHandoverAt = :ownerVersion', values: { ':ownerVersion': version } };
}

/**
 * The owner fields for this PUT's item, whether the PUT may write at all, and (for an `ownerSync`
 * request) the outcome to log.
 *
 * @param {{ existing: object, body: object, isOwner: boolean, now: string }} args
 *   `existing` is the stored row (`{}` when there is none), `body` the parsed request, `isOwner`
 *   the PUT arm's pointer-authority answer for this writer, `now` the request's ISO timestamp
 *   (stamped as `ownerHandoverAt` by a handover).
 * @returns {{ ownerMemberId: string|null, ownerEmail: string|null, ownerHandoverAt: string|null,
 *   write: boolean,
 *   sync: null | { outcome: string, fromTail: string|null, toTail: string|null } }}
 *   `ownerHandoverAt` is the value to store: the stored one on every write except a handover.
 *   `write` false means: write NOTHING (no create, no revive, no metadata refresh). Only an
 *   `ownerSync` request can get false, and only `handover` / `email-synced` get true. With
 *   `write` false, `ownerMemberId` / `ownerEmail` are what the response may report: the stored
 *   owner, or null for `refused-deleted` (a tombstone's owner is never echoed).
 */
export function resolveOwnerFields({ existing, body, isOwner, now }) {
  const storedHandoverAt = existing?.ownerHandoverAt ?? null;
  if (body.ownerSync !== true) {
    // Today's write-once values. `||` on both sides so a stored `''` heals (see index.mjs);
    // `realEmail` on the body so a placeholder or malformed address can never latch.
    return {
      ownerMemberId: existing.ownerMemberId || (isOwner ? body.ownerMemberId || null : null),
      ownerEmail: existing.ownerEmail || realEmail(body.ownerEmail) || null,
      ownerHandoverAt: storedHandoverAt,
      write: true,
      sync: null,
    };
  }

  const storedId = existing?.ownerMemberId ?? null;
  const storedEmail = existing?.ownerEmail ?? null;
  const fromTail = tail(storedId);
  const toTail = tail(body.ownerMemberId);
  const keep = (outcome) => ({
    ownerMemberId: storedId,
    ownerEmail: storedEmail,
    ownerHandoverAt: storedHandoverAt,
    write: false,
    sync: { outcome, fromTail, toTail },
  });

  // No create and no revive: an ownership sync only ever edits a live row. The owner it reports
  // is null, never a tombstone's stored owner: a deleted family's owner is not this caller's to read.
  if (!existing || !existing.familyId || existing.deletedAt) {
    return { ...keep('refused-deleted'), ownerMemberId: null, ownerEmail: null };
  }
  // A pre-split client sends its own session id as `ownerMemberId`; it is never an owner claim.
  if (!('writerMemberId' in body)) return keep('refused-pre-split');
  // No registered owner id means no authority to check the writer against (legacy tiers 2/3).
  if (!storedId) return keep('refused-no-owner-id');
  // Only the registered owner can hand ownership on or edit the contact address.
  if (!isOwner) return keep('refused-not-owner');
  // A device on a copy of the pod must not undo a transfer made on the canonical one. A device
  // that cannot even name where the pod lives (no pointer: its provider did not restore) is not
  // provably on it either, so it fails CLOSED with its own outcome, not the misleading
  // off-canonical one a fallback `'local'` used to earn it (2026-10-23).
  if (!pointerPresent(body)) return keep('refused-no-pointer');
  if (!onCanonicalPointer(body, existing)) return keep('refused-off-canonical');
  if (!UUID_RE.test(body.ownerMemberId ?? '')) return keep('refused-invalid-target');

  const email = realEmail(body.ownerEmail);
  if (body.ownerMemberId !== storedId) {
    // A deliberate transfer always; a drift repair only while the row has never been handed
    // over (see the header). Anything other than 'transfer' is drift.
    if (body.ownerSyncReason !== 'transfer' && storedHandoverAt) {
      return keep('refused-handover-locked');
    }
    // Never leave the previous owner's address next to the new owner's id.
    return {
      ownerMemberId: body.ownerMemberId,
      ownerEmail: email ?? null,
      ownerHandoverAt: now,
      write: true,
      sync: { outcome: 'handover', fromTail, toTail },
    };
  }
  if (email && normEmail(email) !== normEmail(storedEmail)) {
    return {
      ownerMemberId: storedId,
      ownerEmail: email,
      ownerHandoverAt: storedHandoverAt,
      write: true,
      sync: { outcome: 'email-synced', fromTail, toTail },
    };
  }
  return keep('unchanged');
}
