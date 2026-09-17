# Plan: Your beanies magic link (7-day), optional PIN reset on kit entry, and a holistic iPhone joiner sweep

> **SCOPE CHANGE 2026-09-17 (greg, mid-plan).** The link is **7-day, not permanent**, and **working,
> verifiable revocation is a first-class requirement of THIS plan**. The 7-day link is explicitly
> step one. The end state is **emailing the magic link to a member's known address**, which becomes
> the standard way a family member signs in on a new device or after a cache clear — that is the
> NEXT plan, started immediately after this one. Do not build email delivery here; do not design
> anything that precludes it.

> Date: 2026-09-17
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-17-beanies-magic-link-and-joiner-sweep.md`
> Mockup: `docs/mockups/beanies-magic-link-2026-09-17.html`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family member who set up or joined beanies on one device, I want a personal link I can save
like a password so that I can sign in on any other device with just my PIN — without a recovery
kit, and without resetting the PIN I created a moment ago.

## Context

ADR-034 retired passwords in favour of a PIN-first identity model. It was the right call for the
reasons it states, but it left a structural hole that only becomes visible on a second device.

A family created since Phase 4 is **kit-born**: `createNewFile` writes `wrappedKeys: {}` and the
recovery kit's wrap is the envelope's ONLY wrap (`syncStore.ts:2856-2867`). The PIN is deliberately
never an envelope wrap — a 6-digit PIN is 10⁶ offline guesses against an exfiltrated file — so its
unwrap half is device-local (`deviceUnlock.ts`) and cannot travel.

The consequence: **the recovery kit is not the last-resort route to a second device, it is the only
route.** A disaster-recovery instrument became the front door. Worse:

- On arrival the kit lands the user on a "Set a New PIN" pane (`ProveView.vue:99-108`), so the PIN
  they created minutes ago gets overwritten. The escape exists (`switchTargets` offers "Sign In
  with PIN" once the pod is open, `proveMethods.ts:210`) but it is a quiet text link under a form
  that tells them to set a fresh PIN.
- Joiners end with a PIN and nothing else (`useJoinFlow.ts:1035-1042`: "NO envelope wrap is created
  any more"), and are doubly excluded from the kit prompt (`authPrompts.ts:88` gates on
  `canManagePod`, `:89` on the creator's already-stamped `recoveryKitConfirmedAt`).
- Every person who reaches the unlock screen — including a member returning to their own family —
  reads `loginV6.unlockNoPasswordHint`: _"This file contains another family's encrypted data."_
  (`uiStrings.ts:4122-4126`). **The gate is not the defect, the string is.** The card is gated on
  `v-if="syncStore.hasPendingEncryptedFile"` (`LoadPodView.vue:1577`), and a previous pass added
  that gate for exactly this class of bug. But `hasPendingEncryptedFile` is
  `pendingEncryptedFile !== null` (`syncStore.ts:627`) — "a file is staged and not yet decrypted" —
  which is true for a returning member on a cold device. The gate cannot distinguish stranger from
  member; only the copy can stop asserting.

Measured context from the same-day `/beanies-metrics` run: **84 real families, 26 registered and
never truly engaged, and the create-family flow converts only 53% of starters.**

This plan adds the missing portable credential, stops the kit from clobbering PINs, fixes the copy
defect, and then sweeps the whole joiner chain on iPhone.

## Requirements

1. Mint a per-member **"your beanies magic link"** at BOTH pod creation (owner) and join (joiner).
2. **The link expires 7 days after it is minted.** `MAGIC_LINK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000`,
   beside `INVITE_EXPIRY_MS` (24h) and `LINK_EXPIRY_MS` (15min) in `inviteService.ts`. Redemption
   after expiry fails with a NAMED reason and an offer to create a new one.
3. The link is a high-entropy token transported as a URL + QR, carrying the file LOCATOR (`fam`,
   `p`, `ref`, `fileId`) the way `buildInviteLink` already does, so one scan does the whole journey.
   The recovery kit gets you a key but not the file locator; the magic link carries both.
   ⚠️ **The locator is not ACCESS.** Redeeming still requires a Google account that can read the
   file — the `drive.file` grant the Picker creates, or the writer grant
   `useInviteFlow.shareDriveAccess` issued at invite time — or a local copy of the `.beanpod`. This
   is a real second factor (a stolen URL alone opens nothing) AND a real failure mode: a magic link
   opened while signed into the wrong Google account fails at file read, not at unwrap. Every
   acceptance criterion and browser test that opens a link must state which Google account the
   device is signed into.
4. On arrival, the link opens the pod and lands the user directly on **their own member's PIN
   entry** — no person picker, no kit prompt, no passphrase prompt.
5. The magic link must NOT authorize a PIN reset. The kit-only gate at `useLoginFlow.ts:898-920`
   (`recoveryOpenedBy !== 'kit'` → return) stays byte-identical.
6. Store the wrap in a NEW additive-optional envelope dict **keyed by `memberId`**, carrying
   `keyId`, `createdAt` and `expiresAt`.
   5b. **REVOCATION IS A DELIVERABLE, NOT A PROPERTY.** Minting a new link MUST kill the previous one,
   and that must be demonstrated in code, in tests, and by hand — not asserted. Three mechanisms,
   all required, because no one of them is sufficient:
   (a) keying by `memberId` so the new wrap OVERWRITES the old at the same key;
   (b) the `'newest-wins'` merge rule, without which a peer holding the stale entry republishes it
   and the revocation silently un-happens;
   (c) monotonic `createdAt`, so a fast clock cannot make a dead link outlive its replacement.
   The 7-day `expiresAt` is a SAFETY NET on top of these, not a substitute: a revocation that fails
   to propagate must not leave a working link for a week.
7. Register the new dict in ONE place — `envelopeMerge.ENVELOPE_KEY_DICTS` — which both
   `preserveLocalKeyDicts` (so it is not dropped) and `keyDictSize` (so an offline mint still
   triggers a publish) iterate. Registering in two hand-written lists is what Phase 1c exists to
   delete; a requirement that still names both would reinstate it.
8. Never persist the token. Settings can only CREATE A NEW link (rotating and thereby revoking);
   it can never re-display the current one.
9. Settings → Security & Recovery gains a card showing status plus a single action, with an
   explicit "this cancels your current one" warning.
10. Recovery-kit arrival defaults to normal PIN entry, with an OPTIONAL, visually subordinate
    "Forgot your PIN? Reset it" affordance that appears ONLY when `recoveryOpenedBy === 'kit'`.
11. Pod creation keeps its mandatory unclosable recovery-kit step and presents the magic link on
    the SAME screen as one combined "save these" step with a single confirm.
12. Fix the unlock-screen copy defect at `LoadPodView.vue:1577`.
13. Full observability coverage (see the dedicated section) with a success denominator.
14. A holistic iPhone joiner sweep (Phase 4) verifying the already-shipped-but-undeployed join
    fixes and hunting residual friction.
15. **A paste-a-link fallback exists in the app** (greg, 2026-09-17). One field on the WelcomeGate
    accepting a pasted invite OR magic link, for when a universal link fails to open the app.
    VERIFIED: no such affordance exists today — the only paste patterns in the repo are the recipe
    importer and the diagnostic blob.
16. **The joiner must be SHOWN and able to save their link before the flow hands off.** A minted
    link that is never displayed is a dead entry in the envelope: the token is never persisted
    (requirement 7), so the moment `handleSubmitPin` returns it is gone forever.

## Shipping Order

**This plan ships in FOUR changes, not one.** The seams are where the blast radii differ.

1. **Ship 1 — the small fixes, first.** Phase 2 (`ProveView` default target), Phase 3 (the
   `unlockNoPasswordHint` string + the template comment), and **1g, the `invite_token_tail`
   truncation**. No new surface, no new credential. These address the MEASURED failure (5 of the 6
   real kit redemptions clobbered a PIN) and close an active token leak. Holding them behind the
   rest is the most expensive sequencing choice available.
2. **Ship 2 — the merge registry, alone.** Phase 1c with the FOUR EXISTING dicts and no
   `memberLinkKeys`. A behaviour-preserving refactor of the file that silently destroys key material
   when wrong; landing it alone makes "the existing tests pass unchanged" an unambiguous proof. Ship
   3 then adds dict #5 as one line, which DEMONSTRATES the registry's claim instead of asserting it.
3. **Ship 3 — the credential.** 1a, 1b, 1d, 1e, 1f, telemetry, help docs. Sub-seam: land
   `useClipboard` + `useMintedLink` + `MintedLinkPanel` + the `DeviceLinkCard` rewrite first as a
   no-new-feature refactor (it carries a visual change to a shipped surface), then `MagicLinkCard`.
   3b. **NEXT PLAN, not this one — email delivery.** Sending the magic link to a member's known email
   becomes the standard way a family member signs in on a new device or after a cache clear, and it
   is what closes the 7-day window's gap. Starts immediately after this plan finishes. Nothing here
   may preclude it: keep minting in a service separate from UI, keep the memberId-keyed dict for the
   saved link, and leave `inviteKeys` free for a short-TTL one-shot so an emailed link does not have
   to invalidate a saved one.
   3c. **Ship 3c — deep linking (Phase 5).** 5a config, 5b the inbound-link bridge, 5d the fragment
   move. ⚠️ The iOS half needs an entitlement change → provisioning refresh → NEW NATIVE BUILD, so
   it cannot take effect from today's web deploy; the Android half and 5d can. 5c (Install Referrer)
   is recommended DEFERRED.
4. **Ship 4 — Phase 4, and it is not code.** ⚠️ PREREQUISITE: `main` must be DEPLOYED first. The
   sweep's first job is verifying `b0999459` / `1e1d1c18` / `855a0809`, which are provably not
   ancestors of the last prod deploy `92ec4937` (65 commits behind). Until the deploy happens there
   is nothing to verify, and running the sweep against production would measure the OLD code and
   report the already-fixed bug as still broken.

## Important Notes & Caveats

- **Keying by `memberId` is the load-bearing design decision, not an implementation detail.**
  `mergeKeyDict` is `{...(remote ?? {}), ...(local ?? {})}` — **LOCAL-WINS**, not
  last-writer-wins, and its own docstring says so (`envelopeMerge.ts:44-54`). A _deletion_ cannot
  propagate at all: that is the union-merge trap that makes `inviteKeys`, `wrappedKeys` and
  `passkeyWrappedKeys` permanently unrevocable, and `syncStore.retireMemberKeyMaterial`
  (`:5920-5948`) documents it as a standing limitation. ⚠️ **An overwrite at the same key does NOT
  propagate either under today's rule** — device B holding the pre-rotation entry in memory wins the
  merge and republishes the dead wrap. Keying by `memberId` is what makes revocation _possible_; the
  `'newest-wins'` `createdAt` arbitration added in 1c is what makes it _work_. **Neither alone is
  sufficient**, and shipping the dict with the default `'local-wins'` rule would give a rotation UI
  that silently does nothing. Keying by token hash (the `inviteKeys` shape) would give permanently
  accumulating key material and no revocation under any rule. Keying by
  token hash (the `inviteKeys` shape) would give permanently accumulating key material and no
  revocation. Do not "simplify" this into the existing invite dict.
- **`createdAt` arbitration is required, not optional.** Unconditional local-wins lets a peer still
  holding the old wrap in memory revert a rotation on its next fetch+push. This is exactly the
  failure `pickNewerPassphrase` (`envelopeMerge.ts:109-117`) was written to prevent — review
  finding F2 on the passphrase. Mirror that function rather than inventing a second arbitration.
- **`preserveLocalKeyDicts` silently DROPS any dict it does not name** (its own Pass-4 note at
  `envelopeMerge.ts:78-79`). Forgetting to name the new dict destroys every magic link on the first
  merge, silently. This is the single highest-severity implementation hazard in the plan.
- **`keyDictSize` is the second half of the same hazard and is easier to miss.** `keyDictSize`
  (`envelopeMerge.ts:119-130`) is the ONLY signal that this device holds key material the remote
  file lacks — `syncStore.ts:1849` computes `keyDictSize(merged) > keyDictSize(remoteEnvelope)`
  because envelope keys cannot show up in the Automerge-heads `dirty` flag. Its own comment says a
  kit set offline "must trigger a publish exactly like an offline passkey enrolment (this count is
  that signal)". A `memberLinkKeys` entry not counted there is a link that exists on screen and
  never reaches the file — the exact R2-F15 dead-QR failure, arriving silently and later.
- **Do NOT put the wrap in `wrappedKeys`.** Any entry there flips `envelopeCapabilities.password`
  true (`fileSync.ts:245-251`), `coldCredentialSurface` returns `'secret'` first
  (`fileSync.ts:262-279`), and a kit-born family would be shown a password field it has never had.
  Legacy clients also enumerate `wrappedKeys` as (memberId, wrap) pairs and would surface a phantom
  member — the exact Pass-4 finding that gave `recoveryPassphrase` its own field.
- **Carry `keyId` and fail closed on drift.** VERIFIED: no envelope wrap carries a `keyId` today —
  neither `InviteKeyPackage` nor `RecoveryKeyPackage` has one; only `DeviceUnlockRecord` does
  (`deviceUnlock.ts:174-185`). After #117 rotates the family key, a saved magic link would AES-KW
  unwrap **successfully** (the token-derived KEK is unchanged) and hand back a STALE family key,
  surfacing as a confusing decrypt failure instead of an honest "this link is out of date". The new
  package must be better than the ones beside it; do not copy their omission.
- **`keyId` has an existing source — do not invent one.** `BeanpodFileV4.keyId`
  (`syncFileV4.ts:71-72`) is the family-key rotation identifier. `MemberLinkKeyPackage.keyId` is a
  COPY of `envelope.keyId` at mint, compared at redeem exactly the way `unlockWithPin` compares
  `record.keyId !== params.expectedKeyId` (`deviceUnlock.ts:173-184`). Mirror that block's SHAPE —
  emit a `warn`, return a NAMED reason, never a generic unwrap failure — but ⚠️ **NOT its delete.**
  `unlockWithPin` calls `deleteDeviceUnlock` (`deviceUnlock.ts:177`), which removes a DEVICE-LOCAL
  IndexedDB record. The magic-link entry lives in the SHARED envelope, and the device that detects
  the mismatch is cold: it has no family key, no write path to Drive, and the union merge would not
  propagate the deletion anyway. The redeem path emits and reports; it writes nothing. Sweeping
  stale-`keyId` entries belongs to whatever ships #117, from a device that holds the key.
- **Salt encoding: `createInvitePackage` closes the footgun; the TYPE COMMENT is what is left.**
  `createInvitePackage` writes the salt with `bufferToBase64url` (`inviteService.ts:89`) and
  `redeemInviteToken` reads it with `base64urlToBuffer` (`:104`) — a matched pair, so using them
  removes the encoding decision from this plan entirely. That is a second reason to use
  `createInvitePackage` rather than hand-composing. ⚠️ What survives is a DOC bug already in the
  repo: `InviteKeyPackage.salt` is commented `// PBKDF2 salt (base64, 16 bytes)`
  (`syncFileV4.ts:46-47`) when `inviteService` writes base64URL. Fix that comment in 1a; do not
  inherit it.
- **"Only for that user" is UX scoping, NOT a cryptographic compartment.** The link unwraps the
  FAMILY key, so a leaked link exposes all family data regardless of the PIN. The member binding
  and the PIN gate the interface, not the ciphertext — the same class of guarantee as the
  client-side `isInviteExpired` check (`useJoinFlow.ts:810-813`) on a wrap with no time binding.
  **Copy must not overpromise a compartment that does not exist.**
  Concretely: the link decrypts the pod BEFORE any PIN is asked for (`decryptPendingFileWithKey`
  runs in the redeem tail; the login machine starts afterwards from an already-open pod). So the PIN
  that follows a magic link is a UI gate over decrypted data — the same guarantee the device link
  gives today — and a link holder can pick any member in the picker, including tapping through as a
  child (`proveMethods.isChildMember`). The preselected member is a convenience, not a boundary.
  Copy must say "anyone with this link can open your family's information", never "only you can use
  it".
- **`reEncryptEnvelope` is a `{...envelope}` spread** (`fileSync.ts`), so an old client re-writing
  the file PRESERVES the new dict. VERIFIED this session. The merge is the only real drop risk.
- **Naming is a deliberate exception.** CLAUDE.md's terminology table lists standalone "beanies" as
  incorrect. greg chose **"your beanies magic link"** twice, with reasons (it marks the link as
  beanies', as personal, and as the thing that unlocks the family file). Use it verbatim. Do not
  silently normalise it to "magic link".
- **This surface is exempt from playful language.** Per CLAUDE.md's beanie-mode floor, the `beanie`
  values here keep the real nouns (device, family file, PIN, link) and only drop case.
- **Do not change the 15-minute device link.** `DeviceLinkCard` remains correct for "both devices
  in hand right now". VERIFIED: it has NO `canManagePod` gate, only `syncStore.familyKey`, so any
  signed-in member can already mint one.
- **Offline mint is a dead link.** `DeviceLinkCard` already refuses to hand out a QR whose wrap
  never reached the durable file (R2-F15, `DeviceLinkCard.vue:56-61`). Match that behaviour exactly.

## Assumptions

> **Review these before implementation.** Valid at planning time; may have changed.

1. The mockup at `docs/mockups/beanies-magic-link-2026-09-17.html` expresses the intended design.
   **It has NOT been approved by greg** — it was generated while he was away under his explicit
   authorisation to proceed. Treat it as design intent, not a signed-off design.
   ⚠️ **The mockup PREDATES the 7-day scope change and does not show expiry anywhere.** Two gaps to
   close before building to it: (a) the save-step caption "You can cancel this link and create a new
   one in Settings." must also state the 7-day life; (b) the Settings card shows THREE states
   (none / active / just-created) and the status line reads "One link active, created 12 September."
   — a 7-day link needs a FOURTH state, **expired**, and the active line must carry the expiry DATE.
   Requirement 8's "status plus a single action" is not satisfiable without it.
2. Supporting strings the mockup introduced ("Save these two things", "I've saved my link", "Set a
   New PIN", "Save New PIN", "Back to PIN entry", the two Settings status lines) are PROPOSED, not
   approved. They need `uiStrings` entries with both `en` and `beanie` values and greg's review.
3. The recovery passphrase stays exactly as it is, and the magic link **does NOT supersede it**. A
   7-day token is a convenience credential; the passphrase and the kit remain the only durable
   routes back into a family file. (An earlier round claimed the link superseded the passphrase —
   that reasoning assumed a permanent link and died with the scope change.) greg may still want to
   revisit the passphrase, but not because of this plan.
4. A member with no `pinHash` (unclaimed) is NOT issued a magic link; that person still uses the
   invite flow.
5. Email/SMS/WhatsApp delivery is a follow-up. The architecture must not preclude it: keep the
   saved link in the memberId-keyed dict, and let a future emailed one-shot ride the existing
   `inviteKeys` machinery with an added optional `memberId` and a short TTL, so sending an email
   does NOT invalidate the user's saved link.

## Approach

### Phase 1 — the magic link credential

**1a. Envelope type** (`src/types/syncFileV4.ts`)

Add an additive-optional dict following the `recoveryKeys` precedent exactly (same comment
discipline: ADDITIVE OPTIONAL on '4.0', never a version bump).

```ts
/** Per-member saved sign-in link wraps ("your beanies magic link"). Key = memberId. */
memberLinkKeys?: Record<string, MemberLinkKeyPackage>;

/**
 * `InviteKeyPackage` plus the three fields a REVOCABLE, rotation-aware credential needs.
 * Extends rather than restates: salt/wrapped/expiresAt then have ONE definition, and
 * `createInvitePackage`'s return value is structurally assignable to this minus the extras.
 */
export interface MemberLinkKeyPackage extends InviteKeyPackage {
  /**
   * SHA-256 of the LIVE token (base64url — `hashInviteToken`, `inviteService.ts:112`).
   * ⚠️ LOAD-BEARING FOR REVOCATION, not an optimisation. Without it, a link superseded by a
   * newer mint is indistinguishable from a corrupt one: the entry still exists (same memberId
   * key), so the redeem gets as far as `unwrapFamilyKey` and fails THERE, and the user sees the
   * generic "redeem failed, use your recovery kit" instead of the honest "this link has been
   * cancelled". Comparing the hash FIRST is what makes revocation reportable. Storing a hash of
   * a 256-bit CSPRNG token adds no attack surface: `inviteKeys` already stores the same hash, in
   * the clear, as its dict KEY.
   */
  tokenHash: string;
  /** Copy of `envelope.keyId` at mint; mismatch = fail closed (NO write — see caveat). */
  keyId: string;
  /**
   * Merge arbitrator, newest wins. MONOTONIC — see `setMemberLinkWrap` in 1e. REVOCATION
   * depends on this. NOT the expiry clock: `expiresAt` comes from the real wall clock.
   */
  createdAt: ISODateString;
}
```

Two one-line corrections to `InviteKeyPackage` itself, in the same edit, because
`MemberLinkKeyPackage` now inherits its comments:

- `salt` — `(base64, 16 bytes)` → `(base64URL, 16 bytes — written by bufferToBase64url)`. The
  comment has been wrong since the type was written (`inviteService.ts:89`).
- `expiresAt` — `(24h from creation)` → `(INVITE_EXPIRY_MS for invites, LINK_EXPIRY_MS for device
links, MAGIC_LINK_EXPIRY_MS for magic links)`. `DeviceLinkCard.vue:52` already violates the 24h
  claim today.

**1b. Service** (`src/services/auth/magicLink.ts`, new)

Mint / redeem / build-url, deliberately separable from any UI so the email follow-up can reuse it.
Every primitive it needs is **ALREADY EXPORTED** — this service adds no crypto:

- `generateInviteToken()` — `inviteService.ts:32`
- `createInvitePackage(fk, token, MAGIC_LINK_EXPIRY_MS)` — `:79`
- `hashInviteToken(token)` — `:112`
- `redeemInviteToken(wrapped, salt, token)` — `:100`
- `isInviteExpired(expiresAt)` — `:256` (⚠️ takes the STRING, not the package)
- `buildInviteLink` / `parseInviteLink` — `:159` / `:191`
- `generateInviteQR` — `@/utils/qrCode`, **NOT** `inviteService` (`DeviceLinkCard.vue:21`)

`deriveInviteKey`, `wrapFamilyKey`/`unwrapFamilyKey` and `SALT_LENGTH` are NOT called by this
service — `createInvitePackage`/`redeemInviteToken` own them. An earlier draft listed them because
it hand-composed the wrap; the scope change removed that need.

✅ **`createInvitePackage` IS now the right primitive** (scope change: the link is 7-day, not
permanent). Call `createInvitePackage(fk, token, MAGIC_LINK_EXPIRY_MS)` — it already stamps
`expiresAt` exactly as needed, and `isInviteExpired` (`inviteService.ts:256`) already reads it. The
magic-link package is `createInvitePackage`'s output plus `keyId` and `createdAt`. That removes the
hand-composed wrap an earlier draft specified, and with it a whole class of salt-encoding mistake.
The token is still never persisted (the never-persist-the-secret contract the kit uses).

`MAGIC_LINK_EXPIRY_MS` is declared and **exported** in `inviteService.ts` beside `LINK_EXPIRY_MS`
(`:27`) — not in `magicLink.ts`. The three link lifetimes belong in one place. Note
`INVITE_EXPIRY_MS` (`:21`) is private and `LINK_EXPIRY_MS` is exported; follow the latter.

URL shape reuses the existing builder. Extend `InviteLinkParams` with two optional fields the way
`linkMode` was added (`inviteService.ts:144-150`, `:180`, `:234`) — that interface's own comment
says "Adding a new optional field is the only way to extend the URL contract":
`magicLink?: boolean` → `ml=1`, `memberId?: string` → `m=`, giving
`…/join?fam=&p=&ref=&fileId=&t=<token>&ml=1&m=<memberId>`.

⚠️ `parseInviteLink` returns `null` on a malformed URL and silently drops an undecodable
`ref`/`hint` (`inviteService.ts:192-232`). `ml=1` with a MISSING or unparseable `m=` must not
inherit that silence — it is an unusable link, and the caller must surface it (see the Error
Handling Contract), not fall through to the classic invite path.

**1c. Merge** (`src/services/sync/envelopeMerge.ts`)

Four edits, all in this one file. The first turns this plan's highest-severity hazard from a
comment into a **compile error**; the rest hang off it.

1. **Declare the dicts once.** `preserveLocalKeyDicts` (`:73-96`) and `keyDictSize` (`:119-130`)
   each hand-name the dicts today, and neither knows about the other — two independent places to
   forget, and this plan adds a fourth dict. Replace both hand-written lists with one registry plus
   a compile-time exhaustiveness check:

   ```ts
   /** Envelope fields that are MAPS of wraps — derived from the type, not from a list. */
   type EnvelopeKeyDictField = {
     [K in keyof BeanpodFileV4]-?: NonNullable<BeanpodFileV4[K]> extends Record<
       string,
       { wrapped: string }
     >
       ? K
       : never;
   }[keyof BeanpodFileV4];

   type MergeRule = 'local-wins' | 'newest-wins';

   /**
    * Every envelope wrap dict and how its collisions resolve. Adding a dict to
    * `BeanpodFileV4` without adding it here is a TYPE ERROR — `satisfies` requires every
    * `EnvelopeKeyDictField` to be present. This is the ONLY list; both
    * `preserveLocalKeyDicts` and `keyDictSize` iterate it.
    */
   const ENVELOPE_KEY_DICTS = {
     wrappedKeys: { rule: 'local-wins', required: true },
     passkeyWrappedKeys: { rule: 'local-wins', required: true },
     inviteKeys: { rule: 'local-wins', required: true },
     recoveryKeys: { rule: 'local-wins', required: false },
     memberLinkKeys: { rule: 'newest-wins', required: false },
   } as const satisfies Record<EnvelopeKeyDictField, { rule: MergeRule; required: boolean }>;
   ```

   `required` is what preserves today's asymmetry EXACTLY: the three original dicts are written as
   `{}` when absent on both sides (`?? {}` at `:75-77`), while an optional dict absent on both sides
   is OMITTED ENTIRELY — the key must not appear at all, not appear as `undefined` (the
   conditional-spread shape at `:80-82`; `'recoveryKeys' in merged` must stay false). A registry
   carrying only the merge rule cannot reproduce this, and test 3 asserts both halves.

   ⚠️ `memberLinkKeys` MUST be `'newest-wins'`. With the default `'local-wins'` rule a rotation is
   silently reverted by any peer holding the old wrap in memory, and the Settings "create a new
   link" action becomes a no-op that looks like it worked.

   ⚠️ **What the guard does and does not prove.** It proves every dict whose values carry a
   `wrapped: string` is registered. It does NOT prove every envelope field is handled: a future dict
   whose package has no `wrapped` field (tombstones, for instance) is not selected by the type and
   escapes the check. Say so in the comment so nobody over-trusts it.

   Both types must be `export`ed — test 3c needs them.

   Also define the missing helper (named in Files Affected but nowhere in the Approach until now):

   ```ts
   /**
    * Union of keys; per-key the NEWER `createdAt` wins, so a rotation on one device is not
    * reverted by another device's stale in-memory copy. Missing `createdAt` sorts oldest —
    * same rule as `pickNewerByCreatedAt`, which this delegates to per key.
    */
   function mergeNewestWinsDict<T extends { createdAt?: string }>(
     remote: Record<string, T> | undefined,
     local: Record<string, T> | undefined
   ): Record<string, T> | undefined;
   ```

   `recoveryPassphrase` is deliberately NOT selected by that type — it is a scalar wrap (an
   interface, no index signature), so it keeps its own explicit line in both functions.

2. `preserveLocalKeyDicts` iterates `ENVELOPE_KEY_DICTS`, applying `mergeKeyDict` for
   `'local-wins'` and `mergeNewestWinsDict` for `'newest-wins'`, then writing the key ONLY when the
   merged value is defined OR `required` is true (in which case `?? {}`). `keyDictSize` iterates the
   same registry and keeps its `+ (envelope.recoveryPassphrase ? 1 : 0)`.

3. Generalise `pickNewerPassphrase` (`:109-117`) into
   `pickNewerByCreatedAt<T extends { createdAt?: string }>(incoming, local): T | undefined` —
   identical body, one type parameter — used by both the `'newest-wins'` rule and
   `recoveryPassphrase`. Behaviour byte-for-byte, asserted by the existing passphrase tests passing
   UNCHANGED.

4. Fix the misplaced docstring: the block at `:99-108` describes `keyDictSize` but sits above
   `pickNewerPassphrase`. Move it, and rewrite the file header's dict list (`:4-9`) to point at
   `ENVELOPE_KEY_DICTS` rather than restating it — a second list that can drift is the same bug at
   documentation level.

**Why a registry rather than a fourth hand-written entry**: this plan calls "forgetting to name the
dict" its single highest-severity hazard, then mitigates it by asking a human to remember it in two
separate functions. With the registry the next dict is one line, and forgetting it fails
`npm run type-check` instead of destroying key material silently on the first merge.

**1c-bis. Keep the capability model honest** (`src/services/sync/fileSync.ts`)

`envelopeCapabilities` is documented as "the single answer every credential-offer decision consults"
about "what a given envelope can ACTUALLY be opened with" (`:230-244`). After this change that
sentence is false: `memberLinkKeys` can open the envelope and is not represented — deliberately,
because a magic link is not a typed credential and must never reach `coldCredentialSurface`.
`passkeyWrappedKeys` and `inviteKeys` are already excluded the same way, so the model is right and
only the docstring is wrong.

Narrow the docstring rather than the type: state that it answers "which TYPED, cold credential
surface can be offered", and name the wrap kinds deliberately excluded because they are link- or
device-borne and never typed (`inviteKeys`, `passkeyWrappedKeys`, `memberLinkKeys`). No behaviour
change, no new capability flag. Add the assertion that an envelope carrying ONLY `memberLinkKeys`
reports `password`/`passphrase`/`kit` all false and `coldCredentialSurface` returns `'none'`.

**1d. Redemption** (`useJoinFlow.ts`, `useLoginFlow.ts`, `LoginPage.vue`)

⚠️ **`ml=1` is NOT a third mode.** It is `lk=1` with a different wrap source and a pre-selected
member, and building it as a third mode duplicates the entire post-decrypt routing chain for no
behavioural gain. The `lk=1` path is already right: it decrypts, validates the familyId, skips the
unclaimed-member claim flow, and sets `currentStep = 'link-ready'`, which `JoinPodView` (`:77-80`)
emits to `LoginPage.handleLinkReady` (`:668-672`) → `enterFlow` → `flow.startForFamily`
(`useLoginFlow.ts:370`). That is the standard login machine, which already serves EVERY member with
the full prove ladder. All the magic link needs is to arrive there with a member already chosen.

1. `useJoinFlow`: `parsed.magicLink === true` sets `linkMode.value = true` (reusing every existing
   `linkMode` branch at `:806`, `:811`, `:823`, `:870-885`) plus `magicLinkMemberId = parsed.memberId`.
2. **Split the resolver from the decrypt tail rather than branching inside
   `tryInviteTokenDecrypt`.** That function is named for the invite token and begins
   `if (!pending?.envelope?.inviteKeys) return false;` (`useJoinFlow.ts:798`) — a magic-link branch
   above that line leaves the function's name lying, and one below it makes the whole feature depend
   on `inviteKeys` being present. Instead:
   - extract today's tail (`redeemInviteToken` → `decryptPendingFileWithKey` → `asJoinDecryptError`,
     `:815-826`) into `decryptPendingWithWrap(pkg, token)`, unchanged;
   - `tryInviteTokenDecrypt` keeps its `inviteKeys` guard, resolves by token hash, checks
     `isInviteExpired`, calls the tail;
   - `tryMagicLinkDecrypt` resolves `pending.envelope.memberLinkKeys?.[memberId]` and runs FOUR
     checks IN THIS ORDER, each with its own named reason, then calls the same tail:
     1. no entry → `'no-entry'`
     2. `pkg.tokenHash !== await hashInviteToken(token)` → `'link-revoked'`
     3. `isInviteExpired(pkg.expiresAt)` → `'token-expired'`
     4. `pkg.keyId !== pending.envelope.keyId` → `'key-rotated'` + `warn`
        **Order matters**: revocation is checked BEFORE expiry, because a user who rotated their link
        yesterday needs "you created a newer link", not "it lapsed". ⚠️ `isInviteExpired` takes the
        STRING (`inviteService.ts:256`; `useJoinFlow.ts:810` already calls it as
        `isInviteExpired(pkg.expiresAt)`) — never the package.
   - the ONE branch lives at the single call site, choosing which resolver runs.

   Two flat five-line functions over one shared tail, instead of one function with two preconditions
   and a nested branch. Every error arm in the Error Handling Contract stays where it is.

3. `JoinPodView`'s `link-ready` emit becomes a SINGLE OBJECT payload —
   `'link-ready': [{ familyId, familyName, preselectMemberId?, linkKind }]` — replacing today's two
   positional args (`JoinPodView.vue:64-70`). A third positional argument is where this thread turns
   fragile; one object means a future field is additive and unordered. One emit site, one handler
   (`LoginPage.handleLinkReady`, `:668-672`), so the change is contained. `LoginPage.enterFlow`
   (`:132`) takes an optional third `opts` bag and passes it through; its five other call sites are
   untouched.

   ⚠️ **Delete `emitDeviceLinkRedeemed(true)` at `JoinPodView.vue:78` in the same edit.** The
   success emit moves to the login machine's `done` branch; leaving the existing call in the
   `link-ready` watch means every device link is counted twice and the denominator this change
   exists to create is wrong from day one. The failure arms (`useJoinFlow.ts:806, 811, 823`) stay
   exactly where they are.

4. `useLoginFlow.startForFamily` gains an optional third `opts`. After `dispatch({ type: 'START' })`
   (`:402-408`), if `opts?.preselectMemberId` matches a person in `built.people`, call the EXISTING
   `onPickPerson(person)` — the same function the picker tap calls. No new state, no new event, no
   bypass of the prove machine. `recoveryOpenedBy` is never written on this path, so the
   `onResetPin` gate (`useLoginFlow.ts:915`) stays shut **by construction** rather than by
   remembering not to.

   **`preselectMemberId` is a UI HINT with zero authorization weight**, and should be read that way
   at every layer it crosses. It is validated against `built.people`, it selects the same
   `onPickPerson` a tap would, it is never persisted, and it grants nothing — the full prove ladder
   still runs. Threading it explicitly through four layers is correct precisely BECAUSE it is inert:
   a store field or module-level variable would be hidden state with a lifetime bug waiting (a stale
   value pre-selecting a member on a later, unrelated login), which is the failure mode
   `stageInFlight`'s tagging comment (`useLoginFlow.ts:190-200`) exists to describe. Do not
   "simplify" it into shared state.

5. **Member not found in `built.people`** must NOT fail silently: fall through to the normal picker,
   surface `proveError` naming the cause, emit `error_code: 'member-missing'`. A magic link for a
   member deleted on another device is a real state.

**The success denominator lands in `useLoginFlow`, at the `done` state — not at
`PROVE_SUCCEEDED`.** The comment at `useJoinFlow.ts:870-884` explains why `link-ready` is too early
("it hands off to the standard login machine, which still has to show the person picker and prove a
PIN… the rate would look healthy during exactly the failure it exists to surface").
`PROVE_SUCCEEDED` is a milder version of the same mistake: the credential proved, but the pod can
still fail to open (`OPEN_FAILED` exists), and it is dispatched from **FIVE** sites
(`useLoginFlow.ts:666, 694, 761, 892, 929`) — five copies of one emit.

Emit from the single `if (s.kind === 'done')` branch in `runStateEffect` (`useLoginFlow.ts:539`).
One site, and it is the honest terminal: the person is in.

The link kind rides a closure-local `openedByLink: 'device' | 'magic' | null`, set by
`startForFamily`'s `opts`, READ AND CLEARED in that same `done` branch — beside the existing
`recoveryOpenedBy.value = null`, which is the identical lifecycle and the precedent to copy. It must
ALSO be cleared on `idle` (beside `recoveryOpenedBy.value = null` at `useLoginFlow.ts:552`) and on
every `START`, or a later manual login gets credited to a link the user is no longer using.
⚠️ ORDERING: the `START` clear lives in `dispatch`, and `startForFamily` assigns `openedByLink` from
`opts` AFTER `dispatch({ type: 'START' })` and before `onPickPerson` — assign it first and the clear
wipes it. Note this differs from `recoveryOpenedBy`, which is NOT cleared on `START` today; the
divergence is deliberate (a link opener is per-arrival, a recovery opener survives the picker) and
belongs in the comment. A closure local, never module-level, per `useLoginFlow.ts:190-196`.

**1e. Issuance points** — all three go through ONE store method.

`syncStore.setMemberLinkWrap(memberId, pkg): Promise<boolean>` must mirror `addInvitePackage`
(`syncStore.ts:3263-3295`), **NOT** `addRecoveryKey` (`:5892-5903`). The two have deliberately
different contracts: `addRecoveryKey` is fire-and-forget and rides the next save, while
`addInvitePackage` awaits `syncNow(true)`, logs on failure and RETURNS the boolean. The magic link
needs the latter — "offline mint is a dead link" is exactly `addInvitePackage`'s contract, and
`DeviceLinkCard.vue:54-61` is the caller-side half of it.

`syncStore` will then hold FOUR near-identical envelope-key writers — `addInvitePackage`
(`:3263-3295`), `addRecoveryKey` (`:5888-5903`), `setRecoveryPassphraseWrap` (`:5906+`) and
`addPasskeySecret` — each repeating `const env = {...envelope.value}` → mutate one dict →
`envelope.value = env` → `syncService.setEnvelope(env)`, differing only in whether they await a
publish. Factor that common body into one private helper
`putEnvelopeEntry(dict, key, pkg, { publish: boolean }): Promise<boolean>` and route the NEW method
plus `addInvitePackage` and `addRecoveryKey` through it. **Scope guard**: the two existing methods'
public signatures, return types and log lines stay identical, and their existing tests must pass
unchanged — if any test needs editing, the helper is wrong; revert to the new method using it alone.
`setRecoveryPassphraseWrap` (scalar, not a dict) stays as it is.

- Creation: `ResumePodSetup.vue` `recovery-kit` phase (`:692-705`, `:1067-1072`) → combined step (1f).
- Join: after `authStore.joinFamily` succeeds inside `useJoinFlow.handleSubmitPin` (`:1043-1050`).
- Settings: a new card (1f).
- **Revocation**: `syncStore.revokeMemberLink(memberId): boolean` — **SYNCHRONOUS and
  crypto-free.** It overwrites the entry with a DEAD one (`{ salt: '', wrapped: '', tokenHash: '',
keyId: envelope.keyId, createdAt: <monotonic, per below>, expiresAt: new Date(0).toISOString() }`)
  and returns whether an entry was there. A redeem then fails check 2 (`tokenHash` mismatch) →
  `'link-revoked'`, deterministically.

  **Three corrections, each a real defect caught in review. All three are verified:**

  1. ⚠️ **Call it from `authStore` (`:1382`, beside `retireMemberKeyMaterial`), NOT from inside
     `retireMemberKeyMaterial`.** That function is `void`/object-returning and **SYNCHRONOUS**
     (`syncStore.ts:5950`), so an async mint there would be a floating promise — an unhandled
     rejection is exactly the silent failure this plan forbids. It also has an early `return` when
     `localWrapsCleared === 0` (`:5983`), which is the NORMAL case for a kit-born family
     (`wrappedKeys: {}`), so a call placed after it **would never run for the families this plan is
     for**. `authStore`'s unclaim is already `async`.
  2. ⚠️ **It does NOT ride `keyDictSize`.** VERIFIED: the publish signal is
     `keyDictSize(merged) > keyDictSize(remoteEnvelope)` (`syncStore.ts:1849`) — a **strict `>` on a
     COUNT**. Overwriting an existing `memberId` key leaves the count IDENTICAL, so **neither a
     rotation nor a revocation is visible to that signal**. The publish must be explicit. For
     `revokeMemberLink` it already is: `authStore` awaits `syncNowBounded()` immediately below and
     already CHECKS the boolean — so add nothing, just report `link_revoked
action:'publish_failed'` + `reportError severity:'critical'` in that existing false branch. For
     `setMemberLinkWrap` it already is too: `await syncNow(true)`, the `addInvitePackage` contract.
     **`keyDictSize` covers the FIRST mint for a member and nothing else** — requirement 6 and the
     `keyDictSize` caveat must say so rather than over-promising it.
  3. Update the `unclaim_wraps_not_revoked` warn (`authStore.ts:1401-1414`): its copy — "the merge
     will restore them" — is now wrong for one class of key material. The magic link IS revocable;
     the password/passkey wraps are not. Split the message rather than leave a log line that tells a
     reader the opposite of what just happened.

**The monotonic `createdAt` stamp — specified here because Proof 3 is not executable without it.**
`setMemberLinkWrap` computes `createdAt` itself; it does NOT use `Date.now()` directly:

```ts
// Monotonic. A device whose clock is AHEAD must not stamp an entry that outlives its own
// replacement, and `pickNewerByCreatedAt` resolves TIES to `incoming` (envelopeMerge.ts:116),
// so two mints inside one millisecond would otherwise be a coin flip. `+1` guarantees a strict
// win over the entry being replaced.
const prev = envelope.value.memberLinkKeys?.[memberId]?.createdAt;
const prevMs = prev ? Date.parse(prev) : NaN;
const createdAt = new Date(
  Number.isFinite(prevMs) ? Math.max(Date.now(), prevMs + 1) : Date.now()
).toISOString();
```

⚠️ `expiresAt` is NOT derived from `createdAt`. It comes from `createInvitePackage`, i.e. the real
wall clock plus `MAGIC_LINK_EXPIRY_MS`, so a `createdAt` bumped forward to win a merge can never
extend a link's life. The two timestamps answer different questions and must stay independent.

**A failed magic-link mint must NEVER block creation or join.** Both new issuance points sit on
paths a user cannot escape: the pod-creation `recovery-kit` phase is a mandatory unclosable step
(`ResumePodSetup.vue:1066-1077`; `RecoveryKitDisplay` is "not closable except via the explicit
confirmation", `:8-11`), and the join mint fires after `authStore.joinFamily` has already succeeded.
`setMemberLinkWrap` awaits `syncNow(true)` and returns false offline, so on a flaky connection the
mint WILL fail there.

The contract, mirroring `RecoveryKitDisplay`'s own "a PDF failure NEVER blocks confirmation — the
on-screen code is the source of truth" (`:10-11`):

- **Creation**: the kit is the guaranteed artefact. A failed mint degrades the combined step to
  kit-only, shows the inline "your link was not saved" note plus "you can create one later in
  Settings → Security & Recovery", and **leaves the confirm button ENABLED**. It never retries in a
  loop and never gates progress. Create-flow conversion is already 53%; a new network dependency
  that can wedge the final step is not an acceptable trade for a convenience credential.
- **Join**: identical — the joiner reaches the app with a PIN exactly as today, plus the Settings
  pointer.
- Both still emit `link_minted action:'publish_failed'` + `reportError severity:'critical'`.
  **Silent is the thing forbidden, not degraded.**

**1f. Shared UI — reuse, do not re-render**

Three surfaces need "QR + link + copy". Two implementations already exist and a third would be the
duplication this pass exists to prevent.

- **`src/components/ui/InviteLinkCard.vue`** — branded QR frame + scan/share hint + `#actions` slot,
  already generic (`link`, `qrUrl`, `loading`), already used by the invite wizard. **Use it for the
  QR half.** Its only magic-link-unfriendly line is the hardcoded `t('family.linkExpiry')` at
  `:51-53`; make that a `#footnote` slot defaulting to today's string, so the invite wizard is
  byte-identical and the magic link supplies its own. ⚠️ Two other lines are equally
  invite-specific and must move with it: the QR `alt` (`t('invite.qrAlt')`, `:29`) and the scan hint
  (`t('family.scanOrShare')`, `:43-45`). Give it three additive optionals — `qrAlt?`, `hint?`, and a
  `#footnote` slot — each defaulting to today's string. Six lines. Shipping only the footnote slot
  leaves a screen reader announcing "QR code for your invite" on the magic-link card: an
  accessibility defect, not a copy nit.
- **`src/components/settings/DeviceLinkCard.vue` — split the LOGIC out, not a "shell".** A "shared
  shell with the mint function injected" is a template-method pattern expressed as a component prop:
  the hardest available seam to read, and any stated fallback ("write `MagicLinkCard` separately if
  extraction proves awkward") is the one outcome that guarantees the duplication this section exists
  to prevent. **There is no fallback.** The split is along logic/presentation, where Vue already has
  first-class seams:

  1. `src/composables/useMintedLink.ts` (new, ~40 lines) owns the SEQUENCE, which is the genuinely
     duplicated and genuinely dangerous half: `familyKey` guard → mint → publish → **refuse to
     render a QR if the wrap never reached the durable file** → build link → render QR → telemetry →
     `reportError` on throw. Signature
     `useMintedLink(mint: () => Promise<{ link: string } | { error: UIStringKey }>)` returning
     `{ link, qr, isMinting, formError, run }`. Every arm of the Error Handling Contract's mint rows
     lives here ONCE, including the `warn`-on-QR-failure rule — today both existing call sites
     swallow it (`DeviceLinkCard.vue:74-76`, `RecoveryKitDisplay.vue:70-72`).
  2. `src/components/settings/MintedLinkPanel.vue` (new, presentational) = `InviteLinkCard` for the
     QR + the link/copy row + the inline `formError`, with a `#footnote` slot for the per-feature
     note. ⚠️ VERIFIED: `InviteLinkCard` renders NO link text and NO copy button (55 lines, zero
     copy affordance) — the link/copy row is `DeviceLinkCard.vue:94-116` only, so without this panel
     `MagicLinkCard` would duplicate it regardless of the QR reuse.
  3. `DeviceLinkCard` and `MagicLinkCard` become thin: a `BaseCard`, a description, a mint button,
     `<MintedLinkPanel>`, and their own `mint` function. **Acceptance test for the refactor:
     `DeviceLinkCard.vue` ends under ~60 lines (from 124) and contains no `try`/`catch` and no
     telemetry call.** If it does not, the extraction did not happen.

  ⚠️ This moves `DeviceLinkCard`'s QR from a plain `h-44` image (`:95`) to `InviteLinkCard`'s branded
  gradient frame (`:21-39`). A deliberate, small visual change to an existing shipped surface — list
  it explicitly in browser test 10 rather than discovering it in review.

- **The joiner must be SHOWN the link (requirement 14) — this is otherwise a hole.** 1e mints it
  inside `handleSubmitPin` (`useJoinFlow.ts:1044-1050`) and the token is never persisted, so as
  specified the joiner's link would be minted and destroyed in the same tick. Add a `'link-saved'`
  step to `useJoinFlow` between `joining` and hand-off, rendered in `JoinPodView` as
  `<MintedLinkPanel>` plus a single explicit confirm — the same save-then-confirm contract
  `RecoveryKitDisplay` uses, for the same reason. Mandatory to pass, but the confirm is ALWAYS
  enabled: a failed mint degrades the step to the Settings pointer and lets the joiner straight
  through. ⚠️ Do NOT reuse `RecoveryKitDisplay` here — a joiner has no kit, and that component's
  whole contract is the kit.
- **Creation (Requirement 10) reuses `RecoveryKitDisplay.vue`, it does not sit beside it.** That
  component already IS the unclosable one-confirm modal (`:143`, `:227-229`), and its PDF/share
  stack exports whatever is inside `ref="kitCardEl"` (`:98`, `:144`). Add an optional
  `magicLink?: string` prop rendered INSIDE `kitCardEl`. One confirm, one PDF, one share sheet, zero
  new export code — and the saved PDF carries both artefacts, which is what "save these two things"
  should mean. Strictly smaller than a new component, and the only way the two things are genuinely
  saved together.

**Fix `useClipboard` rather than working around it.** `useClipboard.copy`
(`src/composables/useClipboard.ts:10-20`) swallows the failure — `catch { return false }` — and
`DeviceLinkCard.vue:111` discards that boolean, so a failed copy on iOS is a silent no-op with no
toast, no banner, no console line. `RecoveryKitDisplay.vue:77-91` already hand-rolls a workaround.
Give `useClipboard` an `error` ref AND an optional caller-supplied surface —
`useClipboard(opts?: { surface?: string })`, defaulting to `'clipboard'` — then report from the
catch. The surface must NOT be hard-coded: there are **six** call sites across unrelated features (VERIFIED), and a hard-coded `'login-flow'` would file a travel-page copy failure under login and
pollute the one funnel this plan is measured on. `reportError` takes `surface: string`
(`errorReporter.ts:46`) and dedupes per `(surface, message)` (`:145-146`), so the caller's surface is
what makes the dedupe bucket meaningful. Then delete `RecoveryKitDisplay.handleCopyKitCode`
(`:76-91`) in favour of it — note it already calls `reportError`, so the migration must keep that AND
add the user-visible failure it lacks. **Copy is the PRIMARY save action for a
magic link — it is the one failure that must never be silent.**

**1g. The token must not reach telemetry** (`src/composables/useJoinFlow.ts`)

⚠️ **SHIPS IN SHIP 1**, not with the credential — it is a one-line fix and this feature is what
makes it dangerous.

`recordError` writes `invite_token_tail: inviteToken.value` (`:478`) and
`file_id_tail: targetFileId.value` (`:477`) — the **FULL values, despite the key names**. Both keys
ARE allowlisted (`diagnosticContext.ts:107-108`), so they reach the CloudWatch firehose AND Slack
via `reportError` on every join error. Today that publishes a 24-hour invite token. The moment
`ml=1` rides `inviteToken.value` — which it does, via `parseUrl` — it publishes a credential that
unwraps the family key **for seven days** into CloudWatch log retention and a Slack channel. Seven
days of retention is not a mitigation: the token reaches a chat channel a human can read in seconds,
and the whole family key is behind it. **Ship-1 severity is unchanged by the scope change.**

Fix: `tail(...)` both, matching the field names and `buildDiagnosticReport`'s own treatment at
`:553`. `tail` is already imported from `@/utils/diagnostics`. Add a test asserting the emitted
context contains neither the full token nor the full fileId.

**1h. Paste-a-link fallback** (`src/components/login/WelcomeGate.vue`, + a small view)

⚠️ SHIPS IN SHIP 3 with the credential.

**Why it is required, not a nicety.** Universal links fail in ways we cannot fix: tapped inside
WhatsApp's in-app browser, long-pressed and deliberately opened in the browser, after iOS has
remembered "open in Safari" for the domain, or when Android App Link verification did not complete.
Without a manual path, every one of those is a dead end for someone holding a valid credential.

**Shape:**

- **ONE field, BOTH link kinds.** Not separate invite and magic-link boxes — the user does not know
  which they were sent. `parseInviteLink` (`inviteService.ts:191`) already distinguishes `lk=1`,
  `ml=1` and the classic invite, and already accepts hash-routed and query-routed forms. Route the
  parsed result into the SAME handlers the URL path uses; do not fork the flow.
- **A single line on the WelcomeGate, not a fourth card.** The three cards are already a choice
  between "sign in", "join" and "create", and a person in this state does not know which they are.
  A neutral "Have a link? Paste it here" under the cards avoids making them guess.
- **Manual paste only. NEVER a silent clipboard read.** iOS surfaces a system banner for clipboard
  access, and for a product whose pitch is privacy, reading what someone copied without asking is
  the wrong instinct. A plain field.
- ⚠️ **Loud failures — this is the specific risk of a paste box.** `parseInviteLink` returns `null`
  on a malformed URL and SILENTLY DROPS an undecodable `ref`/`hint` (`:192-232`). Chat apps wrap and
  truncate long URLs, so a partially-copied link is the EXPECTED input here, not an edge case. A
  `null` parse must say "that doesn't look like a complete beanies link — check it copied fully",
  and a parse that succeeded but lost `ref`/`fileId` must not silently proceed to a file it cannot
  find. Emit `error_code:'paste-unparseable'` / `'paste-incomplete'`.

**What it does NOT solve**: it is invisible to someone who has not installed the app yet. The
no-app-installed case needs the store redirect plus a "tap your link again" instruction — see the
deep-link section.

### Phase 2 — optional PIN reset on kit entry

The whole change is ONE expression. `ProveView.vue:101-108` currently reads:

```js
props.recoveryOpenedBy === 'kit'
  ? (retryTarget ?? 'reset-pin')
  : (retryTarget ?? firstNonRecovery ?? 'recovery');
```

Move `'reset-pin'` to the END of the kit chain as the last resort rather than the first:

```js
props.recoveryOpenedBy === 'kit'
  ? (retryTarget ?? firstNonRecovery ?? 'reset-pin')
  : (retryTarget ?? firstNonRecovery ?? 'recovery');
```

That single move delivers all three requirements. One other thing in the file must change with it:
the comment directly above the expression (`ProveView.vue:100-106`) currently asserts "Only a KIT
leads with the reset" and "A kit LANDS on the reset" — both become false the moment the expression
moves, and a comment contradicting the line under it is how the next reader reinstates the old
behaviour. Rewrite it in place to state the new rule and WHY. Nothing else in the file changes:

- a kit arrival lands on the member's FIRST non-recovery method (`firstNonRecovery`), which for a
  cold kit arrival is the PIN — `PROBES` order is biometric → pin → tap-through → password →
  passphrase (`proveMethods.ts:181-211`) and the biometric probe returns null off-native. On a
  NATIVE device with a biometric registration the kit arrival lands on biometric, which is correct
  and better, not a regression — say so in the acceptance criterion rather than discovering it in
  test;
- a member with NO PIN has no non-recovery method, so `firstNonRecovery` is undefined and they
  still land on `reset-pin` — the genuinely-forced case, preserved by the expression rather than by
  a second condition;
- `retryTarget` still wins, which is what the comment at `:103-106` exists to protect (the
  component remounts after every failed attempt).

**No new affordance component is needed.** `switchTargets` (`:212-224`) unshifts `'reset-pin'`
whenever `recoveryOpenedBy === 'kit' && activeMethod !== 'reset-pin'` — which, after this change, is
precisely the kit-on-PIN-pane state. The link renders itself. The only work left is the switch
link's LABEL: confirm it reads "Forgot your PIN? Reset it" for this target rather than a bare method
name, and that it renders visually subordinate to the PIN form.

Preserve exactly: the authorization gate (`useLoginFlow.ts:913-915`, `!== 'kit'` → return), the
`=== 'kit'` test in `switchTargets` (`:219-223`), and the passphrase's inability to reset.

### Phase 3 — unlock-screen copy fix

`LoadPodView.vue:1577`. **Change the string, not the gate, and do not add a branch.**

`loginV6.unlockNoPasswordHint` (`uiStrings.ts:4122-4126`) asserts "This file contains another
family's encrypted data" — an assertion the code cannot substantiate, because the only thing the
gate knows is that a file is staged and undecrypted (`syncStore.ts:627`).

Rejecting the `memberLinkKeys`/roster-signal branch **deliberately**: the card renders PRE-AUTH
against a staged envelope, and the codebase already paid for guessing here. The comment above it
(`:1584-1589`) records that this pair was previously split on `caps.password` and told families with
no password "Don't have the password?", and that the fix was to make the string credential-neutral
so it could render on every envelope shape. It also warns that the `en` and `beanie` values once
diverged so the guard test passed. A second split — on whether the envelope "plausibly relates to
this person" — re-introduces exactly that class of defect, and there is no sound signal for it: a
magic-link holder on a cold device is precisely the case where the envelope IS theirs and the device
knows nothing.

So: one string, neutral on BOTH audience and credential, naming the real routes in (invite link,
magic link, recovery kit) without asserting whose file it is. Both `en` and `beanie` rewritten
together, `beanie` keeping the real nouns. Extend the existing guard test for this key.

⚠️ `loginV6.unlock` is ALREADY in `IMPORTANT_PREFIXES` (`uiStrings.test.ts:122`), so that key is
covered. The NEW magic-link keys are NOT — add the feature's key prefix (`magicLink.`) to that list
in the same change, per CLAUDE.md's "add new important-surface key prefixes to its list". A saved
sign-in credential is squarely inside the floor's named scope. While there: `deviceLink.` is missing
from that list today — add it too; same surface, two-word fix.

Note on the chosen name: "your beanies magic link" trips the guard's own `(?<=your|all|my|…)\s
beanies` pattern (`uiStrings.test.ts:214`) but PASSES, because the test only flags bean-words
INTRODUCED in `beanie` that are absent from `en`, and the name is identical in both. That is the
mechanism, not a loophole — do not "fix" it, and do not write a `beanie` value that uses "beanies"
where `en` does not.

The template comment at `LoadPodView.vue:1572-1575` makes the same unsubstantiated claim in prose
("This greets someone who opened a `.beanpod` that is not theirs"). Correct it in the same change —
leaving it is how the next reader re-derives the string this phase is deleting.

## Revocation: how it is PROVEN, not asserted

greg's requirement is that minting a new link revokes the old one, and that this is **verifiable**.
Revocation is the one behaviour in this plan that can fail silently and look fine, so it gets its own
proof obligations. All five must pass before the feature is called done.

**The three mechanisms, and what breaks if each is missing**

| Mechanism                            | Where                                     | If omitted                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memberId` as the dict key           | `syncFileV4.ts`                           | A new mint appends instead of replacing; both links work forever                                                                                                      |
| `'newest-wins'` merge rule           | `ENVELOPE_KEY_DICTS`                      | A peer holding the stale entry republishes it; revocation un-happens on the next sync, silently                                                                       |
| Monotonic `createdAt`                | `setMemberLinkWrap`                       | A fast-clock device's dead link outlives its own replacement                                                                                                          |
| `tokenHash` on the package           | `syncFileV4.ts`                           | A revoked link fails at `unwrapFamilyKey`, so the user is told "something went wrong" instead of "you cancelled this link", and Proof 1 cannot assert a specific code |
| Explicit publish (NOT `keyDictSize`) | `setMemberLinkWrap` / `authStore` unclaim | An overwrite leaves the dict COUNT unchanged, so `syncStore.ts:1849`'s strict `>` never fires and the revocation never reaches Drive                                  |

**Proof 1 — unit, the overwrite.** Mint for member M, capture token A. Mint again, capture token B.
Assert `memberLinkKeys[M]` has exactly ONE entry, that redeeming A fails with EXACTLY
`'link-revoked'` (not "one of two codes" — with `tokenHash` the outcome is deterministic, and an
`or` in an assertion is a test that cannot fail for the right reason), and that B succeeds.

**Proof 2 — unit, the propagation.** This is the one that catches the real bug. Construct a remote
envelope carrying the NEW wrap and a local envelope still carrying the OLD one, run
`preserveLocalKeyDicts`, and assert the NEW wrap survives. **Under today's `'local-wins'` rule this
test FAILS** — that is the point of writing it. The COMMITTED artefact is the propagation test plus a direct
assertion that `ENVELOPE_KEY_DICTS.memberLinkKeys.rule === 'newest-wins'`; watching it fail once
against `'local-wins'` is developer discipline, not a deliverable, and must not be the only proof
left in the suite. Add a SYMMETRY case in the same test — swap which side holds the new wrap and
assert the same winner — because a test that only runs one way passes under a plain "remote-wins"
rule too, which is not what was asked for.

**Proof 3 — unit, the clock.** Seed an existing entry stamped one hour in the FUTURE. Mint a
replacement. Assert the new `createdAt` is strictly greater, and that `pickNewerByCreatedAt` picks
the new one.

**Proof 4 — unit, unclaim.** `authStore.unclaim` calls `revokeMemberLink`; assert the entry is
REPLACED (not deleted — a delete cannot propagate), that the member's saved token now fails with
`'link-revoked'`, that the replacement's `createdAt` beats the original's, and that it survives
`preserveLocalKeyDicts` against a peer's stale copy. Assert SEPARATELY that it runs for a KIT-BORN
family (`wrappedKeys: {}`) — the case `retireMemberKeyMaterial`'s early return would have skipped.

**Proof 5 — by hand, THREE real browser profiles.** Ordering is the whole test:

1. Profile A (Google account with write access): open the pod, mint a link for member M, save the
   URL as LINK-1.
2. Profile C (a SECOND account that can read the file): sign in and OPEN the pod, so C holds the
   PRE-rotation envelope in memory. Leave the tab open, do not reload.
3. Back on A: mint again for M (LINK-2).
4. Profile B (a THIRD context, state which account): open LINK-1. Expect refusal naming
   `link-revoked`, pointing at a signed-in device.
5. Force C to sync. Re-open LINK-1 on B. It must STILL be dead. **This is the step that catches the
   merge bug, and it only works because C loaded the envelope at step 2, BEFORE the rotation.** If C
   is opened after step 3 the test proves nothing.
6. Confirm LINK-2 works on B. **A green unit suite is not sufficient evidence for this one** — the failure mode is a
   merge that only manifests across devices, which is exactly what the 2026-09-08 compaction incident
   taught.

**Belt and braces.** The 7-day `expiresAt` bounds the damage if all of the above is somehow wrong,
but it is NOT the revocation mechanism and must never be described as one in code comments or copy.
A link revoked on day 1 must be dead on day 1, not day 8.

## Error Handling Contract

Every failure point, its user-visible surface, and its developer signal. **Nothing on this list may
return silently, and nothing may surface without telling the developer where to look.**

| Point                               | Fails how                                               | User sees                                                                                                        | Developer sees                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mint: no family key                 | `syncStore.familyKey` null                              | inline `t('recovery.podNotOpen')`, the exact shape `DeviceLinkCard.vue:39-43` uses                               | `link_minted` `action:'publish_failed'` + `error_code:'no_family_key'` (note `emitLinkMinted` gains an `errorCode` param it lacks today, and `DeviceLinkCard`'s no-family-key branch at `:40-43` currently emits nothing at all) |
| Mint: publish failed                | `setMemberLinkWrap` → `syncNow(true)` false             | inline "your link was not saved — reconnect and try again"; **QR withheld**, matching `DeviceLinkCard.vue:56-61` | `link_minted` `action:'publish_failed'` + `reportError` `severity:'critical'` at creation/join only                                                                                                                              |
| Mint: throw                         | crypto / import failure                                 | inline mint-failed banner                                                                                        | `reportError` (`DeviceLinkCard.vue:78-87` shape)                                                                                                                                                                                 |
| Mint: QR render                     | `generateInviteQR` throws                               | link + copy still shown, QR area reads "QR unavailable — use the link"                                           | ⚠️ `warn` log. Do NOT copy `DeviceLinkCard.vue:74-76` / `RecoveryKitDisplay.vue:70-72`, which both `catch { qr = '' }` with no log and no on-screen note — a silently missing QR on the one screen whose job is "scan this"      |
| Copy to clipboard                   | `navigator.clipboard` rejects (iOS, insecure context)   | visible failure + "select the link and copy it manually"                                                         | `reportError` from inside `useClipboard` (see 1f)                                                                                                                                                                                |
| Redeem: `ml=1`, no/unparseable `m=` | `parseInviteLink` drops it                              | join-flow error card: link is incomplete, ask for a new one                                                      | `error_code:'no-member-param'`                                                                                                                                                                                                   |
| Redeem: no `memberLinkKeys[m]`      | the merge dropped the dict, or the member never minted  | "we couldn't find this link — ask a signed-in device in your family to create a new one"                         | `error_code:'no-entry'`. **A spike across many families at once is the dropped-dict alarm**                                                                                                                                      |
| Redeem: `tokenHash` mismatch        | a newer link was minted, or the member was unclaimed    | "this link has been cancelled — a newer one was created. Ask a signed-in device in your family for a new one"    | `error_code:'link-revoked'`                                                                                                                                                                                                      |
| Redeem: past `expiresAt`            | 7 days elapsed                                          | "this link has expired — ask a signed-in device in your family to create a new one"                              | `error_code:'token-expired'` (the SAME code the device-link arm emits at `useJoinFlow.ts:811`; `kind` separates them)                                                                                                            |
| Redeem: `keyId` mismatch            | #117 rotation                                           | "this link is out of date"                                                                                       | `error_code:'key-rotated'` + `warn`. **NO envelope write** — the redeeming device is cold and the union merge would not propagate a delete                                                                                       |
| Redeem: unwrap throws               | corrupt/tampered wrap ONLY (revocation is caught above) | generic redeem-failed with the recovery-kit route offered                                                        | `error_code:'unwrap-failed'`                                                                                                                                                                                                     |
| Redeem: decrypt fails               | payload/key mismatch                                    | existing `FILE_DECRYPT_FAILED` card                                                                              | already covered by `tryStep` + `asJoinDecryptError` (`useJoinFlow.ts:820-826`) — reuse, add nothing                                                                                                                              |
| Redeem: member not in roster        | deleted elsewhere                                       | picker renders + `proveError` naming the cause                                                                   | `error_code:'member-missing'`                                                                                                                                                                                                    |
| Redeem: file unreachable            | Drive permission / 404                                  | existing join recovery surfaces                                                                                  | `error_code:'file-unreachable'`                                                                                                                                                                                                  |

**One vocabulary, two kinds.** `link_redeemed` carries both `kind:'device'` and `kind:'magic'`, so
their `error_code` values must not diverge for the same cause:

| Cause                      | device (existing, `useJoinFlow.ts:806/811/823`) | magic (new)                                              |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| wrap not found             | `token-invalid`                                 | `no-entry` (kept distinct: it is the DROPPED-DICT alarm) |
| superseded by a newer mint | n/a (token-keyed, unrevocable)                  | `link-revoked`                                           |
| past `expiresAt`           | `token-expired`                                 | `token-expired` (REUSED)                                 |
| family key rotated         | n/a                                             | `key-rotated`                                            |
| unwrap threw               | n/a                                             | `unwrap-failed`                                          |
| decrypt threw              | `decrypt-failed`                                | `decrypt-failed` (REUSED)                                |

Two standing rules for this feature:

- **A caught exception with no log is a defect in review.** Every `catch` added by this plan either
  calls `reportError` or emits a typed event. `catch {}` and `catch { x = '' }` do not ship.
- **Every user-facing failure names the way out** (create a new link in Settings / use your recovery
  kit / ask for an invite). A magic-link failure is someone locked out of their family's data on a
  device they are holding; "something went wrong" is not an acceptable terminal state here.

### Phase 5 — deep linking: make a shared link open the app

⚠️ **VERIFIED STATE TODAY: a beanies link opens the app on NEITHER platform.** Three independent
causes, each sufficient alone:

1. **Wrong host.** Every shared link is `https://app.beanies.family/...` — that is what
   `shareableOrigin()` (`src/utils/shareableOrigin.ts:22-43`) forces, and it exists because iOS
   shells were emitting `capacitor://app.beanies.family/join?...`, which opens NOTHING on the
   recipient's phone. But `App.entitlements:25` claims `applinks:beanies.family`, the **apex**.
   `app.beanies.family` is claimed by neither platform.
2. **Wrong path.** The AASA (`web/public/.well-known/apple-app-site-association`) claims only
   `/oauth/native` and `/oauth/native/*`. Android's single `autoVerify` filter
   (`AndroidManifest.xml:28-32`) is `host=beanies.family pathPrefix=/oauth/native`.
3. **No handler.** Both `appUrlOpen` listeners hard-filter: `googleAuth.ts:2857` →
   `handleNativeAuthRedirect` drops any non-OAuth URL on its first line; `iosOpenInAdapter.ts:122`
   handles share-sheet files only. **Even with the config fixed, the app would receive the link and
   do nothing.** This is runtime work, not a config flip.

⚠️ **The 59/27 "universal-link vs custom-scheme" telemetry split is NOT evidence iOS works.** It is a
platform split: Android's verified App Link intercepts the OAuth redirect, while iOS always falls
through to the custom scheme, because Apple fires Universal Links only on user-initiated **taps**,
never on a server redirect. **iOS Universal Links have never been exercised in production here.** A
WhatsApp/SMS tap IS a user tap, so the OAuth limitation does not apply to this feature.

⚠️ **Do not claim an apex path.** `apex-cutover.js:130-133` 301s `/join` to `app.beanies.family`, and
BOTH platforms match the TAPPED url without following redirects. The claim must be on the origin
actually tapped.

**5a. Config (native + infra)**

- `ios/App/App/App.entitlements` — add `applinks:app.beanies.family`. ⚠️ This is an Apple Developer
  portal capability change: it forces a provisioning-profile refresh and a NEW BUILD. The iOS half
  cannot take effect from a web deploy.
- NEW `public/.well-known/apple-app-site-association` on the app origin, claiming `/join*` and
  `/welcome*`. ⚠️ That URL currently returns the **SPA shell with HTTP 200** — Apple's CDN would
  fetch HTML and the association would fail SILENTLY with no error on any surface.
- **Fix the Content-Type on BOTH origins.** `beanies.family/.well-known/apple-app-site-association`
  is served as `binary/octet-stream`; Apple requires `application/json`. S3 object metadata in the
  deploy sync, not a code change.
- `android/app/src/main/AndroidManifest.xml` — second `autoVerify="true"` intent-filter for
  `host=app.beanies.family`, `pathPrefix=/join` and `/welcome`. `assetlinks.json` is ALREADY live and
  correct on that origin. Verify with `adb shell pm get-app-links family.beanies.app`.
- **Extend `nativeOAuth.manifests.test.ts`** to cover the new hosts/paths, or this drifts silently.
- ⚠️ **TRAP:** `deploy.yml:209` sets `include-hidden-files: true` specifically so `dist/.well-known/`
  survives the artifact round-trip (`upload-artifact` strips dotfiles). If that flag is ever removed
  the AASA 404s and the association fails silently. `apex-cutover.js:108-116` and
  `rewrite-to-html.js:43-50` already pass `/.well-known/*` verbatim — do not let anyone "tidy" them.

**5b. Runtime — the generic inbound-link bridge**
A handler beside `installNativeAuthListener` (`App.vue:1706-1716`) that takes an
`app.beanies.family` https URL from `appUrlOpen` and does `router.replace(path + search + hash)`,
keeping the `isSameOriginReturnPath` guard already used there. Must NOT swallow OAuth URLs — order
it after the existing listener, or test the transport first. Every failure logs.

**5c. Android deferred deep linking via Play Install Referrer — RECOMMENDED DEFERRED, see below**
`com.android.installreferrer` gives genuine post-install context on Android, free, with no
attribution vendor. ⚠️ **The referrer must carry the LOCATOR ONLY (`fam`, `p`, `fileId`) and NEVER
the token** — requirement 2 establishes that the locator is not access. The referrer string transits
Google Play, which is a third party by this project's own rule, and shipping it obliges an update to
the data-collection table in `docs/runbooks/native-store-submission.md` plus the Play Data Safety
answers. **Recommendation: do NOT ship in this build** — it is Android-only, bounded to 90 days,
adds store-declaration work, and only improves the install case that 1h already handles acceptably.
Revisit after the email work, which removes the need entirely.

**5d. Move the token from the query string to the FRAGMENT**
Pass 4 recorded that the fragment was unavailable because `usePickBeanpodFile.ts:116` builds the
OAuth returnPath as `${pathname}${search}`, dropping it. That is a reason the fragment is HARD, not
a reason the query string is SAFE — and the same review found the full token being shipped to
CloudWatch and Slack, the same leak from another direction. Fix: **capture the fragment into memory
at first paint, BEFORE any OAuth navigation**, so the returnPath never has to carry it. The kit
already does exactly this (`recoveryKit.ts:106-120`: "the code lives in the URL fragment — fragments
never leave the browser"), and `LoginPage.vue:323-333` already parses and `history.replaceState`s a
fragment away. Removes the token from access logs, `Referer` headers and every unfurler at once.
⚠️ **Backward compatibility is mandatory**: invite links already sent MUST keep working, so
`parseInviteLink` accepts the token from EITHER the query or the fragment; only newly-built links
put it in the fragment.

**On unfurlers, accurately**: WhatsApp and iMessage generate previews on the SENDER's device, so the
common mobile case does not hand the URL to Meta. But **WhatsApp Web/Desktop senders do** leak it to
Meta's crawler, Slack/Discord/Teams fetch server-side unconditionally, and even the sender-side case
performs a GET that lands the token in our own CloudFront access logs. 5d fixes all of those;
Universal Links do not, because a preview fetch is a crawler GET, not a tap.

### Phase 4 — holistic iPhone joiner sweep

See the dedicated section below.

## Files Affected

- `src/types/syncFileV4.ts` — new `memberLinkKeys` dict + `MemberLinkKeyPackage` (salt is base64URL)
- `src/services/auth/magicLink.ts` — NEW, mint/redeem; composes existing primitives, adds no crypto
- `src/services/crypto/inviteService.ts` — `magicLink?` / `memberId?` on `InviteLinkParams` +
  `buildInviteLink` + `parseInviteLink`. ⚠️ NOT "export the primitives" — `generateInviteToken`
  (`:32`), `deriveInviteKey` (`:43`), `buildInviteLink` (`:159`), `parseInviteLink` (`:191`) are
  already exported; `generateInviteQR` lives in `src/utils/qrCode.ts`
- `src/services/sync/envelopeMerge.ts` — `preserveLocalKeyDicts` (NOT `mergeEnvelopes`, no such
  function) + `keyDictSize` + `pickNewerByCreatedAt` + `mergeNewestWinsDict` + the misplaced docstring
- `src/stores/syncStore.ts` — `setMemberLinkWrap` (mirroring `addInvitePackage`, `:3263-3295`),
  `revokeMemberLink`, `putEnvelopeEntry`, and `retireMemberKeyMaterial` (`:5950`) updated INCLUDING
  its docstring's "revocation is NOT available" claim
- `src/composables/useJoinFlow.ts` — `ml=1` folded into the existing `linkMode` path; the
  `link-saved` step; join started/completed events; **and the `tail()` fix at `:477-478` (1g)**
- `src/composables/useLoginFlow.ts` — `startForFamily` `opts`; `openedByLink` closure local; the
  link-redeem success emits from the SINGLE `done` branch (`:538-542`), **NOT** from the five
  `PROVE_SUCCEEDED` sites; one local `emitProveOutcome` wrapper carrying `+opener:kit`; reset gate
  (`:915-916`) untouched
- `src/pages/LoginPage.vue` — thread `preselectMemberId` through `handleLinkReady` / `enterFlow`
- `src/components/login/WelcomeGate.vue` — the paste-a-link entry (1h)
- `src/components/login/JoinPodView.vue` — `link-ready` emit becomes a single object payload
  (`:69`); DELETE `emitDeviceLinkRedeemed(true)` (`:78`); render the new `link-saved` step
- `src/components/ui/InviteLinkCard.vue` — `#footnote` slot replacing the hardcoded expiry line
- `src/composables/useClipboard.ts` — `error` ref + caller-supplied `surface` + report the failure
  it currently swallows (six call sites)
- `src/composables/useMintedLink.ts` — NEW, the mint sequence, once
- `src/components/settings/MintedLinkPanel.vue` — NEW, the QR/link/copy presentation, once
- `src/components/auth/RecoveryKitDisplay.vue` — optional `magicLink` prop rendered inside
  `kitCardEl` (combined save step, one confirm, one PDF); drop its hand-rolled copy for `useClipboard`
- `src/components/login/ResumePodSetup.vue` — pass the minted link into `RecoveryKitDisplay`
- `src/components/settings/DeviceLinkCard.vue` (rewritten thin) +
  `src/components/settings/MagicLinkCard.vue` (NEW, thin) — each a `BaseCard`, a description, a mint
  button, `<MintedLinkPanel>` and its own `mint`. NOT a "shared shell": 1f rejects the
  template-method-as-prop explicitly
- `src/pages/SettingsPage.vue` — mount the card in Security & Recovery. ⚠️ Placement is a deliberate
  override: `SettingsPage.vue:2220-2225` states the taxonomy in its own comment (Security & Recovery
  is "family/device-level protection", while "personal sign-in methods live in Account & Sign-In
  above"). A per-member saved sign-in link is by that rule an Account & Sign-In item. It goes in
  Security & Recovery anyway, beside `DeviceLinkCard` (there for the same reason), because a user
  looking for "how do I get back in" looks there. Record the override in the card's block comment so
  the next reader does not "correct" it.
- `src/components/login/ProveView.vue` — the one-expression default change (Phase 2)
- `src/components/login/LoadPodView.vue` — the copy defect is in `uiStrings`, but the comment at
  `:1572-1575` DOES need updating (it repeats the unsupportable claim in prose)
- `src/services/translation/uiStrings.ts` — all new strings, `en` + `beanie`
- `src/services/telemetry/loginFlowEvents.ts` — generalise the two device-link emitters; add join
  started/completed
- ~~`src/components/auth/MagicLinkDisplay.vue`~~ — **CUT**, see Phase 1f
- ~~`src/utils/diagnosticContext.ts` + store-declaration surfaces~~ — **CUT**, zero new context keys
- `src/content/help/security.ts` — see Help Center Coverage
- `docs/mockups/beanies-magic-link-2026-09-17.html` — committed
- Tests alongside each of the above

## Help Center Coverage

- **Action**: `new article`
  - **Category**: `security`
  - **Article type**: `how-to`
  - **Slug**: `your-beanies-magic-link`
  - **Title**: Your beanies magic link
  - **Scope**: What the magic link is, why you save it, how to use it to sign in on a new device,
    and how to cancel one and create a new one. Must state plainly that anyone holding the link can
    open the family file, so it belongs only on a trusted device.
  - **File**: `src/content/help/security.ts` (the security category already lives there)
  - **Notes**: Must NOT claim the link limits access to one person's data — it unwraps the family
    key. Must say the link cannot be shown again after creation. **Must state the 7-day expiry and that a new link can
    be created at any time.** Must not imply the link is permanent. Must say what to do when a link
    HAS expired, and that the answer is "ask a signed-in device in the family", because the reader
    is on a device that cannot self-serve.

- **Action**: `update existing`
  - **Category**: `security`
  - **Slug**: the existing recovery-kit article
  - **Scope**: The kit no longer forces a PIN reset on arrival; reset is now optional. Also correct
    any implication that the kit is shown once and gone — it is regenerable.

## Observability Coverage

Surface: **`login-flow`**, not a new one. Magic-link mint/redeem are login-flow events by every
definition the existing surface uses, they share the `prove_outcome` funnel the success rate must be
read against, and `loginFlowEvents.ts` already exists as the typed facade whose stated reason for
existing is that "the headline metric is only trustworthy if payload shapes can't drift per call
site". A CloudWatch filter isolates the feature by message prefix (`link_*`) at zero cost.

### No new context keys. This is a hard constraint, not a preference.

An earlier draft proposed `origin`, `rotated`, `cause`, `choice`, `ok`. All five are refused:

- `ALLOWED_CONTEXT_KEYS` lives in **`src/utils/diagnosticContext.ts:61`** (NOT `logEvent.ts`),
  strips anything unlisted with a console warn, and is mirrored by a pinned Lambda drift test.
- Its own comment at `:93-94` states the rule: "`action`, `kind` and `error_code` above are REUSED
  rather than duplicated per feature."
- `joinStepEvents.ts:56-67` spells out the cost: adding a key "obliges us to update the
  collected-Diagnostics declarations filed with Apple and Google… That is not a change to make
  quietly."
- `loginFlowEvents.ts:9-13` states the same discipline for this exact surface.

All five proposed values are closed enums and fit the existing keys exactly. **The entire
store-declaration workstream is deleted from this plan.**

### Events — added to `src/services/telemetry/loginFlowEvents.ts`

- `emitLinkMinted(kind: 'device' | 'magic', ok, errorCode?)` — **generalise the existing
  `emitDeviceLinkMinted`** (`:118-121`) rather than adding a parallel function. `kind` is already
  allowlisted; `action` stays `'minted' | 'publish_failed'`; `error_code` carries `'no_family_key'`.
  Update the one call site at `DeviceLinkCard.vue:59,77`. Fold origin into `detail` as
  `origin=settings,rotated=1`, matching `emitProveOutcome`'s `detail: 'depth=N'` (`:105`).
- `emitLinkRedeemed(kind: 'device' | 'magic', ok, errorCode?)` — same generalisation of
  `emitDeviceLinkRedeemed` (`:124-129`). Existing call sites (`useJoinFlow.ts:806, 811, 823`) pass
  `'device'`. `ok: true` fires from the login machine's single `done` branch (Phase 1d), which is
  what finally gives the DEVICE link a denominator too, closing the gap `useJoinFlow.ts:872-884`
  records.
- ⚠️ **The generalisation RENAMES the CloudWatch message strings**, from `device_link_minted` /
  `device_link_redeemed` to `link_minted` / `link_redeemed` (the `link_*` prefix the surface filter
  depends on). A deliberate, one-time break in event continuity. It is safe here ONLY because the
  measured baseline is zero — the device-link path has never been used in production — so nothing is
  lost. Any saved CloudWatch query, metric filter or dashboard referencing `device_link_*` must be
  updated in the same change, and the "Targets after this ships" numbers must be read against the
  NEW names.
- **No new event for the Phase 2 metric — extend `emitProveOutcome`'s `detail` instead.** A
  dedicated `emitKitArrivalChoice` would need its own once-per-arrival discipline (fire it twice and
  the ratio is garbage; fire it in `ProveView` and it double-counts every remount after a failed
  attempt, which `:100-106` documents as routine). The ratio is already latent in the existing
  funnel: a reset emits `prove_outcome kind='recovery-reset'` (`useLoginFlow.ts:906-911`) and a PIN
  emits `prove_outcome kind='pin'` — the only missing fact is HOW THE ARRIVAL STARTED. Add it to the
  `detail` string `emitProveOutcome` already builds (`loginFlowEvents.ts:105`):
  `detail: 'depth=0+opener:kit'` when `recoveryOpenedBy === 'kit'`, using the `+flag` encoding
  `emitProveMethodsResolved` already uses (`:50-57`). Phase 2's metric becomes
  `kind=recovery-reset vs kind=pin, filtered on +opener:kit` — zero new events, zero new context
  keys, no double-count risk, and it covers biometric and tap-through arrivals for free.
  ⚠️ COST CHECK: `emitProveOutcome` is called from **nine** direct sites in `useLoginFlow`
  (`:656, :685, :724, :921, :1006, :1029, :1074, :1087, :1100`) and nowhere else. `:724` is already
  a closure-local wrapper — `const emitOutcome` at `:723` — used by twelve further calls between
  `:744` and `:890`. **HOIST that existing wrapper to composable scope** rather than writing a new
  one, and route the other eight direct sites through it. Threading a new field through all eleven is the duplication this plan spends a section
  deleting. Do it ONCE: promote the existing `emitOutcome` pattern to a single closure-local wrapper
  in `useLoginFlow` that injects `opener: recoveryOpenedBy.value`, and route every call site through
  it. `emitProveOutcome` gains one optional `opener?: 'kit' | 'passphrase'` field and builds
  `detail: 'depth=N+opener:kit'` itself. Zero new context keys, and the eleven-site drift risk is
  closed rather than multiplied.
- **NEW, required by the telemetry pull:** `emitJoinStarted()` / `emitJoinCompleted(ok, errorCode?)`.
  `useJoinFlow` currently emits **only on error** (`reportError({ surface: 'join-flow:<CODE>' })`),
  so CloudWatch cannot answer "how many joins start vs finish" at all. Phase 4 explicitly requires
  that ratio; without these two events the sweep cannot be evidence-based. Both ride `action` +
  `error_code`, so still zero new context keys.

**Dropped: `perfTiming.record('magic_link_redeem_ms', …)`.** Verified type error — `record`'s third
parameter is `PerfContext = { perf_doc_bytes?, perf_entity_count? }` (`perfTiming.ts:31-36`), so
`{ ok }` does not compile. It is also load-path instrumentation that only escalates at ≥250ms, and a
redeem duration drives no decision this plan can act on. `emitLinkRedeemed`'s ok/fail rate already
answers the question.

### Failure modes and the event that diagnoses each blind

| Failure                                       | Diagnosed by                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wrap never reached the file (offline mint)    | `emitLinkMinted` `action:'publish_failed'`                                                                                          |
| Link used after its 7 days                    | `emitLinkRedeemed` `error_code:'token-expired'` `kind:'magic'` — **if this dominates, the email follow-on is urgent, not optional** |
| Link revoked by a newer mint                  | `emitLinkRedeemed` `error_code:'link-revoked'`                                                                                      |
| Link used after rotation (#117)               | `emitLinkRedeemed` `error_code:'key-rotated'`                                                                                       |
| `preserveLocalKeyDicts` dropped the dict      | `error_code:'no-entry'` spiking across many families at once                                                                        |
| `keyDictSize` omission (mint never published) | `emitLinkMinted` ok but no later successful redeem for that family                                                                  |
| Member deleted/unclaimed                      | `error_code:'member-missing'`                                                                                                       |
| Drive file gone / permission lost             | `error_code:'file-unreachable'`                                                                                                     |

**Critical vs firehose**: `emitLinkMinted` failure at creation/join is ALSO `reportError` with
`severity:'critical'` — the user's only portable credential silently failed to exist. Redeem
failures are firehose `warning` with an on-screen recovery affordance; they are never silent.

### Measured baseline (CloudWatch + Plausible, pulled 2026-09-17)

The theory behind this plan is confirmed, with the caveats stated. Record these so the change can be
judged against them afterwards:

- **The recovery kit is a routine second-device method, not an emergency one.** `kit_redeemed/ok`
  fired **11 times across 7 pods**; **6 of the 22 real families created since telemetry began (27%)
  redeemed a kit**, every one of them on a **cold device**, all within days of signup. Five of the
  six follow the identical trace `kit_redeemed:ok → recovery_pin_reset → prove_outcome ok
kind=recovery-reset` — i.e. **the exact PIN-clobbering greg described, happening to real families**.
  `kit_redeemed/accepted-pod-open` (warm) = **0**.
- **The device-link QR path has never been used in production. Zero mints, zero redeems, ever**,
  on a feature live since 2026-08-28. Both events fire on success AND failure, so this is not a
  denominator artefact. It is the strongest argument that a _saved_ credential fits behaviour better
  than an ephemeral both-devices-in-hand one.
- `passphrase` was **never attempted by anyone**, in any window.
- `pin_enroll` across **23 real families** — PIN adoption is broad; the gap is portability, not PINs.
- Plausible cross-check: logins by method = pin 32, **password 29**, recovery-reset 6, passkey 4.

**Targets after this ships**, read against the NEW `link_*` message names:

- `prove_outcome kind='recovery-reset'` filtered on `+opener:kit` becomes the MINORITY of
  `+opener:kit` arrivals (today it is 5 of 6);
- `link_redeemed kind:'magic' ok:true` exceeds `kit_redeemed/ok` within one release;
- `kit_redeemed/ok` falls;
- `join_completed / join_started` becomes measurable at all — it currently cannot be computed.

**Honest limits of the baseline** — do not overclaim these numbers:

- The `login-flow` surface only exists from 2026-08-28, so the real window is ~20 days, not 30.
- 34 of 56 `prove_outcome` events are greg's own household; only 14 are real non-founder users. Any
  percentage over those 14 is noise.
- `prove_outcome` is NOT a login denominator — trusted-device auto-opens emit nothing.
- **The iPhone consent loop is suggestive, not proven.** 55% of native OAuth starts never complete
  (155 start → 86 return → 70 complete), and the worst bucket is pre-auth with no `family_id` — but
  a user who simply cancels the consent screen produces an identical trace. The fix (`1e1d1c18`) is
  undeployed, so there is no pre/post comparison to make.
- Unrelated but loud, and worth its own look: `google-token-lifecycle` **"drive recovery failed" 299
  events across 4 pods** (228 greg's, 60 one real family). Out of scope here; flagged.

## Acceptance Criteria

- [ ] A brand-new owner finishes creation holding both a recovery kit and a magic link, from one
      screen and one confirm.
- [ ] A joiner finishes joining having been SHOWN their magic link on a confirm step, and having
      copied it successfully; a failed mint shows the Settings pointer and the confirm still lets
      them through.
- [ ] Opening the magic link on a device that has never seen the pod, **signed into a Google
      account that CAN read the file**, reaches that member's PIN entry — no recovery kit, no
      passphrase, no person picker, no PIN reset. Opening it signed into an account that cannot read
      the file produces the named `file-unreachable` surface, not a silent stall.
- [ ] Creating a new magic link in Settings makes the previous one stop working, verified after a
      full sync round-trip AND against a peer device that held the old wrap in memory BEFORE the
      rotation. The previous link's holder is told **"this link has been cancelled"**, not a generic
      failure. All five proofs in "Revocation: how it is PROVEN" pass.
- [ ] Unclaiming a member kills their link even when the family has no `wrappedKeys` at all (the
      kit-born case `retireMemberKeyMaterial`'s early return would have skipped).
- [ ] A magic link older than 7 days is refused with `'token-expired'` and a route to a new one,
      distinct from the `'key-rotated'` message; the Settings card shows an EXPIRED state at 8 days,
      not a green "active" dot.
- [ ] No claim anywhere in shipped code, copy, help article or comment describes the link as
      permanent, and none describes `expiresAt` as the revocation mechanism.
- [ ] A link pasted into the WelcomeGate field signs the user in exactly as tapping it would, for
      both an invite link and a magic link, and a truncated paste produces a named error rather than
      a silent failure or a dead-end spinner.
- [ ] Entering via recovery kit lands on the member's first non-recovery method (PIN, or biometric
      on a native device where one is enrolled) rather than the reset pane; the existing PIN works;
      reset is reachable but optional; reset remains impossible via passphrase; a member with NO PIN
      still lands on reset-pin.
- [ ] Unclaiming a member kills their saved magic link, verified after a full sync round-trip AND
      against a peer device still holding the old wrap in memory.
- [ ] No join-flow error path emits the full invite/magic token or the full Drive fileId — asserted
      in a test over the context `recordError` builds.
- [ ] A rotation stamped by a device with a fast clock is still superseded by a later rotation on a
      correct-clock device.
- [ ] A returning member on a cold device is never told the file belongs to another family.
- [ ] An older client can open, re-write and sync the file without destroying `memberLinkKeys`.
- [ ] A magic link minted before a kit-driven PIN reset still works afterwards.
- [ ] Every new string has both `en` and `beanie` values; `beanie` keeps the real nouns.
- [ ] Help Center articles added/updated and matching shipped behaviour.
- [ ] Diagnostic logging implemented via `loginFlowEvents`; `emitLinkRedeemed` fires on success as
      well as failure for BOTH `kind:'device'` and `kind:'magic'`; join started/completed events
      exist; **zero new context keys** and therefore zero store-declaration changes.
- [ ] No `catch` added by this change is empty or log-free; every failure in the Error Handling
      Contract has been triggered by hand at least once and produced both the on-screen message and
      the console/CloudWatch line.
- [ ] No duplicated mint logic and no third QR-and-link surface: the mint sequence exists ONCE in
      `useMintedLink`, the QR/link/copy presentation exists ONCE in `MintedLinkPanel` (over
      `InviteLinkCard`), and `DeviceLinkCard.vue` is at most 65 lines (from 124) with no `try`/`catch` and no
      telemetry call.
- [ ] `ENVELOPE_KEY_DICTS` is the only list of envelope wrap dicts in the codebase; removing an
      entry fails `npm run type-check`; `envelopeMerge.ts` contains no hand-written dict list.
- [ ] `proveMethods.PROBES` is unchanged; a magic link adds no prove method and no `ProveView` pane.
- [ ] A failed mint at creation or join degrades to a pointer and NEVER blocks the step.
- [ ] Phase 4 sweep completed with written pass/fail evidence per step.

## Testing Plan

1. Unit: `magicLink` mint→redeem round trip; wrong token; rotated `keyId` fails closed; missing
   entry; missing member.
2. Unit: `pickNewerByCreatedAt` — newest wins, missing `createdAt` sorts oldest, one-sided presence
   survives. The existing passphrase assertions in
   `src/services/sync/__tests__/envelopeMerge.test.ts` must pass **UNCHANGED** after the
   generalisation — that is the proof the refactor is behaviour-preserving.
3. Unit: `preserveLocalKeyDicts` preserves `memberLinkKeys` both directions; a rotation on device A
   is not reverted by device B's stale copy; a dict absent on both sides is still OMITTED, not
   written as `{}`; and the three required dicts still default to `{}`.
   3a. Unit: `keyDictSize` counts `memberLinkKeys` — the offline-publish signal. Extend the existing
   "keyDictSize counts kits + passphrase" test at `envelopeMerge.test.ts:185`.
   3b. Unit: `magicLink` round-trips `createInvitePackage` → `redeemInviteToken` end to end. No longer
   a base64-vs-base64url test (that bug class is gone now the wrap is not hand-composed) — it proves
   `MemberLinkKeyPackage`'s extra fields did not break the inherited `InviteKeyPackage` contract.
   3c. **Type-level: the registry guard actually guards.** A `@ts-expect-error` fixture showing that
   removing `memberLinkKeys` from `ENVELOPE_KEY_DICTS` fails `type-check`. VERIFIED viable:
   `tsconfig.app.json` includes `src/**/*.ts`, so test files ARE type-checked by `npm run type-check`
   (`vue-tsc -b --noEmit`) and a `@ts-expect-error` there is a real assertion. Requires
   `EnvelopeKeyDictField` and `MergeRule` to be EXPORTED. Assert BOTH directions: a registry missing
   an entry errors, and a registry with an unknown entry errors.
4. Unit: `envelopeCapabilities` / `coldCredentialSurface` unchanged by the new dict — a kit-born
   family is never offered a password field.
5. Unit: `ProveView` landing — kit arrival defaults to PIN; reset reachable; passphrase arrival
   offers no reset; no-PIN member still lands on reset.
   5a. Unit: `proveMethods.PROBES` names and order are unchanged by this feature — the axis-B invariant.
   5b. Component: a failed `setMemberLinkWrap` at the creation kit step leaves the confirm button
   ENABLED and shows the Settings pointer; the same at join still reaches the app.
   5c. Unit: `openedByLink` is cleared on `done`, on `idle` and on `START`, so a later manual login
   emits no `link_redeemed`.
   5d. Unit: revocation — Proofs 1 to 4 in "Revocation: how it is PROVEN". Proof 2 (the propagation
   test) must be written and observed FAILING against `'local-wins'` before the registry entry is
   switched to `'newest-wins'`.
   5g. Unit: each of the four redeem checks fires its OWN code, in order, and no other — `no-entry`,
   `link-revoked`, `token-expired`, `key-rotated`. Assert that a package which is BOTH revoked and
   expired reports `link-revoked`, since that ordering is a deliberate UX decision.
   5h. Unit: `keyDictSize` is UNCHANGED by a rotation. This test PINS the limitation so nobody
   re-derives "the count will publish it" (it will not — `syncStore.ts:1849` is a strict `>`). Pair
   it with an assertion that `setMemberLinkWrap` awaited `syncNow(true)`.
   5i. Unit: `revokeMemberLink` runs for a KIT-BORN family (`wrappedKeys: {}`) — the case
   `retireMemberKeyMaterial`'s `localWrapsCleared === 0` early return (`:5983`) skips.
   5e. Unit: `recordError` context carries neither the full token nor the full fileId (1g).
   5f. Unit: monotonic `createdAt` — minting against an existing entry stamped in the future still
   produces a strictly newer value.
6. Integration: old-client simulation — parse, `reEncryptEnvelope`, merge, confirm links survive.
7. Browser (`/run`): creation → save step → magic link on a second profile → PIN → signed in.
8. Browser: join → magic link → second profile → PIN → signed in.
9. Browser: Settings regenerate → old link dead, new link live.
   9a. Browser: unclaim the member on device A; the link that member saved stops working on device B
   after a sync round-trip.
   9b. Browser: Proof 5 — mint on profile A, save the URL, mint again, confirm the saved URL is refused
   on profile B with the named reason, then force a sync from a context still holding the old
   envelope and confirm the old link stays dead.
10. Browser: light AND dark, plus Large reading mode, on all four surfaces.
11. Phase 4 sweep (below).
12. Full suite + type-check + lint.

## Phase 4 — Holistic iPhone Joiner Sweep

### ⚠️ PREREQUISITE — deploy first

This sweep cannot start until `main` is deployed. Re-verified: `b0999459`, `1e1d1c18` and `855a0809`
are NOT ancestors of the last prod deploy `92ec4937`, and `git rev-list --count 92ec4937..HEAD` = 65.
Step 1 of the sweep is verification of those commits, so running it against production today
measures the OLD code and would report the already-fixed bug as still broken.

### The report (verbatim, from the early adopter who raised the original joiner problem)

> He's on an iPhone, we both are. The file in my drive has him listed as it being shared with him
> but when he logs in through Google with his Gmail it just goes back to the login page in the app.

### CRITICAL FINDING — established before planning, not assumed

**The reported symptom is almost certainly ALREADY FIXED ON `main` AND NOT DEPLOYED.**

- Last successful `Deploy beanies PROD` = `92ec4937` (2026-09-15).
- `git merge-base --is-ancestor` proves `b0999459` (join consent loop), `1e1d1c18` (picker opens on
  the consented account) and `855a0809` are NOT ancestors of `92ec4937`. They are among 65
  undeployed commits.
- CHANGELOG 2026-09-16 describes the fix in the reporter's own terms: _"Joining a family from an
  iPhone no longer loops back to the Google sign-in screen... beanies was treating 'we have not been
  shown your family's file yet' as 'you are signed in to the wrong account', which on an iPhone, an
  iPad or an installed app meant leaving the page entirely instead of opening the file chooser."_

**The sweep's first job is therefore VERIFICATION, not diagnosis.** Do not re-fix what is fixed.

### Sweep scope — the full chain, in order, on iOS Safari + installed PWA + native iOS

1. Invite link parse and arrival — `parseInviteLink`, hash-routed and query-routed forms, and the
   `capacitor://` origin hazard `shareableOrigin()` exists for.
2. Google consent under iOS redirect-auth (ADR-026), `loginHint` pre-population from the invite's
   `hint`, and the decline/retry path `b0999459` addressed.
3. Drive file discovery and the Picker showing the account that just consented (`1e1d1c18`): the
   Picker lists the browser's DEFAULT session, not the OAuth token's account.
4. **The reporter's exact case** — a file shared via `shareDriveAccess` writer grant vs. what the
   Picker actually surfaces to the invitee.
5. Member claim and PIN creation (`useJoinFlow` set-pin → joining, `authStore.joinFamily`).
6. NEW: magic link issuance at end of join, and its iOS behaviours — QR rendering, clipboard copy
   under iOS, and whether a saved link survives the PWA's storage isolation (iOS Chrome and
   Safari/PWA have completely separate IndexedDB).
7. Hand-off into the signed-in app and the first-run state a joiner lands in.

### Required outputs

- Written pass/fail per step with file:line evidence, not impressions.
- Every genuine defect either fixed here or filed with a repro.
- `login-flow` CloudWatch check for `prove_outcome`, join events and device-link events, to see
  where real joiners actually fail.
- An explicit statement of what could NOT be verified without a physical iPhone. That is greg's to
  run and must never be reported as passing.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan block plus three code sweeps; established
  the memberId-keying decision, the keyId-fails-closed requirement, and the undeployed-fix finding
  behind Phase 4.
- **Pass 2 (DRY + error handling)**: Corrected four dead citations (`mergeEnvelopes` does not exist,
  it is `preserveLocalKeyDicts`; `ALLOWED_CONTEXT_KEYS` is in `diagnosticContext.ts` not
  `logEvent.ts`; `generateInviteQR` is not in `inviteService`; the unlock card is gated, not
  ungated); caught two omissions that would have shipped silently (`keyDictSize` must count the new
  dict or an offline mint never publishes, and the base64-vs-base64url salt split); cut a new
  component, a new telemetry surface, five privacy-declared context keys and a type-invalid
  `perfTiming` call by reusing `InviteLinkCard`, `RecoveryKitDisplay`, the `lk=1`/`link-ready` path
  and the `loginFlowEvents` facade; reduced Phase 2 to a single expression; added an Error Handling
  Contract table; and folded in the measured CloudWatch/Plausible baseline, which confirmed the
  premise (27% of new families redeem a kit on a cold device) and killed one assumption (the device
  link has never been used in production).
- **Pass 3 (Sustainability)**: Replaced the two hand-maintained envelope-dict lists with a single
  `ENVELOPE_KEY_DICTS` registry plus a `satisfies` exhaustiveness check, turning the plan's top
  hazard from a comment into a compile error and making dict #5 one line; recorded WHY four dicts
  stay separate and narrowed `envelopeCapabilities`' now-false docstring; named the two-axis rule
  (one file-opening route, zero prove methods, `PROBES` must not grow); moved the link-redeem
  success emit from five `PROVE_SUCCEEDED` sites to the single `done` branch with a clear-on-idle
  lifecycle, and deleted `emitKitArrivalChoice` in favour of an `+opener:kit` flag on the existing
  `prove_outcome` detail; replaced the shared-shell-with-fallback with a decided `useMintedLink` +
  `MintedLinkPanel` split and made `useClipboard` take the caller's surface across its nine call
  sites; split the magic-link resolver out of `tryInviteTokenDecrypt` over a shared decrypt tail;
  and closed two ways a failed mint could strand a user mid-creation or mid-join.
- **Pass 2 (re-run after the 7-day scope change)**: Found the expiry change had left NO
  Error-Handling row, no copy and no telemetry row for an expired link; renamed `expired-keyid` →
  `key-rotated` and folded expiry onto the device link's existing `token-expired`; made
  `MemberLinkKeyPackage extend InviteKeyPackage` and added `tokenHash`, without which a revoked link
  fails at `unwrapFamilyKey` and "this link has been cancelled" is unreachable; specified the
  monotonic `createdAt` that Proof 3 asserts but nothing implemented; found that `keyDictSize` is a
  strict `>` on a COUNT so an overwrite (every rotation, every revocation) never triggers a publish,
  and that `revokeMemberLink` as specified would have been an unhandled async rejection inside a
  synchronous function behind an early return that skips kit-born families; and cleared the stale
  permanent-link language and ten drifted citations.
- **Pass 4 (Fresh-eyes sweep)**: Split the plan into four ships (small fixes first, the merge
  registry alone, then the credential, then a deploy-gated iPhone sweep); found that the FULL invite
  token is written to the allowlisted `invite_token_tail` key at `useJoinFlow.ts:478` and would
  publish a permanent credential to CloudWatch and Slack; corrected the load-bearing claim that an
  overwrite propagates under the existing merge (it does NOT — `mergeKeyDict` is local-wins, and
  only the new `newest-wins` rule makes rotation work); closed the member-removal hole by revoking
  through an overwrite with a discarded token rather than an unpropagatable delete; removed the
  unimplementable "delete the dead entry" from the cold keyId path; recorded the query-string
  exposure against the repo's own fragment convention and verified why the fragment is unavailable
  (the OAuth returnPath drops it); gave the registry a `required` flag so it can reproduce
  `preserveLocalKeyDicts`' asymmetry, and defined the missing `mergeNewestWinsDict`; found that the
  joiner is never SHOWN the link the plan mints for them and specified the save step; deleted the
  duplicate `emitDeviceLinkRedeemed(true)`; and resolved four contradictions left by earlier rounds.

## Prompt Log

Full prompt history is recorded in `docs/prompts/2026-09/2026-09-17-second-device-friction.md`,
which carries every prompt verbatim plus the decisions taken and the facts verified this session.

---

## Implementation notes (2026-09-17, decisions taken during the build)

Recorded here rather than only in a hand-back message, because these are the calls a
future reader will otherwise have to re-derive from the diff.

### Deviations from the plan, and why

1. **Mint telemetry lives in `useMintedLink`, not in the cards.** The plan's acceptance
   criterion said `DeviceLinkCard` must end with no telemetry call. The first pass left the
   emits in the card's `mint` closure. Moving them into the composable satisfies the
   criterion AND is better: both link kinds now emit identical shapes by construction
   rather than by care.
2. **`ENVELOPE_KEY_DICTS` is a TYPE ANNOTATION, not `as const satisfies`.** The plan
   specified `satisfies`. That narrows `spec.rule` to the literals the registry currently
   holds, which made the `'newest-wins'` branch an "unintentional comparison" type error
   until a dict used it — forcing a new dict to add a BRANCH as well as a line, the exact
   coupling the registry exists to remove. The annotation gives the same exhaustiveness
   (every union member required, unknown keys rejected) while widening `rule`. Noted in the
   file.
3. **No join-started/completed emitters were added.** The plan required them on the
   grounds that CloudWatch showed no join funnel. That research was wrong: it searched the
   `login-flow` surface, and the funnel already exists on `join-flow` —
   `joinStepEvents.watchJoinSteps` emits every step transition and `emitJoinCompleted` is
   already called. Duplicating it would have been two shapes for one funnel. A note in
   `loginFlowEvents.ts` records this so the next reader does not "fix" it again.
4. **A real regression surfaced that the plan said could not exist.** Phase 2 claimed
   "nothing else in the file changes". `forgotCredential` returned `'pin'` whenever the PIN
   pane was active, and was only `null` for kit arrivals BY ACCIDENT — because a kit
   arrival always landed on `reset-pin`. Moving the landing to the PIN meant someone who
   had just redeemed their kit was offered "Forgot your PIN? Use a recovery kit". Fixed by
   gating on the OPENER rather than the pane. The existing test caught it.
5. **Phase 5c (Play Install Referrer) NOT built.** Android-only, bounded to 90 days, the
   referrer transits Google Play, and shipping it obliges updating the Play Data Safety
   answers and the store data-collection runbook — for an install case the paste fallback
   already handles and the email follow-on removes entirely. The plan already recommended
   deferring; this confirms it was deferred.
6. **Phase 5d shipped PARTIALLY, deliberately.** The token now gets `router.replace`d out
   of the URL immediately after `parseUrl` reads it, which removes it from the address bar,
   the history entry and any `Referer`. The full move to the fragment did NOT ship: it
   requires `usePickBeanpodFile`'s OAuth returnPath (`${pathname}${search}`) to carry a
   fragment first, and that is the iOS redirect path this whole feature exists to serve —
   breaking it to harden a 7-day token is the wrong trade to make unattended. The strip is
   most of the value; the fragment move is a follow-up.

### What the iOS half cannot do yet

`applinks:app.beanies.family` is in `App.entitlements`, the AASA is written, and the
Android manifest claims the host. **The iOS half cannot take effect from a web deploy** —
entitlements are compiled into the binary, so it needs a new native build. No Apple
Developer portal change is required: the Associated Domains capability is already enabled
on the App ID (the existing entitlement would not sign otherwise) and signing is
automatic. Play Console needs nothing; `assetlinks.json` is already live and correct on
both origins.

### Defects found AFTER the code was written, and by what

Recorded because the _source_ of each catch is the useful part.

**D1 — CRITICAL, self-inflicted, caught by the Phase 4 joiner code trace.** The `t=` strip
added as a privacy mitigation (Phase 5d) destroyed the invite token across a full-page
OAuth redirect. `usePickBeanpodFile` composes the returnPath as
`${window.location.pathname}${window.location.search}` — read from the LIVE address bar —
and that returnPath is the ONLY carrier of the token across the redirect; nothing stashes
it anywhere else. Every redirect-auth platform (iPhone, iPad, installed PWA, native shell)
would have consented, returned with an empty token, had the decrypt silently skipped, and
landed on "contact a family admin" — **indistinguishable from the consent-loop bug that
had just been fixed.** Removed, with a comment explaining why a deferred strip does not
save it either (iOS discards backgrounded tabs; a reload of a stripped URL has nothing to
recover from). Two regression tests now pin the URL contract, and `parseUrl` is exported
solely so they can.

**D2 — HIGH, caught by the same trace.** The joiner's `link-saved` step — by its own
comment "the ONLY moment the joiner can ever see their link" — rendered the URL as bare
selectable text with no copy button, no QR, and no copy-failure row. On a phone the only
save action was tap-to-select then long-press on a wrapped monospace URL. Fixed by using
`MintedLinkPanel`, which already existed in this same change set and was wired into both
Settings cards but not into the one screen that cannot be revisited.

**D3 — MEDIUM, same trace.** The paste fallback validated with `parseInviteLink` (which
accepts hash-routed links) and then re-derived the query from `new URL(...).search`,
discarding the hash — so a pasted legacy link passed validation and routed to a bare
`/join` with no error, no token and no family. Now forwards what the parser resolved.

**D4 — LOW, PRE-EXISTING, NOT FIXED.** `useShareText` awaits `Share.share`/`navigator.share`
and only falls back to `copy()` after they reject, by which point WebKit has consumed the
user gesture, so the clipboard write fails on iOS. Left alone deliberately: it predates
this change, it is outside this blast radius, and reordering a share path has its own risk.
Every copy site this change touches IS in-gesture.

**D5 — caught by the BROWSER run, invisible to 8215 unit tests.** Changing the creation
confirm button's label broke `e2e/helpers/auth.ts`, which the whole E2E suite depends on —
it waited on the literal `recovery.kitConfirmStored`. Worse, the label was wrong: it read
"I've saved both" even when the mint had FAILED and there was only one thing on screen.
Both fixed — the label now says "both" only when there are two, and the helper accepts
either string rather than depending on a network outcome.

---

## AGREED NEXT PIECE (greg, 2026-09-17) — make invite links single-use

**Not part of this build.** Agreed during it, to be done once this session's work is
complete and before/alongside the email work.

### The problem, verified in this session

An invite link is **never invalidated by successful use**. Across the whole codebase
`inviteKeys` is only written (`syncStore.ts:3270`), merged (`envelopeMerge`) and read
(`useJoinFlow`) — there is no delete, no consumed flag, no prune. It stays live for its
full 24h and then merely fails a CLIENT-SIDE date check.

Reuse is also deliberate rather than accidental: `useInviteFlow` caches one token and
re-renders the URL per recipient with a different `hint`, explicitly to avoid "burning a
fresh token / consuming a new invite slot" (`:104-108`). So one live token is routinely in
several people's messages at once.

What a second use does:

1. `tryInviteTokenDecrypt` finds the entry, checks only expiry, and **decrypts the pod** —
   the second holder has the family key and all the family's data before any question of
   identity is asked.
2. Then it branches on the roster. If unclaimed members remain, they land on the picker
   and **can claim a DIFFERENT member** — an invite sent to Alice also lets whoever else
   holds it become Bob. If none remain, `NO_UNCLAIMED_MEMBERS` (warning, no recovery
   buttons) — but the decrypt already happened.

The only thing standing in the way is Drive read access to the `.beanpod`; a leaked link
alone opens nothing. But `shareDriveAccess` grants the invitee writer access by email, so
link + that grant is enough.

### The fix, and why it is now small

Overwrite `inviteKeys[tokenHash]` with a dead package on successful claim — the same move
`revokeMemberLink` makes for the magic link (empty `salt`/`wrapped`, unmatchable hash), so
a later redeem fails at the wrap lookup with a NAMED reason rather than limping into a
generic failure.

⚠️ It requires flipping `inviteKeys` to `'newest-wins'` in `ENVELOPE_KEY_DICTS`, because
under the current `'local-wins'` rule a peer holding the pre-consumption entry republishes
it and the consumption silently un-happens — the exact failure Proof 2 was written to
catch for `memberLinkKeys`. That flip is now ONE LINE because the registry exists; before
Ship 2 it would have been a refactor.

### SCOPE: invite links ONLY. Device links stay reusable. (greg, 2026-09-17)

Device links are NOT included, deliberately. A device link is a "both devices in hand right
now" tool with a 15-minute window, and reusing it inside that window is the point rather
than a leak. An invite that still works after it has been accepted is a different thing: a
spare key with counter-intuitive behaviour.

### ⚠️ Scoping it to invites changes the fix, because both kinds share one dict

`newest-wins` **cannot arbitrate `inviteKeys` as it stands.** `pickNewerByCreatedAt`
compares `createdAt`, and `InviteKeyPackage` has no such field (it has `expiresAt`). With
both sides undefined the comparison ties, and a tie resolves to `incoming` — so a
consumed-overwrite would win or lose depending on which side happened to be remote. A coin
flip is exactly what this fix exists to remove.

So the order is:

1. an additive optional `createdAt` on `InviteKeyPackage`, stamped at mint AND at consume
   (monotonic at consume, same rule as `setMemberLinkWrap`);
2. `inviteKeys` flipped to `'newest-wins'` — one line, and harmless to device links,
   because a real collision needs the SAME 32-byte token on both sides, which only happens
   when the two sides hold the same entry;
3. the consume-overwrite itself, on successful CLAIM only — so device links are never
   overwritten and stay reusable for their window.

**Rejected alternative, recorded so nobody re-proposes it:** track consumed token hashes in
the Automerge DOC. It merges properly and needs no envelope change, which is appealing —
but the doc is only readable AFTER the invite has decrypted the pod, so a second holder
would still obtain the family key and only then be told the invite was spent. Overwriting
the envelope wrap stops the decrypt itself, which is the harm worth preventing.

**Consume on the CLAIM, never on the decrypt.** A joiner who decrypts and then abandons
before setting a PIN must still be able to tap the link again; burning it at decrypt would
strand exactly the person the 2026-09-16 "claim that outlived the join" fix was written for.

Two things to get right, learned from the magic link:

- `keyDictSize` will NOT see the overwrite (strict `>` on a count), so the publish must be
  explicit, exactly as `setMemberLinkWrap` does.
- The same treatment should cover the DEVICE link, which shares the `inviteKeys` dict and
  has the same never-consumed shape. Its 15-minute window makes it far less exposed, but
  it is one mechanism and should get one fix.

Reuse Proof 1 / Proof 2 / Proof 5 from "Revocation: how it is PROVEN" — the proofs
transfer directly.

---

## ⛔ STOP POINT — this change is NOT ready to ship (2026-09-17)

Two `/code-review max` rounds ran. Round 1: 15 findings. Round 2: **15 more, six of them
regressions introduced by round 1's own fixes.** That is the documented
"patches-stop-converging" signal from `docs/lessons.md` and from this skill's Phase 6, and
the honest response is to stop correcting call sites, not to run a third round.

### The six round-1 fixes that broke something

| Fix                           | What it broke                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #5 rollback                   | Rebuilds the envelope from `syncStore.envelope.value`, which the just-run merge never updated — so it overwrites syncService's freshly-merged copy AND the worker cache with a stale one. Can lose another member's passkey/wrappedKey.                                                                                 |
| #4 unconditional tombstone    | Its central claim is false. The stamp is monotonic only against an entry THIS device holds; against an unseen remote entry it is the local wall clock, and ties resolve to remote. A future-dated mint (which `mintMagicLinkPackage` actively manufactures) beats the tombstone and the revocation silently un-happens. |
| #8 `parseUrl` returns boolean | The caller still discards it. The documented bug is unchanged.                                                                                                                                                                                                                                                          |
| #1 `activeView` watcher       | Half a fix. `/join` is the only route producing `'join'`, so a `/join`→`/join` retry changes nothing and the watch never fires — which is exactly the path the paste fallback lands on after a failed link.                                                                                                             |
| #2 `getLaunchUrl`             | Not cold-start-only on either platform, and the JS context restarts while the process lives — so any reload replays an hour-old link and yanks a signed-in member into the join flow.                                                                                                                                   |
| #7 `forgotCredential`         | Only suppresses a label inside `RecoveryKitLink`; the chip still renders "Use a recovery kit". Its new regression test passes **only because the test stubs that component** — asserting on its own mock, which ADR-007 forbids.                                                                                        |

### Why this is structural rather than a third patch round

Four of the fifteen (`#2`, `#4`, `#5`, `#15`) are the same underlying problem wearing
different clothes: **`syncStore` has nine near-identical envelope-write sites with three
different durability contracts, and `envelope.value` is not the same object the merge
updates.** Revocation correctness was built on top of that without the layer underneath
being sound. Patching each symptom is what produced the regressions.

The plan already specified the structural move and it was skipped: **Phase 1e's
`putEnvelopeEntry` helper.** One owner for clone → mutate → `setEnvelope` → publish, with
the durability contract as a parameter rather than a convention repeated nine times. That
is where the decision belongs, and it is what the next pass should do FIRST.

Also structural, and also skipped: the token should never have been in the OAuth `state`.
`redirectState.ts`'s own header forbids it ("NEVER a password, token, family key…"), the
NATIVE arm already does the right thing with a sessionStorage stash plus a nonce, and the
web arm is the outlier. Fixing that one seam closes the analytics leak, the Google-logs
leak and the history/Referer exposure together — instead of scrubbing each downstream.

### What IS safe

Ship 1 is independent, small, and clean through both reviews: the `tail()` fix for the
token leak, the `ProveView` kit-arrival default, and the unlock-screen copy. None of it
touches the envelope-write layer.
