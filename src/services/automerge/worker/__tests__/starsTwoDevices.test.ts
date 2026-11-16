// @vitest-environment node
/**
 * Stars and rewards (#148), step 2: the real-Automerge two-device cases (plan Testing Plan item
 * 6) beyond the week close (`choreWeeks.test.ts`). Each device writes what the star repository,
 * the chore repository and the settings repository write, through the real `docOps`, then the
 * devices merge.
 */
import { describe, expect, it } from 'vitest';
import type { FamilyDocument } from '@/types/automerge';
import type { ChoreMark, ChoreStarGift } from '@/types/models';
import { choreMarkId, indexMarks, marksOn, REWARD_MARK_REF } from '@/utils/chores';
import { planWeekClose } from '@/utils/choreStars';
import { applyMutation } from '../docOps';
import type { MutationOp } from '../protocol';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';

const KID = 'kid';
const W0 = '2026-11-09';
const MON = '2026-11-16';
const T = '2026-11-01T08:00:00.000Z';

const plain = (doc: Doc) => JSON.parse(JSON.stringify(doc)) as FamilyDocument;
const set = (collection: string, entity: { id: string }): MutationOp => ({
  op: 'set',
  collection: collection as 'todos',
  id: entity.id,
  entity: { ...entity },
});

function giftOf(id: string, by: string, stars: number, date = '2026-11-12'): ChoreStarGift {
  return { id, memberId: KID, date, stars, by, note: 'Helped', createdAt: T, updatedAt: T };
}
function rewardMark(by: string): ChoreMark {
  return {
    id: choreMarkId('celebrated', KID, MON, REWARD_MARK_REF),
    kind: 'celebrated',
    memberId: KID,
    date: MON,
    ref: REWARD_MARK_REF,
    by,
    createdAt: T,
    updatedAt: T,
  };
}

describe('both grown-ups give a bonus at once', () => {
  it('both gifts survive the merge, and the week close counts both', () => {
    const origin = seeded([
      set('chores', {
        id: 'c1',
        title: 'Make bed',
        emoji: '🛏️',
        assigneeIds: [KID],
        block: 'morning',
        sortOrder: 0,
        createdBy: 'mom',
        createdAt: T,
        updatedAt: T,
      } as never),
    ]);
    const { a, b } = fork(origin);
    const onA = apply(a, set('choreStarGifts', giftOf('g-mom', 'mom', 2)));
    const onB = apply(b, set('choreStarGifts', giftOf('g-dad', 'dad', 3)));
    const merged = converge(onA, onB);
    const js = plain(merged.a);
    expect(Object.keys(js.choreStarGifts).sort()).toEqual(['g-dad', 'g-mom']);
    const plan = planWeekClose({
      todayYmd: MON,
      weekStartDay: 1,
      rewards: { on: true, weeklyOn: false, barPct: 100, startedOn: W0 },
      earners: [KID],
      living: new Set([KID]),
      chores: Object.values(js.chores),
      marks: [],
      gifts: Object.values(js.choreStarGifts),
      weeks: [],
    });
    expect(plan.write).toEqual([expect.objectContaining({ weekStart: W0, bonus: 5 })]);
  });
});

describe('both devices tick across the bar', () => {
  it('synced first: the second device finds the reward mark and plays no banner', () => {
    const { a, b } = fork(seeded());
    const onA = apply(a, set('choreMarks', rewardMark(KID)));
    const synced = converge(onA, b);
    // What `afterTick` asks on device B before writing (`marksOn(...).celebrated`).
    const index = indexMarks(Object.values(plain(synced.b).choreMarks));
    expect(marksOn(index, KID, MON).celebrated.has(REWARD_MARK_REF)).toBe(true);
  });

  it('offline on both: the deterministic id converges to ONE reward mark', () => {
    const { a, b } = fork(seeded());
    const onA = apply(a, set('choreMarks', rewardMark(KID)));
    const onB = apply(b, set('choreMarks', { ...rewardMark('mom') }));
    const merged = converge(onA, onB);
    const marks = Object.values(plain(merged.a).choreMarks);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'celebrated', ref: 'reward', date: MON });
    // ...and it does not disturb that day's chores (an older build asks `celebrated.has(block)`).
    const day = marksOn(indexMarks(marks), KID, MON);
    expect([...day.celebrated]).toEqual([REWARD_MARK_REF]);
  });
});

describe('two grown-ups change different stars settings', () => {
  it('per-key merge keeps both changes (MERGE_FIELDS choreRewards)', () => {
    const base = { on: true, startedOn: W0, weeklyOn: true, title: 'Ice cream', barPct: 100 };
    const origin = applyMutation(seeded(), {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { id: 'app_settings', choreRewards: base }, base: {} },
    }).doc;
    const { a, b } = fork(origin);
    // What `settingsRepo.saveSettings` sends: the whole object with one key changed, and the
    // projection's value as the base.
    const onA = applyMutation(a, {
      op: 'named',
      name: 'patchSettings',
      args: {
        patch: { id: 'app_settings', choreRewards: { ...base, barPct: 80 } },
        base: { choreRewards: base },
      },
    }).doc;
    const onB = applyMutation(b, {
      op: 'named',
      name: 'patchSettings',
      args: {
        patch: { id: 'app_settings', choreRewards: { ...base, title: 'Pizza', emoji: '🍕' } },
        base: { choreRewards: base },
      },
    }).doc;
    const merged = converge(onA, onB);
    expect(plain(merged.a).settings?.choreRewards).toEqual({
      ...base,
      barPct: 80,
      title: 'Pizza',
      emoji: '🍕',
    });
  });
});
