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

describe('useDeviceApprovalDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a key immediately when the surface is already usable', () => {
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
    );
    result.deliver('KEY-A', 'warm');
    expect(result.approvalKey.value).toBe('KEY-A');

    usable.value = false;
    await nextTick();

    expect(result.approvalKey.value).toBeNull();
  });

  it('REGRESSION: discards a held key when the session changes', async () => {
    // Sign-out is an SPA transition, so a key held before it would otherwise be released
    // into the NEXT member's session and wrap THAT family's key for a device that never
    // scanned anything.
    const usable = ref(false);
    const session = ref<string | null>('fam-1');
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: session })
    );
    result.deliver('KEY-A', 'warm');

    session.value = 'fam-2';
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

  it('REGRESSION: re-delivering the SAME key is not a supersession', () => {
    // Re-scanning is exactly what someone does when the first attempt appeared to do
    // nothing — i.e. the population where delivery is broken. Counting it as a loss would
    // make the failure metric consist mostly of people retrying.
    const usable = ref(false);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
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
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
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

  it('REGRESSION: the very first session hydration does not discard a held key', async () => {
    // `activeFamilyId` starts null and is only assigned when the family store initialises,
    // which happens LONG after a deep link is delivered. Treating that null -> id as a
    // session change discarded the key at the exact moment the pod finished opening, and
    // produced the 0.21.3 signature: held, dropped, never delivered.
    const usable = ref(false);
    const session = ref<string | null>(null);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: session })
    );

    result.deliver('KEY-A', 'cold-launch');
    session.value = 'fam-1';
    await nextTick();
    usable.value = true;
    await nextTick();

    expect(result.approvalKey.value).toBe('KEY-A');
    expect(messages()).toContain('approval_key_delivered');
  });

  it('expires a key that is on screen, not just one being held', () => {
    // The requesting device stops polling after its own window regardless, so a sheet left
    // open past it could still publish a wrap against a request nobody is waiting on.
    vi.useFakeTimers();
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
    );

    result.deliver('KEY-A', 'warm');
    expect(result.approvalKey.value).toBe('KEY-A');
    vi.advanceTimersByTime(APPROVAL_EXPIRY_MS + 1);

    expect(result.approvalKey.value).toBeNull();
  });

  it('dismiss clears the key without reporting a loss', () => {
    const usable = ref(true);
    const { result } = withSetup(() =>
      useDeviceApprovalDelivery({ isSurfaceUsable: usable, sessionKey: ref('fam-1') })
    );
    result.deliver('KEY-A', 'warm');

    result.dismiss();

    expect(result.approvalKey.value).toBeNull();
    expect(messages()).not.toContain('approval_key_dropped');
  });
});
