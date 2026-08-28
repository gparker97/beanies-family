# Login/auth first-principles rethink — PIN-first identity, recovery kit, no passwords

> date: 2026-08-28
> category: architecture / auth
> issue: tracker #76 (failed on-device), leads to a new redesign track
> plan: docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md
> tags: auth, login, biometric, pin, recovery-kit, crypto, google-oauth, redesign

## Prompts

**2026-08-28 (morning, after /good-morning)** — paraphrase:

> Going back to testing for #76 — a lot of work and code review max was done yesterday, with
> the goal to unify biometric login across BOTH login surfaces. After 5 rounds of planning,
> implementation, and review, I've tested now on all surfaces (web, ios, android) and it
> still doesn't work. Flow: logout → re-auth via Google → member list → select member →
> password prompt (not biometric) on both iOS and Android. Web gave a biometric prompt but it
> failed. Side question: why does a simple logout invalidate all tokens and revoke grants?
> Since we've started, I've never seen biometric work successfully for a family member on the
> first try — we may be pursuing the wrong path. I want to go back to a blank slate and think
> about the simplest, most efficient way for users to select their identity and login. Most
> important: absolutely dead simple. Ideas: a PIN per user (possession of the file already
> proves a lot); keeping member names outside the encrypted envelope (scrambled) so identity
> can be selected before entering a secret, unifying the flows. Do full comprehensive
> research of the codebase and think deeply about options — simple as possible while
> adequately secure, with a feasible migration path for existing users.

**Mid-research addition:**

> You can also review the existing login flow completely to see how it works and where it is
> breaking.

**On the draft plan (rejecting password-as-fallback):**

> Concerned about a PIN on top of a password — two things to remember. Original thought was
> PIN-only per family; I understand the security limitation; 5-10 retries then lockout sounds
> right. The password fallback can be simplified further: we've always had the "forgot
> password = locked out forever" problem. Time to build the emergency backup mechanism — a
> generated backup file with a key, stored somewhere safe, as the final fallback when all
> other methods fail. Generated at setup with a clear "store this in a safe place" message.
> Also confirming: switch-user within the family requires only that member's PIN; local
> sign-out doesn't revoke Google tokens; sign out & clear data does.

## Outcome

Plan approved 2026-08-28 (docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md).

- Research: 3 Explore agents (flow map, crypto map, Google token lifecycle) + 2 Plan agents
  (unified-flow design; adversarial security/migration review).
- Root causes of the #76 failure found: LoadPodView's biometric gate uses a WebAuthn probe
  that is always false in the Capacitor WebView (only ungated call site); #76's own
  cached-key hardening broke the web passkey fallback; untrusted sign-out whole-grant revoke
  - one-shot trust prompt + ADR-028 prompt=consent explains forced re-auth and cross-device
    token churn.
- Decisions: retire web WebAuthn+PRF; device-local roster (names-in-envelope rejected —
  GDPR/revision-history); three-tier logout with no revoke on plain sign-out; **eliminate
  passwords** — 6-digit member PIN (hash inside the encrypted doc) + device-wrap unlock +
  native biometric + recovery kit (full-entropy key file, new additive `recoveryKeys`
  envelope field) + device-linking bootstrap.
- Implementation: 5 phases, starting with the unified-flow LoginPage rewrite.

## Round 2-3 amendments (2026-08-28, later)

Greg's follow-up decisions after reviewing the draft plan:

- **No token deletion on regular sign-out, even locally** — sign-out never touches Google
  tokens; sign back in with no Google screen.
- **No revoke anywhere as a side effect** — "sign out & clear data" deletes LOCAL tokens
  only (whole-grant revoke punishes every device on the account). Revoke relocated to one
  explicit Settings action ("Disconnect Google from beanies everywhere").
- **Optional family recovery passphrase** added (strength-enforced envelope wrap) so a
  family can recover on a bare device via Google sign-in + passphrase. PIN-as-envelope-wrap
  explained as unsafe (offline brute-force of 10^6).
- **Server-assisted "PIN unlocks anywhere" considered and DROPPED** (needs a server-held
  pepper + attempt-counting protocol; infra/protocol cost not justified).
- **Process:** greg chose to run the /beanies-plan 4-pass gauntlet on the final amended
  plan before implementation. An earlier premature implementation start (roster cache,
  registry v4) was fully reverted.

## Gauntlet round (2026-08-28, after plan approval)

- 4-pass gauntlet ran (Pass 2: 11 revisions incl. an impossible-crypto fix; Pass 3: 7
  structural revisions incl. pure `loginFlow.ts` state machine + sign-out step lists;
  Pass 4: 8 revisions incl. the phantom-member `wrappedKeys` hazard and the unimplementable
  silent PIN re-wrap). All folded into the plan.
- greg accepted the Pass-4 amendment: tier-2 sign-out on UNTRUSTED devices clears local
  Google tokens (never revokes); trusted devices keep tokens untouched.
- Plan status: APPROVED. Implementation begins with Phase 1.

## Implementation round (2026-08-28, afternoon)

> greg (mid-implementation): "once implementation is complete, directly run a /code-review
> max on the entire welcome gate and login and authentication and logout process including
> all new code just implemented ... fix any issues found."

Phase 1 implemented in 6 commits + 1 fix commit (`32f74465..840d0332`, local, unpushed):
roster cache → prove engine + telemetry facade → pure state machine → integration
(PersonSelectView/ProveView/OpenRecoveryPanel, LoginPage thin renderer, LoadPodView
demoted, PickBeanView + BiometricLoginView deleted) → /code-review max (15 verified
findings, all fixed). Full unit suite green (5097). On-device walkthrough on all three
platforms is the outstanding acceptance gate before push/deploy.
