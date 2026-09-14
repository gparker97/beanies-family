/**
 * The wall's person focus.
 *
 * Both rules here fail SILENTLY when they break — a wall filtered to nobody looks exactly like a
 * wall with nothing on it, and that is a way to miss a pickup rather than a cosmetic bug. They
 * live in a composable rather than the page precisely so they can be reached without mounting
 * the whole wall.
 */
import { describe, it, expect } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { useWallMemberFocus } from '@/composables/useWallMemberFocus';

/** Run inside a scope so the composable's `watch` is registered and disposed like a real one. */
function withFocus(initialRoster: string[]) {
  const roster = ref(initialRoster);
  const scope = effectScope();
  const focus = scope.run(() => useWallMemberFocus(() => roster.value))!;
  return { ...focus, roster, stop: () => scope.stop() };
}

describe('what the views are handed', () => {
  it('hands null for everyone, which is NOT the same as an empty list', () => {
    const f = withFocus(['m1', 'm2']);
    // A view has to tell "no filter" apart from "a filter that matches nobody" — `null` is how,
    // and collapsing the two into `[]` is the change that breaks every wall view at once.
    expect(f.visibleMemberIds.value).toBeNull();
    f.stop();
  });

  it('hands the same array to every view, which is why the type is readonly', () => {
    // A computed CACHES, so the spread inside it runs once per change — "a defensive copy" was
    // never true, and the old version of this test pushed to the copy and then asserted the
    // SOURCE, which the spread protects unconditionally. It passed without testing its claim.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    expect(f.visibleMemberIds.value).toBe(f.visibleMemberIds.value);
    f.stop();
  });
});

describe('toggling', () => {
  it('adds beans rather than replacing them — the whole point of the change', () => {
    const f = withFocus(['m1', 'm2', 'm3']);
    f.toggle('m1');
    f.toggle('m3');
    expect(f.visibleMemberIds.value).toEqual(['m1', 'm3']);
    f.stop();
  });

  it('falls back to EVERYONE when the last focused bean is dropped', () => {
    // Never "a filter matching nobody": on a glanceable screen the only explanation would be an
    // unlit chip, which is not an explanation.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m1');
    expect(f.visibleMemberIds.value).toBeNull();
    f.stop();
  });

  it('clears back to everyone', () => {
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m2');
    f.clear();
    expect(f.visibleMemberIds.value).toBeNull();
    f.stop();
  });
});

describe('when the roster changes underneath a mounted wall', () => {
  it('drops a member who is gone', async () => {
    // A cross-device merge removing a member, or a human re-tagged as a pet. This was live
    // BEFORE multi-select and left the wall matching nobody with no chip lit to say why.
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    f.toggle('m2');

    f.roster.value = ['m2'];
    await nextTick();

    expect(f.visibleMemberIds.value).toEqual(['m2']);
    f.stop();
  });

  it('falls back to everyone when every focused bean is gone', async () => {
    const f = withFocus(['m1']);
    f.toggle('m1');

    f.roster.value = ['m9'];
    await nextTick();

    expect(f.visibleMemberIds.value).toBeNull();
    f.stop();
  });

  it('does not churn when the roster grows but the focus is unaffected', async () => {
    const f = withFocus(['m1', 'm2']);
    f.toggle('m1');
    const before = f.focusedMemberIds.value;

    // A roster that GROWS while the focus is unaffected. ⚠️ Deliberately not an identical-content
    // reassign: the watch source is a joined string, so identical content never fires the
    // callback at all and the old version of this test passed with the guard deleted.
    f.roster.value = ['m1', 'm2', 'm3'];
    await nextTick();

    expect(f.focusedMemberIds.value).toBe(before);
    f.stop();
  });
});
