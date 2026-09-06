/**
 * The fatal overlay's state, and the one invariant that makes `App.vue` safe to
 * read it as a computed.
 *
 * ⚠️ THE REGRESSION THIS FILE EXISTS FOR is the stale link. `action` has to be
 * assigned on EVERY `setFatal`, not only when one is passed, or a store link
 * from a needs-update block survives into `surfaceLineageFatal`'s block, which
 * has nothing to do with the store and would send a person to the App Store to
 * fix a lineage split.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFatalErrorStore } from '../fatalErrorStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

const link = { labelKey: 'appUpdate.openStore' as UIStringKey, url: 'https://example.test/app' };

describe('fatalErrorStore', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('carries no action by default, so every existing caller is unchanged', () => {
    const store = useFatalErrorStore();
    store.setFatal('something broke', 'detail');
    expect(store.action).toBeNull();
    expect(store.clearDataHelps).toBe(true);
  });

  it('carries the action it was given', () => {
    const store = useFatalErrorStore();
    store.setFatal('too old', null, { clearDataHelps: false, action: link });
    expect(store.action).toEqual(link);
  });

  it('CLEARS a previous action when the next fatal passes none', () => {
    // The stale-link regression, stated as directly as it can be.
    const store = useFatalErrorStore();
    store.setFatal('too old', null, { action: link });
    store.setFatal('a lineage split, which the store cannot fix');
    expect(store.action).toBeNull();
  });

  it('clear() takes the action with it', () => {
    const store = useFatalErrorStore();
    store.setFatal('too old', null, { action: link });
    store.clear();
    expect(store.action).toBeNull();
    expect(store.message).toBeNull();
  });

  it('never holds an action without a message', () => {
    // The invariant `App.vue`'s computed depends on: an action can never be
    // rendered beside a message it does not belong to, because `setFatal` is
    // the only writer of both.
    //
    // Asserted as an explicit implication rather than a guarded `expect`. The
    // first version wrote `if (store.action !== null) expect(...)`, which
    // silently ran no assertion at all in two of its three steps — a test
    // shaped like a proof and doing nothing.
    const store = useFatalErrorStore();
    const holdsWithoutMessage = () => store.action !== null && store.message === null;

    store.setFatal('too old', null, { action: link });
    expect(store.action).not.toBeNull();
    expect(holdsWithoutMessage()).toBe(false);

    store.setFatal('plain');
    expect(store.action).toBeNull();
    expect(holdsWithoutMessage()).toBe(false);

    store.setFatal('too old again', null, { action: link });
    store.clear();
    expect(store.action).toBeNull();
    expect(holdsWithoutMessage()).toBe(false);
  });
});
