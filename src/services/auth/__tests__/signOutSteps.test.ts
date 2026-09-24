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
    expect(SIGN_OUT_CLEAR_STEPS).toContain('deleteFamilyDb');
  });
});
