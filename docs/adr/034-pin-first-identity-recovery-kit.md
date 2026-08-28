# ADR-034: PIN-first identity, recovery-kit root of trust, password retirement

> Status: Accepted
> Date: 2026-08-28
> Supersedes the credential model of ADR-014/ADR-019 (their file-based/encryption
> architecture stands); retires the web half of ADR-015; amends the sign-out grant
> semantics of ADR-028/ADR-031.
> Plan + full 4-pass review record: `docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md`

## Context

The password-centric login (one password doing double duty as member identity AND
envelope decryption secret, plus a fragile web WebAuthn+PRF biometric layer) failed
its on-device acceptance test repeatedly (#76): three independent "biometric or
password?" decision engines disagreed, identity was entangled with decryption, and
untrusted sign-out revoked the whole Google grant — killing every device on the
account. A first-principles redesign shipped across 2026-08-28 in five phases
(unified flow → member PIN → recovery kit/passphrase → PRF+password retirement →
logout tiers).

## Decision — the credential model

| Purpose                                            | Mechanism                                                                                                                                                                            | Lives where                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Day-to-day unlock on a known device                | Native OS-keystore biometric, or member PIN unwrapping a `deviceUnlock` wrap (PIN + device secret → HKDF → AES-KW over the family key)                                               | Device registry DB / OS keystore   |
| Member identity (switch user, step-up, join claim) | **Per-member 6-digit PIN** — PBKDF2 hash INSIDE the encrypted doc (`FamilyMember.pinHash`), CRDT-synced family-wide                                                                  | Encrypted doc                      |
| Envelope root of trust (new families)              | **Recovery kit**: 160-bit Crockford-base32 code, PBKDF2→AES-KW wrap in the envelope's `recoveryKeys`; printable PDF + deep-link QR; MANDATORY confirm-stored step at family creation | Envelope + the family's safe place |
| Memorable no-device recovery (opt-in)              | **Recovery passphrase** — strength-checked phrase, its own additive envelope field (`recoveryPassphrase`), never inside `wrappedKeys`                                                | Envelope                           |
| New-device bootstrap                               | **Device link** (15-minute invite-style wrap, `lk=1` marker; identity = the member's PIN on arrival), or kit, or passphrase                                                          | Envelope `inviteKeys`              |
| Legacy (pre-Phase-4 families)                      | Existing password wraps keep working; password entry is offered ONLY to members holding a `passwordHash` (suppressed warm once a PIN exists; suppressed cold for kit-born envelopes) | Envelope (unchanged)               |

Key invariants:

- **A PIN is never an envelope wrap** (10⁶ offline guesses against an exfiltrated
  file). The PIN hash lives inside the ciphertext; only the full-entropy kit (and
  the optional strength-checked passphrase) wrap the envelope.
- **New families are born password-free**: `createNewFile` writes `wrappedKeys: {}`
  plus the kit wrap, and refuses to write a pod whose owner has no `pinHash` (the
  deferred-credential sentinel machinery, re-pointed from password to PIN).
- **`requiresPassword` (member "unclaimed" flag) derives from "no passwordHash AND
  no pinHash"** on every read — a PIN-only member reads as claimed.
- **Existing families migrate via nags, not migrations**: a data-driven post-sign-in
  prompt chain (`authPrompts.ts`: PIN → kit → native biometric → trust) converts
  legacy members one dismissable prompt at a time.
- **Web WebAuthn+PRF is retired**: no new web passkeys are created and the web
  assertion path is deleted (one release honoured existing enrolments, 0.13).
  Native keystore biometric is unchanged. Leftover web registrations surface only
  as a `prf_withheld` telemetry signal and in Settings management.
- **Envelope wrap deletion is NOT attempted**: `envelopeMerge` is union/local-wins
  and cannot propagate deletions (a stale device would resurrect an emptied dict),
  and no fleet-version floor exists. Legacy password wraps and inert
  `passkeyWrappedKeys` remain until #117 key rotation rebuilds the envelope under a
  new keyId — the one mechanically safe deletion point. The file-side
  "weakest password wrap" exposure for legacy families persists until then
  (documented residual).
- **No sign-out tier ever revokes the Google grant** (revoke is whole-grant per
  (user, client)); the sole revoke site is the explicit Settings "Disconnect Google
  Everywhere" action. Tiers are ordered idempotent step lists
  (`signOutSteps.ts`), tier differences expressed as list membership.
- The plaintext `cachedFamilyKeys` store is retired: the trusted-device auto-open
  key is AES-KW-wrapped under the device secret (`trustedAutoOpen` registry store,
  lazy migration) — an at-rest DB dump alone no longer yields the family key.

## Accepted trade-off

Lose all devices AND the recovery kit AND have no passphrase set ⇒ the data is
permanently unrecoverable. Mitigations: the kit step is mandatory at creation
(confirm-stored gated), regenerable anytime, nagged when unconfirmed
(doc-side `recoveryKitConfirmedAt` signal), and the passphrase exists for the
memorable path. A just-created family that abandons the kit step AND loses its
trusted cache before the nag re-offers is stranded — accepted (minutes-old family,
near-zero stakes) with a "start over" escape on the recovery surface.

## Consequences

- One prove engine (`proveMethods.ts` probe array), one prompt sequencer
  (`authPrompts.ts`), one reset gate (`assertCanResetMember`), one kit surface
  (`RecoveryKitDisplay`), sign-out as data — the tri-engine drift class that caused
  #76 is structurally closed.
- Mixed-version caveats (documented in STATUS, acceptable because native updates
  ship in the same window): ≤0.13 clients cannot open kit-born envelopes, misread
  PIN-only members as unclaimed, and dead-end on `lk=1` device links.
- Observability: the `login-flow` surface carries the full decision trail
  (`prove_methods_resolved`+`prf_withheld`, `prove_outcome` first-try rate,
  `device_link_minted/redeemed`, `auto_open_wrap_migrated`, `signout_tier`).
