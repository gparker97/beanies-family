/**
 * The wall's person focus.
 *
 * Both rules here fail SILENTLY when they break — a wall filtered to nobody looks exactly like a
 * wall with nothing on it, and that is a way to miss a pickup rather than a cosmetic bug. They
 * live in a composable rather than the page precisely so they can be reached without mounting
 * the whole wall.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';

import { useWallMemberFocus } from '@/composables/useWallMemberFocus';

function withFocus(initialRoster: string[]) {
  const roster = ref<string[]>(initialRoster);
  // No `effectScope`: reconciliation is DERIVED, so there is no watcher to register or dispose.
  // The scope this test used to need was itself a symptom of the design that got replaced.
  return { ...useWallMemberFocus(() => roster.value), roster };
}

describe('what the views are handed', () => {
  it('hands null for everyone, which is NOT the same as an empty list', () => {
    // A view has to tell "no filter" apart from "a filter that matches nobody" — `null` is how,
    // and collapsing the two into `[]` is the change that breaks every wall view at once.
    expect(withFocus(['m1', 'm2']).visibleMemberIds.value).toBeNull();
  });

  it('hands the same array to every view, which is why the type is readonly', () => {
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    expect(f.visibleMemberIds.value).toBe(f.focusedMemberIds.value);
  });
});

describe('toggling', () => {
  it('adds beans rather than replacing them — the whole point of the change', () => {
    const f = withFocus(['m1', 'm2', 'm3']);
    f.toggle('m1');
    f.toggle('m3');
    expect(f.visibleMemberIds.value).toEqual(['m1', 'm3']);
  });

  it('falls back to EVERYONE when the last focused bean is dropped', () => {
    // Never "a filter matching nobody": on a glanceable screen the only explanation would be an
    // unlit chip, which is not an explanation.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m1');
    expect(f.visibleMemberIds.value).toBeNull();
  });

  it('clears back to everyone', () => {
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m2');
    f.clear();
    expect(f.visibleMemberIds.value).toBeNull();
  });
});

describe('when the roster changes underneath a mounted wall', () => {
  it('drops a member who is gone, with no sync call and no tick', () => {
    // A cross-device merge removing a member, or a human re-tagged as a pet. Derived, so it is
    // true on the very next read rather than after a watcher has run.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m2');

    f.roster.value = ['m2'];

    expect(f.visibleMemberIds.value).toEqual(['m2']);
  });

  it('falls back to everyone when every focused bean is gone', () => {
    const f = withFocus(['m1']);
    f.toggle('m1');
    f.roster.value = ['m9'];
    expect(f.visibleMemberIds.value).toBeNull();
  });

  it('falls back to everyone when the roster EMPTIES', () => {
    // ⚠️ The case a watch keyed on a joined roster string could not see: "nobody focused" and
    // "roster empty" hash to the same empty string, so the callback bailed and the wall stayed
    // filtered to nobody. Reachable on a family switch, a transient members reload, or every
    // human re-tagged as a pet.
    const f = withFocus(['m1']);
    f.toggle('m1');
    f.roster.value = [];
    expect(f.visibleMemberIds.value).toBeNull();
  });

  it('remembers a member who leaves and comes back', () => {
    // Ignored, not deleted: a transient reload must not quietly rewrite what the user chose.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m2');

    f.roster.value = ['m1'];
    expect(f.visibleMemberIds.value).toBeNull();

    f.roster.value = ['m1', 'm2'];
    expect(f.visibleMemberIds.value).toEqual(['m2']);
  });

  it('cannot resurrect a departed member by tapping someone else', () => {
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m2');

    f.roster.value = ['m2'];
    f.toggle('m2');

    // m1 is still in the raw choice but must never come back into the filter.
    expect(f.visibleMemberIds.value).toBeNull();
  });
});
