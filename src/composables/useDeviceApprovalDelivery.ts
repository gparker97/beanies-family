/**
 * Holds an inbound device-approval key until the app can actually act on it.
 *
 * ⚠️ WHY THIS IS NOT A FEW LINES IN `App.vue`. It was, twice, and both versions were wrong
 * in ways that only a review caught:
 *
 *   1. Gating on `!isInitializing` looks right and is not. `isInitializing` goes false at
 *      "dismiss the full-screen spinner", which runs BEFORE `loadFamilyData()` — the only
 *      path to a family key or a current member. So the sheet opened on its `!canApprove`
 *      branch ("open the beanies app and try scanning again from there") ON the beanies
 *      app, visible and tappable for the whole data load. Every way out of that panel
 *      clears the key, and the held copy was already gone: the fix made the sheet visible
 *      and then destroyed the key.
 *   2. `isInitializing === false` also means "init STOPPED", not "init succeeded". Three of
 *      its four assignment sites are failure or early-return paths, and releasing into
 *      those puts the sheet under `FatalErrorOverlay` (`z-[300]` against the sheet's
 *      `z-50`) where it is invisible, unreachable, and holding the only key.
 *
 * So the gate takes a single `isSurfaceUsable` boolean IN and hands a key OUT. It knows
 * nothing about stores, initialisation, or overlays — which is what makes it testable at
 * all, and `App.vue` is the one place in this repo no test can mount.
 *
 * ⚠️ SETUP-SCOPED, AND THAT IS NOT THE SAME AS SESSION-SCOPED. `App.vue` never unmounts, so
 * setup scope removes the cross-TEST leak, not the cross-SESSION one. Sign-out is an SPA
 * transition, not a reload, so without an explicit reset a key held before sign-out would be
 * released into the NEXT member's session and wrap THAT family's key for a device that
 * never scanned anything. The session identity below is what closes that, and it is
 * load-bearing.
 *
 * ⚠️ THE SESSION IDENTITY IS DERIVED HERE, NOT PASSED IN, AND THAT IS THE WHOLE POINT.
 * This gate previously took a ready-made `sessionKey: Ref<string | null>` where `null` meant
 * "not hydrated yet". `App.vue` then composed it as
 * `` `${familyId ?? 'none'}:${memberId ?? 'none'}` `` — a string that is NEVER null. Every
 * hydration step ('none:none' -> 'fam:none' -> 'fam:mem') therefore read as a session change,
 * and the discard below threw the key away at the exact moment the pod finished opening. That
 * shipped in 0.21.4 and reproduced the original 0.21.3 signature exactly: held, dropped,
 * never delivered.
 *
 * The contract now lives with the guard that depends on it, so a call site cannot break it:
 * the two ids go in, and `null` means exactly one thing — NO IDENTIFIABLE SESSION HERE.
 *
 * | transition                                   | derived key                    | behaviour        |
 * | -------------------------------------------- | ------------------------------ | ---------------- |
 * | cold launch (∅,∅) -> (fam,∅) -> (fam,mem)    | null -> null -> 'fam:mem'      | key SURVIVES     |
 * | sign-out (fam,mem) -> (fam,∅)                | 'fam:mem' -> null              | discard          |
 * | switch person (fam,m1) -> (fam,∅) -> (fam,m2)| 'fam:m1' -> null -> 'fam:m2'   | discard on step 1|
 *
 * A *momentary* loss of either id (a member re-read, say) is deliberately treated as a
 * session exit and discards the key. That is the conservative direction, and it is the only
 * one that keeps the sign-out guarantee intact.
 */
import { ref, computed, watch, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import { APPROVAL_EXPIRY_MS } from '@/services/crypto/deviceApproval';
import {
  emitApprovalKeyDelivered,
  emitApprovalKeySettled,
  emitApprovalKeyDropped,
  emitApprovalKeyHeld,
  type DeliveryKind,
} from '@/services/telemetry/deepLinkEvents';

interface Pending {
  key: string;
  /**
   * How it arrived. Carried on the SAME object as the key, never as a parallel ref — a
   * buffered deep-link key released while a separate flag read `in-app-scan` would skip the
   * provenance warning for exactly the key that warning exists to gate.
   */
  delivery: DeliveryKind;
  /** For the TTL. A request the other device has already abandoned must not be approved. */
  arrivedAt: number;
  /**
   * The approval has been acted on; only the panel saying so is still on screen.
   *
   * ⚠️ A FLAG RATHER THAN CLEARING `pending`, because the sheet's visibility is DERIVED from
   * the held key — clearing it would yank the "Device Approved" panel off screen the instant
   * it appeared. What has to stop is the TTL, not the panel.
   */
  settled: boolean;
  /**
   * Nobody was signed in ON THIS DEVICE when the key arrived.
   *
   * ⚠️ READ FROM DURABLE STORAGE, NOT FROM REACTIVE STATE, AND THAT IS THE ENTIRE POINT.
   * The question — "may this key be handed to whoever signs in next?" — has now been got
   * wrong three times, every time by trying to infer it from state that has not hydrated
   * yet at the moment a key arrives:
   *
   *   1. `prev != null` on the session key could not tell a cold launch from a handover;
   *      both produce `null -> 'fam:mem'`.
   *   2. A `seenSession` latch seeded at setup was always false, because both store refs
   *      are `null` at App.vue setup on every page load.
   *   3. `isSurfaceUsable && sessionKey === null` was always FALSE on web, because the
   *      web transport delivers at the top of `onMounted` where `isInitializing` and
   *      `isLoadingData` are both still true.
   *
   * Each of those had a passing test, and each test passed only by seeding an initial state
   * production cannot produce. The persisted auth session has none of that problem: it is
   * written by `persistSession`, removed by `clearSession`, and readable synchronously and
   * correctly at any moment, including the first line of `onMounted`.
   *
   *   - SIGNED IN (or previously signed in and returning): a session record exists, this is
   *     false, and a key arriving during a cold launch survives into the session about to
   *     rehydrate. That is the 0.21.3/0.21.4 bug and it stays fixed.
   *   - NOBODY SIGNED IN: no record, this is true, and the key is destroyed the moment
   *     anyone signs in — including via a trusted auto-open, which would otherwise
   *     materialise a session with nobody having typed anything.
   */
  arrivedSignedOut: boolean;
}

export interface DeviceApprovalDelivery {
  /** The key to show, or null. Null whenever the surface cannot act on it. */
  approvalKey: ComputedRef<string | null>;
  /** How the visible key arrived. Drives the provenance warning; null when nothing shown. */
  delivery: ComputedRef<DeliveryKind | null>;
  /** A key arrived, from any transport. */
  deliver: (key: string, delivery: DeliveryKind) => void;
  /** The approval was acted on. Stops that key's TTL and books it out of the funnel. */
  settle: (key: string, outcome: 'approved' | 'unconfirmed') => void;
  /** The sheet closed. Counts a loss only if the key had not already been settled. */
  dismiss: () => void;
}

export function useDeviceApprovalDelivery(opts: {
  /** True only when a key could be acted on right now: pod open, member known, no fatal. */
  isSurfaceUsable: Ref<boolean>;
  /**
   * The open family, straight from the store. Pass the raw value — do NOT pre-compose it
   * with `memberId`, and do NOT substitute a placeholder for a missing one. See the header.
   */
  familyId: Ref<string | null | undefined>;
  /**
   * The signed-in member, straight from the store.
   *
   * ⚠️ FAMILY **AND** MEMBER. `activeFamilyId` alone is not a session: nothing in sign-out or
   * switch-person clears it (`clearSession` touches auth state only), so a key held on one
   * person's screen survived Switch Person and landed the NEXT person straight on a live
   * fingerprint panel for something they never scanned.
   */
  memberId: Ref<string | null | undefined>;
  /**
   * Is there a persisted auth session on this device, right now?
   *
   * Injected rather than imported so the gate stays free of store singletons and so a test
   * can drive both answers from the initial state production actually has. App.vue supplies
   * the real read.
   */
  hasPersistedSession: () => boolean;
  /**
   * Called when a key that was ON SCREEN expires.
   *
   * ⚠️ Without this, arming the TTL for shown keys made the fingerprint panel simply vanish
   * mid-comparison with no explanation — and if it fired while the PIN prompt was up, the
   * person finished typing and got nothing at all, logged as a "dismissal" they never made.
   */
  onShownExpired?: () => void;
}): DeviceApprovalDelivery {
  const pending = ref<Pending | null>(null);
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let announced = false;

  function clearTimer(): void {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  function discard(errorCode: string): void {
    const p = pending.value;
    if (!p) return;
    clearTimer();
    pending.value = null;
    announced = false;
    // ⚠️ A SETTLED KEY IS ALREADY BOOKED OUT. It has an `approval_key_settled` entry, so
    // emitting a drop here too would give one key two terminal events and re-inflate the
    // exact ratio this work set out to make meaningful. Reached by a sign-out, a session
    // rejection, or a new key arriving while the "Device Approved" panel is still up.
    if (p.settled) return;
    emitApprovalKeyDropped({ delivery: p.delivery, errorCode });
  }

  /**
   * ⚠️ A COMPUTED, NOT A RELEASE WATCHER. "Close the sheet when the surface goes unusable"
   * is the same statement as "open it when the surface is usable", so expressing it once as
   * a derived value means there is no retraction path to get wrong, and no window in which
   * the buffer and the visible key disagree.
   */
  const approvalKey = computed(() =>
    opts.isSurfaceUsable.value && pending.value ? pending.value.key : null
  );
  const delivery = computed(() =>
    opts.isSurfaceUsable.value && pending.value ? pending.value.delivery : null
  );

  /**
   * Success is counted when the key becomes ACTIONABLE, not when it was handed over.
   * Counting the hand-off would count buffering, which is how a feature that delivered
   * nothing to anyone still reported a healthy rate in 0.21.3.
   */
  watch(
    approvalKey,
    (key) => {
      if (key === null || announced) return;
      announced = true;
      // ⚠️ The TTL is deliberately NOT cleared here. The requesting device stops polling
      // after `APPROVAL_EXPIRY_MS` whatever this one does, so a sheet left open past that
      // can still be approved — publishing a wrap against a request nobody is waiting on,
      // and telling the approver "Device Approved" for a sign-in that will never happen.
      emitApprovalKeyDelivered({ delivery: pending.value?.delivery ?? 'web-load' });
    },
    { flush: 'sync' }
  );

  /**
   * Who this key belongs to. `null` until BOTH ids are known — see the header for why that
   * nullability is derived here rather than accepted from a caller.
   */
  const sessionKey = computed(() => {
    const family = opts.familyId.value;
    const member = opts.memberId.value;
    return family && member ? `${family}:${member}` : null;
  });

  /**
   * A key that belongs to nobody here is destroyed rather than handed over.
   *
   * ⚠️ TWO SEPARATE QUESTIONS, AND MERGING THEM IS WHAT KEPT GOING WRONG.
   *
   * The first is "did the session CHANGE?" — a switch person or a different family. Plain
   * inequality answers it.
   *
   * The second is "did this key arrive before anyone was signed in, and if so was that
   * because the app was still booting, or because nobody is signed in on this device?"
   * Transition history cannot answer that: `null -> 'fam:mem'` looks identical either way.
   * Two attempts tried anyway — `prev != null` alone released a phished link to the next
   * member, and a `seenSession` latch was inert in production because both store refs are
   * null at App.vue setup on every page load. The answer is recorded per key at arrival
   * instead, as `arrivedSignedOut`. See `Pending`.
   *
   * ⚠️ SIGN-OUT DOES NULL `currentMemberId`, VIA `resetAllAppStores()`. An earlier version of
   * this comment claimed otherwise; every sign-out control (`AppHeader`,
   * `MobileHamburgerMenu`, `SettingsPage`) calls it, and `resetStores.ts` calls
   * `familyStore.resetState()`. So the `next === null` branch IS the sign-out path, and a key
   * held across one is discarded there. The `next !== prev` branch covers switch-person and a
   * family switch on top of that.
   */
  watch(sessionKey, (next, prev) => {
    if (next === null) {
      // Leaving a known session: sign-out, or switch-person's intermediate step.
      if (prev != null) discard('session-changed');
      return;
    }
    // A session appeared or changed.
    if (prev != null && next !== prev) {
      discard('session-changed'); // switch person, or a different family
    } else if (pending.value?.arrivedSignedOut) {
      // First session in this scope, and the key arrived before it on a surface that was
      // already settled — so it belongs to whoever was handed the link, not to whoever just
      // signed in. Handing it over would show them a live fingerprint and an armed Approve
      // for a code they never scanned.
      discard('session-changed');
    }
  });

  function deliver(key: string, kind: DeliveryKind): void {
    const existing = pending.value;
    if (existing) {
      if (existing.key === key) {
        // A re-scan of the SAME code — which is exactly what someone does when the first
        // attempt appeared to do nothing. Not a supersession; counting it as one would make
        // the failure metric consist mostly of people retrying.
        //
        // ⚠️ BUT RE-SAMPLE THE PROVENANCE. Someone may have signed out between the two
        // arrivals, and freezing the first answer would keep a key marked "this device had
        // a session" after it stopped having one. Narrowing only: it can go false -> true.
        existing.arrivedSignedOut ||= !opts.hasPersistedSession();
        return;
      }
      // Tagged with the HELD key's transport, not the incoming one: the entry being thrown
      // away is the old one, and mis-attributing it makes a transport that is silently
      // losing keys read as the healthy one.
      // Not a loss if it already did its job — see `discard`.
      if (!existing.settled) {
        emitApprovalKeyDropped({ delivery: existing.delivery, errorCode: 'superseded' });
      }
    }
    clearTimer();
    announced = false;
    pending.value = {
      key,
      delivery: kind,
      arrivedAt: Date.now(),
      // Read at ARRIVAL, from storage rather than from stores that have not hydrated.
      arrivedSignedOut: !opts.hasPersistedSession(),
      settled: false,
    };

    // Armed for EVERY key, shown or held, and measured from arrival — the other device's
    // window runs from when IT minted the code, not from when this one got round to it.
    expiryTimer = setTimeout(() => {
      const wasShown = opts.isSurfaceUsable.value && pending.value !== null;
      discard('expired');
      if (wasShown) opts.onShownExpired?.();
    }, APPROVAL_EXPIRY_MS);

    if (!opts.isSurfaceUsable.value) {
      // The arrival denominator. Without it a native scan that is held and never released
      // produces no `deep-link` event at all, so the drop RATE is unmeasurable.
      emitApprovalKeyHeld({ delivery: kind });
    }
  }

  /**
   * The sheet closed. `consumed` says whether the key had already done its job.
   *
   * ⚠️ THE FLAG IS THE WHOLE POINT, AND ITS ABSENCE MADE THE METRIC WORSE THAN THE SILENCE
   * IT REPLACED. `dismiss()` originally cleared the key with no event at all, so
   * `approval_key_held` had no terminal entry. Routing it through `discard('dismissed')`
   * closed that — and opened a worse one: the sheet's ONE close handler is also how a
   * SUCCESSFUL approval is dismissed ("Done" on the approved panel emits the same `close`),
   * so every healthy approval also logged a WARN-level drop. `dropped / held` then reads
   * ~100% on perfectly healthy traffic and cannot distinguish abandonment from success,
   * which is exactly the question it exists to answer.
   *
   * A Reject tap produces both `device_approval_outcome: rejected` and
   * `approval_key_dropped: dismissed`. The former is the authoritative one.
   */
  function dismiss(): void {
    // A key that already did its job was booked out by `settle()`; counting it again here is
    // what made the drop rate read ~100% on healthy traffic.
    if (pending.value?.settled) {
      clearTimer();
      pending.value = null;
      announced = false;
      return;
    }
    discard('dismissed');
  }

  /**
   * The approval has been acted on. Stops the TTL and books the key out of the funnel.
   *
   * ⚠️ CALLED THE MOMENT THE PUBLISH RESOLVES, NOT WHEN THE SHEET CLOSES. Hanging this off
   * the close handler meant it never ran for the case it was written for: approve, then put
   * the phone down — the entire point being that the OTHER device is now signing in. The
   * timer armed at arrival then fired under the "Device Approved" panel, logged an `expired`
   * drop for a healthy approval, pulled the panel off screen and toasted "that sign-in code
   * expired, ask for a new one".
   *
   * ⚠️ `'unconfirmed'` IS NOT SILENT. Folding it in with `'approved'` lost the terminal entry
   * for the one outcome the three-state publish exists to measure — a wrap that may never
   * have landed. It is not a `dropped` either: nothing was lost and the write may well
   * arrive. It gets its own level and its own code.
   */
  function settle(key: string, outcome: 'approved' | 'unconfirmed'): void {
    const p = pending.value;
    // ⚠️ KEY-SCOPED, BECAUSE THE CALLER CAN BE A GENERATION BEHIND. A publish may be in
    // flight for up to the credential budget, and a second approval link arriving inside it
    // replaces `pending`. An unscoped settle would then disarm the SUCCESSOR's TTL and book
    // the successor out of the funnel — letting it be approved long after its window closed,
    // which is the very hazard the expiry exists to prevent, and losing its abandonment
    // count. Same cross-generation mix-up the sheet's own generation guard exists to stop.
    if (!p || p.key !== key || p.settled) return;
    clearTimer();
    p.settled = true;
    emitApprovalKeySettled({ delivery: p.delivery, outcome });
  }

  onScopeDispose(clearTimer);

  return { approvalKey, delivery, deliver, dismiss, settle };
}
