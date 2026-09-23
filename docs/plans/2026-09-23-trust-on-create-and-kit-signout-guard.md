# Plan: Trust the creating device, and guard sign-out when the recovery kit was never saved

> Date: 2026-09-23
> Related issues: None (direct implementation)
> Plan file: `docs/plans/2026-09-23-trust-on-create-and-kit-signout-guard.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As the person who just created a family on my own phone or computer, I want signing out
and back in on that same device to "just work" with my PIN, and I want to be stopped
before I sign out in a way that would lock me out of my family forever because I never
saved my recovery kit.

## Context

greg reproduced a lockout on prod (2026-09-23, iOS, family "Test new flow 4"): he created a
family, ticked past the recovery kit without saving it, signed out choosing to keep data,
and on return was sent to the "decrypt" (recovery kit entry) screen with no way in.

Root cause, verified in code:

- `authStore.signOut()` (`src/stores/authStore.ts:3025`) picks `SIGN_OUT_TRUSTED_STEPS` or
  `SIGN_OUT_UNTRUSTED_STEPS` (`src/services/auth/signOutSteps.ts:73-98`) from
  `settingsStore.isTrustedDevice` (device-global, default `false`, `settingsStore.ts:179`).
  The untrusted tier runs `deleteFamilyDb`, `clearKeyCacheFamily` and
  `removePinWrapsFamily`. For a kit-born family (no password wrap in the envelope) the
  recovery kit is then the only way back in on that device.
- A new owner's device is effectively never trusted. Trust is only set by the trust prompt
  (`App.vue:356 handleTrustDevice`) or the Settings toggle (`SettingsPage.vue:2348`). The
  prompt is last in the `pin -> kit -> native-biometric -> trust` chain
  (`authPrompts.ts:73-106`), one prompt shows per sign-in, and in the creating session the
  OnboardingWizard owns the single interruption slot (`useSessionInterruption.ts:31`,
  `OnboardingWizard.vue:94`).
- The create path hides this: `syncStore.createNewFile` force-caches the family key
  regardless of trust (`syncStore.ts:3218-3226`, `{ force: true }`) and
  `ResumePodSetup.vue:875` enrols the owner's PIN device wrap. The session behaves as
  trusted until sign-out deletes both.
- The kit step (`ResumePodSetup.vue:850-908`, `RecoveryKitDisplay.vue:84-95`) can be passed
  with an unconditional "I've stored it" tick (deliberately unconditional, pinned by a
  test, must stay that way). Confirming stamps `settings.recoveryKitConfirmedAt`
  (`settingsStore.markRecoveryKitConfirmed`, `settingsStore.ts:703`). There is no record of
  whether the kit was actually saved (download/share/copy) or only ticked.
- The sign-out confirm (`AppHeader.vue` modal) always says `auth.signOutConfirmHint`:
  "Your data is saved and will be here when you come back." (`uiStrings.ts:3735`), which
  is false on an untrusted device. The mobile menu (`MobileHamburgerMenu.vue:153-181`)
  signs out immediately with no confirm at all. `ProfileMenu.vue:293` emits `sign-out` to
  AppHeader's modal.
- `docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md:200-205` promised a sign-out
  warning ("reopening will need another family member or a recovery path"). It was never
  built. ADR-034 (`docs/adr/034-pin-first-identity-recovery-kit.md:56-72`) accepted "a
  just-created family that skips the kit and loses its trusted cache is stranded" as
  near-zero stakes. greg's repro shows it is the default outcome, not an edge case.

This is a long-standing design gap (unchanged since 2026-08-28), not a 0.22.0 regression.

## Requirements

1. **Trust on create, without fail.** Whenever a family is created on a device, that
   device becomes trusted (`isTrustedDevice = true`) inside the create orchestration,
   before the kit step. The owner's key cache and PIN wrap then survive a keep-data
   sign-out, and on return the owner opens the pod with trusted auto-open or their PIN.
   - Applies on web, PWA, iOS and Android, and to both storage providers.
   - Does NOT apply to the App Review demo seed. A reviewer's device must not be left
     trusted.
   - The user can turn trust off afterwards (Settings, or the sign-out tick); nothing
     forces it back on.
   - Pinned by unit tests so it cannot silently regress.
2. **Trust on join.** A member who claims their place through the joining flow
   (`authStore.joinFamily`) also makes that device trusted. Pinned by tests like
   requirement 1. A device-link or magic-link sign-in of an existing member is not a join;
   requirement 4 covers it.
3. **One shared trust action.** `authStore.setDeviceTrust(trusted, source)` is the only way
   any user-facing surface changes device trust.
   - It writes the flag and never throws. Success means the flag was written.
   - When trusting, it then caches the open family's key as a best-effort step (a cache
     failure is reported as a warning, with no toast; the next open caches it).
   - If the flag write fails it shows one error toast, which also reports, and returns
     false.
   - It is used by create, join, the new-device trust prompt (both answers), the Settings
     toggle, and the sign-out tick.
   - The sign-out step implementations and the Settings clear-data escape hatch keep the
     raw settingsStore setters: their runner or handler already reports, and they must not
     toast mid-teardown.
4. **Always ask on every other new device.** On the first sign-in on a device that is not
   trusted and has not answered (`!isTrustedDevice && !trustedDevicePromptShown`), the
   trust question is always shown, on every sign-in path.
   - Nothing pre-empts it: not the other auth nags, and not the one-interruption-per-load
     slot.
   - Created and joined devices are already trusted, so they are never asked.
   - An untrusted sign-out and a clear-data sign-out both re-arm the question, so the next
     sign-in on that device asks again.
   - The demo seed marks it answered, so a reviewer is never asked.
5. **Record how the kit was confirmed.** Alongside `recoveryKitConfirmedAt`, store
   `recoveryKitConfirmedVia: 'saved' | 'acknowledged'` on the family's doc-side settings
   (synced, so every manager's devices agree).
   - `saved`: the kit was downloaded or shared as a PDF, or its code was successfully
     copied. `acknowledged`: the kit was only ticked.
   - Never goes from `saved` back to `acknowledged` (kits accumulate; an earlier saved kit
     still works).
6. **One sign-out confirm, shared by desktop and mobile, with a trust tick.** Both
   ProfileMenu (desktop) and MobileHamburgerMenu open the same confirm. Mobile currently
   signs out with no confirm. The confirm shows:
   - A tick, new `auth.signOutTrustDevice`: "Trust this device so I can sign back in with
     my PIN".
     - It starts checked when `isTrustedDevice`, unchecked otherwise.
     - On Sign Out, the kit guard (requirement 7) is decided against the tick's chosen
       trust. A changed tick is then applied through `setDeviceTrust(..., 'signout-tick')`
       after the guard passes and before any teardown step runs.
     - Cancel, and any way out of the guard that keeps the user signed in, changes
       nothing.
   - A hint that follows the tick live:
     - checked shows `auth.signOutConfirmHint` ("Your data is saved and will be here when
       you come back.");
     - unchecked shows new `auth.signOutConfirmHintUntrusted` ("This device isn't trusted,
       so signing back in here will need a link from a family member's device or your
       recovery kit.").
   - Sign Out, the "clear all data from this device" link, and Cancel.
     - The clear-data link is the separate shared-device option.
     - It is now shown on mobile whatever the trust state; it used to show only on trusted
       devices (`MobileHamburgerMenu.vue:620`).
     - It ignores the tick, because it untrusts anyway.
7. **Sign-out kit guard.** After the confirm, and before the tick is applied or anything is
   torn down, show a short guard when all five hold:
   a. the signed-in member can manage the pod (`canManagePod`), the same rule as the kit
   nag;
   b. the kit is not detected as saved (`hasKitSavedSignal` is false);
   c. the chosen sign-out drops key material (`dropsKeyMaterial(signOutStepsFor(tier,
trust))`, where `trust` is the tick's value): an unticked keep-data sign-out, or any
   clear-data sign-out. A ticked keep-data sign-out therefore never guards;
   d. this is not an App Review demo session (`isDemoSession`);
   e. the family has no recovery passphrase (`envelope.recoveryPassphrase` absent). A
   passphrase opens the pod cold (`fileSync.ts:447`), so "lose access forever" would be
   false.
   - **Legacy rule (Q2):** if `recoveryKitConfirmedVia` is absent, a password-era family
     (the owner has a real, non-sentinel `passwordHash`) counts as saved. Kit-born
     families that confirmed before this ships count as not saved.
   - A kit confirmed inside the guard continues the sign-out only once it is durable,
     whether it was confirmed by saving or by the tick. The tick stays unconditional.
   - **Copy (greg's wording):**
     - Title reuses `recovery.kitPromptTitle` ("Save Your Recovery Kit").
     - Body, new `recovery.kitGuardBody`: "We didn't detect you saving your recovery kit.
       Please create one before signing out, otherwise you will lose access to your family
       file forever."
     - Primary reuses `recovery.kitGenerate` ("Create Recovery Kit", Q3).
     - Destructive secondary, new `auth.signOutAnyway`: "Sign out anyway".
     - Dismiss (X, Escape, backdrop) keeps the user signed in and closes everything.
   - **Excluded:** the escape hatches (fatal-overlay clear-data, delete family, start
     over, Google disconnect, Settings clear-data).
   - `beanie` values keep the real nouns ("recovery kit", "family file", "access").
8. **Failures are never silent.**
   - A throw during a menu sign-out is reported and shown with new `auth.signOutFailed`:
     "Sign-out didn't finish. Try again, or reload the app."
   - A failed trust change is shown with new `auth.trustSetFailed`: "We couldn't update
     this device's trust setting. Try again, or change it in Settings."
   - The fatal-overlay clear-data's bare `catch {}` now reports.
9. **Docs.**
   - Amend ADR-034's accepted trade-off: the stranded new family is no longer accepted.
   - Annotate the sign-out warning promised in the 2026-08-28 plan (`:200-205`) and
     ADR-034 (`:70-72`) as **partly** addressed. The untrusted-device case is covered by
     the sign-out trust tick and its live hint. The "no PIN-holding enrolments" warning is
     still open.

## Important Notes & Caveats

- **The kit tick must stay unconditional.** `canConfirmKit` in `RecoveryKitDisplay` is
  pinned by `RecoveryKitDisplay.gate.test.ts`. This plan only records HOW the kit was
  confirmed and adds no condition to the tick.
- **Kits accumulate; regenerating does not inert the old one** (until tracker #99).
  - `addRecoveryKey` only adds a wrap (`syncStore.ts:6255`).
  - "Create Recovery Kit" in the guard mints an additional kit, and `via` never
    downgrades.
  - When #99 ships, `via` must reflect the newest confirm; the model doc comment says so.
- **Stale "a new kit disables the old one" comments** are corrected where touched:
  - `RecoveryKitPromptModal.vue:1-8`;
  - `RecoveryKitPromptModal.vue:33-34`, which moves into `useRecoveryKitFlow`;
  - `settingsStore.ts:709-713`.
- **A kit only counts once durable.** The guard continues only when the confirm push
  (`syncNowBounded()`) returned true.
- **Trust is device-global** (`isTrustedDevice` is in global settings). Create and join
  trust the device for every family on it, which is the intended meaning. Accepted
  consequences:
  - It overrides an earlier "don't trust" made here for another family, and that family's
    key is cached on its next open (`settingsStore.ts:884`). Measured by
    `device_trust_set` `detail: 'was:declined'`.
  - A trusted keep-data sign-out keeps the Drive refresh token, encrypted DB, roster and
    auto-open wrap. On a borrowed device the user unticks trust or uses clear-data. Both
    are on the shared confirm, and the guard covers both.
  - Joins also happen on borrowed devices; the tick is the remedy at sign-out.
- **The tick applies on Sign Out, not on toggle, and only once the guard has passed.**
  - Cancel and a dismissed guard are both honest: nothing changes.
  - There is one trust write per sign-out.
  - A failed trust write aborts before any teardown. The user stays signed in, and the
    toast says why.
- **Turning trust off does not delete the cached auto-open key**; the untrusted sign-out
  that follows does (`clearKeyCacheFamily`). This is pre-existing Settings behaviour and
  stays out of scope.
- **Create caches the key twice**: once in `setDeviceTrust`, once in the existing
  `cacheFamilyKey(..., { force: true })`.
  - The force write stays, because the demo seed does not trust and a failed trust write
    must still leave the create session reloadable.
  - It is one idempotent IDB write. Only its stale comment changes.
- **Order inside create:** `setDeviceTrust(true, 'create')` runs at step 7, after register
  and before the key cache and `markPodCreated`.
  - A failed create never trusts.
  - Trust is in place before ResumePodSetup's `enrollDevicePinWrapForMember` and the kit
    phase.
  - The demo is skipped through the existing `suppressRemote`.
- **Order inside join:** `setDeviceTrust(true, 'join')` runs after the claim
  (`applyPinReset`) and before the session is set. It never throws, so the "claim is the
  last fallible write" guarantee (`joinClaimOrdering.test.ts`) still holds.
- **Always-ask costs:**
  - Trust bypasses the interruption slot, as the slot's single exemption. On the rare load
    where another surface already claimed the slot, both can be on screen.
  - The trust modal renders on `layer="top"` (z-250), above the onboarding wizard (z-200),
    the what's-new drawer (z-40) and base modals. `OnboardingWizard.vue:270-274` documents
    'top' as exactly the tier for modals that must stack above the wizard, so this is the
    intended use, not a workaround. `PwaReinstallModal` (also 'top') is mounted before the
    auth prompts, so trust paints above it too. 'gate' (z-260) stays reserved for
    `DocumentExtractConsentModal`.
  - Only the trust modal uses 'top'. The kit nag and the guard stay on 'base', because their
    unclosable `RecoveryKitDisplay` is base, and a 'top' intro would let that display open
    invisibly behind the wizard.
  - Either trust answer latches the sign-in, so on an untrusted new device the PIN, kit and
    native-biometric nags move to a later sign-in.
- **The guard is decided synchronously, before any await**, in `useSignOut`, against the
  tick's chosen trust. The same synchronous step moves `phase` off `confirm`, which is what
  blocks a double tap.
- **Trusted is now the default tier for created and joined devices**, and two non-menu
  sign-outs inherit it. Neither of them is guarded.
  - "Start over" on the post-create kit step (`LoginPage.vue:840`, visible per
    `ResumePodSetup.vue:1349`) now keeps the half-created family openable on this device
    instead of wiping it. That is the safer direction.
  - "Disconnect Google everywhere" (`GoogleDisconnectCard.vue:38`) takes the trusted tier,
    and its "signs out fully" comment is corrected.
- **CIG:**
  - The confirm moves as-is from AppHeader into `SignOutHost`.
  - The guard, the kit nag and the trust prompt share the new `AuthPromptModal` shell.
  - "Sign out anyway" uses the danger variant (a destructive confirm).
  - All text uses ink tokens or `-lift` partners, checked in light and dark.
- **Accepted risk:** "never downgrade" reads local settings, so two unsynced managers
  confirming at once could end at `acknowledged` (Automerge last-writer-wins). The only
  effect is an unnecessary guard.
- **Accepted residual:** a guard kit confirmed with a non-durable push, then cancelled,
  leaves a local `via: 'saved'` ahead of the family file, so a later offline untrusted
  sign-out is not guarded. `quietTeardownAndForceSave` retries the push first, and the DB
  is kept when that push fails.

## Assumptions

1. `RecoveryKitDisplay`'s `kitSaved` (set on a real PDF delivery) is sticky.
   - A successful copy is recorded in a new sticky `kitCodeCopied`, set when the kit's
     `useClipboard().copy()` returns true.
   - The hand-rolled `kitCopied` is removed; the 2-second "Copied" state comes from that
     instance's `copied`.
   - Known trade: `useClipboard` reports `'clipboard write failed'` instead of
     `kit_copy_failed`.
2. `canManagePod` on the signed-in member is available at sign-out time.
3. Only managers can call `authStore.createRecoveryKit()`.
4. The doc-side `Settings` entity takes a new optional field without a migration.
5. No existing test asserts that a created or joined device stays untrusted. The E2E
   helper already dismisses a trust modal if one appears (`e2e/helpers/auth.ts:151-160`).

## Open Questions (answered at plan review)

- **Q1. Join flow trusted?** Yes (requirement 2).
- **Q2. Legacy confirmations:** accepted as recommended. Kit-born counts as not saved;
  password-era counts as saved.
- **Q3. Primary label:** reuse "Create Recovery Kit".

## Approach

### A. One shared trust action; trust on create and on join

1. `authStore.setDeviceTrust(trusted: boolean, source: DeviceTrustSource): Promise<boolean>`,
   where `DeviceTrustSource = 'create' | 'join' | 'prompt' | 'settings' | 'signout-tick'`.
   Success means the flag was written. Caching the key is best-effort, as it is on every
   other open path (`syncStore.ts:2470-2481`).
   ```ts
   /** The ONE user-facing way to change this device's trust (2026-09-23). Never throws.
    *  Returns true once the flag is written; the key cache after it is best-effort. */
   async function setDeviceTrust(trusted: boolean, source: DeviceTrustSource): Promise<boolean> {
     const s = useSettingsStore();
     const was = s.isTrustedDevice ? 'trusted' : s.trustedDevicePromptShown ? 'declined' : 'unset';
     try {
       await s.setTrustedDevice(trusted);
     } catch (e) {
       // showToast(type, title, message?, options): the string is the toast TITLE.
       showToast('error', useTranslationStore().t('auth.trustSetFailed'), undefined, {
         surface: 'login-flow',
         error: e,
         context: { action: 'device_trust_set_failed', kind: source },
       });
       return false;
     }
     emitDeviceTrustSet({ source, trusted, was });
     if (trusted) await cacheActiveFamilyKeyBestEffort(source);
     return true;
   }

   /** Non-fatal (R2-F1): a trusted device without a cached key still opens with its PIN,
    *  and the next open caches it. Reports a warning; never toasts, never throws. */
   async function cacheActiveFamilyKeyBestEffort(source: DeviceTrustSource): Promise<void> {
     try {
       const familyId = useFamilyContextStore().activeFamilyId;
       if (!familyId) return;
       const { useSyncStore } = await import('@/stores/syncStore'); // lazy: see :162
       const exported = await useSyncStore().getExportedFamilyKey();
       if (exported) await useSettingsStore().cacheFamilyKey(exported, familyId);
     } catch (e) {
       reportError({
         surface: 'login-flow',
         message: 'trusted key cache failed',
         error: e,
         severity: 'warning',
         context: { action: 'device_trust_key_cache_failed', kind: source },
       });
     }
   }
   ```
   `setTrustedDevice` already writes `trustedDevicePromptShown: true`, so any answer that
   succeeds, including create and join, closes the question on this device. A failed flag
   write changes nothing, so the question stays armed and a sign-out tick aborts before any
   teardown.
   - `authStore` already imports `showToast` (`authStore.ts:60`) and reaches translation
     through `useTranslationStore().t` (`:63`, `:405`); the lazy `syncStore` import is the
     existing pattern at `:164`.
   - `isDemoSession` is exported from `src/utils/reviewDemo.ts:138`.
2. **Create** (`syncStore.createNewFile`, step 7, `syncStore.ts:~3213`):
   - Add one line before the key-cache try block: `if (!suppressRemote) await
useAuthStore().setDeviceTrust(true, 'create');`.
   - Replace the `force` comment ("the user JUST entered the password") with: "force: the
     demo seed does not trust the device, and a failed trust write must still leave the
     create session reloadable."
   - Amend the `suppressRemoteSideEffects` doc comment: "LOCAL writes are unaffected, with
     one exception: trust-on-create is skipped, because a trusted reviewer device would
     keep the demo pod through a plain sign-out."
3. **Join** (`authStore.joinFamily`, after `authStore.ts:2079`): `await
setDeviceTrust(true, 'join');`, with a comment that it cannot throw, so the claim-last
   ordering holds.
4. **Trust prompt answers** (`App.vue:357-373`):
   - Both handlers first set `activeAuthPrompt = null`, so a failure toast is never hidden
     behind the unclosable modal.
   - Both then set `authPromptDeclinedThisSignIn = true`: one prompt per sign-in, whatever
     the answer.
   - Trust calls `authStore.setDeviceTrust(true, 'prompt')`.
   - Decline calls `setDeviceTrust(false, 'prompt')`.
   - The inline key-cache code in `handleTrustDevice` is deleted.
   - A failed answer leaves the question armed, so the next sign-in asks again.
5. **Settings toggle** (`SettingsPage.vue:2348`):
   `@update:model-value="authStore.setDeviceTrust($event, 'settings')"`.
   - Turning trust on there now also caches the key.
   - The toggle stays bound to the store, so a failure leaves it showing the real state.

### B. Record how the kit was confirmed

1. `models.ts` `Settings`: add `recoveryKitConfirmedVia?: 'saved' | 'acknowledged'`, with
   a doc comment on the never-downgrade rule and #99.
2. `settingsStore.markRecoveryKitConfirmed(via)`, with a REQUIRED parameter.
   - It writes `recoveryKitConfirmedAt` plus `recoveryKitConfirmedVia: via === 'saved' ?
'saved' : (settings.value.recoveryKitConfirmedVia ?? 'acknowledged')`.
   - The existing catch gains `kind: via`, and it still never throws.
   - Its comment (`:709-713`) is corrected: a swallowed stamp makes the nag re-fire, and
     obeying it mints an additional kit; it does not stop the stored kit working.
3. `RecoveryKitDisplay.vue`:
   - Replace `handleCopyKitCode` (`:147-162`) and `kitCopied` with a second
     `useClipboard({ surface: 'login-flow' })` instance. Its `copied` drives the "Copied"
     state, and its `error` renders `share.copyFailedHelp` with the magic-link copy-error
     markup (`:296-302`).
   - Add a sticky `kitCodeCopied`, set when `copy()` returns true and reset in the
     open/code watcher (`:114`).
   - Emit `stored: [via]`, where `via = kitSaved || kitCodeCopied ? 'saved' :
'acknowledged'`.
   - `canConfirmKit` and the tick are untouched.
4. New `src/composables/useRecoveryKitFlow.ts`, extracted from the near-identical code in
   `RecoverySettings.vue:36-62` and `RecoveryKitPromptModal.vue:36-64`. Each call returns its
   own state, and each consumer gets a fresh instance when it mounts, so there is no
   `reset()`.
   - State: `kitCode`, `kitId`, `showKit`, `isGenerating`, `isConfirming`, `unsynced`,
     `error`. `isConfirming` carries over R2-F9: the intro must not reappear while it is
     true, or a second tap mints another kit.
   - `generate()` clears `error` and `unsynced`, then calls `authStore.createRecoveryKit()`
     and maps a failure to `error`. The store already reports `kit_generate_failed`.
   - `confirmStored(via): Promise<boolean>`, all under `isConfirming`:
     1. Clear the code and hide the display.
     2. Await `markRecoveryKitConfirmed(via)`.
     3. Set `durable = await syncStore.syncNowBounded()`.
     4. If not durable, set `unsynced` and `error = t('recovery.kitNotSynced')`, and call
        `emitKitConfirmNotSynced()`.
     5. Return `durable`.
   - `retrySync(): Promise<boolean>` re-runs `syncNowBounded()` and clears `unsynced` and
     `error` on success. It never mints a kit. A failure re-emits
     `emitKitConfirmNotSynced()`.
   - The nag and RecoverySettings drop their local copies. The nag keeps emitting `done`
     after confirm whatever the push result; RecoverySettings shows the not-synced error.
   - New `recovery.kitNotSynced`: "Your new kit hasn't reached your family file yet. Check
     your connection and try again."
5. `ResumePodSetup.handleKitStepStored(via)` calls `markRecoveryKitConfirmed(via)`
   directly.
   - The dead try/catch (`:900-907`) is removed.
   - There is no sync here; SetupProgressModal's sync carries the stamp.
6. `authPrompts.ts` kit signals:
   - Add `type KitSignalContext = Pick<AuthPromptContext, 'settings' | 'owner' | 'envelope'>`.
   - Add a header line saying the kit signals are also consumed by the sign-out guard.
   - Add:
     ```ts
     export function hasKitSavedSignal(ctx: KitSignalContext): boolean {
       const via = ctx.settings?.recoveryKitConfirmedVia;
       if (via) return via === 'saved';
       // Legacy (pre-`via`): a password-era family can still open cold with its password (Q2).
       return !!ctx.owner?.passwordHash; // DEFERRED_PASSWORD_HASH is '' (kit-born)
     }
     export function needsKitGuardBeforeSignOut(
       ctx: KitSignalContext & {
         member: FamilyMember | undefined;
         dropsKeyMaterial: boolean;
         isDemo: boolean;
       }
     ): boolean {
       return (
         !ctx.isDemo &&
         ctx.dropsKeyMaterial &&
         !!ctx.member?.canManagePod &&
         !hasKitSavedSignal(ctx) &&
         !ctx.envelope?.recoveryPassphrase // a passphrase opens the pod cold (fileSync.ts:447)
       );
     }
     ```
   - With the settings or the envelope not loaded, only the legacy branch decides, so a
     kit-born family guards (the safe direction).

### C. Sign-out: one confirm, the trust tick, the kit guard

1. `signOutSteps.ts`:
   - Export `KEY_MATERIAL_STEPS: ReadonlySet<SignOutStepName>` = `clearKeyCacheFamily`,
     `clearKeyCacheAll`, `removePinWrapsFamily`, `removePinWrapsAll`, `forgetLocalFamily`.
     Its doc comment says "any step that removes this device's ability to open a pod; a
     new such step MUST be added here".
   - Export `dropsKeyMaterial(steps)` and `signOutStepsFor(tier: 'sign-out' | 'clear',
trusted)`. `authStore.signOut` and `signOutAndClearData` select through it, so the
     guard and the teardown can never disagree.
   - `SIGN_OUT_CLEAR_STEPS`: add `reArmTrustPrompt` immediately after `untrustDevice`
     (requirement 4). Delete documented exception 2 from the header; tier 3 is now a plain
     superset for that step.
2. New `src/components/auth/AuthPromptModal.vue`, a presentational shell.
   - Props: `open`, `title`, `body`, `error?`, `footnote?`, `closable?` (default false),
     `layer?` (default `'base'`, passed to BaseModal).
   - A default slot for the action buttons; it emits `close`.
   - It renders `BaseModal size="sm"` with the logo, h2, body, `role="alert"` error, action
     column and footnote, lifted from `TrustDeviceModal.vue:13-38`.
   - Used by the guard, the kit nag intro (`RecoveryKitPromptModal.vue:70-99`) and
     `TrustDeviceModal`.
     - `TrustDeviceModal` keeps its props, emits and `trust.notNow` button (the E2E helper
       clicks it), passes `layer="top"`, and shrinks to about ten lines.
     - The nag and the guard keep 'base' (see Caveats).
3. New `src/composables/useSignOut.ts`: module-level state, following the `useConfirm`
   pattern (`useConfirm.ts:64-126`). It imports `router` from `@/router` (the
   `useQuickAdd` pattern).
   - `phase: 'idle' | 'confirm' | 'guard' | 'signing-out'`, plus the pending guard
     `resolve`. Because it is one value, no impossible combination can exist.
   - `requestSignOut()`: idle becomes confirm; otherwise a no-op. `cancelSignOut()`:
     confirm becomes idle.
   - `abandonSignOut()`: in `confirm`, goes to idle; in `guard`, resolves `'cancelled'`; in
     `idle` or `signing-out`, does nothing.
   - `signOut(tier, { trust }): Promise<'signed-out' | 'cancelled' | 'failed'>` is a flat
     sequence of small named helpers, each returning early. The body has ONE
     try/catch/finally, with nothing nested inside the try:
     1. If `phase !== 'confirm'`, return `'cancelled'`.
     2. Synchronously, before any await: `const guard = evaluateKitGuard(tier, trust); phase
= guard ? 'guard' : 'signing-out'`. A second tap now fails step 1.
        `evaluateKitGuard` is synchronous (it emits telemetry, so it is not pure). It
        builds the context the same way the prompt watcher does (`App.vue:1985-1992`):
        `member = familyStore.members.find((m) => m.id === authStore.currentUser?.memberId)`
        (NOT `familyStore.currentMember`, which can be null over a loaded roster, see the
        `preselectSessionMember` note in `joinFamily`), `owner: familyStore.owner`,
        `settings: settingsStore.settings`, `envelope: syncStore.envelope`,
        `dropsKeyMaterial: dropsKeyMaterial(signOutStepsFor(tier, trust))`,
        `isDemo: isDemoSession.value`. It calls `needsKitGuardBeforeSignOut` and
        `emitKitGuard`, and returns the decision.
     3. `if (guard) { const outcome = await awaitKitGuard(); if (outcome === 'cancelled')
return 'cancelled'; phase = 'signing-out'; }`. `awaitKitGuard` awaits `'kit_saved' |
'sign_out_anyway' | 'cancelled'` and calls `emitKitGuardOutcome(outcome)`. Nothing
        has been written yet, so a cancel changes nothing.
     4. `if (!(await applyTrustTick(tier, trust))) return 'failed'`. The helper calls
        `authStore.setDeviceTrust(trust, 'signout-tick')` only when `tier === 'sign-out'`
        and the tick differs from `isTrustedDevice`. The action has already shown and
        reported any failure, and nothing has been torn down.
     5. `await runTeardown(tier)`: the store call for the tier, then `resetAllAppStores()`,
        then `router.replace('/login')`. Return `'signed-out'`.
     6. Catch: `showToast('error', t('auth.signOutFailed'), undefined, { surface:
'login-flow', error, context: { action: 'sign_out_failed', kind: tier } })` (the
        string is the toast title; one call both shows and reports), then return
        `'failed'`.
     7. Finally: set `phase = 'idle'` and clear `resolve`.
   - `useSignOutHost()` returns `{ phase, resolveKitGuard(outcome), abandonSignOut }` for
     the one renderer.
   - `__resetSignOutForTests()` resets the module state (the `useSessionInterruption.ts`
     test-reset pattern). App code never calls it.
4. Sign-out renderers. Each phase gets its own component, mounted with `v-if`, so each open
   starts from fresh state and no "reset on entry" watchers are needed.
   - New `src/components/auth/SignOutHost.vue`: a propless switcher (the ConfirmModal
     pattern), mounted once at the App root beside the nag (`App.vue:2351`), outside
     `showLayout`.
     - It renders `<SignOutConfirm v-if="phase === 'confirm'" />`, `<SignOutKitGuard
v-if="phase === 'guard'" />`, and the progress overlay.
     - Its one watcher: when `authStore.isAuthenticated` becomes false, call
       `abandonSignOut()`. A session that ends under an open confirm or guard therefore
       never leaves a modal over `/login` or a pending promise.
   - New `src/components/auth/SignOutConfirm.vue`: the AppHeader modal
     (`AppHeader.vue:579-658`) moved over: icon, message, danger Sign Out, clear-data link
     with `clearDataLabel` and the "what's this" `InfoHintBadge`, and Cancel.
     - The `isSigningOut` bindings (`:loading`, `:disabled`, the Cancel `v-if`, the close
       guard) are dropped, because `signOut` moves `phase` off `confirm` synchronously and
       this component unmounts.
     - It gains the tick, reusing the kit tick's native-checkbox markup
       (`RecoveryKitDisplay.vue:414-424`), bound to `const trustTick =
ref(settingsStore.isTrustedDevice)` and set once in setup.
     - It gains the live hint: `trustTick ? auth.signOutConfirmHint :
auth.signOutConfirmHintUntrusted`.
     - Sign Out calls `signOut('sign-out', { trust: trustTick })`. Clear-data calls
       `signOut('clear', { trust: trustTick })`. Close and Cancel call `cancelSignOut()`.
   - New `src/components/auth/SignOutKitGuard.vue`: `const flow = useRecoveryKitFlow()` in
     setup, so there is no reset. It uses `AuthPromptModal` and `RecoveryKitDisplay`.
     - It renders `AuthPromptModal` with title `recovery.kitPromptTitle`, body
       `recovery.kitGuardBody`, error `flow.error`, and `closable` (disabled while
       generating or confirming). The modal is hidden while `flow.showKit ||
flow.isConfirming`.
     - Primary `recovery.kitGenerate` calls `flow.generate()`. While `flow.unsynced` is
       set, it reads `action.tryAgain` and calls `flow.retrySync()`.
     - A `confirmStored` or `retrySync` that returned true resolves `'kit_saved'`.
     - Danger "Sign out anyway" resolves `'sign_out_anyway'`. Close resolves
       `'cancelled'`.
   - **Progress** (`phase === 'signing-out'`, inline in `SignOutHost`): the full-screen
     "Signing out…" overlay, moved as-is from `MobileHamburgerMenu.vue:640-651`. It is the one
     progress surface for both desktop and mobile.
5. Callers:
   - **AppHeader:** `promptSignOut` becomes `showProfileDropdown = false;
requestSignOut()`. Delete `showSignOutModal`, `isSigningOut`, the `confirmSignOut*`
     handlers, `clearDataLabel`, the modal, and the `showSignOutModal = false` line in
     `confirmSwitchMember`.
   - **MobileHamburgerMenu:** "Sign out" becomes `close(); requestSignOut()`. Delete
     `isSigningOut`, both handlers, `clearDataLabel`, the clear-data row (`:617-629`) and
     the overlay.
   - **ProfileMenu:** fix the header comment (`:20-21`). The confirm and progress now live
     in `SignOutHost`.
   - The escape-hatch sign-outs keep their own callers.
   - `App.vue:1754-1761`: replace the bare `catch {}` with `reportError({ surface:
'auth-signout', message: 'fatal-overlay clear-data failed; reloading anyway', error,
severity: 'warning', context: { action: 'fatal_clear_failed' } })`.
6. `RecoveryKitPromptModal.vue` (the nag) gets no mode prop. It switches to
   `useRecoveryKitFlow` and `AuthPromptModal`, and its `:1-8` and `:33-34` comments are
   corrected.

### D. Always ask on every other new device

1. `authPrompts.ts`:
   - Add `isTrustedDevice` to `flags`.
   - Move the `trust` descriptor to the FRONT, with `eligible: (ctx) =>
!ctx.flags.isTrustedDevice && !ctx.flags.trustedDevicePromptShown` and a new
     descriptor field `unpreemptable: true`.
   - Export `isUnpreemptable(id)`.
   - Update the header's ordering block: trust comes first, and why.
2. `App.vue` watcher (`:1985-2000`) and template:
   - Pass `isTrustedDevice: settingsStore.isTrustedDevice` into `flags`.
   - The show-site becomes `const claimed = winner ? claimInterruption('auth-prompt') :
false; if (winner && (claimed || isUnpreemptable(winner))) { activeAuthPrompt.value =
winner; emitAuthPromptShown(winner, !claimed); }`.
   - Trust still claims the slot, so later surfaces yield. Because trust is first and either
     answer latches (A.4), no other nag shows in the same sign-in.
   - Move `<PwaReinstallModal />` (`:2357`) above `<TrustDeviceModal>` (`:2334`). Both are
     Teleport-to-body 'top' modals, and at equal z-index mount order decides which paints
     on top, so this keeps the trust question uppermost.
3. `useSessionInterruption.ts` header: document the single exemption (the trust question,
   `isUnpreemptable`, 2026-09-23).
4. Re-arm on every path that wipes trust:
   - tier 3 (C.1);
   - `SettingsPage.vue:1340` gains `await settingsStore.resetTrustedDevicePrompt()` after
     `setTrustedDevice(false)`, inside its existing try;
   - untrusted tier 2 already re-arms.
5. Demo: `demoSeed.ts` calls `settingsStore.setTrustedDevicePromptShown()` beside
   `dismissKitPrompt()` (`:242`), with the same comment rationale. The reviewer is neither
   asked nor trusted.

### E. Docs

1. ADR-034: add an "Amended 2026-09-23" note under the accepted trade-off.
2. The 2026-08-28 plan `:200-205` and ADR-034 `:70-72`: "Untrusted-device case covered by
   `docs/plans/2026-09-23-trust-on-create-and-kit-signout-guard.md` (the sign-out trust
   tick and its live hint). The no-PIN-holding-enrolment warning is still open."
3. `docs/STATUS.md` and `CHANGELOG.md` at ship time.

## Implementation Order

Each step leaves the build green and the tests passing. Later steps depend on earlier ones.

1. **Types and data.** `models.ts` (`recoveryKitConfirmedVia`);
   `settingsStore.markRecoveryKitConfirmed(via)`; `signOutSteps.ts` (`KEY_MATERIAL_STEPS`,
   `dropsKeyMaterial`, `signOutStepsFor`, tier-3 `reArmTrustPrompt`); `authPrompts.ts`
   (`isTrustedDevice` flag, trust first, `unpreemptable`, `isUnpreemptable`,
   `KitSignalContext`, `hasKitSavedSignal`, `needsKitGuardBeforeSignOut`). Update
   `authPrompts.test.ts`, `dataClearingSecurity.test.ts` and the settingsStore test in the
   same step.
2. **Telemetry facade.** `loginFlowEvents.ts`: `emitDeviceTrustSet`, `emitAuthPromptShown`,
   `emitKitGuard`, `emitKitGuardOutcome`, `emitKitConfirmNotSynced`.
3. **Strings.** All new and changed keys in `uiStrings.ts` (table below), then
   `npm run translate` to confirm the parser still reads the file.
4. **Shared trust action.** `authStore.setDeviceTrust` +
   `cacheActiveFamilyKeyBestEffort`; `authStore.signOut` / `signOutAndClearData` select
   through `signOutStepsFor`. New `authStore.deviceTrust.test.ts`.
5. **Trust on create and join.** `syncStore.createNewFile` step 7 (one line + comments);
   `authStore.joinFamily` after the claim; `demoSeed.ts` marks the question answered.
   Update `createNewFile.test.ts`, `joinClaimOrdering.test.ts`, `demoSeed.test.ts`.
6. **Kit confirmation.** `RecoveryKitDisplay.vue` (`useClipboard`, `kitCodeCopied`, emit
   `via`); new `useRecoveryKitFlow.ts`; `ResumePodSetup.vue` passes `via` through. Update
   `RecoveryKitDisplay.gate.test.ts`; new `useRecoveryKitFlow.test.ts`.
7. **Prompt shell.** New `AuthPromptModal.vue`; `TrustDeviceModal.vue` (`layer="top"`),
   `RecoveryKitPromptModal.vue` and `RecoverySettings.vue` move onto the shell and the flow.
8. **Sign-out.** New `useSignOut.ts`, `SignOutHost.vue`, `SignOutConfirm.vue`,
   `SignOutKitGuard.vue`; `App.vue` mounts the host; `AppHeader.vue`,
   `MobileHamburgerMenu.vue`, `ProfileMenu.vue` switch to `requestSignOut()`. New
   `useSignOut.test.ts` and the component tests.
9. **Always ask.** `App.vue` watcher and trust handlers, `PwaReinstallModal` mount order,
   `useSessionInterruption.ts` header; `SettingsPage.vue` toggle and clear-data re-arm;
   `App.vue` fatal clear-data catch; `GoogleDisconnectCard.vue` comment.
10. **Docs and help.** `security.ts` (`password-recovery`), ADR-034, the 2026-08-28 plan,
    `CHANGELOG.md`, `docs/STATUS.md`.
11. **Verify.** `npm run validate` once (captured to a file), the browser walkthrough in
    Testing Plan item 12, then `/code-review`.

## String Table

Every entry needs `en` and `beanie`. All keys sit under `auth.` or `recovery.`, which are
already on the important-surface list in `uiStrings.test.ts`, so the beanie values keep the
real nouns.

| Key                                      | en                                                                                                                                               | beanie                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.signOutTrustDevice` (new)          | Trust this device so I can sign back in with my PIN                                                                                              | trust this device so i can sign back in with my pin                                                                                              |
| `auth.signOutConfirmHintUntrusted` (new) | This device isn't trusted, so signing back in here will need a link from a family member's device or your recovery kit.                          | this device isn't trusted, so signing back in here will need a link from a family member's device or your recovery kit.                          |
| `auth.signOutAnyway` (new)               | Sign out anyway                                                                                                                                  | sign out anyway                                                                                                                                  |
| `auth.signOutFailed` (new)               | Sign-out didn't finish. Try again, or reload the app.                                                                                            | sign-out didn't finish. try again, or reload the app.                                                                                            |
| `auth.trustSetFailed` (new)              | We couldn't update this device's trust setting. Try again, or change it in Settings.                                                             | we couldn't update this device's trust setting. try again, or change it in settings.                                                             |
| `recovery.kitGuardBody` (new)            | We didn't detect you saving your recovery kit. Please create one before signing out, otherwise you will lose access to your family file forever. | we didn't detect you saving your recovery kit. please create one before signing out, otherwise you will lose access to your family file forever. |
| `recovery.kitNotSynced` (new)            | Your new kit hasn't reached your family file yet. Check your connection and try again.                                                           | your new kit hasn't reached your family file yet. check your connection and try again.                                                           |
| `trust.hint` (changed)                   | You can change this in Settings, or when you sign out.                                                                                           | you can change this in settings, or when you sign out.                                                                                           |

Reused unchanged: `auth.signOutConfirmHint`, `auth.signOutConfirmTitle`,
`auth.signOutConfirmMessage`, `auth.signOutClearDataHint`, `auth.signingOut`,
`recovery.kitPromptTitle`, `recovery.kitGenerate`, `action.tryAgain`, `action.cancel`,
`share.copyFailedHelp`, `trust.title`, `trust.description`, `trust.trustButton`,
`trust.notNow`.

## Files Affected

- `src/stores/authStore.ts`: `setDeviceTrust`; the join call; `signOutStepsFor` in
  `signOut` and `signOutAndClearData`.
- `src/stores/syncStore.ts`: the one-line create call at step 7; comments on `force` and
  `suppressRemoteSideEffects`.
- `src/stores/settingsStore.ts`: `markRecoveryKitConfirmed(via)` (required parameter, no
  downgrade, corrected comment).
- `src/types/models.ts`: `recoveryKitConfirmedVia`.
- `src/services/auth/authPrompts.ts`: trust first, the `isTrustedDevice` flag,
  `unpreemptable` and `isUnpreemptable`, `KitSignalContext`, `hasKitSavedSignal`,
  `needsKitGuardBeforeSignOut`, header.
- `src/services/auth/signOutSteps.ts`: `KEY_MATERIAL_STEPS`, `dropsKeyMaterial`,
  `signOutStepsFor`, tier-3 `reArmTrustPrompt`, header.
- `src/services/telemetry/loginFlowEvents.ts`: `emitDeviceTrustSet`,
  `emitAuthPromptShown`, `emitKitGuard`, `emitKitGuardOutcome`, `emitKitConfirmNotSynced`.
- `src/services/demo/demoSeed.ts`: marks the trust question answered.
- `src/composables/useSignOut.ts` (new), `src/composables/useRecoveryKitFlow.ts` (new).
- `src/composables/useSessionInterruption.ts`: header note on the exemption.
- `src/components/auth/SignOutHost.vue`, `SignOutConfirm.vue`, `SignOutKitGuard.vue`,
  `AuthPromptModal.vue` (all new).
- `src/components/auth/RecoveryKitDisplay.vue`, `RecoveryKitPromptModal.vue`,
  `src/components/common/TrustDeviceModal.vue`.
- `src/components/settings/RecoverySettings.vue`, `src/components/login/ResumePodSetup.vue`.
- `src/components/common/AppHeader.vue`, `MobileHamburgerMenu.vue`, `ProfileMenu.vue`
  (comment only).
- `src/App.vue`: trust handlers (both latch), watcher, `PwaReinstallModal` moved above the
  auth prompts, `<SignOutHost />`, fatal clear-data catch.
- `src/components/settings/GoogleDisconnectCard.vue`: header comment only (the device now
  keeps the trusted tier).
- `src/pages/SettingsPage.vue`: toggle through `setDeviceTrust`; clear-data re-arm.
- `src/content/help/security.ts` (`password-recovery`).
- `src/services/translation/uiStrings.ts`:
  - New keys: `recovery.kitGuardBody`, `recovery.kitNotSynced`, `auth.signOutAnyway`,
    `auth.signOutConfirmHintUntrusted`, `auth.signOutFailed`, `auth.signOutTrustDevice`,
    `auth.trustSetFailed` (all on the important-surface prefixes).
  - Changed: `trust.hint`. en: "You can change this in Settings, or when you sign out."
    beanie: "you can change this in settings, or when you sign out."
  - Reused: `recovery.kitPromptTitle`, `recovery.kitGenerate`, `action.tryAgain`,
    `auth.signOutConfirmHint`, `share.copyFailedHelp`.
- Tests:
  - existing: `createNewFile.test.ts`, `joinClaimOrdering.test.ts`, `authPrompts.test.ts`,
    `dataClearingSecurity.test.ts`, `RecoveryKitDisplay.gate.test.ts`, `demoSeed.test.ts`;
  - new: `src/stores/__tests__/authStore.deviceTrust.test.ts`, `useSignOut.test.ts`,
    `useRecoveryKitFlow.test.ts`, sign-out renderer component tests, and a settingsStore no-downgrade
    test.
- Docs: `docs/adr/034-pin-first-identity-recovery-kit.md`,
  `docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md`.

## Help Center Coverage

- **Action**: update existing
- **Category**: `security`
- **Slug**: `password-recovery` ("Your Recovery Kit (and Other Ways Back In)",
  `src/content/help/security.ts:561`). No trusted-device article exists.
- **Title**: unchanged
- **Scope**:
  - The device you create or join your family on is trusted automatically, so signing out
    there keeps you able to sign back in with your PIN.
  - Any other device asks, the first time you sign in, whether to trust it.
  - The sign-out screen shows whether this device is trusted and lets you change it. On a
    borrowed device, untick it or use the clear-data option.
  - If you haven't saved your recovery kit, sign-out asks you to create one first.
- **Notes**: be clear that "Sign out anyway" without a saved kit can lock you out for good.
  Bump `updatedDate`.

## Observability Coverage

All events go through the `loginFlowEvents.ts` facade on surface `login-flow`, using only
the allowlisted keys `action`, `kind`, `detail` and `error_code`
(`src/utils/diagnosticContext.ts:61-69`, `:202`). `result`, `tier`, `trusted`, `source` and
`kit_via` are NOT allowlisted and are not used. No allowlist, Lambda-mirror or store
declaration change is needed.

- **`emitDeviceTrustSet({ source, trusted, was })`**: `device_trust_set` (info), fired only
  after the flag write succeeds.
  - `action: source` (`create | join | prompt | settings | signout-tick`)
  - `kind: 'on' | 'off'`
  - `detail: 'was:trusted' | 'was:declined' | 'was:unset'`
  - `create` or `join` with `was:declined` counts overrides of an explicit decline.
  - There is no demo event, because create skips the call.
- **`device_trust_set_failed`** (error): the single failure record, reported once through
  the error toast inside `setDeviceTrust`, with `kind: source`. The failure rate is this
  count against `device_trust_set`.
- **`device_trust_key_cache_failed`** (warning): the best-effort key cache after a
  successful trust write failed. It carries `kind: source`, and there is no toast.
- **`emitAuthPromptShown(id, slotBypassed)`**: `auth_prompt_shown` (info), `action:
'shown'`, `kind: id`, `detail: 'slot:bypassed' | 'slot:claimed'`. "Always ask" is
  measurable: every `device_trust_set` with `action: 'prompt'` is preceded by a shown event
  with `kind: 'trust'`, and every untrusted first sign-in produces one.
- **`emitKitGuard({ shown, tier, trusted, via, passphrase })`**: `kit_guard` (info).
  - `action: shown ? 'shown' : 'skipped'`
  - `kind: tier`
  - `detail: '<trusted|untrusted>+via:<saved|acknowledged|legacy|none>+pp:<0|1>'`
  - `trusted` is the tick's chosen trust, because the guard is decided before the tick is
    applied.
  - It fires on every confirmed menu sign-out.
- **`emitKitGuardOutcome(outcome)`**: `kit_guard_outcome`, emitted only by `useSignOut`,
  with `action` one of `kit_saved`, `sign_out_anyway`, `cancelled`. `sign_out_anyway` is
  warn and is the one to alert on later.
- **`emitKitConfirmNotSynced()`**: `kit_confirm_not_synced` (warn), from
  `useRecoveryKitFlow` when a confirm push or a `retrySync` was not durable.
- **`kit_confirm_stamp_failed`** (existing) gains `kind: via`.
- **`sign_out_failed`**: reported once, through the error toast in `useSignOut`, with
  `kind: tier`.
- **`fatal_clear_failed`** (warning, surface `auth-signout`) replaces the bare catch.
- The existing **`emitSignoutTier`** still records the tier that actually ran.
- None of these warrant `severity: 'critical'`.

## Acceptance Criteria

- [ ] Creating a family on any platform leaves `isTrustedDevice === true`. The demo seed
      leaves it unchanged and never shows the trust question.
- [ ] Joining a family (claim flow) leaves `isTrustedDevice === true`; a failed join does
      not.
- [ ] After creating or joining, then signing out with the tick left checked, signing back
      in on that device opens with PIN or trusted auto-open, never the kit-entry screen.
- [ ] On an untrusted device that has not answered, the first sign-in by every path shows
      the trust question first, even when another auto-surface claimed the slot. After an
      untrusted or clear-data sign-out, the next sign-in asks again.
- [ ] Every trust change (prompt, Settings, tick, create, join) goes through
      `setDeviceTrust`; a failure shows `auth.trustSetFailed` and is reported.
- [ ] Desktop and mobile open the same sign-out confirm.
  - The tick reflects the current trust state, and the hint follows it live.
  - Cancel changes nothing, and neither does dismissing the guard.
  - Sign Out applies a changed tick after the guard passes and before any teardown.
  - A double tap never starts a second sign-out.
- [ ] A manager whose kit was only ticked sees the guard before an unticked keep-data
      sign-out or any clear-data sign-out. It never appears for a saved kit, a family with
      a recovery passphrase, a ticked keep-data sign-out, a non-manager, or the demo.
- [ ] The trust question is visible above the onboarding wizard and the PWA reinstall
      modal, and neither answer is followed by another auth nag in the same sign-in.
- [ ] "Create Recovery Kit" generates the kit, shows it and stamps `via`.
  - It completes the sign-out only if the kit reached the family file.
  - Otherwise it shows `recovery.kitNotSynced` and the user stays signed in; "Try again"
    re-pushes without minting.
  - "Sign out anyway" signs out; dismissing keeps the user signed in.
- [ ] Guard and confirm copy is the approved wording, in en and beanie, light and dark, at
      ~400px.
- [ ] A failed sign-out shows a toast and is reported; the escape-hatch sign-outs are
      unaffected.
- [ ] The kit tick remains unconditional (the existing pin test is green and unchanged).
- [ ] Help Center article(s) listed in **Help Center Coverage** are updated and match the
      shipped behaviour.
- [ ] Diagnostic logging in **Observability Coverage** is implemented and verified, riding
      only on allowlisted facade keys.

## Testing Plan

1. **Unit, trust on create (the regression pin), `createNewFile.test.ts`:**
   - "MUST trust the creating device": `saveGlobalSettings` was called with `{
isTrustedDevice: true, trustedDevicePromptShown: true }`, before `markPodCreated`.
   - A create failing at write, verify or persist never writes `isTrustedDevice`.
   - With `suppressRemoteSideEffects`, trust is not written (pairs with
     `demoSeed.test.ts:209`).
   - If the trust write rejects, create still returns `ok`, `cacheFamilyKey` ran with
     `force`, and the error report carries `device_trust_set_failed`.
2. **Unit, trust on join (`joinClaimOrdering.test.ts`):** "MUST trust the joining device".
   In `joinFamily`, `setDeviceTrust(true, 'join')` appears after `applyPinReset(` and
   before `freshSignIn.value = true`. The existing claim-last assertions stay green.
3. **Unit, `setDeviceTrust` (new `authStore.deviceTrust.test.ts`):**
   - `true` writes the flag and caches the active family's key. The `saveGlobalSettings`
     mock must echo the patch back (the `createNewFile.test.ts` mock returns `{}`, which
     would leave `isTrustedDevice` false and make the non-force cache a silent no-op).
   - `false` writes the flag only.
   - A rejected flag write returns false, never throws, shows exactly one error toast with
     `device_trust_set_failed`, and emits no `device_trust_set`.
   - A rejected key cache after a good flag write returns TRUE, shows no toast, and
     reports `device_trust_key_cache_failed` as a warning.
   - With no active family, it returns true and skips the cache.
   - `was` is read before the write.
4. **Unit, prompts (`authPrompts.test.ts`):**
   - `trust` wins over pin, kit and native-biometric when eligible (replaces "trust is the
     terminal prompt").
   - It is not eligible when the device is trusted or the question was already answered.
   - `isUnpreemptable` is true only for `trust`.
   - The `ctx()` fixture default marks trust answered, so the other ordering tests keep
     their meaning.
   - The existing throwing-descriptor test expects the next eligible prompt.
5. **Unit, tier data (`dataClearingSecurity.test.ts` plus the signOutSteps test):**
   - Tier 3 contains `reArmTrustPrompt` after `untrustDevice`, and exception 2 is removed.
   - `signOutStepsFor('sign-out', true)` has no key-dropping steps.
   - `dropsKeyMaterial` is true for untrusted, clear, and both eviction lists.
   - Every `KEY_MATERIAL_STEPS` entry is a valid `SignOutStepName`.
   - After trust, `authStore.signOut()` runs `SIGN_OUT_TRUSTED_STEPS`.
   - `dataClearingSecurity.test.ts:1137-1147`:
     - Invert both assertions, to "tier 3 contains `reArmTrustPrompt` after
       `untrustDevice`".
     - Delete the "exclusively the untrusted tier-2's" comment and its assertion on
       `SIGN_OUT_CLEAR_STEPS`.
6. **Unit, guard truth table:**
   - Covers dropsKeyMaterial × canManagePod × isDemo × passphrase (present / absent /
     envelope null) × via (saved / acknowledged / legacy kit-born `passwordHash: ''` /
     legacy password-era / settings null).
   - Password-era legacy never guards; a passphrase never guards; the demo never guards.
   - Plus the settingsStore no-downgrade test.
7. **Unit, `RecoveryKitDisplay.gate.test.ts`:**
   - Emits `saved` after a PDF delivery, and after a copy even past 2 seconds (fake
     timers).
   - Emits `acknowledged` after the tick only.
   - A failed copy renders its error.
   - The unconditional-tick tests are unchanged.
8. **Unit, `useRecoveryKitFlow`:**
   - `confirmStored` returns the push result; `false` sets `unsynced` and `error` and emits
     `kit_confirm_not_synced`.
   - `isConfirming` is true throughout.
   - `retrySync` never calls `createRecoveryKit`.
   - A failed `generate` sets `error`; a later `generate` clears `error` and `unsynced`
     first.
9. **Unit, `useSignOut`** (`__resetSignOutForTests()` in `beforeEach`):
   - `requestSignOut` is idempotent; `signOut` outside `confirm` returns `'cancelled'`.
   - `phase` leaves `confirm` synchronously: a second `signOut` issued before the first
     one's first await returns `'cancelled'`, and the store sign-out runs once.
   - The guard is decided from the tick's value:
     - unticked with an unsaved kit guards, even while `isTrustedDevice` is still true;
     - ticked never guards;
     - `clear` ignores the tick.
   - A changed tick calls `setDeviceTrust(..., 'signout-tick')` once, after the guard
     resolves (or when there is no guard) and before the store sign-out.
     - An unchanged tick does not call it.
     - A guard `cancelled` never calls it.
   - A failed trust change returns `'failed'`, never calls the store sign-out, and adds no
     `sign_out_failed` toast.
   - `kit_saved` and `sign_out_anyway` sign out; `cancelled` never calls the store.
   - A second `signOut` during `guard` returns `'cancelled'` without replacing the
     resolver.
   - `abandonSignOut`:
     - in `guard`, it resolves `'cancelled'` and never calls the store or
       `setDeviceTrust`;
     - in `signing-out`, it is a no-op.
   - A throw from the context, the store or the router shows exactly one error toast with
     `sign_out_failed`, returns `'failed'`, and resets to `idle`.
   - `emitKitGuardOutcome` fires once per guard.
10. **Component tests:**
    - `SignOutConfirm`: the tick starts from `isTrustedDevice` on each mount, and the hint
      follows the tick live.
    - `SignOutKitGuard`: a remount starts with no error and no kit (fresh flow).
    - `SignOutHost`:
      - exactly one child per phase;
      - the overlay shows only in `signing-out`;
      - `isAuthenticated` going false calls `abandonSignOut`.
    - `TrustDeviceModal` renders on `layer="top"`. `RecoveryKitPromptModal` and
      `SignOutKitGuard` stay on 'base'.
    - `App.vue` handlers: both trust answers set the per-sign-in latch.
11. **E2E:** none added (25-test budget). Run the full suite with `run-e2e`, because create
    now writes global trust. `e2e/helpers/auth.ts:151-160` already tolerates the trust
    modal.
12. **Browser, both modes, ~400px and desktop:**
    - Create, tick the kit, sign out with the tick checked, then sign back in with the PIN.
    - On the confirm, untick and cancel: trust is unchanged.
    - Untick and sign out: the guard appears. Try all three outcomes.
    - "Create Recovery Kit" while offline shows not-synced and stays signed in.
    - Clear-data shows the guard.
    - A second browser profile signing in by magic link is asked to trust first, even with
      the what's-new drawer due.
    - The mobile menu opens the same confirm.
13. **Device (greg):** repeat the prod repro on iOS after release.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted:
  - trust-on-create in `createNewFile`;
  - `via` on kit confirmation;
  - a shared `useSignOut` and a guard decision;
  - reuse of `RecoveryKitPromptModal`;
  - honest copy and docs.
- **Pass 2 (DRY + error handling)**:
  - Telemetry moved onto the `loginFlowEvents` facade with allowlisted keys (4 of the 5
    proposed keys weren't allowlisted).
  - The kit-copy signal fixed: it reset after 2 seconds, so it now uses `useClipboard`
    plus a sticky flag.
  - The guard now requires a durable kit push.
  - The duplicated generate/stored code extracted into `useRecoveryKitFlow`.
  - The demo exemption reuses `suppressRemoteSideEffects`, and `force` is kept.
  - The tier check is derived from the step lists, with the decision placed in
    `authPrompts.ts`.
  - `useSignOut` is promise-based with a catch.
  - The guard is scoped to the menu surfaces.
  - Existing strings reused.
  - The "regenerate inerts" claim corrected; `via` never downgrades.
- **Pass 3 (Sustainability)**:
  - Restored the dropped `isConfirming` double-mint guard.
  - Not-synced retries re-push instead of minting another kit.
  - The mode-prop modal became a propless renderer (renamed `SignOutHost` in Pass 4).
  - `useSignOut` uses a single `phase` state, wraps its whole body in one catch, returns
    a typed outcome, and owns all guard telemetry (duplicate outcome events dropped).
  - Key-dropping steps are named once in `KEY_MATERIAL_STEPS`.
  - Trust-on-create is extracted into a helper that never throws.
  - `markRecoveryKitConfirmed(via)` requires its argument.
- **Revision 2 (greg's follow-up)**: added trust-on-join, always-ask on other new
  devices, the sign-out trust tick shared by desktop and mobile, and one shared trust
  action. Passes 2-4 re-run below.
- **Pass 4 (Fresh-eyes sweep)**:
  - Traced and confirmed the return path: the trusted steps keep the roster, the PIN wrap
    and the auto-open wrap, so sign-in lands on auto-open or the PIN.
  - Exempted the demo from the guard.
  - Aligned the legacy rule with Q2 (password-era families count as saved).
  - One `SignOutHost` now owns the guard and the single progress overlay (removes a
    desktop double overlay).
  - Sign-out failures report once, through the error toast.
  - Trust-on-create records the earlier trust state.
  - The 2026-08-28 warning is marked partly covered.
  - Stale "a new kit disables the old one" comments are fixed, and the no-downgrade rule
    is tied to #99.
  - The Help Center target is corrected, and the failed-create and demo tests are
    pinned.
- **Pass 2 (round 2)**: Folded Revision 2 into the requirements and approach.
  - One `authStore.setDeviceTrust(trusted, source)`, which shows and reports its own
    failure, drives create, join, the prompt, Settings and the sign-out tick. Join trust
    sits in `joinFamily` after the claim.
  - The trust question comes first in the chain and is exempt from the interruption slot.
    Tier-3 and Settings clear-data now re-arm it, and the demo marks it answered.
  - The confirm moved from AppHeader into `SignOutHost` and is shared with mobile. The tick
    is applied on Sign Out, with a live hint.
  - A new `AuthPromptModal` shell de-duplicates the trust, kit-nag and guard modals.
  - Telemetry is consolidated on the facade, and the fatal clear-data bare catch now
    reports.
- **Pass 3 (round 2)**:
  - Only the trust flag write decides success; the key cache is best-effort, so a cache
    failure no longer reports a false failure or aborts sign-out.
  - Trust failures now leave one telemetry record instead of two.
  - `SignOutHost` split into a switcher plus `SignOutConfirm` and `SignOutKitGuard`, each
    mounted with `v-if`, so no reset watchers are needed.
  - `useSignOut` flattened into named early-return helpers, with a test reset hook and
    `abandonSignOut` for a lost session.
  - Confirmed there is no new store cycle, and the trust exemption stays one descriptor
    field.
- **Pass 4 (round 2)**:
  - The guard is decided synchronously from the tick's chosen trust, and the tick is
    applied only after the guard. This closes a double-tap race and stops a dismissed
    guard from leaving the device untrusted.
  - The trust modal is on the 'top' layer with `PwaReinstallModal` mounted before it, so
    the wizard and the PWA modal can no longer hide it.
  - Both trust answers latch the sign-in.
  - The guard skips families with a recovery passphrase.
  - Documented that "Start over" and Google disconnect now inherit the trusted tier.
  - Fixed the stale `trust.hint`.
  - Named the `dataClearingSecurity` assertions to invert.
- **Pass 5 (verification, Fable 5.1)**: re-checked every file:line claim against HEAD
  `85365ee2`.
  - The guard now resolves the member from `authStore.currentUser.memberId` (as the prompt
    watcher does), not `familyStore.currentMember`, which can be null over a loaded roster.
  - `setDeviceTrust` uses `useTranslationStore().t`; `showToast`'s second argument is
    the title.
  - Requirement 3 now matches Pass 3: only the flag write decides success.
  - Confirmed 'top' is the documented tier for stacking above the onboarding wizard.
  - Added an Implementation Order and a String Table.

## Implementation Notes (2026-09-23, build + two review rounds)

Built as planned, with these deviations, each from a verified review finding or browser check:

- **The guard's "saved" rule is now `recoveryKitConfirmedVia === 'saved'` plus
  `hasColdOpenCredential`**, read from the ENVELOPE (a password wrap in `wrappedKeys` or a
  `recoveryPassphrase`, exactly what `tryUnwrapFamilyKey` tries cold). This replaced
  `hasKitSavedSignal`, which inferred cold-open ability from the doc's `passwordHash` and so
  (a) told a password-era owner who later ticked past a new kit they would "lose access
  forever", and (b) could trust a `passwordHash` whose wrap was gone. greg's Q2 still holds:
  password-era envelopes carry password wraps.
- **The guard has a visible Cancel** (a phone has no Escape key) and **stays open while the
  kit is pushing**, primary reading "Saving your kit..." (`recovery.kitSaving`, new) with
  every action disabled. Hiding it left the user on the plain app for up to the save timeout.
- **No trust tick in the App Review demo**, and `applyTrustTick` no-ops there.
- **Failure reports** for the trust write and sign-out go straight to `reportError`
  (`severity: 'critical'`: a user action failed) with a stable message, plus a silent toast,
  because the toast's own report is skipped while an identical toast is live.
- **`useClipboard` takes an optional `action`** (`context.action`), so kit-copy failures are
  filterable as `kit_copy_failed`.
- **Warning lines are Heritage Orange as `text-primary-700`** (AA on white), not Alert Red.
- **Accepted, not changed:** the double key cache on create (plan); and the residual where a
  guard kit confirmed with a failed push, then cancelled, leaves a local `saved` stamp ahead
  of the file (narrow: offline, cancel, then an offline untrusted sign-out).

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-23)

> I've just created a family called "test new flow 4" in production to test the new login
> flow and magic link / qr code changes. I didn't save the recovery kit, and logged out
> once (without clearing data) but was not able to login again as i hit the decrypt data
> step on login. 2 questions here:
>
> 1. When logging out without clearing data, is it expected that you still need to decrypt
>    the file when logging back in? Or is that a bug? My expectation is that you only need to
>    decryupt the file when you clear data on logout, but i could be wrong
>
> 2. If this is indeed the case - in the case that a new family member (the first member /
>    pod owner) is logging out for the first time, and no other family members exist, should
>    we give one final confirmation to ask the user if they have saved the recovery kit -
>    because if not, they will not be able to retrieve their pod again and will be locked out
>    of the pod forever. now that we don't have passwords, this is the danger of not saving
>    the recovery kit and not having any other method to decrypt the file other than the
>    recovery, which somebody could choose not to save. how would you propose we address
>    this?
>
> as an aside, can yo uplease remove all traces of the new family test new flow 4 from the
> system, registry, etc - i cannot login anymore and it is a test family whic hshould not
> impact our metrics. pls also check if otehr test families (stale, created by me, almost
> no activity, test in the name, etc) are in the production registry and remove them.

### Follow-up 1 (2026-09-23)

> Go ahead to remove all the test families in your table above as well as the first one on
> your list above (example.com) but leave the other two.
>
> Fully agree to trust the creating service by default and let's do that without fail and
> create tests to pin that so it never changes.
>
> Also agree to add the guard and fix this copy, but for the guard do not over explain to
> the user - just very simply say that we did not detect you saving the recovery kit,
> please create one before signing out otherwise you will lose access to your family file
> forever. Go ahead to take this through beanies plan

### Follow-up 2 (2026-09-23)

> Looks good and one thing to add - for any new device (aside from the pod creation
> device), at the first sign-in, pls make sure we _always_ ask the user if the device is
> trusted.
>
> q1) yes let's have joined devices be trusted also
> q2) ok 3) that is ok to reuse
>
> -> One more thing, since logging out on a trusted device vs logging out on a
> non-trusted device has a separate action which is not clear at logout time, i'd also
> like to add a tick to the logout modal (something like "trust this device so i can
> login again") which clearly reflects the trusted device status (i.e. if trusted then
> the box is checked, otherwise it is not checked). does this make sense and what do you
> think of this approach?

### Follow-up 3 (2026-09-23)

> agree with both, go ahead

(Agreeing to: mobile gets the shared sign-out confirm; one shared trust action for every surface.)

### Follow-up 4 (2026-09-23)

> review the plan once more with fable and ensure everything is correct and accurate, make
> any adjustments as needed to ensure the plan is complete and precise to help improve
> implementation accuracy. make any adjustments to the plan as needed and show me the plan
> once done.

</details>
