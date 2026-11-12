/**
 * useWallMemories: the family scrapbook on the wall (#140).
 *
 * Pins the rules that fail quietly: which tap opens the viewer (only the lone lit bean, and
 * only with the viewer on), that every close path is one logged function, that an unattended
 * wall comes back to the schedule after three minutes, and that night closes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useWallMemberFocus } from '@/composables/useWallMemberFocus';
import { WALL_MEMORIES_IDLE_MS, useWallMemories } from '@/composables/useWallMemories';
import { DEFAULT_WALL_MEMORIES } from '@/utils/wallMemories';
import type { WallMemoriesSettings } from '@/types/models';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

function setup(overrides: Partial<WallMemoriesSettings> = {}) {
  const settings = ref<WallMemoriesSettings>({ ...DEFAULT_WALL_MEMORIES, ...overrides });
  const asleep = ref(false);
  const target = new EventTarget();
  const scope = effectScope();
  const { focus, memories } = scope.run(() => {
    const focus = useWallMemberFocus(() => ['m1', 'm2', 'm3']);
    const memories = useWallMemories({ focus, asleep, settings: () => settings.value, target });
    return { focus, memories };
  })!;
  return { settings, asleep, target, scope, focus, memories };
}

/** The `kind`s logged for one event, in order. */
const kinds = (message: string) =>
  logEvent.mock.calls
    .map(([e]) => e)
    .filter((e) => e.message === message)
    .map((e) => e.context.kind);

beforeEach(() => {
  logEvent.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('which tap opens the scrapbook', () => {
  it('no bean lit: a tap filters', () => {
    const { memories } = setup();
    expect(memories.opensOnTap('m1')).toBe(false);
  });

  it('one bean lit: a second tap on THAT bean opens it, a tap on another filters', () => {
    const { focus, memories } = setup();
    focus.toggle('m1');
    expect(memories.opensOnTap('m1')).toBe(true);
    expect(memories.opensOnTap('m2')).toBe(false);
  });

  it('two beans lit: a tap only drops one', () => {
    const { focus, memories } = setup();
    focus.toggle('m1');
    focus.toggle('m2');
    expect(memories.opensOnTap('m1')).toBe(false);
    expect(memories.opensOnTap('m2')).toBe(false);
  });

  it('viewer off: the lone lit bean un-filters exactly as before, and open does nothing', () => {
    const { focus, memories } = setup({ viewer: false });
    focus.toggle('m1');
    expect(memories.opensOnTap('m1')).toBe(false);
    memories.open('face-chore');
    expect(memories.isOpen.value).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('opening and closing', () => {
  it('logs the door it opened through and the way it closed', () => {
    const { memories } = setup();
    memories.open('face-chore');
    expect(memories.isOpen.value).toBe(true);
    memories.close('button');
    memories.open('face-sheet');
    memories.close('escape');
    memories.open('chip-second-tap');
    memories.close('button');
    memories.open('lane-second-tap');
    memories.close('escape');

    expect(kinds('wall_memories_open')).toEqual([
      'face-chore',
      'face-sheet',
      'chip-second-tap',
      'lane-second-tap',
    ]);
    expect(kinds('wall_memories_close')).toEqual(['button', 'escape', 'button', 'escape']);
    expect(logEvent.mock.calls.every(([e]) => e.surface === 'beanie-wall')).toBe(true);
  });

  it('a second open while open, or a close while closed, logs nothing', () => {
    const { memories } = setup();
    memories.close('button');
    memories.open('face-chore');
    memories.open('face-sheet');
    expect(kinds('wall_memories_open')).toEqual(['face-chore']);
    expect(kinds('wall_memories_close')).toEqual([]);
  });

  it('switching the viewer off hides it at once (derived, no watcher)', () => {
    const { settings, memories } = setup();
    memories.open('face-chore');
    settings.value = { ...settings.value, viewer: false };
    expect(memories.isOpen.value).toBe(false);
  });

  it('exposes the enabled types, which may be empty', () => {
    const { settings, memories } = setup();
    expect([...memories.types.value].sort()).toEqual(['favorite', 'milestone', 'note', 'saying']);
    settings.value = {
      ...settings.value,
      show: { milestone: false, favorite: false, saying: false, note: false },
    };
    expect(memories.types.value.size).toBe(0);
  });

  it('logs an empty open with its reason', () => {
    const { memories } = setup();
    memories.reportEmpty('types-off');
    memories.reportEmpty('no-entries');
    const details = logEvent.mock.calls
      .map(([e]) => e)
      .filter((e) => e.message === 'wall_memories_empty')
      .map((e) => e.context.detail);
    expect(details).toEqual(['types-off', 'no-entries']);
  });

  it('returns focus to the face that opened it', () => {
    const { memories } = setup();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    memories.open('face-chore', opener);
    document.body.focus();
    memories.close('button');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('closing on its own', () => {
  it('closes after three minutes with nobody at the wall', () => {
    const { memories } = setup();
    memories.open('face-chore');
    vi.advanceTimersByTime(WALL_MEMORIES_IDLE_MS - 1);
    expect(memories.isOpen.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(memories.isOpen.value).toBe(false);
    expect(kinds('wall_memories_close')).toEqual(['idle']);
  });

  it('any touch restarts the three minutes', () => {
    const { memories, target } = setup();
    memories.open('face-chore');
    vi.advanceTimersByTime(WALL_MEMORIES_IDLE_MS - 1000);
    target.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(WALL_MEMORIES_IDLE_MS - 1000);
    expect(memories.isOpen.value).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(memories.isOpen.value).toBe(false);
  });

  it('activity after a close does not re-arm a timer', () => {
    const { memories, target } = setup();
    memories.open('face-chore');
    memories.close('button');
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(WALL_MEMORIES_IDLE_MS * 2);
    expect(kinds('wall_memories_close')).toEqual(['button']);
  });

  it('closes when the wall goes to sleep', async () => {
    const { memories, asleep } = setup();
    memories.open('face-chore');
    asleep.value = true;
    await nextTick();
    expect(memories.isOpen.value).toBe(false);
    expect(kinds('wall_memories_close')).toEqual(['night']);
  });

  it('cannot open while the wall is asleep', () => {
    const { memories, asleep } = setup();
    asleep.value = true;
    memories.open('face-chore');
    expect(memories.isOpen.value).toBe(false);
  });

  it('leaves no timer behind when the wall unmounts', () => {
    const { memories, scope } = setup();
    memories.open('face-chore');
    scope.stop();
    vi.advanceTimersByTime(WALL_MEMORIES_IDLE_MS * 2);
    expect(kinds('wall_memories_close')).toEqual([]);
  });
});
