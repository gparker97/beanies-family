/**
 * The chore celebration's rules (#146): the weekday move (by the device's local day), the sound
 * rotation (paired sound usually, the kids cheer takes a turn, never the same twice in a row),
 * the praise rotation (never the same line twice, "What a ..." only for timed blocks), the praise
 * line's pop-in pieces, and the anchor a tick surface builds at the tap.
 */
import { describe, it, expect } from 'vitest';
import {
  CHEER_SOUND,
  CHORE_MOVES,
  CHORE_PRAISE,
  SOUND_FOR_MOVE,
  SYNTH_CELEBRATION_SOUNDS,
  choreCelebrationAnchor,
  isChoreSoundId,
  moveForDate,
  pickChoreSound,
  pickPraiseIndex,
  choreTickAnchor,
  choreTickSelector,
  fillPraise,
  type ChoreSoundId,
} from '@/utils/choreCelebration';

/** A seeded generator, so a long run is reproducible. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('moveForDate', () => {
  it('one move per weekday, Monday first, as the mockup', () => {
    // 2026-11-16 is a Monday. Local constructor: the device's own day.
    const week = Array.from({ length: 7 }, (_, i) => moveForDate(new Date(2026, 10, 16 + i, 9)));
    expect(week).toEqual([
      'bounce-party',
      'peek-a-boo',
      'parade',
      'drop-in',
      'tumble-in',
      'stadium-wave',
      'parachutes',
    ]);
    expect(new Set(week).size).toBe(CHORE_MOVES.length);
  });

  it('reads the LOCAL day: one minute before and after local midnight', () => {
    expect(moveForDate(new Date(2026, 10, 22, 23, 59))).toBe('parachutes'); // Sunday night
    expect(moveForDate(new Date(2026, 10, 23, 0, 1))).toBe('bounce-party'); // Monday morning
  });

  it('every move has its own paired synthesized sound', () => {
    const paired = CHORE_MOVES.map((m) => SOUND_FOR_MOVE[m]);
    expect(new Set(paired).size).toBe(7);
    expect([...paired].sort()).toEqual([...SYNTH_CELEBRATION_SOUNDS].sort());
  });
});

describe('pickChoreSound', () => {
  it('plays the weekday’s paired sound when the dice say so', () => {
    expect(pickChoreSound('parade', null, () => 0.9)).toBe('fanfare');
    expect(pickChoreSound('parade', 'marimba', () => 0.9)).toBe('fanfare');
  });

  it('the kids cheer takes its turn on a low roll', () => {
    expect(pickChoreSound('parade', null, () => 0.1)).toBe(CHEER_SOUND);
  });

  it('the paired sound just played: the cheer, so a second celebration never repeats it', () => {
    expect(pickChoreSound('parade', 'fanfare', () => 0.99)).toBe(CHEER_SOUND);
  });

  it('the cheer just played: the paired sound, whatever the roll', () => {
    expect(pickChoreSound('parade', CHEER_SOUND, () => 0)).toBe('fanfare');
  });

  it('never the same sound twice in a row over a long run, and the cheer turns up', () => {
    const rnd = seeded(7);
    let last: ChoreSoundId | null = null;
    let cheers = 0;
    for (let i = 0; i < 500; i++) {
      const move = CHORE_MOVES[Math.floor(i / 9) % 7]!; // several celebrations a day
      const next = pickChoreSound(move, last, rnd);
      expect(next).not.toBe(last);
      if (next === CHEER_SOUND) cheers++;
      last = next;
    }
    expect(cheers).toBeGreaterThan(50);
    expect(cheers).toBeLessThan(450);
  });

  it('isChoreSoundId narrows a stored value', () => {
    expect(isChoreSoundId('glock')).toBe(true);
    expect(isChoreSoundId(CHEER_SOUND)).toBe(true);
    expect(isChoreSoundId('kazoo')).toBe(false);
    expect(isChoreSoundId(null)).toBe(false);
  });
});

describe('pickPraiseIndex', () => {
  it('never the same line twice in a row', () => {
    const rnd = seeded(3);
    let last: number | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const next = pickPraiseIndex('morning', last, rnd);
      expect(next).not.toBe(last);
      seen.add(next);
      last = next;
    }
    expect(seen.size).toBe(CHORE_PRAISE.length);
  });

  it('Anytime never gets "What a ..." (it has no reading for it)', () => {
    const whatA = CHORE_PRAISE.findIndex((p) => p.timedOnly);
    expect(whatA).toBeGreaterThanOrEqual(0);
    for (let r = 0; r < 1; r += 0.01) {
      expect(pickPraiseIndex('anytime', null, () => r)).not.toBe(whatA);
    }
  });
});

describe('fillPraise', () => {
  const fill = (template: string, name: string, block = 'Evening', blockWord = 'evening') =>
    fillPraise(template, { name, block, blockWord });
  const named = (t: string, n: string, b?: string, w?: string) =>
    fill(t, n, b, w)
      .words.filter((x) => x.name)
      .map((x) => x.text);

  it('fills the text and cuts it into words, the name its own piece with its punctuation', () => {
    const p = fill('High five, {name}! {block} is all done.', 'Pip', 'Morning');
    expect(p.text).toBe('High five, Pip! Morning is all done.');
    expect(p.words).toEqual([
      { text: 'High', name: false },
      { text: 'five,', name: false },
      { text: 'Pip!', name: true },
      { text: 'Morning', name: false },
      { text: 'is', name: false },
      { text: 'all', name: false },
      { text: 'done.', name: false },
    ]);
  });

  it('marks the name by where it was filled, never by matching text', () => {
    // "Evening" contains "Eve"; "All" contains "Al"; "Morning" contains "Mo".
    expect(named('{block}, all done! Nice work, {name}.', 'Eve')).toEqual(['Eve.']);
    expect(named('What a {blockWord}, {name}! All done.', 'Al')).toEqual(['Al!']);
    expect(named('High five, {name}! {block} is all done.', 'Mo', 'Morning')).toEqual(['Mo!']);
  });

  it('a two-word name wiggles whole, as one piece', () => {
    const p = fill('Woohoo, {name}! Your {blockWord} chores are done.', 'Mary Jo');
    expect(p.text).toBe('Woohoo, Mary Jo! Your evening chores are done.');
    expect(p.words.filter((w) => w.name).map((w) => w.text)).toEqual(['Mary Jo!']);
    expect(p.words.map((w) => w.text)).toContain('Woohoo,');
  });

  it('Chinese: phrases after full-width punctuation, the name its own piece', () => {
    const p = fill('击个掌，{name}！{block}全部搞定！', 'Pip', '早上', '早上');
    expect(p.text).toBe('击个掌，Pip！早上全部搞定！');
    expect(p.words).toEqual([
      { text: '击个掌，', name: false },
      { text: 'Pip！', name: true },
      { text: '早上全部搞定！', name: false },
    ]);
    // No space and no punctuation between the name and the words after it.
    expect(fill('{name}做到了！', '小明').words).toEqual([
      { text: '小明', name: true },
      { text: '做到了！', name: false },
    ]);
  });

  it('an empty name marks nothing', () => {
    expect(fill('Nice work, {name}.', '').words.every((w) => !w.name)).toBe(true);
  });
});

describe('choreCelebrationAnchor', () => {
  function el(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
    const d = document.createElement('div');
    d.getBoundingClientRect = () =>
      ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;
    return d;
  }

  it('measures the block and the tick at the tap and finds the clip', () => {
    const lane = document.createElement('section');
    lane.setAttribute('data-celebration-clip', '');
    const block = el({ left: 10, top: 100, width: 300, height: 200 });
    const tick = el({ left: 250, top: 240, width: 52, height: 52 });
    lane.append(block);
    block.append(tick);
    const a = choreCelebrationAnchor(block, tick, true);
    expect(a.blockAt).toEqual({ x: 10, y: 100, w: 300, h: 200 });
    expect(a.tick).toEqual({ x: 250, y: 240, w: 52, h: 52 });
    expect(a.tickEl).toBe(tick);
    expect(a.clip).toBe(lane);
    expect(a.compact).toBe(true);
  });

  it('no tick on screen: the block’s centre stands in, and no clip means the viewport', () => {
    const block = el({ left: 0, top: 0, width: 200, height: 100 });
    const a = choreCelebrationAnchor(block, null);
    expect(a.tickEl).toBeNull();
    expect(a.tick.x + a.tick.w / 2).toBe(100);
    expect(a.tick.y + a.tick.h / 2).toBe(50);
    expect(a.clip).toBeNull();
    expect(a.compact).toBe(false);
  });
});

describe('choreTickAnchor', () => {
  it('finds the tapped tick inside the block by its selector', () => {
    const block = document.createElement('section');
    const row = document.createElement('div');
    row.setAttribute('data-chore-id', 'c 1');
    const tick = document.createElement('button');
    tick.setAttribute('data-testid', 'chore-tick');
    row.append(tick);
    block.append(row);
    const a = choreTickAnchor(block, choreTickSelector('c 1'), true);
    expect(a?.tickEl).toBe(tick);
    expect(a?.compact).toBe(true);
  });

  it('no block on screen: no anchor', () => {
    expect(choreTickAnchor(null, choreTickSelector('c1'))).toBeNull();
  });
});
