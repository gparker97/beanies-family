/**
 * The copy RULES, asserted directly. No Pinia, no repo mocks, no clock — which is the
 * whole reason `buildCopySeeds` is a pure module rather than a block inside the store.
 */
import { describe, it, expect } from 'vitest';
import { buildCopySeeds, freshItems } from '../listSeed';
import type { FamilyList } from '@/types/models';

function source(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'src-1',
    title: 'Saturday Chores',
    emoji: '🧹',
    category: 'kids',
    ownerId: 'm-joey',
    items: [
      {
        id: 'i-1',
        title: 'Make the bed',
        completed: true,
        completedBy: 'm-joey',
        completedAt: 'x',
      },
      { id: 'i-2', title: 'Feed the dog', completed: false },
    ],
    lifecycle: 'oneoff',
    completed: true,
    completedBy: 'm-joey',
    completedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'm-greg',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const OWNERS = [
  { id: 'm-joey', name: 'Joey' },
  { id: 'm-ollie', name: 'Ollie' },
];

const build = (src: FamilyList, titleTemplate = "{bean}'s {list}", owners = OWNERS) =>
  buildCopySeeds({ source: src, owners, titleTemplate, today: '2026-09-07', createdBy: 'm-greg' });

describe('freshItems', () => {
  it('gives every item a new id and an unticked state', () => {
    const items = freshItems(['a', 'b']);
    expect(items.map((i) => i.title)).toEqual(['a', 'b']);
    expect(items.every((i) => !i.completed)).toBe(true);
    expect(items[0].id).not.toEqual(items[1].id);
  });
});

describe('buildCopySeeds', () => {
  it('produces one seed per owner, in selection order, owned by that bean', () => {
    const seeds = build(source());
    expect(seeds).toHaveLength(2);
    expect(seeds.map((s) => s.ownerId)).toEqual(['m-joey', 'm-ollie']);
  });

  it('expands {bean} per owner and leaves {list} already filled', () => {
    // `{list}` is substituted by the modal when it seeds the field; the store only
    // ever expands `{bean}`. Here the template arrives with `{list}` still in it, so
    // it must survive untouched rather than render as an empty string.
    const seeds = build(source(), "{bean}'s Chores");
    expect(seeds.map((s) => s.title)).toEqual(["Joey's Chores", "Ollie's Chores"]);
  });

  it('does not let a $ in a member name corrupt the title', () => {
    // A plain String.replace would interpret `$&` as a replacement pattern.
    const seeds = build(source(), '{bean} list', [{ id: 'm-x', name: 'A$& B' }]);
    expect(seeds[0].title).toBe('A$& B list');
  });

  it('falls back to the source title when the template expands to nothing', () => {
    const seeds = build(source(), '   ');
    expect(seeds[0].title).toBe('Saturday Chores');
  });

  it('gives every copy fresh, unticked items in the original order', () => {
    const seeds = build(source());
    for (const seed of seeds) {
      expect(seed.items.map((i) => i.title)).toEqual(['Make the bed', 'Feed the dog']);
      expect(seed.items.every((i) => !i.completed)).toBe(true);
      expect(seed.items.every((i) => i.completedBy === undefined)).toBe(true);
      expect(seed.items.every((i) => i.completedAt === undefined)).toBe(true);
      expect(seed.items.map((i) => i.id)).not.toContain('i-1');
    }
    // Two copies must not share item ids either.
    expect(seeds[0].items[0].id).not.toEqual(seeds[1].items[0].id);
  });

  it('clears the list-level completion triple even when the source is filed', () => {
    const seeds = build(source());
    expect(seeds[0].completed).toBe(false);
    expect(seeds[0].completedBy).toBeUndefined();
    expect(seeds[0].completedAt).toBeUndefined();
  });

  it('drops links, dueDate and templateKey', () => {
    const seeds = build(
      source({
        linkedActivityId: 'a-1',
        linkedVacationId: 'v-1',
        dueDate: '2026-09-30',
        templateKey: 'kids-chores',
      })
    );
    expect(seeds[0].linkedActivityId).toBeUndefined();
    expect(seeds[0].linkedVacationId).toBeUndefined();
    expect(seeds[0].dueDate).toBeUndefined();
    expect(seeds[0].templateKey).toBeUndefined();
  });

  it('carries emoji, category, lifecycle, cadence and the frequency shadow', () => {
    const cadence = { kind: 'weekly', interval: 1 } as unknown as FamilyList['cadence'];
    const seeds = build(source({ lifecycle: 'recurring', frequency: 'weekly', cadence }));
    expect(seeds[0].emoji).toBe('🧹');
    expect(seeds[0].category).toBe('kids');
    expect(seeds[0].lifecycle).toBe('recurring');
    expect(seeds[0].frequency).toBe('weekly');
    expect(seeds[0].cadence).toBe(cadence);
  });

  it('stamps lastResetDate only for a recurring source, so a copy does not reset today', () => {
    expect(build(source({ lifecycle: 'recurring', frequency: 'weekly' }))[0].lastResetDate).toBe(
      '2026-09-07'
    );
    expect(build(source())[0].lastResetDate).toBeUndefined();
  });

  it('never arms the cycle celebration on a copy', () => {
    const seeds = build(
      source({ lifecycle: 'recurring', frequency: 'weekly', cycleCelebrated: true })
    );
    expect(seeds[0].cycleCelebrated).toBe(false);
  });

  it('attributes the copy to the member performing it, not the source creator', () => {
    const seeds = buildCopySeeds({
      source: source({ createdBy: 'm-someone-else' }),
      owners: OWNERS,
      titleTemplate: '{bean}',
      today: '2026-09-07',
      createdBy: 'm-greg',
    });
    expect(seeds.every((s) => s.createdBy === 'm-greg')).toBe(true);
  });

  it('copies an empty list without complaint', () => {
    const seeds = build(source({ items: [] }));
    expect(seeds[0].items).toEqual([]);
  });

  it('returns nothing when no bean was selected', () => {
    expect(build(source(), '{bean}', [])).toEqual([]);
  });
});
