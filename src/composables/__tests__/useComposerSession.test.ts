/**
 * One composer session per open of the quick-add surface (#119): the latch, the per-open draft
 * and the `sent` / `dismissed` telemetry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

import { COMPOSER_SURFACE, useComposerSession } from '../useComposerSession';

function setup(allowed = true) {
  const isOpen = ref(false);
  const openSeq = ref(0);
  const allow = ref(allowed);
  const onOpen = vi.fn();
  const scope = effectScope();
  const s = scope.run(() =>
    useComposerSession(isOpen, openSeq, { composerAllowed: () => allow.value, onOpen })
  )!;
  /** What `openQuickAdd` does: flip isOpen (if closed) and advance openSeq. */
  async function open() {
    isOpen.value = true;
    openSeq.value += 1;
    await nextTick();
  }
  async function close() {
    isOpen.value = false;
    await nextTick();
  }
  return { s, allow, onOpen, open, close, scope, isOpen, openSeq };
}

const events = (message: string) =>
  logEvent.mock.calls.map((c) => c[0]).filter((e) => e.message === message);

describe('useComposerSession', () => {
  beforeEach(() => logEvent.mockReset());

  it('latches composerShown once per open and reports it to onOpen', async () => {
    const { s, open, onOpen, scope } = setup(true);
    await open();
    expect(s.composerShown.value).toBe(true);
    expect(onOpen).toHaveBeenCalledWith(true);
    scope.stop();
  });

  it('a disallowed open (scoped, picker, no reader) shows no composer', async () => {
    const { s, open, onOpen, scope } = setup(false);
    await open();
    expect(s.composerShown.value).toBe(false);
    expect(onOpen).toHaveBeenCalledWith(false);
    scope.stop();
  });

  it('sees a picker stage set synchronously after open (pre flush)', async () => {
    const { s, allow, isOpen, openSeq, scope } = setup(true);
    isOpen.value = true;
    openSeq.value += 1;
    allow.value = false; // startQuickAddItem sets the picker stage on the same tick
    await nextTick();
    expect(s.composerShown.value).toBe(false);
    scope.stop();
  });

  it('is NOT re-evaluated mid-open: the composer and its draft stay', async () => {
    const { s, allow, open, scope } = setup(true);
    await open();
    s.draft.value = 'keep me';
    allow.value = false; // an Everyday member tile moved the stage to picker
    await nextTick();
    expect(s.composerShown.value).toBe(true);
    expect(s.draft.value).toBe('keep me');
    scope.stop();
  });

  it('resets the draft on every open', async () => {
    const { s, open, close, scope } = setup(true);
    await open();
    s.draft.value = 'old';
    await close();
    await open();
    expect(s.draft.value).toBe('');
    scope.stop();
  });

  it('logs dismissed with had_text / empty when a shown session closes unsent', async () => {
    const { s, open, close, scope } = setup(true);
    await open();
    s.draft.value = '  draft  ';
    await close();
    await open();
    await close();
    const d = events('composer dismissed');
    expect(d.map((e) => e.context)).toEqual([
      { action: 'dismissed', detail: 'had_text' },
      { action: 'dismissed', detail: 'empty' },
    ]);
    expect(d[0].surface).toBe(COMPOSER_SURFACE);
    scope.stop();
  });

  it('a handed-off session logs sent and no dismissal on the close that follows', async () => {
    const { s, open, close, scope } = setup(true);
    await open();
    s.draft.value = 'Swimming Tue';
    s.markHandedOff('paste');
    await close();
    expect(events('composer sent').map((e) => e.context)).toEqual([
      { action: 'sent', kind: 'paste' },
    ]);
    expect(events('composer dismissed')).toHaveLength(0);
    scope.stop();
  });

  it('no dismissal for a session that never showed the composer', async () => {
    const { open, close, scope } = setup(false);
    await open();
    await close();
    expect(events('composer dismissed')).toHaveLength(0);
    scope.stop();
  });

  it('a re-open while open ends the live session once and re-evaluates the latch', async () => {
    const { s, allow, open, openSeq, onOpen, scope } = setup(true);
    await open();
    s.draft.value = 'half typed';
    allow.value = false; // the Scrapbook's scoped add, on the non-modal desktop card
    openSeq.value += 1;
    await nextTick();
    expect(s.composerShown.value).toBe(false);
    expect(events('composer dismissed').map((e) => e.context)).toEqual([
      { action: 'dismissed', detail: 'had_text' },
    ]);
    expect(onOpen).toHaveBeenLastCalledWith(false);
    scope.stop();
  });
});
