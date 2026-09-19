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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, familyId, memberId })
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
    // `clearSession` touches auth state only, so `activeFamilyId` SURVIVES a sign-out. A gate
    // keyed on the family alone would hand the key to whoever signs in next.
    const usable = ref(false);
    const familyId = ref<string | null | undefined>('fam-1');
    const memberId = ref<string | null | undefined>('mem-1');
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, familyId, memberId })
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

  it('REGRESSION: a key buffered while SIGNED OUT is not released to whoever signs in next', async () => {
    // `isSurfaceUsable` is true on a settled, signed-out surface — that is what the sheet's
    // "open beanies to approve" panel is for. A link arriving there belongs to nobody, and
    // `prev != null` alone could not tell that apart from a cold launch, so it was handed to
    // the next member to sign in: a live fingerprint and an Approve button for a code they
    // never scanned.
    const usable = ref(true);
    const familyId = ref<string | null | undefined>('fam-1');
    const memberId = ref<string | null | undefined>('mem-1');
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, familyId, memberId })
    );

    // Sign out: family survives, member does not.
    memberId.value = undefined;
    await nextTick();

    // A link arrives on the signed-out-but-usable surface.
    result.deliver('KEY-A', 'warm');

    // Someone else signs in.
    memberId.value = 'mem-2';
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'session-changed' }),
      })
    );
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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, familyId, memberId })
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
