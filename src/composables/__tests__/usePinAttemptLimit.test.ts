/**
 * The PIN brute-force limit (#80 review).
 *
 * Two surfaces failed the same way and this composable exists to make that structural:
 * the wall pad's budget lived in component refs under a `v-if`, so closing the challenge
 * reset it; the step-up challenge — the boundary guarding transfer-ownership,
 * remove-member and clear-all-data — had no budget at all.
 *
 * The load-bearing property is therefore SURVIVAL, not merely "a limit exists": a test
 * that only counts five failures in one continuous scope would have passed against the
 * broken code too.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import {
  usePinAttemptLimit,
  __resetPinAttemptsForTests,
  PIN_COOLDOWN_MS,
} from '@/composables/usePinAttemptLimit';
import { MAX_PIN_ATTEMPTS } from '@/services/auth/deviceUnlock';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
import { logEvent } from '@/services/telemetry/logEvent';

beforeEach(() => {
  __resetPinAttemptsForTests();
  vi.mocked(logEvent).mockClear();
});

function exhaust(limit: ReturnType<typeof usePinAttemptLimit>) {
  let lockedOut = false;
  for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) lockedOut = limit.recordFailure();
  return lockedOut;
}

describe('usePinAttemptLimit', () => {
  it('locks out after MAX_PIN_ATTEMPTS and reports which failure did it', () => {
    const limit = usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock');
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) {
      expect(limit.recordFailure()).toBe(false);
      expect(limit.inCooldown.value).toBe(false);
    }
    expect(limit.recordFailure()).toBe(true);
    expect(limit.inCooldown.value).toBe(true);
    expect(limit.cooldownSeconds.value).toBeGreaterThan(0);
  });

  /**
   * THE regression test. A fresh `usePinAttemptLimit(...)` call stands in for the
   * component remounting after `BaseModal` destroyed its `v-if` subtree — which is exactly
   * how the wall pad's cooldown used to evaporate.
   */
  it('a cooldown SURVIVES the consuming component unmounting and remounting', () => {
    exhaust(usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock'));

    const remounted = usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock');
    expect(remounted.inCooldown.value).toBe(true);
    expect(remounted.cooldownSeconds.value).toBeGreaterThan(0);
  });

  it('scopes the budget per member, so switching target and back does not reset it', () => {
    const scope = ref('reauth:alice');
    const limit = usePinAttemptLimit(scope, 'reauth-challenge', 'reauth');
    exhaust(limit);
    expect(limit.inCooldown.value).toBe(true);

    // Bob is untouched...
    scope.value = 'reauth:bob';
    expect(limit.inCooldown.value).toBe(false);

    // ...and Alice is still locked out on the way back.
    scope.value = 'reauth:alice';
    expect(limit.inCooldown.value).toBe(true);
  });

  it('a correct PIN clears the budget', () => {
    const limit = usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock');
    limit.recordFailure();
    limit.recordFailure();
    expect(limit.attemptsRemaining.value).toBe(MAX_PIN_ATTEMPTS - 2);
    limit.recordSuccess();
    expect(limit.attemptsRemaining.value).toBe(MAX_PIN_ATTEMPTS);
  });

  it('a live cooldown survives a page reload, via localStorage', () => {
    exhaust(usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock'));
    expect(localStorage.getItem('beanies_pin_attempts')).toBeTruthy();

    // Simulate a reload: in-memory state gone, storage intact.
    const stored = localStorage.getItem('beanies_pin_attempts')!;
    __resetPinAttemptsForTests();
    localStorage.setItem('beanies_pin_attempts', stored);

    expect(usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock').inCooldown.value).toBe(
      true
    );
  });

  it('discards a persisted cooldown whose expiry is implausibly far out (clock moved)', () => {
    localStorage.setItem(
      'beanies_pin_attempts',
      JSON.stringify({
        'wall-unlock': { failures: 0, lockedUntil: Date.now() + PIN_COOLDOWN_MS * 100 },
      })
    );
    expect(usePinAttemptLimit('wall-unlock', 'beanie-wall', 'wall-unlock').inCooldown.value).toBe(
      false
    );
  });

  it('emits telemetry on EVERY failure, so the rate is measurable — not only the lockout', () => {
    const limit = usePinAttemptLimit('reauth:alice', 'reauth-challenge', 'reauth');
    limit.recordFailure();
    limit.recordFailure();
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        surface: 'reauth-challenge',
        message: 'pin_attempt_failed',
        context: expect.objectContaining({ action: 'pin_failed', kind: 'reauth' }),
      })
    );
  });

  it('never puts the scope (which embeds a member id) into the telemetry context', () => {
    usePinAttemptLimit('reauth:secret-member-id', 'reauth-challenge', 'reauth').recordFailure();
    const ctx = vi.mocked(logEvent).mock.calls[0]![0].context ?? {};
    expect(JSON.stringify(ctx)).not.toContain('secret-member-id');
  });
});
