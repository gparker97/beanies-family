# Plan: Require an invite to claim an unclaimed adult bean

> Date: 2026-09-01
> Related issues: Notion tracker #79 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-01-unclaimed-adult-requires-invite.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent, I want my own bean on the shared family tablet to be un-enterable by whoever picks it up, so that my child cannot land in my session and reach the family finances.

## Context

The #76 security review recorded four pre-existing auth gaps. Tracker #79 was the first. Its original description named `authStore.setPassword` as the hole; **code research at pre-plan contradicted that**, and #79 has been rewritten. Corrections that drive this plan:

1. **`authStore.setPassword` is dead code.** Re-verified in pass 4: the only references anywhere in `src/` or `e2e/` are its definition (`authStore.ts:1105`), its export (`authStore.ts:2231`), and a past-tense comment at `authStore.ts:1672`. (The other `setPassword`/`resetPassword` grep hits are unrelated translation keys and `join.setPasswordTitle`.) It still mints a session with no authorization check, so it is live attack surface for any future caller, but it is not today's vulnerability.

2. **The live mechanism is `tap-through`**, and it is a _deliberate feature_. The probe in `proveMethods.ts:134-138` offers it when `podOpen && hasCredential === false`; `authStore.signInPasswordless` (`authStore.ts:664`) executes it. Its docstring says "today's passwordless kids" — a young child should not need a PIN on the family device. It already fails closed for credentialed members: it refuses if `member.passwordHash || member.pinHash`.

3. **It requires the pod to be already open, and the pod opens more often than pass 1 assumed.** Two reachable states, both verified:
   - **Switch Member** (`AppHeader.confirmSwitchMember` — "Tier 1: member-only — the pod stays open").
   - **Trusted-device auto-open.** `useLoginFlow.startForFamily` calls `tryTrustedAutoOpen(familyId)` at `useLoginFlow.ts:262`, _before_ `buildPeople`, and its own comment states the intent: "open silently with the cached key so passwordless members get tap-through". So after a plain sign-out on a trusted device, the picker is presented over an **already-open pod** and tap-through is offered immediately.

**The actual defect**: tap-through does not distinguish a child from an adult. `src/components/login/CreateMembersStep.vue:72` adds a second parent as `ageGroup: 'adult'` with **no credential**, so that parent is tap-through-able. And `usePermissions.ts` gates whole routes on `canViewFinances`, read from the **session**. So:

> On the family tablet, a child taps the other parent's face on the picker, after a Switch Member or simply after a sign-out on the trusted device, and is in that parent's session, including the finance corner their own bean cannot reach.

**Severity, stated honestly.** The pod being open means the data is already decrypted in memory, so tap-through does not unlock data; it mints a _session_ (attribution plus that member's route permissions). It still requires physical access to the trusted device, and the device lock screen is the outer defence. What justifies fixing it: the app has already decided the picker is a PIN gate, the hole sits precisely where parents live because the wizard never gives them a credential, and (per finding 3) it is reachable on the ordinary sign-out path, not only an obscure one.

**Approach decided at pre-plan** (greg's proposal, adopted over an adult-on-device PIN step-up): an unclaimed **adult** must be claimed via the **invite**.

**What the invite actually is (pass-4 correction).** Passes 1-3 described the invite as "member-bound". It is not, at the crypto layer. `createInvitePackage` (`inviteService.ts:76-91`) wraps the _family_ key against a random token with a **24h expiry** (`INVITE_EXPIRY_MS`, `isInviteExpired` at `:243`). Member binding happens **at claim time**: `useJoinFlow` presents the _unclaimed-member grid_ (`useJoinFlow.ts:50, 211, 712`) and the joiner picks which bean to claim, then sets a 6-digit PIN (`useJoinFlow.ts:720-732` → `applyPinReset`). The properties that actually justify the decision, all true:

- it is **out-of-band** — the claimant must receive a link, not merely be standing next to an open pod;
- it must be **sent by a signed-in member** who can already manage the pod;
- it **expires in 24h**, so it is not a standing entitlement;
- claiming **always sets a PIN**, so the bean becomes credentialed and can never be tap-through-able again.

Residual, accepted and recorded: while an invite is live, its holder can claim _any_ unclaimed bean in that family, not only the one it was created for. That is pre-existing behaviour, unchanged by this plan, and out of scope.

Rejected alternative: an adult PIN step-up proves only that _a grown-up is nearby_ (any adult could approve anyone into any bean, and it invites "just put your PIN in for me"), never expires, and would add a third authorization concept plus a whole approval flow. Decisive practical point: **a second parent needs an invite for their own device regardless** — it is the only way the pod reaches their phone — so requiring it costs almost nothing.

## Requirements

1. The `tap-through` probe offers one-tap sign-in **only** when the member is a child.
2. An unclaimed **adult** on an open pod is offered an explanatory terminal instead: a family member must send them an invite. No claim, no session, no credential written.
3. `authStore.signInPasswordless` enforces the same rule **at the store level**, defence in depth. The prove engine decides what to _offer_; the store decides what to _allow_. A caller that bypasses the engine must still be refused.
4. The gate **fails closed**: anything other than a definite `'child'` is treated as an adult.
5. The person picker no longer distinguishes credential state (`PersonSelectView.vue:94-105` — green dot vs orange "+").
6. `authStore.setPassword` and its export are deleted.
7. Invite joining (`useJoinFlow` → `authStore.joinFamily`) is **untouched** and gains no friction.
8. **No refusal is silent.** Every refusal path in `signInPasswordless`, including the two that exist today and currently emit nothing, is reported once, through one helper, with translated user copy and a developer-actionable console/firehose record.
9. The `recovery` terminal remains reachable for an unclaimed adult, so nobody is ever stranded.
10. **The "may this member tap through" rule has exactly one definition in the codebase**, shared by the engine and the store, so the two enforcement points cannot drift apart. That definition is an **authorization** predicate and is deliberately _not_ shared with the nine pre-existing `ageGroup === 'child'` sites, which are all display copy (see Caveats).

## Important Notes & Caveats

- **Do not touch `useJoinFlow` / `joinFamily`.** They are entitled by possession of a live invite and already correct. Adding a gate there would create the remote-friction problem this approach exists to avoid.
- **Preserve the existing credentialed-member guard** in `signInPasswordless`. The new age check is _additional_, not a replacement — review F6 recorded a real bug where a PIN-only member could be minted a session via a stale card.
- **The module contract in `proveMethods.ts:9-15` is load-bearing**: probes are pure `(ctx) => method | null` with _no try/catch, no logging, no telemetry_ — the wrapper loop owns all of it. Pass 1's proposed `logEvent` inside the tap-through probe stays removed (see Observability).
- **`ageGroup` is already available** at the `ProveContext` build site: `liveProjectPerson` projects it from the live doc (`useLoginFlow.ts:299-313`). No new plumbing.
- **Children are untouched** — one tap, no ceremony, exactly as today.
- `PersonCard.hasCredential` **stays on the type**. It is the engine's input (`useLoginFlow.ts:146, 343`), is persisted by `rosterCache.ts:31`, and its presence is pinned by `rosterCache.test.ts:76`. Only the _badge_ is removed.
- **`isChildMember` is scoped to authorization only.** Nine `ageGroup === 'child'` comparisons already exist (`PersonSelectView.vue:29`, `BeanCard.vue:203`, `BeanHero.vue:95`, `BeanOverviewTab.vue:140`, `InvitePickerStep.vue:77`, `JoinPodView.vue:149`, `FamilyMemberModal.vue:132`, `CreateMembersStep.vue:171,190`) and every one of them chooses a _label_ ("Little bean" / "Parent bean"). A future tidy-up must **not** sweep them into `isChildMember`: that would couple user-facing copy to a security predicate, so a copy change could move the auth boundary. Say this on the predicate's docstring.
- **A second, authorized claim path exists and is deliberately left open.** A pod manager can set an unclaimed member's PIN directly — `BeanAccountPanel.vue:44-65` explicitly admits "deliberately PIN-less tap-through kids added at setup" and excludes only genuinely-invited pending members with a real email. That path requires `canManagePod` and an authenticated actor, so it is authorization, not a bypass. Recorded here so nobody later "closes" it in the name of this change. It also means the new copy must point at the invite as _a_ route, not claim it is the only one.
- Do not restate baked-in constraints (DRY, i18n, no-silent-failures) — enforced elsewhere.

**Sustainability guardrails — the shapes this change must NOT take:**

- **No shared "terminal" abstraction across `recovery` and `invite-needed`.** They look alike but behave differently: `recovery` is an _escape_ (`switchTo` routes straight out via `emit('use-recovery')` at `ProveView.vue:128-131`, and `firstNonRecovery` deliberately refuses to make it the active pane), whereas `invite-needed` _is_ a pane and must become active. Naming them one concept would invite a future change to treat them uniformly and silently break one of the two. They share exactly one property, "not switchable to", and that is the only thing allowed to be shared, as a flat local constant in `ProveView.vue`.
- **No second probe.** Splitting into a `tap-through` probe and an `invite-needed` probe would duplicate the `podOpen && hasCredential === false` precondition in two places; a future edit to one and not the other could offer both or neither. One probe keeps "exactly one of the two, or nothing" structurally true. The module doc's "one probe = one method" line gets a one-line amendment saying so.
- **The probe keeps `name: 'tap-through'`.** That string is the `context.kind` on the existing `probe_failed` report (`proveMethods.ts` loop); renaming it would silently break continuity of that signal for no functional gain.
- **No nesting, no chained ternaries** in the new view logic: both new pieces are flat lookup constants (see §4).
- **Deliberately out of scope, recorded as follow-ups, not done here** (keeping the security diff small and reviewable):
  - Four near-identical session tails exist (`signIn`, `signInPasswordless`, `joinFamily`'s PIN path, and `setPassword` which this change deletes). `createSessionForVerifiedMember` (`authStore.ts:1799`) is almost the shared helper already but hardcodes `track('login', { method: 'cross_device' })`. Unifying them needs a `method` parameter and touches the password sign-in path, a separate change. This plan removes one of the four duplicates by deleting `setPassword`.
  - `signIn`'s refusals use hardcoded English (`'Member not found'`, `'No password set for this member'`, `authStore.ts:606-617`) and report nothing. Same defect class as requirement 8 but a different function; fixing it here would widen the blast radius past the security fix.

## Assumptions

> Review these before implementation.

1. `ageGroup` is required on `FamilyMember` (verified: `models.ts:306`, `AgeGroup = 'adult' | 'child'` at `:252`) but **optional on `RosterCacheMember`/`PersonCard`** (verified: `models.ts:136`, `loginFlow.ts:37`). Cold cards may lack it — harmless, because tap-through requires `podOpen`, where `liveProjectPerson` supplies the doc value. A missing value is treated as adult.
2. The setup wizard's owner always sets a PIN, so a credential-less _owner_ does not normally exist. The gate does not depend on this; the severity assessment does.
3. `podOpen()` is the only way tap-through is reachable — verified in the probe — and it is reached both by Switch Member and by `tryTrustedAutoOpen`.
4. The first member of a brand-new pod reaches the create flow, not the picker, so setup is unaffected. **VERIFIED**: `CreatePodView` → `ResumePodSetup` → `rehydrateOwnerDoc(ownerName, pin)` sets the owner's PIN, and `enrollDevicePinWrapForMember` enrols the device wrap; the picker is never involved.
5. No production data relies on an adult signing in via tap-through as a routine flow; existing unclaimed adults are redirected to the invite path.
6. **The password pane cannot become a side door for a refused adult** — verified, and now pinned by a test. Warm, the password probe is already suppressed for a credential-less member (`ctx.hasPassword === false` → `null`, `proveMethods.ts:145`), so a warm unclaimed adult resolves to exactly `['invite-needed', 'recovery']`. And even if a `password` pane were ever offered, `signIn` refuses with "No password set for this member" when `!member.passwordHash` (`authStore.ts:610`). Two independent reasons, one asserted in §Testing.
7. **The unclaimed adult is genuinely invitable, verified end to end.** `InvitePickerStep` marks a member unselectable only when `role === 'owner'` or `requiresPassword === false` (`InvitePickerStep.vue:56-58`); an unclaimed adult is neither, so they appear selectable. Their synthetic `@setup.local` email is detected by `isUnshareableEmail` and simply renders blank, and `InviteWizardModal` step 1 lets the sender type the real address (`InviteWizardModal.vue:63, 76-79`). So the copy in §6 describes a route that actually exists.
8. **The `invite-needed` terminal is self-healing.** Claiming via the invite always sets a PIN, so `hasCredential` becomes true, the tap-through probe returns `null`, and the member is offered `pin` on every subsequent login. `invite-needed` is a transitional state, never a permanent dead end.
9. **A stronger method legitimately hides the explanation.** If a credential-less adult happens to be offered `biometric` (a native keystore key exists for them on this device), the resolved list is `['biometric','invite-needed','recovery']`, `biometric` is active, and `invite-needed` is filtered out of the switch links. This is correct — they _have_ a proof, so they do not need an invite — and is stated here so it is not later "fixed" into showing a confusing explanation underneath a working method. A stale PIN device wrap cannot produce the same situation: the pin probe self-heals it (`podOpen && hasPin === false` → `removePinUnlock`, return `null`).

## Approach

### 1. `src/services/auth/proveMethods.ts` — the gate (primary change)

- **Export one predicate, the single definition of the rule:**

  `export function isChildMember(m: { ageGroup?: AgeGroup }): boolean` → `m.ageGroup === 'child'`.

  It lives here because this module is already "the SINGLE decision engine" for who may prove how, and because `authStore` already imports freely from `services/auth` (including `passkeyService`, which `proveMethods` also imports) while `proveMethods.ts` imports no store — verified, so no cycle and no new module-graph weight. Both enforcement points call it, satisfying requirement 10: the _enforcement_ is duplicated on purpose (defence in depth), the _definition_ is not. `AgeGroup` comes from `@/types/models`, which this module already imports from.

  Docstring must state the scope: **"Authorization predicate — who may enter without proving. Not a general age helper: the label sites that compare `ageGroup` are copy, and coupling copy to this would let a wording change move the auth boundary."**

- Add **`isChild: boolean`** to `ProveContext`, deliberately _not_ the `boolean | null` tri-state its siblings use. `hasCredential`/`hasPin`/`hasPassword` need `null` because "unknown" and "false" imply different offers there; here "unknown" and "not a child" are the _same_ outcome (adult → no tap-through), so a tri-state would add a branch with no behaviour behind it. Document exactly that on the field, so the divergence from the sibling style reads as a decision, not an oversight. Being **required** (not optional) makes the compiler point at every call site — verified to be one (`useLoginFlow.ts:339`) plus the test helper.
- Add an `invite-needed` variant to `ProveMethod`, documented as **an explanatory pane, not a prove method and not the `recovery` escape**: _"An unclaimed ADULT on an open pod. Claiming must go out-of-band through a 24h invite sent by a signed-in member. Unlike `recovery`, this is a pane the user lands on, not a route out."_
- Rewrite the single tap-through probe body, per the module contract (no error plumbing, no telemetry):
  - `podOpen && hasCredential === false && isChild` → `{ kind: 'tap-through' }`
  - `podOpen && hasCredential === false` (i.e. adult/unknown) → `{ kind: 'invite-needed' }`
  - otherwise `null`

  The loop's existing try/catch already degrades a throw away and reports it, and the resolved-methods event already names every kind returned.

- Amend the module docstring's probe list in one line: the tap-through probe now returns tap-through _or_ the `invite-needed` explanation, because both answer the same single question ("may this credential-less member enter here?") and must not be able to disagree.

### 2. `src/composables/useLoginFlow.ts` — supply it

One added line in the `resolveProveMethods` call (~line 339): `isChild: isChildMember(livePerson)`. Undefined `ageGroup` yields `false` → adult → fails closed with no extra code, and the store guard uses the identical predicate.

### 3. `src/stores/authStore.ts` — store-level enforcement, no-silent-refusals, dead-code removal

- Introduce a **closed refusal-kind union** next to the function so the telemetry vocabulary cannot sprawl:

  `type PasswordlessRefusal = 'not-found' | 'credentialed' | 'adult';`

- Inside `signInPasswordless`, introduce **one local refusal helper**, used by all three guards:

  `refuse(kind: PasswordlessRefusal, messageKey: string)` → sets `error.value = translationStore.t(messageKey)`, calls `reportError` once (`surface: 'login-flow'`, `severity: 'warning'`, `message: 'passwordless sign-in refused'`, `context: { action: 'passwordless_refused', kind }`), and returns `{ success: false, error: error.value }`. Each guard is one line: `if (…) return refuse('adult', 'auth.memberNeedsInvite');` — no nesting added to the function. It sits inside the existing `try` (so `isLoading` is still cleared by `finally`) and after `translationStore` is resolved.

  This is a net **reduction**: the two existing guards (`memberNotFound`, `memberHasPassword`) today duplicate the same three lines and, the real defect, report **nothing at all**, so a wrongly-refused sign-in is currently invisible in production. The helper closes that hole and adds the new one in the same shape.

- Add the third guard **after** the credentialed check (order is load-bearing: not-found → credentialed → adult): `if (!isChildMember(member)) return refuse('adult', 'auth.memberNeedsInvite');`. `FamilyMember.ageGroup` is required, so this is total. Reaching it means the engine was bypassed or a race occurred; the refusal is correct, so `warning`, not `critical`.
- The refusal message string tells the user what to do and the `reportError` message plus `action` tell a developer where the rule lives; `reportError` already mirrors to console and the firehose, so no bespoke logging is added.
- **Delete `setPassword`** (`authStore.ts:1105-1137`) and its entry in the return object (`:2231`). Update the stale past-tense comment at `:1672` so it no longer names a function that does not exist.

### 4. `src/components/login/ProveView.vue` — the explanation, without a duplicate pane

Three small edits, all DRY-driven:

- **A single `NON_SWITCHABLE` constant drives the switch-target filter.** `switchTargets` (`:146-154`) renders every non-active offered method as a tappable link, and neither terminal may appear there — `recovery` because it routes out (already excluded today), `invite-needed` because it is not something a user chooses. Replace the inline `.filter((k) => k !== 'recovery')` with a filter against `const NON_SWITCHABLE: readonly ActiveKind[] = ['recovery', 'invite-needed']`, carrying a one-line comment for each entry's reason.

  **Why this filter is the real guard:** `switchLabel`'s `default` branch returns `t('passkey.usePassword')` (`:168-169`). A leaked `invite-needed` would therefore render a link reading _"Use password"_ on a member who has no password — a wrong-and-confusing affordance, not a type error. No `switchLabel` case is added (adding one would imply the kind is switchable); the negative assertion in test 3 is what pins it.

- **A single `MESSAGE_ONLY_BODY` map drives the explanation pane.** The `activeMethod === 'recovery'` pane is already just a centred paragraph (`ProveView.vue:310-315`). Replace its condition with a lookup: `const MESSAGE_ONLY_BODY: Partial<Record<ActiveKind, string>> = { recovery: 'loginFlow.recoveryOnlyBody', 'invite-needed': 'loginFlow.inviteNeededBody' }` and `const messageOnlyBody = computed(() => { const k = MESSAGE_ONLY_BODY[activeMethod.value]; return k ? t(k) : null; })`, rendered as `v-else-if="messageOnlyBody"`. One template block, no chained ternaries, and adding a future explanatory pane is one map entry, while the two kinds keep their distinct behaviour everywhere else.

  **Template ordering is load-bearing.** The pane must stay in the `v-if`/`v-else-if` chain **before the final `v-else` password `<form>`** (`:311`), because that `v-else` is the chain's catch-all: an `invite-needed` active method that fell past it would render the password form for a member with no password. Comment it, and assert it in test 3.

- No new emit, no new button: an `invite-needed` screen offers nothing to click except the always-present `RecoveryKitLink` (requirement 9) and "not you?" (`:192-201`). `firstNonRecovery` already selects `invite-needed` as the active pane (verified: `:69` skips only `'recovery'`), so no change to the active-method initialiser.

### 5. `src/components/login/PersonSelectView.vue` — drop the badge

Remove the `v-if="person.hasCredential"` / `v-else` pair (`:94-105`) **and the now-purposeless `<div class="relative">` wrapper** (`:87`) it positioned against — `BeanieAvatar` becomes a direct child of the `w-[88px]` flex column. Verified: those two badges are the only absolutely-positioned children of that wrapper, so removing it changes nothing else. Everyone still sees their name, face and role label, and the role label (`:29`, derived from `ageGroup`) survives, so the picker still distinguishes parents from children. After this change, age is the _only_ distinction the picker draws, which is exactly the intent.

### 6. Strings — `src/services/translation/uiStrings.ts`

Keys, `en` + `beanie`, sited next to `loginFlow.recoveryOnlyBody` (`:4418`) which they parallel:

- `loginFlow.inviteNeededBody` — the prove-screen explanation.
- `auth.memberNeedsInvite` — the store refusal, next to `auth.memberHasPassword` (`:4435`).

**Copy correction: invites are sent from The Pod, not Settings.** Verified: `InviteWizardModal` is mounted from `MeetTheBeansPage.vue:744` (route `/pod`, nav label `nav.pod` — "The Pod") and `BeanDetailPage.vue:159`, plus `OnboardingInvitePanel`. It is **not** in Settings. Copy must name The Pod, and must not claim the invite is the only route (a pod manager can also set the PIN directly — see Caveats). Suggested `en`: _"Ask a grown-up in your family to invite you from The Pod, they'll send you a link that lets you set your own PIN."_

## Files Affected

- `src/services/auth/proveMethods.ts` — modified (probe + union + one context field + `isChildMember` export)
- `src/composables/useLoginFlow.ts` — modified (one context field, via the shared predicate)
- `src/stores/authStore.ts` — modified (refusal helper + refusal-kind union + age guard; delete `setPassword` + export; fix stale comment)
- `src/components/login/ProveView.vue` — modified (`NON_SWITCHABLE` filter + `MESSAGE_ONLY_BODY` pane, placed before the `v-else` password form)
- `src/components/login/PersonSelectView.vue` — modified (remove badge + wrapper)
- `src/services/translation/uiStrings.ts` — modified (new keys)
- `src/services/auth/__tests__/proveMethods.test.ts` — modified (`ctx()` helper gains `isChild: false`; existing tap-through cases opt in; age cases added)
- `src/stores/__tests__/` — new store-guard test alongside the existing `authStore*.test.ts` files

## Observability Coverage

**Events**

- **No new event in the prove engine.** `emitProveMethodsResolved` already ships the ordered kinds comma-joined into `detail` (`loginFlowEvents.ts:26, 39`), so `invite-needed` appearing there _is_ the refusal signal, measurable as a rate against the `prove_outcome` `kind: 'tap-through'` successes that already fire. Verified: `detail` is a free string, so the new kind needs **no** telemetry schema or allowlist change. Adding a bespoke `logEvent` inside the probe would duplicate that signal _and_ break the module's "probes carry no telemetry" contract.
- `reportError` — `surface: 'login-flow'`, `severity: 'warning'`, `message: 'passwordless sign-in refused'`, `context: { action: 'passwordless_refused', kind: PasswordlessRefusal }`, emitted by the store helper. This is **new coverage for the two pre-existing refusals as well**, which report nothing today.

**Failure modes covered**

- Gate too strict (a child wrongly treated as an adult, e.g. corrupt `ageGroup`) → `invite-needed` in `prove_methods_resolved.detail` for a member the family expects to tap through. Volume is the signal.
- Gate bypassed → the store `reportError` fires where no `invite-needed` was resolved; the two counts diverging is the alarm.
- Probe throws → the existing wrapper loop reports `probe_failed` (with `kind: 'tap-through'`, unchanged) and degrades the method away; because `invite-needed` is produced by the _same_ probe, a degraded probe removes the offer entirely and the user lands on the `recovery` terminal — fail-closed, never a session. This is the concrete reliability reason the two kinds share one probe.
- No bare `catch {}` is added anywhere in this change.

**Critical vs telemetry**

Nothing here is `critical`. A refusal is the system working; paging Slack for it would be noise.

**Privacy / store gate**

`action` and `kind` are already in `ALLOWED_CONTEXT_KEYS` (verified: `diagnosticContext.ts:61-78`). **No new context key**, so no `PrivacyInfo.xcprivacy` / store data-safety update is required.

## Acceptance Criteria

- [ ] An unclaimed **adult** on an open pod is not offered tap-through and cannot obtain a session — asserted at the store level, not only the engine
- [ ] An unclaimed **child** on an open pod still signs in with one tap, exactly as today
- [ ] A credentialed member of any age still cannot tap through (existing guard preserved)
- [ ] A member with a missing/unknown `ageGroup` is treated as an adult (fails closed)
- [ ] A warm unclaimed adult resolves to exactly `['invite-needed', 'recovery']` — no `password` pane appears as a side door, and the `invite-needed` pane does **not** fall through to the password form
- [ ] The engine and the store agree on "child" by construction — both call `isChildMember`; **no new** `ageGroup === 'child'` comparison is introduced, and none of the nine existing label sites is rewired to the predicate (review checklist item, not an automated test)
- [ ] Tapping an unclaimed adult shows the invite explanation naming **The Pod** (not Settings), with recovery still reachable, and **no `invite-needed` link appears in the switch-method list** on any other pane
- [ ] All three `signInPasswordless` refusals emit exactly one `reportError` with a distinct `kind` — none is silent
- [ ] Joining via an invite link works unchanged and needs nobody else present; after claiming, the same bean is offered `pin` and never `invite-needed` again
- [ ] The picker no longer distinguishes which members have credentials (the age-derived role label remains)
- [ ] `authStore.setPassword` no longer exists and nothing references it (including comments)
- [ ] The setup wizard still completes for a brand-new pod
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified

## Testing Plan

1. **Unit — `proveMethods`**: the `ctx()` helper defaults to `isChild: false` (fail-closed by default, so any future test that wants tap-through must say so explicitly; the existing tap-through cases are updated to opt in). Cases: child + no credential + open pod → `tap-through`; adult + no credential + open pod → `invite-needed` and no `tap-through`; missing age → `invite-needed`; credentialed member of either age → neither; closed pod → neither; **warm adult with `hasPassword: false` → exactly `['invite-needed', 'recovery']`** (assumption 6). Assert the full ordered `kind` list as the existing tests do, so a stray terminal cannot slip in unnoticed.
2. **Unit — `authStore.signInPasswordless`**: refuses an adult; allows a child; still refuses a credentialed member and a missing member; each refusal produces exactly one `reportError` with the right `kind`.
3. **Unit — `ProveView`**: with `methods: [{kind:'pin'},{kind:'invite-needed'},{kind:'recovery'}]`, no switch link renders for `invite-needed` (assert no button labelled "Use password" appears, which is what a leak would look like); with `methods: [{kind:'invite-needed'},{kind:'recovery'}]`, the explanation pane is the active one, **no password `<form>` / password input is rendered** (the template-ordering guard), and the recovery-kit link is still present.
4. **Unit — dead code**: no reference to `setPassword` remains.
5. **Manual — the corrected repro (both routes)**: (a) sign in → Switch Member → tap an unclaimed adult; (b) on a trusted device, sign out → picker → tap an unclaimed adult. Both show the invite explanation, no session. Tap an unclaimed child → straight in.
6. **Manual — invite unaffected, end to end**: from The Pod, invite the unclaimed adult (confirm they appear selectable in `InvitePickerStep` and the email field accepts a real address over the `@setup.local` placeholder), claim via the link, set a PIN, then re-check the picker — that bean is now offered `pin`, not `invite-needed` (assumption 8).
7. **Manual — setup**: create a brand-new pod end to end.
8. **Regression**: full unit suite + E2E chromium. (No E2E spec exercises tap-through or the picker credential badge, so no E2E updates are expected.)

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the rewritten #79 after code research corrected the mechanism from `setPassword` to `tap-through`; gate scoped to `ageGroup`, invite as the adult path, store-level defence in depth, dead code removed.
- **Pass 2 (DRY / error handling)**: Verified every reuse claim against the code. Corrected the repro (trusted auto-open re-opens the pod before the picker, so the hole is reachable after an ordinary sign-out, not only via Switch Member). Removed the probe-level `logEvent` — it duplicated `prove_methods_resolved.detail` and broke the "probes carry no telemetry" module contract. Replaced the proposed `switchLabel` case with a `switchTargets` filter (a terminal must not render as a switchable method) and folded the new pane into the existing recovery-terminal block instead of duplicating it. Collapsed the three `signInPasswordless` refusals into one `refuse()` helper, closing the pre-existing silent-refusal gap on the other two. Simplified `isChild` from a tri-state to a plain `boolean`. Confirmed `PersonCard.hasCredential` must stay on the type (roster-cache contract).
- **Pass 3 (Sustainability / maintainability / reliability)**: Gave the "is a child" rule one definition — `isChildMember`, exported from `proveMethods.ts` (verified no store→service cycle) and used by both the engine context and the store guard, so the two enforcement points cannot drift (new requirement 10). Rejected a shared `recovery`/`invite-needed` "terminal" abstraction: they behave differently (escape vs pane) and a false shared concept is the real maintenance trap; they share only "not switchable to", now a flat local `NON_SWITCHABLE` constant. Replaced the pass-2 pane condition with a flat `MESSAGE_ONLY_BODY` key map. Recorded why the two kinds stay in ONE probe and why the probe name must not change. Closed the `PasswordlessRefusal` kind vocabulary as a union type. Verified and pinned the password-pane side door (assumption 6). Made the test helper default to `isChild: false`. Listed two out-of-scope refactors as explicit follow-ups.
- **Pass 4 (Fresh-eyes final sweep)**: Corrected two factual errors that would have shipped as wrong user copy and a wrong rationale — the invite is **family-scoped and 24h-expiring, not member-bound** (`inviteService.ts:76-91`; member binding happens at claim time via `useJoinFlow`'s unclaimed grid), and invites are sent from **The Pod**, not Settings (`MeetTheBeansPage.vue:744`, `BeanDetailPage.vue:159`). Restated the decision's justification on properties that are actually true and recorded the residual (a live invite can claim any unclaimed bean). Verified end to end that an unclaimed adult really _is_ invitable, including over the `@setup.local` placeholder email (new assumption 7). Added the self-healing property (assumption 8) and the "a stronger method legitimately hides the explanation" case (assumption 9). Discovered and recorded the second, authorized claim path (pod-manager PIN reset via `BeanAccountPanel`) so it is not mistaken for a bypass and closed later. Scoped `isChildMember` explicitly as an authorization predicate and forbade sweeping the nine existing display-only `ageGroup === 'child'` sites into it. Sharpened two view-level failure modes from "no break" to their concrete symptom: `switchLabel`'s `default` would render a bogus "Use password" link, and the `v-else` password form is the template chain's catch-all — both now have named tests. Confirmed no telemetry/allowlist change is needed for the new kind, no E2E spec touches tap-through or the picker badge, and `setPassword` really has zero live callers.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

`/beanies-pre-plan let's implement #79, once pre-plan is done move to /beanies-plan`

### Follow-up 1 (pre-plan clarification, on the proposed adult step-up)

"when you say a credential less adult must have a grown up step up or set a PIN, what does that mean exactly?"

Answer selected: "Rewrite #79 to match the findings (Recommended)".

### Follow-up 2 (challenging the threat model)

"but for a grown up (or child) to join the pod, they must have the invite link sent to them from a pod member to decrypt the pod, so just to be clear, what scenario are we actually trying to prevent here? for example, in case somebody steals the invite link (which i believe it only good for 24 hrs)?"

### Follow-up 3 (the adopted approach)

"Ok understand and this makes sense. i'm fine to implement as recommended, but one question - in the case somebody joins the pod via an invite link, do they still need another adult to enter their PIN? This could cause friction if they aren't in the same room. Another thought- what if any unclaimed family members (those with no credentials) can only be claimed when the pod is opened via the invite link? ... Which approach do you think makes more sense?"

### Follow-up 4 (approval to plan)

"yes please update the tracker as needed and run this approach through the plan"

### Follow-up 5 (approval to implement)

"once the plan is done go ahead to implement. once implementation is done run a /code-review high to ensure the implementation works are expected and designed as per the plan and does not introduce any new bugs, side effects, or security issues"

</details>
