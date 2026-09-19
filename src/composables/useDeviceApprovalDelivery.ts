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
  emitApprovalKeyDropped,
  emitApprovalKeyHeld,
  type DeliveryKind,
} from '@/services/telemetry/deepLinkEvents';

interface Pending {
  key: string;
  /**
   * How it arrived. Carried on the SAME object as the key, never as a parallel ref — a
   * buffered deep-link key released while a separate flag read `in-app-scan` would skip the
   * interstitial for exactly the key that interstitial exists to gate.
   */
  delivery: DeliveryKind;
  /** For the TTL. A request the other device has already abandoned must not be approved. */
  arrivedAt: number;
}

export interface DeviceApprovalDelivery {
  /** The key to show, or null. Null whenever the surface cannot act on it. */
  approvalKey: ComputedRef<string | null>;
  /** How the visible key arrived. Drives the interstitial; null when nothing is shown. */
  delivery: ComputedRef<DeliveryKind | null>;
  /** A key arrived, from any transport. */
  deliver: (key: string, delivery: DeliveryKind) => void;
  /** The user closed the sheet. */
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
   * A key held across sign-out or a family switch belongs to nobody here.
   *
   * ⚠️ `prev != null` IS LOAD-BEARING, and it only means what it says because `sessionKey` is
   * genuinely null before hydration. `activeFamilyId` starts null and is only assigned by
   * `familyContextStore.initialize()`, which runs LONG after a deep link is delivered — so
   * without this guard the very first hydration (null -> 'fam-x:mem-y') reads as a session
   * change and discards the key at precisely the moment the pod finishes opening. That killed
   * both cold paths and produced the exact 0.21.3 signature: a `held` event, a `dropped`
   * event, and no `delivered` event ever.
   */
  watch(sessionKey, (next, prev) => {
    if (prev != null && next !== prev) discard('session-changed');
  });

  function deliver(key: string, kind: DeliveryKind): void {
    const existing = pending.value;
    if (existing) {
      if (existing.key === key) {
        // A re-scan of the SAME code — which is exactly what someone does when the first
        // attempt appeared to do nothing. Not a supersession; counting it as one would make
        // the failure metric consist mostly of people retrying.
        return;
      }
      // Tagged with the HELD key's transport, not the incoming one: the entry being thrown
      // away is the old one, and mis-attributing it makes a transport that is silently
      // losing keys read as the healthy one.
      emitApprovalKeyDropped({ delivery: existing.delivery, errorCode: 'superseded' });
    }
    clearTimer();
    announced = false;
    pending.value = { key, delivery: kind, arrivedAt: Date.now() };

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
   * ⚠️ ROUTES THROUGH `discard`, AND THAT IS THE FIX, NOT A TIDY-UP. This was a copy of
   * `discard`'s body minus the emit, so a key abandoned by tapping the backdrop or the X
   * vanished with NO terminal event at all — `approval_key_held` and `approval_key_delivered`
   * had no closing entry and the funnel did not add up.
   *
   * A Reject tap produces both `device_approval_outcome: rejected` and
   * `approval_key_dropped: dismissed`. The former is the authoritative one.
   */
  function dismiss(): void {
    discard('dismissed');
  }

  onScopeDispose(clearTimer);

  return { approvalKey, delivery, deliver, dismiss };
}
