/**
 * signOutSteps — the key-material helpers the sign-out kit guard derives from
 * (2026-09-23). The guard asks `dropsKeyMaterial(signOutStepsFor(tier, trusted))`
 * rather than re-deriving "untrusted tier", so the guard and the teardown can never
 * disagree about whether a sign-out leaves this device able to reopen the pod.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  KEY_MATERIAL_STEPS,
  SIGN_OUT_CLEAR_ACTIVE_STEPS,
  SIGN_OUT_CLEAR_STEPS,
  SIGN_OUT_CLEARED_ELSEWHERE_STEPS,
  SIGN_OUT_EVICTED_STEPS,
  SIGN_OUT_EVICTION_LOCK_STEPS,
  SIGN_OUT_TRUSTED_STEPS,
  SIGN_OUT_UNTRUSTED_STEPS,
  dropsKeyMaterial,
  signOutStepsFor,
  type SignOutStepName,
} from '@/services/auth/signOutSteps';

describe('signOutStepsFor', () => {
  it('picks the list the store runs for each menu tier', () => {
    expect(signOutStepsFor('sign-out', true)).toBe(SIGN_OUT_TRUSTED_STEPS);
    expect(signOutStepsFor('sign-out', false)).toBe(SIGN_OUT_UNTRUSTED_STEPS);
    expect(signOutStepsFor('clear', true)).toBe(SIGN_OUT_CLEAR_STEPS);
    expect(signOutStepsFor('clear', false)).toBe(SIGN_OUT_CLEAR_STEPS);
    expect(signOutStepsFor('clear', false, 'active')).toBe(SIGN_OUT_CLEAR_ACTIVE_STEPS);
  });
});

describe('round 3: only the menu clear sweeps every family', () => {
  // Each every-family step and the family-scoped twin the active scope runs in its place.
  const TWINS: Array<[SignOutStepName, SignOutStepName]> = [
    ['deleteAllLocalFamilies', 'deleteFamilyDb'],
    ['clearKeyCacheAll', 'clearKeyCacheFamily'],
    ['removePinWrapsAll', 'removePinWrapsFamily'],
    ['reclaimAllPasskeys', 'reclaimFamilyPasskeys'],
    ['removeRosterAll', 'removeRosterFamily'],
  ];

  it('the active-scope clear deletes the active family only, otherwise the same teardown', () => {
    const twinOf = new Map(TWINS);
    // Step for step the menu clear, with each every-family step swapped in place.
    expect(SIGN_OUT_CLEAR_ACTIVE_STEPS).toEqual(
      SIGN_OUT_CLEAR_STEPS.map((s) => twinOf.get(s) ?? s)
    );
    expect(dropsKeyMaterial(SIGN_OUT_CLEAR_ACTIVE_STEPS)).toBe(true);
  });

  it("the active-scope clear touches no other family's key material", () => {
    for (const [all, family] of TWINS) {
      expect(SIGN_OUT_CLEAR_STEPS).toContain(all);
      expect(SIGN_OUT_CLEAR_ACTIVE_STEPS).not.toContain(all);
      expect(SIGN_OUT_CLEAR_ACTIVE_STEPS).toContain(family);
    }
    // No step name in the active list may be an every-family sweep.
    expect(SIGN_OUT_CLEAR_ACTIVE_STEPS.filter((s) => /All/.test(s))).toEqual([
      'clearAllRefreshTokens',
    ]);
  });
});

describe('dropsKeyMaterial', () => {
  it('a trusted keep-data sign-out keeps every key (no guard needed)', () => {
    expect(dropsKeyMaterial(signOutStepsFor('sign-out', true))).toBe(false);
  });

  it('an untrusted sign-out, clear-data, and both eviction lists drop key material', () => {
    expect(dropsKeyMaterial(SIGN_OUT_UNTRUSTED_STEPS)).toBe(true);
    expect(dropsKeyMaterial(SIGN_OUT_CLEAR_STEPS)).toBe(true);
    expect(dropsKeyMaterial(SIGN_OUT_EVICTION_LOCK_STEPS)).toBe(true);
    expect(dropsKeyMaterial(SIGN_OUT_EVICTED_STEPS)).toBe(true);
  });

  it('every KEY_MATERIAL_STEPS entry is a step some tier actually runs', () => {
    const all = new Set<SignOutStepName>([
      ...SIGN_OUT_TRUSTED_STEPS,
      ...SIGN_OUT_UNTRUSTED_STEPS,
      ...SIGN_OUT_CLEAR_STEPS,
      ...SIGN_OUT_EVICTED_STEPS,
    ]);
    for (const step of KEY_MATERIAL_STEPS) expect(all.has(step)).toBe(true);
  });
});

describe('SIGN_OUT_CLEARED_ELSEWHERE_STEPS (#100)', () => {
  // Another tab deleted this family's cache. The two properties the evicted tab relies on.
  it('never deletes and never drops key material: the deleting tab owns both', () => {
    expect(SIGN_OUT_CLEARED_ELSEWHERE_STEPS).not.toContain('deleteFamilyDb');
    expect(dropsKeyMaterial(SIGN_OUT_CLEARED_ELSEWHERE_STEPS)).toBe(false);
    for (const step of SIGN_OUT_CLEARED_ELSEWHERE_STEPS) {
      expect(KEY_MATERIAL_STEPS.has(step)).toBe(false);
    }
  });

  it('resets the doc client, which is what lets this family sign in here again', () => {
    expect(SIGN_OUT_CLEARED_ELSEWHERE_STEPS).toContain('resetDocClient');
  });

  it('keeps stored tokens: the deleting tab may be reloading into this same family', () => {
    expect(SIGN_OUT_CLEARED_ELSEWHERE_STEPS).not.toContain('clearGoogleSessionDropTokens');
    expect(SIGN_OUT_CLEARED_ELSEWHERE_STEPS).not.toContain('clearAllRefreshTokens');
  });

  it('the clear tier still deletes', () => {
    expect(SIGN_OUT_CLEAR_STEPS).toContain('deleteAllLocalFamilies');
  });

  it('never announces the end of the session (an echo would ping-pong between tabs)', () => {
    expect(SIGN_OUT_CLEARED_ELSEWHERE_STEPS).not.toContain('announceSessionEnded');
  });
});

describe('C6: tier 3 forgets EVERY family, not only the active one', () => {
  it('runs the every-family delete in place of the active-family one', () => {
    expect(SIGN_OUT_CLEAR_STEPS).toContain('deleteAllLocalFamilies');
    expect(SIGN_OUT_CLEAR_STEPS).not.toContain('deleteFamilyDb');
    // It needs the active id resolved first (a legacy session may never have registered it).
    expect(SIGN_OUT_CLEAR_STEPS.indexOf('resolveFamilyId')).toBeLessThan(
      SIGN_OUT_CLEAR_STEPS.indexOf('deleteAllLocalFamilies')
    );
  });

  it('counts as dropping key material (it forgets keys, wraps and passkeys per family)', () => {
    expect(KEY_MATERIAL_STEPS.has('deleteAllLocalFamilies')).toBe(true);
  });
});

describe('C10: every non-trusted tier tells the other tabs the session ended', () => {
  it('untrusted and both clear tiers announce, AFTER any delete attempt', () => {
    for (const steps of [
      SIGN_OUT_UNTRUSTED_STEPS,
      SIGN_OUT_CLEAR_STEPS,
      SIGN_OUT_CLEAR_ACTIVE_STEPS,
    ]) {
      expect(steps).toContain('announceSessionEnded');
    }
    expect(SIGN_OUT_UNTRUSTED_STEPS.indexOf('deleteFamilyDb')).toBeLessThan(
      SIGN_OUT_UNTRUSTED_STEPS.indexOf('announceSessionEnded')
    );
    expect(SIGN_OUT_CLEAR_STEPS.indexOf('deleteAllLocalFamilies')).toBeLessThan(
      SIGN_OUT_CLEAR_STEPS.indexOf('announceSessionEnded')
    );
  });

  it('a trusted sign-out keeps the device signed in elsewhere, so it never announces', () => {
    expect(SIGN_OUT_TRUSTED_STEPS).not.toContain('announceSessionEnded');
  });

  it('an eviction never announces: the remaining members keep their tabs (round 3)', () => {
    expect(SIGN_OUT_EVICTION_LOCK_STEPS).not.toContain('announceSessionEnded');
    expect(SIGN_OUT_EVICTED_STEPS).not.toContain('announceSessionEnded');
  });
});

describe('clearAttribution (#118): tier 3 only', () => {
  // Tier 2 runs inside the create flow (LoginPage "Start over"), so the campaign tag must
  // survive it; only the clean-device "Clear data" tier drops it.
  it('runs on the clear tier', () => {
    expect(SIGN_OUT_CLEAR_STEPS).toContain('clearAttribution');
  });

  it('never runs on a tier-2 or eviction sign-out', () => {
    for (const steps of [
      SIGN_OUT_TRUSTED_STEPS,
      SIGN_OUT_UNTRUSTED_STEPS,
      SIGN_OUT_CLEARED_ELSEWHERE_STEPS,
      SIGN_OUT_EVICTION_LOCK_STEPS,
      SIGN_OUT_EVICTED_STEPS,
    ]) {
      expect(steps).not.toContain('clearAttribution');
    }
  });

  it('is not key material: it never trips the sign-out kit guard', () => {
    expect(KEY_MATERIAL_STEPS.has('clearAttribution')).toBe(false);
  });
});
