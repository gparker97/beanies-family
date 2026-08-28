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
