/**
 * The shared "is now a safe moment to interrupt" predicate.
 *
 * ⚠️ THE ONE BEHAVIOUR THAT MATTERS is the catch. `isAppQuiet` is called from
 * `usePwaUpdater`, which runs during `App.vue` setup, and from `useAppUpdate`,
 * which runs beside it. `useSyncStore()` throws when Pinia is not yet active,
 * and a throw there would take the whole updater with it. Failing to FALSE is
 * the safe answer both ways: the web defers a reload, the native prompt stays
 * quiet, and both re-ask a moment later.
 *
 * This exists because `isAppQuiet` was moved verbatim out of `usePwaUpdater`
 * and the rule for that move was "behaviour unchanged". A rule with no
 * assertion behind it is a comment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const overlays = vi.hoisted(() => ({ open: false }));
vi.mock('@/utils/overlayStack', () => ({ hasOpenOverlays: () => overlays.open }));

const syncing = vi.hoisted(() => ({ value: false, throws: false }));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => {
    if (syncing.throws) {
      throw new Error('getActivePinia() was called but there was no active Pinia');
    }
    return {
      get isSyncing() {
        return syncing.value;
      },
    };
  },
}));

import { isAppQuiet } from '../appQuiet';

describe('isAppQuiet', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    overlays.open = false;
    syncing.value = false;
    syncing.throws = false;
  });

  it('is quiet when nothing is open and nothing is saving', () => {
    expect(isAppQuiet()).toBe(true);
  });

  it('is not quiet with an overlay open', () => {
    overlays.open = true;
    expect(isAppQuiet()).toBe(false);
  });

  it('is not quiet mid-save', () => {
    syncing.value = true;
    expect(isAppQuiet()).toBe(false);
  });

  it('answers FALSE rather than throwing before the store exists', () => {
    // The pre-init case, reproduced the way it actually happens: the store
    // accessor throws. Neither caller may propagate that out of `App.vue` setup.
    syncing.throws = true;
    expect(() => isAppQuiet()).not.toThrow();
    expect(isAppQuiet()).toBe(false);
  });
});
