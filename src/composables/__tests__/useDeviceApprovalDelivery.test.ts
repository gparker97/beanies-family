/**
 * The delivery gate's contract.
 *
 * ⚠️ THIS FILE IS THE REASON THE GATE IS A COMPOSABLE. The same logic lived inline in
 * `App.vue` twice, and both versions shipped a defect that only a review caught — because
 * nothing in this repo mounts `App.vue`, so neither version could be tested at all. Every
 * test below corresponds to a specific way one of those drafts was wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, effectScope, nextTick } from 'vue';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { useDeviceApprovalDelivery } from '../useDeviceApprovalDelivery';
import { APPROVAL_EXPIRY_MS } from '@/services/crypto/deviceApproval';

/** Run a composable inside a scope, the way a component would. */
function withSetup<T>(fn: () => T): { result: T; stop: () => void } {
  const scope = effectScope();
  const result = scope.run(fn)!;
  return { result, stop: () => scope.stop() };
}

function messages(): string[] {
  return logEvent.mock.calls.map((c) => (c[0] as { message: string }).message);
}

/** The two refs the gate now takes, for the common "already signed in" case. */
function session(familyId: string, memberId: string) {
  return {
    familyId: ref<string | null | undefined>(familyId),
    memberId: ref<string | null | undefined>(memberId),
    // Signed in here, which is what every test below except the handover ones assumes.
    hasPersistedSession: () => true,
  };
}

describe('useDeviceApprovalDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a key immediately when the surface is already usable', () => {
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'warm');

    expect(result.approvalKey.value).toBe('KEY-A');
    expect(result.delivery.value).toBe('warm');
    expect(messages()).toContain('approval_key_delivered');
  });

  it('REGRESSION: holds a key while the pod is still opening, and shows it once it is', async () => {
    // The first inline version released on `!isInitializing`, which goes false BEFORE the
    // family key lands — so the sheet opened on its "you're signed out here" panel, on the
    // beanies app, and every way out of that panel destroyed the key.
    const usable = ref(false);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'cold-launch');
    expect(result.approvalKey.value).toBeNull();
    expect(messages()).toContain('approval_key_held');
    expect(messages()).not.toContain('approval_key_delivered');

    usable.value = true;
    await nextTick();

    expect(result.approvalKey.value).toBe('KEY-A');
    expect(messages()).toContain('approval_key_delivered');
  });

  it('REGRESSION: retracts the key when the surface stops being usable', async () => {
    // A fatal raised AFTER delivery buried the open sheet under FatalErrorOverlay while it
    // held the only copy of the key. Expressing the key as a computed makes that impossible.
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );
    result.deliver('KEY-A', 'warm');
    expect(result.approvalKey.value).toBe('KEY-A');

    usable.value = false;
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
  });

  it('REGRESSION: discards a held key when the family changes', async () => {
    // Sign-out is an SPA transition, so a key held before it would otherwise be released
    // into the NEXT member's session and wrap THAT family's key for a device that never
    // scanned anything.
    const usable = ref(false);
    const familyId = ref<string | null | undefined>('fam-1');
    const memberId = ref<string | null | undefined>('mem-1');
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({
        isSurfaceUsable: usable,
        familyId,
        memberId,
        hasPersistedSession: () => true,
      })
    );
    result.deliver('KEY-A', 'warm');

    familyId.value = 'fam-2';
    await nextTick();
    usable.value = true;
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'session-changed' }),
      })
    );
  });

  it('REGRESSION: discards a held key on SIGN-OUT, which clears the member but not the family', async () => {
    // A gate keyed on the family alone would hand the key to whoever signs in next. (Sign-out
    // in the real app clears the member via `resetAllAppStores()`; this drives that shape.)
    const usable = ref(false);
    const familyId = ref<string | null | undefined>('fam-1');
    const memberId = ref<string | null | undefined>('mem-1');
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({
        isSurfaceUsable: usable,
        familyId,
        memberId,
        hasPersistedSession: () => true,
      })
    );
    result.deliver('KEY-A', 'warm');

    memberId.value = undefined;
    await nextTick();
    // ⚠️ FLIP `usable` BEFORE ASSERTING. `approvalKey` is gated on `isSurfaceUsable`, so with
    // it false the assertion below holds by construction and the test passes against code
    // that emitted the drop event but left `pending` populated — releasing the key to the
    // next member on the next flip, which is the exact scenario this test is named for.
    usable.value = true;
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'session-changed' }),
      })
    );
  });

  it('REGRESSION: re-delivering the SAME key is not a supersession', () => {
    // Re-scanning is exactly what someone does when the first attempt appeared to do
    // nothing — i.e. the population where delivery is broken. Counting it as a loss would
    // make the failure metric consist mostly of people retrying.
    const usable = ref(false);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'cold-launch');
    result.deliver('KEY-A', 'warm');

    const dropped = logEvent.mock.calls.filter(
      (c) => (c[0] as { message: string }).message === 'approval_key_dropped'
    );
    expect(dropped).toHaveLength(0);
  });

  it('tags a supersession with the HELD key’s transport, not the incoming one', () => {
    const usable = ref(false);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'cold-launch');
    result.deliver('KEY-B', 'warm');

    // The key thrown away arrived cold-launch. Charging the drop to `warm` would make a
    // transport that is silently losing keys read as the healthy one.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'superseded', kind: 'cold-launch' }),
      })
    );
  });

  it('expires a held key rather than approving a request the other device abandoned', () => {
    vi.useFakeTimers();
    const usable = ref(false);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'warm');
    vi.advanceTimersByTime(APPROVAL_EXPIRY_MS + 1);

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'expired' }),
      })
    );
  });

  it('REGRESSION: a key delivered on a device with NO SESSION is not released to whoever signs in', async () => {
    // ⚠️ DELIVERED WHILE STILL BOOTING, BECAUSE THAT IS WHAT THE WEB TRANSPORT DOES.
    // `App.vue` calls `deliver(key, 'web-load')` on the FIRST line of `onMounted`, where
    // `isInitializing` and `isLoadingData` are both still true — so `isSurfaceUsable` is
    // false there, always. Two earlier versions of this test seeded `usable = ref(true)`
    // before delivering, which is a state the web path cannot produce, and both passed
    // against guards that were provably inert in production.
    //
    // The scenario: a `/welcome#beanies-approve=` link is messaged to a phone where nobody
    // has signed in. It cold-loads, the key is held, the surface settles on the "open
    // beanies to approve" panel. Somebody then signs in — by typing a PIN, or via a trusted
    // auto-open that materialises a session on its own — and must NOT be handed a live
    // fingerprint with an armed Approve for a code they never scanned.
    const usable = ref(false);
    const familyId = ref<string | null | undefined>(null);
    const memberId = ref<string | null | undefined>(null);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({
        isSurfaceUsable: usable,
        familyId,
        memberId,
        hasPersistedSession: () => false, // nobody has ever signed in here
      })
    );

    result.deliver('KEY-PHISH', 'web-load');
    usable.value = true; // the surface settles, signed out
    await nextTick();
    familyId.value = 'fam-1';
    await nextTick();
    memberId.value = 'mem-1'; // somebody signs in
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'session-changed' }),
      })
    );
  });

  it('REGRESSION: the IDENTICAL sequence on a signed-in device KEEPS the key', async () => {
    // The twin of the test above, and the reason neither can be judged alone: a cold launch
    // on a signed-in device and a handover on a signed-out one produce an identical
    // `null -> null -> 'fam:mem'` with `isSurfaceUsable` starting false. Every attempt to
    // tell them apart from reactive state failed, three times. The only thing that differs
    // at the moment the key arrives is whether this device HAS a session at all.
    const usable = ref(false);
    const familyId = ref<string | null | undefined>(null);
    const memberId = ref<string | null | undefined>(null);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({
        isSurfaceUsable: usable,
        familyId,
        memberId,
        hasPersistedSession: () => true, // signed in here; the app is just starting
      })
    );

    result.deliver('KEY-MINE', 'web-load');
    usable.value = true;
    await nextTick();
    familyId.value = 'fam-1';
    await nextTick();
    memberId.value = 'mem-1';
    await nextTick();

    expect(result.approvalKey.value).toBe('KEY-MINE');
    expect(messages()).toContain('approval_key_delivered');
    expect(messages()).not.toContain('approval_key_dropped');
  });

  it('REGRESSION: the THREE-STEP hydration App.vue actually produces does not discard a held key', async () => {
    // ⚠️ THE STEP COUNT IS THE WHOLE TEST. The previous version of this went from `null`
    // straight to a populated session in ONE step and passed against code that was broken in
    // production: 0.21.4 composed the session key as `${family ?? 'none'}:${member ?? 'none'}`,
    // which is never null, so hydration read as TWO session changes and the key was thrown
    // away at the exact moment the pod finished opening. The stores populate independently —
    // family first, member later — so anything that cannot survive an intermediate state has
    // not been tested.
    const usable = ref(false);
    const familyId = ref<string | null | undefined>(undefined);
    const memberId = ref<string | null | undefined>(undefined);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({
        isSurfaceUsable: usable,
        familyId,
        memberId,
        hasPersistedSession: () => true,
      })
    );

    result.deliver('KEY-A', 'cold-launch');
    expect(messages()).toContain('approval_key_held');

    familyId.value = 'fam-1'; // step 1: family store initialises
    await nextTick();
    memberId.value = 'mem-1'; // step 2: member resolves, LATER
    await nextTick();
    usable.value = true; // step 3: the pod finishes opening
    await nextTick();

    expect(result.approvalKey.value).toBe('KEY-A');
    expect(messages()).toContain('approval_key_delivered');
    expect(messages()).not.toContain('approval_key_dropped');
  });

  it('expires a key that is on screen, not just one being held', () => {
    // The requesting device stops polling after its own window regardless, so a sheet left
    // open past it could still publish a wrap against a request nobody is waiting on.
    vi.useFakeTimers();
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );

    result.deliver('KEY-A', 'warm');
    expect(result.approvalKey.value).toBe('KEY-A');
    vi.advanceTimersByTime(APPROVAL_EXPIRY_MS + 1);

    expect(result.approvalKey.value).toBeNull();
  });

  it('dismiss clears the key AND reports it, so the funnel closes', () => {
    // It used to clear silently — a copy of `discard`'s body minus the emit — so a key
    // abandoned at the backdrop left `approval_key_held` with no terminal entry and the drop
    // rate could not be computed.
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, ...session('fam-1', 'mem-1') })
    );
    result.deliver('KEY-A', 'warm');

    result.dismiss();

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'dismissed' }),
      })
    );
  });
});
