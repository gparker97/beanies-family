import { describe, it, expect } from 'vitest';
import { withBatchSuffix, type ChecklistLine, type ShoppingSection } from '../mealShoppingList';
import {
  applyDuplicateGroups,
  dedupeCandidates,
  dedupeRecipeCount,
  exactKey,
  mergeExactDuplicates,
  restoreMergedLine,
  splitMergedLine,
  splitSnapshotOf,
  type SplitSnapshot,
  type WeekShoppingState,
} from '../shoppingMerge';
import { dedupePayloadBytes } from '../dedupePayload';

/** A generated line, as `buildShoppingLines` makes it. */
function gen(id: string, recipeId: string, source: string, batches = 1): ChecklistLine {
  return { id, source, text: withBatchSuffix(source, batches), checked: true, recipeId, batches };
}

function section(recipeId: string, batches: number, sources: string[]): ShoppingSection {
  return {
    recipeId,
    recipeName: recipeId,
    meals: [],
    batches,
    lines: sources.map((s, i) => gen(`${recipeId}-${i}`, recipeId, s, batches)),
    headingsSkipped: 0,
  };
}

/** The mockup week: tikka ×1, tacos ×3, stir ×2, bolo ×2. */
function week(): WeekShoppingState {
  return {
    sections: [
      section('tikka', 1, ['600 g chicken thighs', '1 yellow onion, diced', '1 cup basmati rice']),
      section('tacos', 3, ['500 g ground beef', '1 bell pepper', 'Salt, to taste']),
      section('stir', 2, ['2 green bell peppers', '1 Cup  Basmati rice ']),
      section('bolo', 2, ['250 g lean ground beef', '1 large yellow onion']),
    ],
    merged: [],
  };
}

const line = (s: WeekShoppingState, id: string) =>
  s.sections.flatMap((x) => x.lines).find((l) => l.id === id)!;

describe('exactKey', () => {
  it('trims, collapses whitespace and ignores case', () => {
    expect(exactKey('  1 Cup\tBasmati   rice ')).toBe('1 cup basmati rice');
  });
});

describe('mergeExactDuplicates', () => {
  it('merges identical lines across recipes, summing batches (×1 + ×2 → ×3)', () => {
    const input = week();
    const s = mergeExactDuplicates(input);
    expect(s.merged).toHaveLength(1);
    const m = s.merged[0]!;
    expect(m).toMatchObject({
      text: '1 cup basmati rice (×3)',
      source: '1 cup basmati rice',
      batches: 3,
      merged: 'exact',
      partIds: ['tikka-2', 'stir-1'],
      recipeIds: ['tikka', 'stir'],
      checked: true,
    });
    expect(line(s, 'tikka-2').mergedInto).toBe(m.id);
    expect(line(s, 'stir-1').mergedInto).toBe(m.id);
    // Sections with no merged line are the same objects.
    expect(s.sections[1]).toBe(input.sections[1]);
    expect(line(s, 'tacos-0').mergedInto).toBeUndefined();
  });

  it('never merges two lines of ONE recipe on their own', () => {
    const s = mergeExactDuplicates({
      sections: [section('a', 1, ['salt', 'Salt'])],
      merged: [],
    });
    expect(s.merged).toEqual([]);
  });

  it('counts every matching line, even two from one recipe, once another recipe matches', () => {
    const s = mergeExactDuplicates({
      sections: [section('a', 1, ['salt', 'Salt']), section('b', 2, ['salt'])],
      merged: [],
    });
    expect(s.merged[0]).toMatchObject({ text: 'salt (×4)', recipeIds: ['a', 'b'] });
    expect(s.merged[0]!.partIds).toHaveLength(3);
  });

  it('skips hand-edited, user-added and split lines', () => {
    const base = week();
    base.sections[0]!.lines[2] = { ...base.sections[0]!.lines[2]!, text: '2 cups basmati rice' };
    expect(mergeExactDuplicates(base).merged).toEqual([]);

    const added = week();
    added.sections[0]!.lines[2] = {
      id: 'x',
      text: '1 cup basmati rice',
      checked: true,
      batches: 1,
    };
    expect(mergeExactDuplicates(added).merged).toEqual([]);

    const split = week();
    split.sections[0]!.lines[2] = { ...split.sections[0]!.lines[2]!, split: true };
    expect(mergeExactDuplicates(split).merged).toEqual([]);
  });

  it('is a no-op (same state) when nothing matches', () => {
    const s: WeekShoppingState = {
      sections: [section('a', 1, ['x']), section('b', 1, ['y'])],
      merged: [],
    };
    expect(mergeExactDuplicates(s)).toBe(s);
  });
});

describe('dedupeCandidates', () => {
  it('ticked, unedited, unmerged lines as SOURCE text under L1…LN', () => {
    const s = mergeExactDuplicates(week());
    s.sections[1]!.lines[2] = { ...s.sections[1]!.lines[2]!, checked: false }; // unticked salt
    s.sections[3]!.lines[1] = { ...s.sections[3]!.lines[1]!, text: '2 onions' }; // edited
    const { payload, idMap, recipeCount } = dedupeCandidates(s, 100_000);
    expect(payload).toEqual([
      { id: 'L1', text: '600 g chicken thighs' },
      { id: 'L2', text: '1 yellow onion, diced' },
      { id: 'L3', text: '500 g ground beef' },
      { id: 'L4', text: '1 bell pepper' },
      { id: 'L5', text: '2 green bell peppers' },
      { id: 'L6', text: '250 g lean ground beef' },
    ]);
    expect(idMap.get('L3')).toBe('tacos-0');
    expect(recipeCount).toBe(4);
  });

  it('never offers merged lines, their parts or split lines', () => {
    const s = mergeExactDuplicates(week());
    const texts = dedupeCandidates(s, 100_000).payload.map((p) => p.text);
    expect(texts.some((t) => /basmati/i.test(t))).toBe(false);
  });

  it('stays within the byte bound, measured on the payload exactly as sent', () => {
    const s = week();
    const full = dedupeCandidates(s, 100_000).payload;
    const bound = dedupePayloadBytes(full.slice(0, 3));
    const capped = dedupeCandidates(s, bound);
    expect(capped.payload).toEqual(full.slice(0, 3));
    expect(dedupePayloadBytes(capped.payload)).toBe(bound);
    for (let b = 2; b < 400; b += 7) {
      expect(dedupePayloadBytes(dedupeCandidates(s, b).payload)).toBeLessThanOrEqual(b);
    }
  });

  it('skips a line that would cross the bound and keeps walking to shorter ones', () => {
    // One byte short of three lines: the third ("1 cup basmati rice") no longer fits, but the
    // shorter "500 g ground beef" after it does, and takes the next id.
    const s = week();
    const bound = dedupePayloadBytes(dedupeCandidates(s, 100_000).payload.slice(0, 3)) - 1;
    const { payload, idMap } = dedupeCandidates(s, bound);
    expect(payload.map((p) => p.text)).toEqual([
      '600 g chicken thighs',
      '1 yellow onion, diced',
      '500 g ground beef',
    ]);
    expect(idMap.get('L3')).toBe('tacos-0');
  });

  it('one long line in the first recipe never hides every later recipe', () => {
    const s: WeekShoppingState = {
      sections: [
        section('big', 1, ['x'.repeat(500), '1 onion']),
        section('small', 1, ['2 onions']),
      ],
      merged: [],
    };
    const { payload, recipeCount, skipped } = dedupeCandidates(s, 100);
    expect(payload.map((p) => p.text)).toEqual(['1 onion', '2 onions']);
    expect(recipeCount).toBe(2);
    // The long line is counted, so "Find Duplicates missed it" is diagnosable.
    expect(skipped).toBe(1);
    expect(dedupeCandidates(s, 100_000).skipped).toBe(0);
  });

  it('dedupeRecipeCount: distinct recipes with an offerable line, whatever the byte bound', () => {
    const s = mergeExactDuplicates(week());
    expect(dedupeRecipeCount(s)).toBe(dedupeCandidates(s, 100_000).recipeCount);
    const long: WeekShoppingState = {
      sections: [section('big', 1, ['x'.repeat(500)]), section('small', 1, ['2 onions'])],
      merged: [],
    };
    // Never hides the card because an early line is long: the walk at tap time skips it.
    expect(dedupeRecipeCount(long)).toBe(2);
    const unticked: WeekShoppingState = {
      sections: [section('a', 1, ['1 onion']), section('b', 1, ['2 onions'])],
      merged: [],
    };
    unticked.sections[1]!.lines[0] = { ...unticked.sections[1]!.lines[0]!, checked: false };
    expect(dedupeRecipeCount(unticked)).toBe(1);
  });

  it('counts multi-byte text in bytes, not characters', () => {
    const s: WeekShoppingState = { sections: [section('a', 1, ['豆腐', 'x'])], merged: [] };
    const first = dedupePayloadBytes([{ id: 'L1', text: '豆腐' }]);
    expect(dedupeCandidates(s, first).payload).toEqual([{ id: 'L1', text: '豆腐' }]);
    // Too small for the tofu line, but the one-byte "x" still fits.
    expect(dedupeCandidates(s, first - 1).payload).toEqual([{ id: 'L1', text: 'x' }]);
  });
});

describe('applyDuplicateGroups', () => {
  function run(groups: { name: string; lineIds: string[] }[], state = week()) {
    const { idMap } = dedupeCandidates(state, 100_000);
    return applyDuplicateGroups(state, groups, idMap);
  }
  // week() payload ids: L1 chicken, L2 yellow onion, L3 rice, L4 beef, L5 bell pepper,
  // L6 salt, L7 green peppers, L8 Basmati, L9 lean beef, L10 large onion.

  it('writes "Name: part + part" from the parts’ own text (suffix included), in section order', () => {
    const r = run([{ name: 'Ground beef', lineIds: ['L9', 'L4'] }]);
    expect(r.applied).toBe(1);
    expect(r.dropped).toBe(0);
    expect(r.state.merged[0]).toMatchObject({
      text: 'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)',
      merged: 'ai',
      recipeIds: ['tacos', 'bolo'],
      partIds: ['tacos-0', 'bolo-0'],
    });
    expect(line(r.state, 'tacos-0').mergedInto).toBe(r.state.merged[0]!.id);
  });

  it('reads a bare number as its L id (a model answering 4 for "L4")', () => {
    const r = run([{ name: 'Ground beef', lineIds: ['4', '9'] }]);
    expect(r).toMatchObject({ applied: 1, dropped: 0 });
    expect(r.state.merged[0]!.partIds).toEqual(['tacos-0', 'bolo-0']);
    // "4" and "L4" are the same line, so this is a singleton after de-duplication.
    expect(run([{ name: 'X', lineIds: ['4', 'L4'] }])).toMatchObject({ applied: 0, dropped: 1 });
  });

  it.each([
    ['unknown ids', [{ name: 'X', lineIds: ['L4', 'L99'] }]],
    ['ids that are neither Ln nor a number', [{ name: 'X', lineIds: ['tacos-0', 'bolo-0'] }]],
    ['a singleton', [{ name: 'X', lineIds: ['L4'] }]],
    ['a repeated id', [{ name: 'X', lineIds: ['L4', 'L4'] }]],
    ['one recipe only', [{ name: 'X', lineIds: ['L4', 'L5'] }]],
    ['an empty name', [{ name: ' ​ ', lineIds: ['L4', 'L9'] }]],
  ])('drops %s', (_label, groups) => {
    const r = run(groups);
    expect(r).toMatchObject({ applied: 0, dropped: 1 });
    expect(r.state.merged).toEqual([]);
  });

  it('first claim wins; a later group keeps its other lines if still ≥ 2 recipes', () => {
    const r = run([
      { name: 'Onion', lineIds: ['L2', 'L10'] },
      { name: 'Onion again', lineIds: ['L10', 'L2'] },
      { name: 'Peppers', lineIds: ['L5', 'L7', 'L2'] },
    ]);
    expect(r.applied).toBe(2);
    expect(r.dropped).toBe(1);
    expect(r.state.merged.map((m) => m.text)).toEqual([
      'Onion: 1 yellow onion, diced + 1 large yellow onion (×2)',
      'Peppers: 1 bell pepper (×3) + 2 green bell peppers (×2)',
    ]);
  });

  it('re-checks the CURRENT state: lines edited or unticked during the run are skipped', () => {
    const s = week();
    const { idMap } = dedupeCandidates(s, 100_000);
    s.sections[3]!.lines[0] = { ...s.sections[3]!.lines[0]!, text: 'mince' };
    s.sections[1]!.lines[1] = { ...s.sections[1]!.lines[1]!, checked: false };
    const r = applyDuplicateGroups(
      s,
      [
        { name: 'Beef', lineIds: ['L4', 'L9'] },
        { name: 'Pepper', lineIds: ['L5', 'L7'] },
      ],
      idMap
    );
    expect(r).toMatchObject({ applied: 0, dropped: 2 });
  });

  it('never merges an exact-merged line or its parts again', () => {
    const s = mergeExactDuplicates(week());
    // Even if an id somehow mapped to them, merged parts and merged lines are refused.
    const idMap = new Map([
      ['A', 'tikka-2'],
      ['B', 'stir-1'],
      ['C', s.merged[0]!.id],
    ]);
    const r = applyDuplicateGroups(s, [{ name: 'Rice', lineIds: ['A', 'B', 'C'] }], idMap);
    expect(r).toMatchObject({ applied: 0, dropped: 1 });
  });
});

describe('splitMergedLine', () => {
  it('removes the merged line and puts its parts back exactly as they were, marked split', () => {
    const merged = mergeExactDuplicates(week());
    const id = merged.merged[0]!.id;
    // An edit made to the merged line is discarded by Split.
    merged.merged[0] = { ...merged.merged[0]!, text: 'lots of rice' };
    const s = splitMergedLine(merged, id);
    expect(s.merged).toEqual([]);
    expect(line(s, 'tikka-2')).toEqual({ ...week().sections[0]!.lines[2]!, split: true });
    expect(line(s, 'stir-1')).toMatchObject({ text: '1 Cup  Basmati rice  (×2)', split: true });
    // Split lines are not offered again.
    expect(mergeExactDuplicates(s).merged).toEqual([]);
    expect(dedupeCandidates(s, 100_000).payload.some((p) => /basmati/i.test(p.text))).toBe(false);
  });

  it('an unknown id is a no-op', () => {
    const s = mergeExactDuplicates(week());
    expect(splitMergedLine(s, 'nope')).toBe(s);
  });
});

describe('restoreMergedLine (Undo Split)', () => {
  function splitFirst(state: WeekShoppingState, at = 0) {
    const id = state.merged[at]!.id;
    const snap = splitSnapshotOf(state, id)!;
    return { snap, split: splitMergedLine(state, id) };
  }
  const withAi = () => {
    const s = mergeExactDuplicates(week());
    const { idMap } = dedupeCandidates(s, 100_000);
    // After the exact merge: L3 = 500 g ground beef, L7 = 250 g lean ground beef.
    return applyDuplicateGroups(s, [{ name: 'Ground beef', lineIds: ['L3', 'L7'] }], idMap).state;
  };

  it.each([
    ['an exact merge', () => mergeExactDuplicates(week()), 0],
    ['a magic beans merge', withAi, 1],
  ])('puts %s back exactly as it was, in its place', (_label, build, at) => {
    const before = build();
    // An edit made to the merged line survives the round trip.
    before.merged[at] = { ...before.merged[at]!, text: `${before.merged[at]!.text}!` };
    const { snap, split } = splitFirst(before, at);
    const restored = restoreMergedLine(split, snap);
    expect(restored).toEqual(before);
  });

  it.each([
    [
      'a part was edited after the Split',
      (s: WeekShoppingState, snap: SplitSnapshot) => {
        const id = snap.parts[0]!.id;
        return {
          ...s,
          sections: s.sections.map((x) => ({
            ...x,
            lines: x.lines.map((l) => (l.id === id ? { ...l, text: 'brown rice' } : l)),
          })),
        };
      },
    ],
    [
      'a part was unticked after the Split',
      (s: WeekShoppingState, snap: SplitSnapshot) => {
        const id = snap.parts[0]!.id;
        return {
          ...s,
          sections: s.sections.map((x) => ({
            ...x,
            lines: x.lines.map((l) => (l.id === id ? { ...l, checked: false } : l)),
          })),
        };
      },
    ],
    [
      'the LAST part was unticked after the Split (any part counts)',
      (s: WeekShoppingState, snap: SplitSnapshot) => {
        const id = snap.parts.at(-1)!.id;
        return {
          ...s,
          sections: s.sections.map((x) => ({
            ...x,
            lines: x.lines.map((l) => (l.id === id ? { ...l, checked: !l.checked } : l)),
          })),
        };
      },
    ],
    [
      'a part is gone (the drawer was reopened)',
      (s: WeekShoppingState, snap: SplitSnapshot) => {
        const id = snap.parts[0]!.id;
        return {
          ...s,
          sections: s.sections.map((x) => ({ ...x, lines: x.lines.filter((l) => l.id !== id) })),
        };
      },
    ],
    [
      'a part was merged into something else',
      (s: WeekShoppingState, snap: SplitSnapshot) => {
        const id = snap.parts[0]!.id;
        return {
          ...s,
          sections: s.sections.map((x) => ({
            ...x,
            lines: x.lines.map((l) => (l.id === id ? { ...l, mergedInto: 'other' } : l)),
          })),
        };
      },
    ],
    [
      'it is already back',
      (s: WeekShoppingState, snap: SplitSnapshot) => restoreMergedLine(s, snap),
    ],
  ])('is a no-op (the same state) when %s', (_label, change) => {
    const { snap, split } = splitFirst(mergeExactDuplicates(week()));
    const changed = change(split, snap);
    expect(restoreMergedLine(changed, snap)).toBe(changed);
  });

  it('splitSnapshotOf is null for an id that is not a merged line', () => {
    expect(splitSnapshotOf(mergeExactDuplicates(week()), 'tikka-0')).toBeNull();
  });
});
