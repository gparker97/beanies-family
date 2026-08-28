# Plan: Login/auth rethink — one flow, PIN-first identity, recovery kit, no passwords

> Date: 2026-08-28
> Related: tracker #76 (shipped but broken on the post-logout path), #77 (removal revokes access), #117 (key rotation), #18 (password strength — superseded for new families by password elimination)
> Research: 3 Explore agents (flow map, crypto map, token lifecycle) + 2 Plan agents (design, adversarial security/migration review). greg decided the open calls and added the recovery-kit direction (below).
> Status: APPROVED — 4-pass gauntlet complete 2026-08-28 (see ## Review Passes); the Pass-4 untrusted-tier-2 token-clearing amendment was accepted by greg. Implementation begins with Phase 1.

## Context

#76 went through 5 rounds of planning + max review and still failed greg's first real test on
all three platforms: logout → Google re-auth → member list → select member → **password
prompt** (iOS/Android), or a failing biometric prompt (web). Biometric has never worked
first-try in months. This plan is the first-principles redesign: dead-simple login, one flow,
one decision engine, no passwords, with a migration path for existing users.

## Diagnosis (verified in code)

**Proximate breaks in greg's repro:**

1. **Native → password:** untrusted sign-out revokes the Google grant + deletes the cached
   family key → next `loadFromFile()` fails → LoginPage's fallback (`resetLoadPodState()`,
   `LoginPage.vue:528`) **discards the resolved deviceKeys** → lands on `LoadPodView`, whose
   `checkBiometricForFamily` (`LoadPodView.vue:160-175`) gates on WebAuthn
   `isPlatformAuthenticatorAvailable()` with **no `isNative()` guard** — always false in the
   Capacitor WebView (the only capability call site without that guard). The exact surface a
   logout produces can never offer biometric on native.
2. **Web → prompt fires, then fails:** #76's untrusted-sign-out hardening (clears
   `cachedFamilyKeys`, `authStore.ts:1400-1410`) deleted the fallback the web passkey path
   silently depended on whenever PRF doesn't return the wrap → `crossDeviceNoCache` dead-end
   (`useBiometricSignIn.ts:79-88`).
3. **Forced Google re-auth every logout:** trust prompt is one-shot and default-untrusted
   (`App.vue:1614`); untrusted sign-out does a **whole-grant revoke** that empirically kills
   every device's tokens for the (user, client) pair (`googleRevoke.ts`) — also the
   cross-device churn; every redirect re-auth is hard-coded `prompt=consent` (ADR-028).

**Structural causes:** three independent "biometric or password?" decision engines
(LoginPage / PickBeanView / LoadPodView) that disagree on native; identity entangled with
decryption (one password, two PBKDF2 jobs); two biometric mechanisms with different sync
semantics (web WebAuthn+PRF fragile in 4 independent ways; native keystore solid); monolithic
logout collapsing member + pod + Google.

## Decisions (greg, 2026-08-28)

1. **No standalone hotfix** — the surgical fixes fold into Phase 1, where their surfaces are
   rewritten anyway.
2. **Retire web WebAuthn+PRF** as the web unlock mechanism.
3. **Roster is device-local only.** Names-in-envelope rejected (Drive revision history makes a
   removed child's name undeletable — GDPR Art. 17; breaks the zero-knowledge help copy;
   envelope merge cannot propagate deletions).
4. **Three-tier logout, and NO app flow ever revokes the Google grant as a side effect**
   (greg, 2026-08-28 round 2; Pass-4 amendment accepted). On trusted devices regular
   sign-out never touches Google tokens at all — not even locally (`drive.file` scope
   yields only ciphertext without the FK); on UNTRUSTED devices tier 2 clears the LOCAL
   tokens (bearer secret with write scope on a shared machine) while still never revoking. "Sign out &
   clear data" deletes the LOCAL tokens (it removes the family from this device) but does
   NOT revoke at Google — revoke is whole-grant per (user, client), so revoking from a
   device-local action punishes every other device/family member on that account; that is
   exactly the cross-device churn being killed. Revoke survives only as an explicit
   Settings action ("Disconnect Google from beanies everywhere") for the
   stolen-tokens case, alongside Google's own account-permissions page. The #62
   revoke-before-mint (fires on interactive re-consent, prevents the 100-token FIFO bug)
   is KEPT for now — interactive consent becomes rare after this plan, so its churn
   window collapses — flagged for a follow-up removal review once that rarity is
   confirmed in telemetry.
5. **Passwords are eliminated as a daily credential.** One memorable secret per member for
   everyday use: a **per-member 6-digit PIN**, synced family-wide via the doc (each member
   has their own PIN, valid on every device; hash inside the encrypted doc, where
   `passwordHash` lives today). The envelope's root of trust becomes a **recovery kit**: a
   generated full-entropy 256-bit key, wrapped into the envelope, stored by the family
   outside the app. New-device bootstrap = device-linking from a signed-in device, or the
   recovery kit, or the optional recovery passphrase (below).
6. **Optional family recovery passphrase** (greg's round-2 requirement, made safe): the
   PIN itself can NEVER be an envelope wrap — anyone who obtains the file (Drive link
   leak, Google-account breach; "can auth to Drive" IS possession of the file) can try
   all 10⁶ PINs offline in seconds, and no client-side KDF changes that materially. The
   memorable no-device recovery path is instead an optional **strength-enforced
   passphrase** stored as an ordinary envelope wrap (today's `wrappedKeys` machinery,
   zero new crypto). A family that sets one gets: all devices lost → Google sign-in →
   passphrase → in. Offered at creation (after the kit) and in Settings; never required
   day-to-day. Storage note (pass 4): the passphrase wrap lives in its own additive field,
   not as a reserved-id `wrappedKeys` entry. `tryUnwrapFamilyKey` (fileSync.ts:147-169)
   enumerates `wrappedKeys` as `(memberId, wrappedKey)` pairs and returns matches as
   member identities — during the Phase 3 mixed-version window a legacy client fed the
   passphrase would "sign in" as a phantom member id. A sibling field costs nothing
   (envelopeMerge/reEncrypt already need extending for `recoveryKeys`) and makes Phase 4's
   "drop per-member wraps, keep the passphrase" a field-level operation instead of an
   id-convention filter.
7. **Server-assisted "PIN unlocks anywhere" — considered and DROPPED** (greg, round 3). A
   retry limit cannot live in a file, so PIN-anywhere requires a server-held pepper +
   attempt-counting protocol (iCloud-escrow-style). Rejected for the infra + protocol
   cost; the passphrase/kit/device-link trio covers the no-device case. Do not re-propose
   without new evidence users are hitting that gap.
8. **Accepted trade-off, stated plainly:** lose all devices AND the recovery file AND
   have no recovery passphrase set = data is unrecoverable, permanently. Mitigations: kit
   mandatory at family creation (printable PDF + QR), re-generatable anytime from any
   signed-in device, explicit warning not to store it in the same Google Drive as the
   pod, and the optional passphrase above.

## Why this is SAFER than today, not just simpler

- Post-migration the envelope contains **only full-entropy wraps** (recovery key, invite
  keys, native/PIN wraps never enter it) plus, per family choice, one strength-enforced
  recovery-passphrase wrap. The "offline brute-force of the weakest family member's
  password" attack on the Drive file — today's real file-side weakness — collapses from
  N member passwords (weakest wins) to at most one deliberately strong passphrase.
- The member PIN hash lives **inside the ciphertext**: a file-only attacker never sees
  anything guessable. Only someone who already opened the pod (i.e. family) could attack a
  sibling's 6-digit identity hash — same insider exposure class as today's `passwordHash`,
  same low stakes (the FK is already shared within the family).
- The plaintext `cachedFamilyKeys` store (raw FK at rest, #77 route 2) is deleted, replaced
  by the PIN-wrapped device copy.

## Target architecture

### Credential model (end state)

| Purpose                                                                           | Mechanism                                                                                                                                                                                                      | Lives where                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Day-to-day unlock on a known device                                               | native OS-keystore biometric; else member PIN unwrapping `deviceUnlock` (PIN + device secret → HKDF → AES-KW over FK)                                                                                          | device registry DB / OS keystore                                                                                                                                                                           |
| Member identity (switch user, step-up, new PIN wrap on a device with an open pod) | **member PIN**, 6-digit, per member, doc-synced to all devices; PBKDF2 hash in the Automerge doc (replaces `passwordHash`; reuse `passwordService` + `DEFERRED_PASSWORD_HASH` machinery for "no PIN yet" kids) | encrypted doc (CRDT-synced)                                                                                                                                                                                |
| New-device bootstrap (get FK onto a device)                                       | **device linking**: any signed-in device mints a one-time link/QR (existing `inviteService` full-entropy machinery, short expiry); or the recovery kit                                                         | envelope `inviteKeys` (existing)                                                                                                                                                                           |
| Emergency (everything forgotten / all devices lost)                               | **recovery kit**: 256-bit random key, AES-KW wrap in new envelope field `recoveryKeys` (additive optional on '4.0'); rendered as printable PDF + QR + key string                                               | envelope + user's safe place                                                                                                                                                                               |
| Memorable no-device recovery (optional, per family)                               | **recovery passphrase**: strength-enforced phrase, one wrap via today's password machinery (`deriveMemberKey` → AES-KW). Google sign-in + passphrase recovers on a bare device. NOT a PIN — see Decision 6     | envelope `recoveryPassphrase?: WrappedMemberKey` — a NEW additive optional field, same machinery and record shape as a `wrappedKeys` entry (zero new crypto), deliberately NOT stored inside `wrappedKeys` |
| Legacy (existing families, during migration)                                      | password wraps in `wrappedKeys` keep working until the family completes PIN + kit setup                                                                                                                        | envelope (unchanged)                                                                                                                                                                                       |

PIN change propagates via the doc; device wraps carry a `pinVersion`. A stale device
cannot detect the mismatch pre-open (the current version lives inside the ciphertext), so
on that device the OLD PIN keeps unlocking until re-wrap — the same bounded trust window
`healStaleWrappedKey` already accepts for passwords. After open with a version mismatch,
prompt for the current PIN, verify against the doc hash, and re-wrap (it cannot be
silent: the PIN just entered was the old one). Two lockout interactions are binding:
(1) a user entering their NEW PIN on a stale device gets unwrap failures
indistinguishable from wrong-PIN — failure copy must include "recently changed your PIN?
this device still expects the previous one"; (2) any successful unlock resets
`failCount`.

### Inversion: prove first, fetch second

Today: load file → figure out decryption → infer identity. New: **prove locally (yield FK
from local material) → then fetch/decrypt**. A dead Drive token becomes a "reconnect Google"
panel _after_ a successful unlock — never a collapse into a credential surface. This kills
the tri-engine bug class structurally.

### State machine (LoginPage rewrite)

```
boot → registry: families[], lastActiveFamilyId
  0 families → BOOTSTRAP: welcome → {create | join-invite | link-device | recovery-kit
               | recovery passphrase (if the family set one) | legacy password (migration)}
               create → generate recovery kit (mandatory, confirm stored) → set PIN →
               offer optional recovery passphrase → in
  1 family  → person-select
  >1        → family-select → person-select

person-select   buttons from rosterCache[familyId]; fallback source = credential records
                (deviceUnlock + native records) if roster evicted — roster is display
                only, NEVER a gate, NEVER authorization
                "someone else" → member PIN entry (identity check vs doc hash)
                (precedent: passkey records already persist memberName as an
                enrol-time display hint, deliberately unreconciled — rosterCache
                entries adopt the same semantics; userFamilyMappings is NOT a
                roster — it holds only the signed-in user's own mapping)

prove(member)   ONE screen, ordered inline fallback chain from the single
                resolveProveMethods(familyId, memberId):
                  1. native keystore record && isNative() → OS biometric
                  2. deviceUnlock record → PIN pad (auto-appears on 1's failure)
                  3. member has no PIN && pod open → tap-through (kids)
                  4. recovery/bootstrap link (always visible, small)
                SUCCESS yields { memberId, FK } from LOCAL material only.
                5 PIN failures → destroy this deviceUnlock wrap → re-bootstrap
                (link from another device / recovery kit / recovery passphrase /
                legacy password)
                (fallback list is phase-aware: until Phase 3 ships, only legacy
                password / native biometric / plaintext-cache exist — the destroy
                dialog must never advertise kit/link/passphrase before they are live)

open            fetch envelope → decrypt with FK
                fetch fails → reconnect-google / re-pick-file INSIDE this state
                keyId mismatch → fail closed → re-bootstrap (#117 hook)
                decrypted → refresh rosterCache → offer missing enrolments
                (PIN not set / biometric available / kit not generated) → in

in              switch-person → person-select  (pod open, grant kept; target member's
                                                PIN or biometric — kids tap through)
                sign-out      → boot           (close pod; Google tokens untouched)
                sign-out+clear→ boot           (full LOCAL teardown incl. local tokens;
                                                NO revoke at Google — removes this
                                                family from this device only)
```

The machine itself is a **pure TypeScript module**, `src/services/auth/loginFlow.ts` (new):
typed states, a `transition(state, event, ctx)` function, no Vue imports, no I/O — effects
(store calls, fetches) are requested via the returned state and executed by the component.
`LoginPage.vue` becomes a thin renderer: current-state → which view component, events →
`transition`. The full matrix in Verification ("platform × enrolment × pod-state × trust")
is unit-tested against this module directly, never via component mounts.

Known consequence, intended: tap-through (method 3) requires an open pod, and a
deviceUnlock wrap requires a PIN — so after a tier-2 sign-out, a device whose only
enrolled members are PIN-less kids has no local prove method; a PIN-holding member (or
bootstrap) must reopen first. This matches today's deferred-password semantics.
Mitigations: the `open`-state enrolment offer surfaces PIN setup for PIN-less members,
and the sign-out confirmation on a device with no PIN-holding enrolments warns that
reopening will need another family member or a recovery path.

**Dies:** `LoadPodView.checkBiometricForFamily`, `activateFamilyForBiometric`'s routing
role, `resetLoadPodState`'s key-discarding fallback, the web PRF path (phased), plaintext
`cachedFamilyKeys`, passwords (phased, per family).
**Merges:** `PickBeanView` + `BiometricLoginView` → `PersonSelectView` + `ProveView`.
**Demoted:** `LoadPodView` → pure fetch/reconnect/file-picker for bootstrap + `open`-failure.
**Survives:** `FamilyPickerView`, `CreatePodView`, `JoinPodView`, envelope crypto,
`inviteService` (extended to device linking), `ReauthChallenge` (target-member PIN or
biometric — a _device_ credential alone never satisfies step-up for high-stakes actions).

### Device PIN wrap spec (adversarial-review conditions, all binding)

- `FK_wrapped = AES-KW( HKDF-SHA256(deviceSecret, info=memberPIN), FK )`; deviceSecret =
  256-bit random bytes imported as a **non-extractable HKDF base CryptoKey**
  (`importKey('raw', bytes, 'HKDF', false, ['deriveKey'])`) stored via structured clone in
  the registry DB (extractable-bytes + PBKDF2-210k fallback where CryptoKey structured
  clone is unsupported; flagged in telemetry). NOTE: an AES-KW key cannot serve as HKDF
  input material — the secret must be created as an HKDF base key or the derivation is
  impossible in WebCrypto (the codebase's own HKDF path does exactly this,
  `passkeyCrypto.ts:85`).
- Records per (familyId, memberId): `deviceUnlock[familyId:memberId] = { memberId,
memberName, wrappedFK, keyId, pinVersion, createdAt, failCount, kdf }` — `memberName`
  is the same enrol-time, deliberately-unreconciled display hint the native keystore and
  passkey records already carry; without it the person-select roster fallback (which
  sources from credential records) has nothing to render.
- **5 failures → destroy the wrap** (bounded casual-guessing; no tamper-proof pretense).
- Lockout is crash/refresh-proof: the `failCount` increment is **persisted (awaited) before
  the failure UI renders**, and the destroy-at-5 check reads the persisted count — closing
  the tab or killing the app between attempts must not reset the counter. Single writer:
  increments and the destroy go through one `deviceUnlock.ts` function, never inline in views.
- Enrollment trusted-device-gated; **no wraps on untrusted devices**.
- `keyId` stamped into deviceUnlock AND native keystore records → #117 rotation invalidates
  every device copy fail-closed.
- Native: PIN is fallback UI over the existing keystore item — no second FK copy.
- Honest threat model: profile malware/XSS remains game-over (as today, which cached the FK
  in plaintext); the PIN's wins are stolen/borrowed-device, at-rest, and deleting the
  plaintext-FK liability.

### Recovery kit spec

- 256-bit random key, presented once as `XXXX-XXXX-…` string + QR inside a generated PDF
  ("store this somewhere safe — it is the only way in if every PIN is forgotten"; explicit
  "not in the same Google Drive as your family data" warning).
- Envelope: `recoveryKeys?: Record<kitId, { salt, wrapped, createdAt }>` — additive optional
  field on `'4.0'` (precedent: `writerVersion?`). Wrap derivation reuses `inviteService`'s
  PBKDF2-over-random-token pattern (full entropy → offline-safe).
- Regenerating a kit adds a new entry and tombstone-replaces the family's prior entry
  **locally**; because envelope dicts are local-wins with no deletion propagation, treat old
  kit entries as valid until #117 key rotation retires them (document this; it is the same
  semantics `wrappedKeys` already has).
- Rendering reuses the existing export stack — NO new PDF/QR/delivery code: lazy jsPDF via
  `useSheetExport`'s `pngBlobToPdf`/`ExportError` staged taxonomy, delivery via
  `shareOrDownloadFile.ts` (the declared single delivery seam), QR via `utils/qrCode.ts`
  (generalize `generateInviteQR` to accept arbitrary text rather than adding a second QR
  helper), copy-to-clipboard via `useClipboard`.
- Failure ordering: the key string + QR render ON SCREEN first; PDF generation/share is a
  second, optional step. A jsPDF load or share failure (offline, WebView quirks) shows the
  staged `ExportError` with retry and NEVER blocks kit confirmation — the user can
  transcribe the on-screen string. All failures `reportError` (surface `login-flow`).
- Using the kit = bootstrap: unwrap FK → open → land in enrolment (set/reset PINs).
- Creation flow makes generation **mandatory** with a "yes, I stored it" confirmation step.

### Logout tiers + Google

- **Switch person:** clears member session only; doc, FK, grant untouched; target member
  proves with their PIN/biometric (kids tap through).
- **Sign out:** force-save, close pod, clear session. **No tier revokes at Google**
  (greg, round 2). On TRUSTED devices tokens are also untouched locally — silent Drive
  refetch, no Google screen. On UNTRUSTED devices tier 2 clears the LOCAL tokens along
  with the family DB and device wraps (still no revoke): a refresh token is a bearer
  secret, and `drive.file` write scope means a shared-device successor could overwrite or
  delete the family's ciphertext file (availability/integrity, not confidentiality) — and
  keeping it would break the documented account-switch invariant in `signOut` (a
  different account on a shared device must get full teardown or silent refresh
  resurrects the wrong account's Drive). So tier 2 = `{ clearLocalTokens: !trusted }`,
  tier 3 = `{ clearLocalTokens: true }`. The untrusted tier-2 step list also includes
  `clearDepartedGoogleArtifacts` (the `.beanpod` driveConnections mirror + last-account
  breadcrumb, authStore.ts:1310-1321). **[Pass-4 amendment ACCEPTED by greg 2026-08-28 — the round-2 goal (no revoke churn, no
  Google screen on personal devices) is fully preserved.]**
- **Sign out & clear data:** full LOCAL teardown — family DB, wraps, roster, AND the
  locally-stored tokens — but **NO revoke at Google**. Deleting the local tokens already
  makes this device unable to use the grant; revoking would kill every other device and
  family member on the same Google account (whole-grant revoke, no per-device revoke
  exists). This is the way to remove a family from a shared device. (Signing into a
  _different_ family never requires it — the family picker supports several side-by-side.)
- **Explicit revoke action** (Settings → "Disconnect Google from beanies everywhere"):
  the ONLY place the app calls Google's revoke endpoint. For the
  my-tokens-were-stolen case; copy states plainly that every device on this Google
  account will need to reconnect. Google's own account-permissions page remains the
  out-of-band alternative.
- Trust prompt becomes re-offerable. ADR-028's `prompt=consent` invariant untouched —
  with the grant surviving sign-out, silent refresh means the consent screen stops being
  routinely reached.
- **Residual churn source, kept deliberately:** #62's revoke-before-mint on interactive
  re-consent (prevents the 100-token FIFO bug) and the account-CHANGE teardown. Both fire
  only on now-rare events (new-device bootstrap, switching Google accounts). Flagged for
  a follow-up removal review once telemetry confirms interactive consent is rare.
- **Rejected:** driveConnections "skip revoke if siblings share the grant" heuristic
  (stale-mirror authorization; Google has no per-device revoke anyway) — moot now that
  no sign-out tier revokes at all.

## Phasing (each independently shippable)

**Phase 1 — unified flow + roster cache (no crypto changes).** LoginPage state-machine
rewrite; `PersonSelectView` + `ProveView`; single `resolveProveMethods`; LoadPodView
demotion; roster written on every open. The two surgical fixes land here as side effects of
deleting their surfaces. Existing credentials (passwords, native biometric, web passkeys)
keep working behind the new flow.

**Phase 2 — member PIN + device wraps.** PIN set/enrolment (`post-open-enroll` + Settings);
doc-side PIN hash (reuse `passwordService`); `deviceSecret`/`deviceUnlock` stores; plaintext
`cachedFamilyKeys` replaced lazily on trusted devices (decline = keep today's behavior).
Password entry remains available as a prove fallback for legacy members.
`cacheFamilyKey`'s `force: true` caller (join flow, which bypasses the trust gate) is
migrated in the same phase — the join flow's "just created a credential" moment becomes
the PIN-enrol + deviceUnlock-wrap moment, so no `force` writes of plaintext keys remain.
Creation flow is UNCHANGED in Phase 2 (still password-based per the unified create flow);
PIN is strictly an additional enrolment. No family may have PIN as its sole cold-boot
credential before Phase 3's kit exists — otherwise a single-device family that hits
lockout-destroy in Phase 2 is permanently locked out.

**Phase 3 — recovery kit + passphrase + device linking.** `recoveryKeys` envelope field;
kit generation UI (mandatory in create flow, offered to existing families via a persistent
nudge); optional recovery-passphrase set/change in Settings + post-kit creation step
(reuses the password wrap machinery with strength enforcement); device linking via
`inviteService` QR/link from any signed-in device — reusing
`generateInviteToken`/`createInvitePackage`/`isInviteExpired`, the `InviteLinkCard.vue`
link+QR+copy UI, and `useInviteFlow`'s error-code/recovery pattern (`InviteFlowError`
with typed `recovery` actions) for link mint/redeem failures. New code is limited to the
short-expiry policy and the redeem-side prove-tail hookup.

Passphrase strength enforcement is NOT a meter: no strength helper or zxcvbn dependency
exists in the codebase and none is added. Default UX generates a 4-word passphrase from an
embedded wordlist via `crypto.getRandomValues` (guaranteed entropy, memorable, zero
validation code); "use my own" is allowed behind one small rule in a new
`src/utils/passphraseStrength.ts` (min 14 chars AND min 3 distinct words/tokens; reject if
it equals the family name or a member name). Entry UI reuses `PasswordEntryFields.vue`
(the existing new+confirm pair — validation deliberately parent-owned, per its own header).

**Phase 4 — retire PRF + passwords.** Stop creating PRF enrolments; honor existing
`passkeyWrappedKeys` one release, then remove the assertion path (abandoned entries inert).
Families that have PINs-for-all + a stored kit get "remove passwords" (empties
`wrappedKeys` on next re-encrypt — the `recoveryPassphrase` field, if set, is untouched;
legacy clients in that family must be updated first — gate on the family's
`writerVersion` floor).

**Phase 5 — logout tiers + trust UX + revoke relocation.** Three actions wired
(`AppHeader`/`MobileHamburgerMenu`/`SettingsPage`); sign-out and sign-out-and-clear both
stop calling Google's revoke endpoint (clear-data deletes local tokens only); the new
explicit "Disconnect Google from beanies everywhere" Settings action becomes the sole
revoke site; re-offerable trust prompt. Tier behavior differences must be expressible as
step-list membership, not conditionals inside steps.

**Rollback:** PIN/kit behind flags; password path untouched until Phase 4, so rollback
through Phase 3 = password sign-in everywhere. One-way steps: deleting a plaintext cached FK
(recoverable via any bootstrap); a family completing Phase-4 password removal (recoverable
only via kit/linking — that is the point). Mixed-version families: safe through Phase 3
(additive field survives old writers via `reEncryptEnvelope` spread — verify in Phase 3
tests); Phase 4 password removal is explicitly gated on the whole family being current.
Flag hygiene: the flags are named up front (`pin-unlock`, `recovery-kit`,
`recovery-passphrase`, `logout-tiers`) and each has a bound removal point — a flag is
deleted (code paths inlined, off-branch removed) in the phase after its feature ships
default-on. Phase 5's exit criteria include zero auth-flow flags remaining.

**Per-phase deletion gates.** The "Dies" list is not aspirational: each phase's exit
criterion includes a grep-verifiable deletion check. Phase 1: `checkBiometricForFamily`,
`resetLoadPodState`, `PickBeanView.vue`, `BiometricLoginView.vue` gone. Phase 2: no
writes to `cachedFamilyKeys` remain (including the `force: true` join-flow caller).
Phase 4: `getPRFOutput`, `buildPRFEvalExtension`, and the passkey assertion path gone
from `passkeyService.ts`; its probe removed from `proveMethods.ts`. A phase is not done
while its superseded surface still compiles.

## Critical files

- `src/services/auth/loginFlow.ts` (new) — the pure state machine (typed states +
  `transition`); the ONLY place a login-flow routing decision lives
- `src/pages/LoginPage.vue` — reduced to a thin renderer over `loginFlow.ts` (state →
  view component, view events → transitions); target is a substantial line-count
  _reduction_ from today's 945
- `src/components/login/PickBeanView.vue` + `BiometricLoginView.vue` → `PersonSelectView.vue` + `ProveView.vue` (new)
- `src/components/login/LoadPodView.vue` — demotion; delete `checkBiometricForFamily`
- `src/composables/useBiometricSignIn.ts` — already the documented single "unlock
  succeeded → become member → get in" sequence (result-variant contract, no shared error
  ref). ProveView's PIN and tap-through successes MUST terminate through this same tail
  (renamed `useProveSignIn`), not a parallel path — the five agreeing steps its header
  enumerates are exactly what a second tail would drift on
- `src/services/auth/proveMethods.ts` (new) — `resolveProveMethods`, the single decision
  engine, structured as an **ordered array of self-contained probes**, each
  `(ctx) => Promise<ProveMethod | null>` (native keystore, deviceUnlock, doc-side
  PIN/tap-through, and — until Phase 4 — legacy passkey and legacy password). ONE wrapper
  loop owns the per-probe try/catch, `reportError` (surface `login-flow`), and the
  `error_code` carried on `prove_methods_resolved`; probes contain no error plumbing of
  their own. It must NEVER throw or silently return []: a failed probe degrades that
  method away (never the whole screen) and the bootstrap/recovery option is appended
  unconditionally after the loop. Phase 4 retirement = deleting one probe from the array
- `src/services/auth/passkeyService.ts` — PRF retirement only (Phase 4)
- `src/services/auth/nativeBiometric.ts` — keyId stamping; PIN-fallback hook
- `src/services/crypto/keyWrap.ts` (new, extracted) — move the mechanism-agnostic helpers
  out of `passkeyCrypto.ts` (`deriveWrappingKey` HKDF→AES-KW, `generateHKDFSalt`,
  `wrapDEK`/`unwrapDEK`) so `deviceUnlock.ts` reuses them instead of re-implementing, and
  so Phase 4's PRF retirement deletes only the truly PRF-specific pieces
  (`getPRFOutput`, `buildPRFEvalExtension`)
- `src/services/auth/deviceUnlock.ts` (new) — PIN wrap records + lockout-destroy; crypto
  calls delegate to `keyWrap.ts` + `familyKeyService`
- `src/services/auth/recoveryKit.ts` (new) — kit gen/render/redeem; derivation delegates
  to `inviteService.deriveInviteKey` (already PBKDF2-over-full-entropy-token, AES-KW), key
  formatting/QR/PDF reuse per the Recovery kit spec
- `src/components/ui/PinInput.vue` (new, generic) — 6-digit numeric entry (inputmode
  numeric, paste-safe, error/shake state, emits complete). The ONLY PIN surface: used by
  `ProveView`, post-open enrolment, Settings PIN change, and `ReauthChallenge` step-up.
  No view renders its own digit boxes
- `src/services/auth/passwordService.ts` — reused verbatim for PIN hashing
- `src/services/crypto/inviteService.ts` — device-linking variant (short-expiry wrap)
- `src/types/syncFileV4.ts` + `src/services/sync/fileSync.ts` + `envelopeMerge.ts` —
  `recoveryKeys` + `recoveryPassphrase` additive fields; `preserveLocalKeyDicts` extended
  to merge both (its `{ ...incoming, <named dicts> }` shape silently DROPS local-only
  entries of any dict it doesn't name — an old-writer incoming envelope would erase a
  locally generated kit); `keyDictSize` extended to count both (it is the "local-only key
  material rides the next save" publish signal — a kit or passphrase set offline must
  trigger a publish exactly like an offline passkey enrolment, per its own header)
- `src/services/indexeddb/registryDatabase.ts` — `deviceUnlock`, `rosterCache`, `deviceSecret` stores (additive schema bump)
- `src/services/auth/signOutSteps.ts` (new) + `src/stores/authStore.ts` — the three tiers
  are **ordered lists of named idempotent steps** (`forceSave`, `closeMemberSession`,
  `closePod`, `resetSyncState`, `resetWorkerDoc`, `clearLocalTokens`, `wipeFamilyLocal`,
  …), each individually caught (the pattern today's `signOut` already follows inline);
  tier N+1's list is a strict superset of tier N's, asserted by a unit test. The store
  stays the entry point (it owns the session refs) but its tier functions reduce to
  "run this step list" — today's ~100-line `signOut` with interleaved trusted/untrusted
  branching (authStore.ts:1323-1418) is decomposed into steps, not copied into three
  variants. Also: switch-person primitive; PIN sign-in
- `src/stores/settingsStore.ts` — `cachedFamilyKeys` retirement (816-848); trust prompt re-offer
- `src/services/google/googleAuth.ts` — `clearGoogleSessionState` loses its entire revoke
  branch (currently lines ~1611-1643, both the fire-and-forget and the #62c awaited path)
  and its `preserveRefreshToken` boolean becomes `{ clearLocalTokens: boolean }` (tier 2 =
  `!trusted` per the Pass-4 amendment above; tier 3 = true). Invariants that survive every
  tier, verbatim from the current header: epoch bump, redirect-intent clear,
  permanent-failure-flag clear, and ALWAYS clearing the `__pending__` refresh-token slot
  (the documented account-B leak). The stale SECURITY NOTE naming `signOutAndClearData`
  as the revoke escape hatch is rewritten to point at the Settings disconnect action. The
  explicit disconnect calls `revokeGrant` (googleRevoke.ts) directly — no new revoke
  plumbing
- `src/pages/SettingsPage.vue` — "Disconnect Google from beanies everywhere" action (sole revoke site) + recovery-passphrase set/change
- `src/services/translation/uiStrings.ts` — all new copy (`en` + `beanie`)
- ADRs: new ADR (identity/recovery model); amendments to 014/019 (supersession note), 015 (PRF retirement), 028 (note), 029, 031
- Help center security copy (`src/content/help/security.ts`) — recovery-kit + PIN model rewrite

## Observability coverage

Surface `login-flow` (new) + existing `native-biometric`, all on the `logEvent` firehose.
All `login-flow` events go through a typed helper module
(`src/services/telemetry/loginFlowEvents.ts`, new): one narrow function per event name with
a typed payload, wrapping `logEvent`. No view or service calls `logEvent` with a hand-typed
`login-flow` event string — the headline metric (first-try success rate) is only
trustworthy if payload shapes can't drift per call site.

- `prove_methods_resolved` {member_present, methods, roster_source} on every prove render —
  answers "why wasn't I offered biometric/PIN?" blind.
- `prove_outcome` {method, ok, error_code, fallback_depth} on every attempt incl. success —
  makes first-try success _rate_ measurable (the redesign's headline metric).
- `pin_enroll` / `pin_wrap_replaced_cache` / `pin_lockout_destroyed` / `pin_rewrap_on_version`.
- `kit_generated` / `kit_redeemed` / `device_link_minted` / `device_link_redeemed`.
- `open_fetch_recovery` {reason} — proves the inversion works (these replacing
  credential-surface landings is the structural win).
- `signout_tier` {tier, trusted, tokens_kept} — confirms no tier ever revokes; local token
  deletion fires only on tier 3. `explicit_revoke_used` for the Settings disconnect action
  (the only revoke site left).
- `roster_fallback_used` — roster eviction frequency.
- Failure paths classify + `reportError`; only FK-loss-class events are `critical`.

## Review Passes

- **Pass 1 (Initial draft)**: built from 3 Explore + 2 Plan agents and three rounds of greg's decisions (biometric root-cause diagnosis, PIN/kit/passphrase credential model, no-revoke logout, PIN-anywhere dropped).
- **Pass 2 (DRY + error handling)**: 11 revisions — fixed an impossible deviceSecret crypto type (AES-KW key can't feed HKDF), extracted `passkeyCrypto`'s generic wrap helpers into `keyWrap.ts` so Phase 4 can't orphan Phase 2, moved `resolveProveMethods` out of the retiring `passkeyService` with a never-blank/never-throw contract, bound kit rendering + device linking to the existing export/QR/delivery/invite stacks, replaced the passphrase strength-meter idea with generate-by-default + one tiny rule, mandated a single generic `PinInput.vue` and a single prove-success tail, and tightened the `googleAuth` decomposition (revoke branch deleted, `{ clearLocalTokens }` replaces `preserveRefreshToken`, pending-slot/epoch invariants kept).
- **Pass 3 (Sustainability)**: 7 revisions — extracted the login state machine to a pure `loginFlow.ts` module (LoginPage.vue becomes a thin renderer), restructured `resolveProveMethods` as an ordered probe array with one error-owning loop, decomposed sign-out into named idempotent step lists (tiers as supersets, tested as data), bound feature-flag removal and per-phase grep-verifiable deletion gates into the phasing, made PIN lockout persist-before-render, and put all `login-flow` telemetry behind a typed event facade.
- **Pass 4 (Fresh-eyes sweep)**: 8 revisions — moved the recovery-passphrase wrap to its own additive envelope field (a reserved `wrappedKeys` id would surface as a phantom member on legacy clients via `tryUnwrapFamilyKey`), extended `preserveLocalKeyDicts`/`keyDictSize` to the new key fields (offline-kit loss/never-publish), rewrote the unimplementable "silent" `pinVersion` re-wrap into an old-PIN-window + prompted re-wrap with lockout-safe copy, made the lockout-destroy fallback list phase-aware with a Phase 2 no-PIN-only-credential invariant, documented the PIN-less-member cold-boot consequence, proposed tier-2 local-token clearing on untrusted devices (no revoke; flagged for greg), added `memberName` to deviceUnlock records for the roster fallback, and disambiguated per-member vs family-wide PIN wording.

## Verification

- **On-device walkthrough of greg's exact repro on all three platforms** — logout →
  re-auth → person picker → biometric/PIN — as the acceptance gate per phase. The suite has
  repeatedly failed to catch this class (`docs/lessons.md`); no green-suite claim substitutes.
- Unit: `resolveProveMethods` matrix (platform × enrolment × pod-state × trust);
  wrap/unwrap/lockout-destroy; keyId + pinVersion fail-closed; kit generate→redeem round-trip;
  sign-out tier clears (extend `dataClearingSecurity.test.ts`).
- Cross-device: tier-2 AND tier-3 sign-out on device A → device B's session and tokens
  survive (the churn repro, inverted — now for both tiers); PIN change on A → B re-wraps
  on next unlock; recovery passphrase set on A → opens the pod on a bare device C.
- Mixed-version: pre-kit client + post-kit client sharing one file — `recoveryKeys` survives
  the old writer's `reEncryptEnvelope` spread and `envelopeMerge` (explicit test).
- E2E: one journey through the new flow (Three-Gate compliant), replacing superseded login
  specs, not adding.

## OUTCOME — Phases 2 + 3 + 5 implemented (2026-08-28, same session as Phase 1)

Commits `c16a5a5d..1b7e8422` (local, unpushed with the Phase-1 series). Phase 4 (retire
PRF + passwords) deliberately NOT built — it is gated on families holding PINs-for-all +
a stored kit, which none can until this ships and is used.

**Deviations from the plan, with reasons:**

1. **Device linking deferred to the Phase-4 package.** The join flow serves only
   UNCLAIMED members (`useJoinFlow.unclaimedMembers` filters on `requiresPassword`), so
   linking an existing member needs join-surface changes — and its real consumer is
   password retirement (until Phase 4, an existing member's password bootstraps any new
   device). Building it now would touch the hardened JoinPodView twice. Kit + passphrase
   cover the no-password bootstrap paths meanwhile.
2. **`signOutSteps.ts` step-list decomposition deferred.** The tier semantics shipped as
   three store functions (switchMember / signOut / signOutAndClearData), each step
   individually caught, rather than the Pass-3 data-driven step lists. Rationale:
   rewriting two recently-hardened ~100-line teardowns late in a large batch trades a
   structural nicety for regression risk; the tier-N+1-superset property is enforced by
   `dataClearingSecurity.test.ts` coverage instead. Revisit with Phase 4.
3. **Plaintext `cachedFamilyKeys` retirement deferred to Phase 4.** The cache is per
   FAMILY; PIN wraps are per member. Deleting the family cache when one member enrols
   would break `tryTrustedAutoOpen` (and tap-through kids) for everyone else on the
   device. Retirement needs the per-member wrap coverage Phase 4's gate guarantees.
4. **App-level post-open PIN nag deferred; Settings is the enrolment surface.** The
   prompt stack already carries the trust + passkey prompts; a third needs its own UX
   pass. The create-flow mandatory kit step is likewise represented as the Settings card
   - the orange "no kit yet" callout rather than a wizard step for now.
5. **Kit codes are Crockford base32 (160-bit)** rather than base64url — transcription
   robustness (no I/L/O/U; aliases normalized on redeem).

**Phase-5 semantics as shipped:** no sign-out tier touches Google's revoke endpoint;
tier 2 keeps local tokens on trusted devices and clears them on untrusted (Pass-4
amendment); tier 3 clears local tokens only; `disconnectGoogleEverywhere()` (Settings,
danger-confirmed) is the sole revoke site; untrusted sign-out re-arms the trust prompt.

---

# PHASE 4 — FINAL PHASE SPEC (revised 2026-08-28, supersedes the original Phase-4 sketch)

> Status: drafted after Phases 1+2+3+5 shipped as web 0.13/0.13R1. Scope: EVERYTHING
> remaining in the rethink, including the setup-wizard rework greg requested
> ("has the setup wizard been updated? it is still asking to set a password").
> Three very-thorough code maps (creation flow + invariants; PRF/linking surfaces;
> debt sweep) inform every line below. Decision (greg, 2026-08-28): the recovery
> passphrase is NOT auto-generated and NOT added to the kit — it stays a Settings-only
> opt-in; the wizard is PIN + kit only.

## What "done" means

After this phase, a NEW family is born password-free (PIN + mandatory recovery kit),
an EXISTING family migrates to PINs via a post-open nag, no surface ever collects a
new password, the web WebAuthn+PRF path is gone, the plaintext `cachedFamilyKeys`
store is gone, sign-out tiers are data-driven step lists, and the docs/help/ADR
record matches reality. Zero auth-flow feature flags (none exist today — confirmed).

## Revised decisions (deviations from the original Phase-4 sketch, with reasons)

1. **`wrappedKeys` is NOT emptied for existing families.** The original sketch
   ("empties `wrappedKeys` on next re-encrypt, gated on a `writerVersion` floor") is
   unimplementable as written: `envelopeMerge` is union/local-wins and its header
   states deletions cannot propagate — any stale device would resurrect the emptied
   dict on its next fetch+push; and no `writerVersion` floor mechanism exists (the
   envelope carries only the LAST writer's version, not a fleet floor). Instead:
   password _entry and creation_ surfaces are retired (nothing ever collects or
   offers a password where a PIN exists), existing wraps stay inert-but-present, and
   dropping them from the envelope is explicitly re-homed to #117 key rotation
   (which rebuilds the envelope wholesale under a new keyId — the only mechanically
   safe deletion point). The file-side "weakest password wrap" exposure for existing
   families therefore persists until #117 — documented as a known residual.
2. **Passphrase leaves the create flow** (greg, 2026-08-28): auto-adding it to the
   kit would duplicate the kit's storage location at ~32 bits of entropy (offline-
   crackable for a file-holder in ~GPU-day) while being unmemorized (never typed).
   Settings-only opt-in stands. Wizard = PIN + kit.
3. **Password prove method becomes conditional, not deleted.** `resolveProveMethods`
   currently appends `{kind:'password'}` unconditionally (the never-blank guarantee).
   "Member has passwordHash" is NOT knowable on a closed pod today (`ProveContext`
   carries only the merged `hasCredential`; `hasPin` is open-pod-only), and the
   prove engine must stay pure (no envelope I/O — "prove first, fetch second"), so
   the facts are carried as device-local open-time data:
   (a) `RosterCacheMember` gains an additive per-member `hasPassword` flag and the
   family-level `RosterCacheEntry` gains `envelopeHasPasswordWraps: boolean`, both
   written by `refreshRosterCache` (which already reads the open family);
   `ProveContext` gains both as `boolean | null` (null → today's safe default:
   offer password). (b) Structurally: a new `{ kind: 'recovery' }` becomes the
   unconditionally-appended terminal outside the probe loop (the never-blank
   guarantee), and password moves INTO `PROBES` as an ordinary conditional probe,
   gated on `hasPassword !== false` AND
   `!(ctx.podOpen && ctx.hasPin === true)` AND (cold)
   `envelopeHasPasswordWraps !== false` — i.e. password is suppressed only where a
   PIN is verifiably usable instead (warm), because `setMemberPin` does NOT clear
   `passwordHash` and on a cold device a converted legacy member's password wrap is
   their only working local bootstrap; kit-born families get the recovery terminal,
   where a password could never succeed. Full password retirement later = delete that probe, exactly per the
   module's stated mechanism. (c) `ProveView`'s `?? 'password'` fallback default
   prefers `pin`, else the recovery terminal. A legacy member (passwordHash, no
   PIN) still signs in with their password — then the nag converts them.
4. **Device linking = FK transport + PIN identity.** A link minted from a signed-in
   device carries a short-expiry invite-style wrap (FK transport). On redeem the
   device opens the pod, then the person picks themselves and proves with their PIN
   (doc-synced — they know it). This serves CLAIMED members, which the classic join
   flow structurally cannot (`unclaimedMembers` filter), without touching the
   unclaimed-claim path.

## Work packages

### WP1 — Passwordless creation wizard (the setup-wizard rework)

New-family flow: **identity (name + 6-digit PIN) → survey → finalize (pod written
with a kit wrap, never a password wrap) → recovery-kit step (save + "I stored it")
→ members → in.**

- `ResumePodSetup.identity`: replace password+confirm with `PinInput` new+confirm
  (reuse `PinInput.vue`; `isValidPin`). Copy explains: "your PIN unlocks beanies on
  your devices" + "your recovery kit (next) is the master key".
- **Sentinel generalization** — the three lockstep invariants survive, re-pointed at
  the PIN:
  1. `signUp({deferPassword:true})` unchanged (owner born with `DEFERRED_PASSWORD_HASH`
     sentinel, and now permanently: the owner NEVER gets a passwordHash).
  2. `rehydrateOwnerDoc(name, pin)` applies `pinHash` + `pinVersion: 1` (in place on
     desktop, rebuild on iOS — both branches). No-op guard becomes "early-return only
     when the owner already holds a real `pinHash`".
  3. `syncStore.createNewFile` fail-closed precondition becomes: refuse to write when
     the resolved owner has no `pinHash` (the password-sentinel check is subsumed —
     an owner with the sentinel AND no pinHash is exactly the refused state).
- **`requiresPassword` derivation change** (`familyMemberRepository.applyDefaults`):
  derive from "no credential at all" — `!passwordHash && !pinHash`. The field keeps
  its name (rename = huge blast radius) but its doc comment is rewritten to
  "unclaimed: has neither a password nor a PIN". Verified consumers (owner election,
  transfer guard, join filter, invite picker, BeanCard) all mean "unclaimed" and are
  correct under the new derivation (`applyDefaults` computes it unconditionally on
  every read, so stored values are already overridden). In the same change, DELETE
  the now-dead explicit `requiresPassword` doc writes (`authStore.setPassword` and
  any inherited by the reworked join claim) — single derivation source, no stored
  value that can disagree with it. Explicit unit tests for: PIN-only owner reads
  claimed; password-only legacy member reads claimed; fresh invitee reads unclaimed.
- **`createNewFile` signature**: the `password: string` param is DROPPED, nothing
  replaces it (the caller cannot supply kit material — the kit wrap needs the FK,
  which `createNewFile` generates internally). `createNewFile()` generates the FK
  → calls `generateRecoveryKit(fk)` internally → the kit wrap becomes the
  envelope's only wrap at birth: `wrappedKeys: {}` +
  `recoveryKeys: { [kitId]: pkg }` (`createBeanpodV4` gains an optional
  `recoveryKeys` param) → returns `{ ..., kit: { kitId, code } }` to the wizard
  for the display step. The kit CODE is never persisted (same one-time contract as
  `generateRecoveryKit`/`redeemRecoveryKit` in `recoveryKit.ts`). A
  `generateRecoveryKit` throw aborts BEFORE any write and surfaces through
  `createNewFile`'s existing mapped-error + cleanup path — no pod may ever be
  written whose only wrap failed to generate, and never a bare throw to the wizard.
  All existing ordering invariants (write → verify → persist → register →
  markPodCreated) and the step-7 key caching are untouched.
- **Kit step** (new phase `'recovery-kit'` between finalize-success and `members`):
  shows code + QR deep link + Save-PDF/Share, requires the "I stored my kit"
  confirmation to proceed. Extract the kit-display body out of
  `RecoverySettings.vue`'s modal into a shared `RecoveryKitDisplay.vue`
  (DRY — one kit surface, two hosts). The confirmation writes a doc-side
  `recoveryKitConfirmedAt` timestamp (inside the ciphertext; also written by
  `RecoverySettings`' existing confirm) — for kit-BORN families this, NOT
  envelope `recoveryKeys` presence, is the "family has a stored kit" signal,
  because their envelope carries a wrap from birth even when nobody saved the
  code. The full confirmed-signal is
  `recoveryKitConfirmedAt || (recoveryKeys non-empty && owner holds a real
non-sentinel passwordHash)`: legacy 0.13 families always have a password-holding
  owner and their kits went through `RecoverySettings`' unclosable confirm modal,
  so they are never re-nagged; the owner-credential key is spoof-proof (old
  clients can add member wraps to a kit-born envelope via classic invites, but no
  old client can ever alter the OWNER's credential — kit-born owners are
  permanently password-free). Backfill the timestamp on first Phase-4 open when
  the legacy condition holds. The timestamp lives on the doc-side `Settings`
  entity (`app_settings` via `settingsRepository`), inside the ciphertext.
  Abandon-at-kit-step is then recoverable: the pod exists with a kit wrap, the
  device is signed in + trusted, and the WP5 nag (keyed on missing
  `recoveryKitConfirmedAt`) re-offers generation (a NEW kit — old entry inert,
  same regenerate semantics).
- **Empty-`wrappedKeys` open path**: `tryUnwrapFamilyKey` currently throws
  "No wrapped keys" when `wrappedKeys` is empty and no passphrase is set — but a
  kit-born family's envelope is exactly that. `tryUnwrapFamilyKey` itself stays
  UNTOUCHED (no hybrid throw/result contract). Instead `fileSync.ts` exports a
  pure predicate `envelopeNeedsRecovery(envelope): boolean` (`wrappedKeys` empty
  AND (`recoveryKeys` non-empty OR `recoveryPassphrase` set)); the three routing
  sites check it BEFORE offering any password entry and route to the existing
  kit-entry / passphrase surfaces: pending-file decrypt, LoadPodView bootstrap,
  AND the resume path (`ResumePodSetup`'s `auto-load` phase via
  `syncStore.completeAutoLoad` — its `'wrong-password'` error mapping must not be
  reachable for a kit-born family, or an untrusted sign-out during setup strands
  the owner on a password prompt that can never succeed). One unit test per call
  site. LoadPodView's per-member password check renders only
  members that actually have wraps; zero wraps → kit/passphrase panel directly.
- **Join claim becomes PIN-based**: `JoinPodView` `set-password` step → `set-pin`
  (PinInput new+confirm). Both real surfaces change: the envelope wrap call is
  DELETED at its actual site (`useJoinFlow`'s `syncStore.wrapFamilyKeyForMember(...)`
  after claim — no new password wraps, ever), and `authStore.joinFamily` is
  reworked to take a PIN and write `pinHash`+`pinVersion` directly (it can no
  longer delegate to `setPassword`, whose `requiresPassword` doc write is deleted
  in the derivation change above) and enrols the device wrap (`enrollPinUnlock` —
  the pod is open at that moment).
  Cross-device access for that member thereafter = their PIN on an opened device,
  device link, kit, or passphrase. `track('login',{method:'pin'})`.
- **`createNewFile` callers beyond the wizard**: `demoSeed.ts` drops
  `DEMO_PASSWORD` — the demo owner is born with a fixed `DEMO_PIN` `pinHash`, the
  generated demo kit code is discarded; verify the demo prove path under the new
  derivation.
- **Abandon-at-kit edge (honesty + escape)**: if the trusted cache is lost (site
  data cleared) before the nag regenerates a kit, a kit-born family whose code was
  never stored is permanently unopenable — the family is minutes old, stakes
  near-zero, but the kit-entry recovery surface reached for a just-created family
  keeps a "start over with a new family" escape (registry delete + re-create), and
  the plan's accepted-trade-off note gains this sub-case.
- E2E: `e2e/helpers/auth.ts` finish-surface steps updated (PIN entry + kit-step
  confirm); `setup-flow.spec.ts` + `google-drive.spec.ts` comments updated. Budget
  unchanged (updates, not additions).

### WP2 — Device linking (claimed members)

- `inviteService`: `INVITE_EXPIRY_MS` gains a per-call override;
  `LINK_EXPIRY_MS = 15 min`. `buildInviteLink`/`parseInviteLink` gain a
  `mode: 'link'` marker param (`lk=1`). Wrap storage: same `inviteKeys` dict
  (merge-safe, additive).
- Mint UI: "Link a Device" card in Settings → Security & Recovery (QR + copy link,
  reuse the invite link/QR machinery + `useInviteFlow`'s error pattern; no Drive
  share step — the link is shown/scanned directly).
- Redeem: `/join?...&lk=1` → same cloud/file fetch → FK via `redeemInviteToken` →
  instead of the unclaimed-only picker, land in the standard person-select → the
  member proves with their PIN → device wraps enrolled. No change to the classic
  claim path.
- Telemetry: `device_link_minted` / `device_link_redeemed` (facade functions exist
  in the plan's observability contract; add to `loginFlowEvents.ts`).

### WP3 — Web PRF retirement (the one-release window closed at 0.13)

- Stop CREATING: App.vue passkey prompt branch retired on web (see WP5 — slot
  reused); `PasskeySettings.vue` enrol path native-only; `healCrossDevicePasskey`
  and `pendingCrossDeviceHeal` deleted from `useLoginFlow` (its trigger,
  `crossDevice`, is web-only).
- Stop ASSERTING: delete the web branch of `authenticateWithPasskey`
  (`authenticateWithPasskeyWeb`, `tryUnwrapFamilyKeyFromPRF`,
  `establishPasskeyWrap`, `evaluatePRFForCredential`, `registerSyncedCredential`,
  retry/fallback helpers); `registerPasskeyForMember` becomes native-only (refuses
  on web). `device-biometric` probe drops its web branch (`isNative()` required;
  `isPlatformAuthenticatorAvailable` gate deleted with it).
- Delete PRF crypto: `getPRFOutput`, `buildPRFEvalExtension`, `prfSaltBytes`,
  `normalizePRFOutput` from `passkeyCrypto.ts`; remaining thin pass-throughs
  collapse into direct `keyWrap.ts` imports and `passkeyCrypto.ts` is deleted.
- KEEP: `nativeBiometric.ts` + `biometricKeystorePlugin` + `passkeyRepository`
  (native records live there) + `biometricShared.ts`; `passkeyWrappedKeys` envelope
  field + its merge handling (existing entries inert, documented — same policy as
  legacy password wraps); Settings list/rename/remove for existing registrations.
- `ReauthChallenge` step-up: PIN verify (`verifyMemberPin`) becomes the primary
  fallback; password verify remains only for members with `passwordHash` and no
  `pinHash`; web-passkey branch deleted, native branch kept.
- `ResetMemberPasswordModal` → `ResetMemberPinModal` (admin/owner resets a member's
  PIN — parents for kids). NO third copy of gate or mutation: extract the existing
  authz gate from `resetMemberPassword` (its closed `ResetError` union) into a
  shared `assertCanResetMember(targetId)` consumed by both reset functions (point
  `BeanAccountPanel.vue`'s mirrored-gate comment at the shared helper), and
  `adminResetMemberPin(memberId, newPin)` delegates its mutation to the same
  internal body `resetMemberPinViaRecovery` uses (validate PIN → pinHash →
  pinVersion bump → `enrollPinUnlock` → bounded sync → `reportError` on failure).
  `ChangePasswordSettings` stays but only for legacy members with a passwordHash
  (change-only; no set-password path — its header already flags the gap; it renders
  nothing for PIN-only members). `PasswordEntryFields.vue` survives only for those
  two legacy surfaces; deleted when they go (#117 follow-up).
- Grep gates: `getPRFOutput|buildPRFEvalExtension|prf` gone from `src/services/`
  (except historical ADR/docs); `authenticateWithPasskeyWeb` zero hits.

### WP4 — `cachedFamilyKeys` retirement (#77 route 2 closed)

- Replacement: `trustedAutoOpen` registry store — FK wrapped via
  `AES-KW(HKDF(deviceSecret, salt, info='beanies.family-trusted-auto-open-v1'), FK)`
  per family, reusing `keyWrap.ts` + the existing per-device `deviceSecrets`
  non-extractable HKDF base key (registry bump v5→v6, additive; same blocked-upgrade
  handling as v5 — the 0.13R1 bounded-wait machinery is already generic). No user
  secret in the derivation — this is deliberately a TRUST wrap (silent open), the
  win over plaintext is purely at-rest: a registry-DB dump no longer yields the FK
  without also executing code in the origin (non-extractable key material).
- Same write moments as today's cache — ALL FOUR write sites: `decryptPendingFile`
  (force), post-`createNewFile` (force), `decryptPendingFileWithKey` (conditional
  force, join/kit/passphrase redeem), and App.vue `handleTrustDevice` (non-force);
  and the five surviving read sites: App.vue boot x2, `tryCachedKeyDecrypt` +
  `tryTrustedAutoOpen` (useLoginFlow), `tryDecryptWithCachedKey` (syncStore),
  LoadPodView fast path — the passkeyService fallback read dies with WP3. The
  grep gate is the backstop, not the inventory.
- Migration: lazy — on first successful open where a legacy plaintext entry exists,
  write the wrapped form and delete the plaintext entry; sign-out tiers clear both
  forms during the window. `models.ts` `cachedFamilyKeys` field + settingsStore
  API deleted once all readers are converted (grep gate:
  `cachedFamilyKeys|cacheFamilyKey|getCachedFamilyKey` zero hits outside the
  migration shim and tests of it).
- Tap-through kids + trusted auto-open behavior is UNCHANGED (same trust wrap,
  different at-rest form).
- E2E `trusted-device.spec.ts` rewritten to assert the wrapped store (data-level,
  Three-Gate compliant).

### WP5 — Post-open enrolment nag + prompt-stack rework

- The App.vue one-slot sequencer (`claimInterruption('auth-prompt')`) gets a new
  priority order: **1) member has no PIN → "Set up your PIN" modal** (the unused
  `pin.promptTitle/Body` strings finally get their component; PinInput new+confirm;
  writes via `setMemberPin`) → **2) family lacks the kit confirmed-signal (see WP1) → "Create your
  recovery kit"** (opens the shared `RecoveryKitDisplay` flow) → **3) native
  biometric enrol prompt** (native only — the web passkey prompt is retired in WP3)
  → **4) trust prompt** (unchanged). The sequencer is EXTRACTED from App.vue's
  inline watcher chain into `src/services/auth/authPrompts.ts`: an ordered array
  of descriptors `{ id, eligible(ctx): Promise<boolean>, shownFlag }` with one
  loop that claims the interruption slot for the first eligible entry (the same
  shape as `PROBES` and the WP6 step lists); App.vue reduces to "winning id →
  modal component". Flags: the KIT and TRUST prompts keep device-level flags
  (pattern: `trustedDevicePromptShown`), but the PIN nag's dismiss flag is keyed
  per `(familyId, memberId)` — on a shared family device, member A dismissing must
  not suppress it for B/C/D. Eligibility: members with a credential history only
  (`hasCredential`) — deliberately PIN-less tap-through kids are excluded (their
  PIN setup stays a parent-initiated action via the reset-PIN modal). Re-arm rules
  mirror the trust prompt on untrusted sign-out where applicable; priority order
  and re-arm rules become unit-testable as data. This is the existing-family
  migration engine: every legacy member gets the PIN nag exactly once per
  dismissal cycle.
- Members phase / join already-set members skip the PIN nag (they have pinHash).

### WP6 — Sign-out step lists (`signOutSteps.ts`)

- The deferred Pass-3 design, now justified by the measured duplication (~7
  byte-identical blocks + a 5-line tail ×3): named idempotent steps
  (`quietTeardownAndForceSave`, `cancelReminders`, `captureDepartingAccount`,
  `clearGoogleSession(tier)`, `resetSyncState`, `resetDocClient`,
  `clearDepartedArtifacts`, `resolveFamilyId`, `deleteFamilyDb`, `clearKeyCache`,
  `removePinWraps`, `removeRoster`, `reclaimKeystores`, `clearAllRefreshTokens`,
  `reArmTrustPrompt`, `finalizeSession`), each individually caught, tiers as ordered
  lists. The store keeps the three public functions; their bodies become "run this
  list". The tier-N+1-superset property asserted by a unit test over the lists AS
  DATA — with the two deliberate asymmetries (docClient.reset tier-2-only; trust
  re-arm tier-2-untrusted-only) encoded as documented exceptions, not violations.
  `dataClearingSecurity.test.ts` contracts unchanged (F14 etc.).

### WP7 — Docs, help, ADRs, strings

- **New ADR-034 “PIN-first identity, recovery-kit root of trust, password
  retirement”** — the credential model table, the no-revoke logout decisions, the
  merge/no-deletion constraint that re-homed wrap removal to #117.
- Amendment notes (Status header lines, not rewrites): ADR-014, 015 (PRF retired),
  019 (recoveryKeys/recoveryPassphrase fields + kit root of trust), 028 (revoke
  relocation note landed in Phase 5), 031 (trusted-device sign-out grant semantics
  superseded by the three tiers).
- Help center (`src/content/help/security.ts`): rewrite `biometric-login` (native
  keystore + PIN, no WebAuthn/password-master-key claims); replace
  `password-recovery` with a recovery-kit/passphrase article (“Your Recovery Kit”)
  — kit, passphrase, PIN reset via recovery, device linking; targeted edits to
  `the-beanpod-file-explained` (recoveryKeys/recoveryPassphrase, wrappedKeys now
  historical for new families), light edits to `how-your-data-is-encrypted` +
  `zero-knowledge-architecture`.
- uiStrings: all new copy en+beanie (wizard PIN step, kit step, link-a-device,
  PIN nag, kit nag, join set-pin, reset-PIN modal, reauth PIN). `npm run translate`.
- STATUS.md + CHANGELOG on ship.

## Observability coverage (Phase 4 delta)

Surface `login-flow` via the existing typed facade (`loginFlowEvents.ts`) — new
events: `create_flow_pin_set`, `create_flow_kit_confirmed` (+ `skipped` variant if
abandoned — fired from the nag instead), `join_claim_pin`, `device_link_minted`,
`device_link_redeemed` {ok, error_code}, a `prf_withheld: boolean` field added to the existing `prove_methods_resolved`
payload, computed by the resolver loop (NOT inside a probe — probes stay free of
telemetry per the module contract) when `!isNative()` and a web registration
record exists — the retired method being withheld is the only observable
straggler signal once the assertion path is gone,
`auto_open_wrap_migrated` (plaintext→wrapped migration), `nag_shown`/`nag_outcome`
{kind: pin|kit|biometric|trust, action}. Sign-out tier events unchanged. All context
keys already allowlisted (`action`/`kind`/`detail`/`error_code`/`stage`) — no new
allowlist keys, no store-declaration delta. Failure paths classify + `reportError`;
FK-loss-class only remains `critical`.

## Verification

- Unit: sentinel-invariant trio under PIN (create refuses pin-less owner; rehydrate
  both branches; requiresPassword derivation matrix); empty-wrappedKeys typed
  outcome + caller routing; link mint/expiry/redeem round-trip; adminResetMemberPin
  role gate; step-list superset-with-exceptions assertion; auto-open wrap
  round-trip + migration + sign-out clearing (extend `dataClearingSecurity`).
- E2E: auth helper PIN path; trusted-device spec rewrite; invite-join spec still
  green (classic claim now sets PIN).
- On-device walkthrough (greg, all three platforms): fresh create end-to-end;
  legacy family gets PIN nag → sets PIN → password no longer offered on a warm
  prove (it remains the cold-bootstrap fallback for legacy members until #117);
  device link phone→laptop; web sign-in after PRF removal (legacy passkey user
  falls back to password → nag).
- Mixed-version — THREE documented caveats (STATUS), same acceptance rationale
  (native update ships in the same window): (a) a <=0.13 client opening a kit-born
  (empty wrappedKeys) file hits 0.13's "No wrapped keys" throw unless a passphrase
  is set; (b) a PIN-only member (kit-born family, or WP1 set-pin join into a
  LEGACY family) reads as unclaimed on <=0.13 clients (`requiresPassword:
!passwordHash`) — re-invitable, excluded from ownership transfer, un-provable on
  pre-0.13 native builds; (c) an old client scanning a WP2 `lk=1` device-link QR
  ignores the marker and dead-ends in the unclaimed-only join. Mitigation copy:
  one line on the WP2 mint card and the join set-pin step: "the other device
  needs beanies 0.14 or later".

## Rollback

Wizard + join changes are forward-only for NEW families (a kit-born family needs a
0.14+ client — see caveat above); existing families are untouched at rest (no wrap
deletion anywhere). PRF removal is reversible by revert (envelope entries were
honored, not deleted). `cachedFamilyKeys` migration is lazy and reversible until the
field is deleted (final commit of WP4, separable). Step-list refactor is pure
restructuring under existing tests.

## Review Passes (Phase 4 spec)

- **Pass 1 (Initial draft)**: drafted from three very-thorough code maps; revised decisions — no `wrappedKeys` emptying (merge can't delete; re-homed to #117), passphrase out of the wizard (greg: kit-only creation), conditional password probe, link=FK-transport+PIN-identity.
- **Pass 2 (DRY + error handling)**: 8 revisions — kit-confirmation nag predicate (FK-loss hole), cold-path `hasPassword` data, resume-path recovery routing, reset-PIN reuse of existing gate/mutation, straggler-telemetry emission site, kit-gen failure taxonomy, API-name fix, dead `requiresPassword` writes deleted.
- **Pass 3 (Sustainability)**: 7 revisions — roster-carried wrap flags (prove stays pure), password-as-probe + `recovery` terminal, `createNewFile` generates kit internally (signature contradiction fixed), legacy families never re-nagged, `prf_withheld` into resolver payload, pure `envelopeNeedsRecovery` predicate, App.vue prompt sequencer extracted as data (`authPrompts.ts`).
- **Pass 4 (Fresh-eyes sweep)**: 8 revisions — warm-only password suppression (reconciled with walkthrough), owner-credential-keyed confirmation backfill (old-client spoof closed), three mixed-version caveats + version copy, full cache write/read inventory, demoSeed + useJoinFlow wrap-site coverage, per-member PIN-nag flags + kid exclusion, start-over escape for the abandoned-kit edge.
