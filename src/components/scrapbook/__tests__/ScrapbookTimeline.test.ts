/**
 * ScrapbookTimeline: the family timeline shared by the wall viewer and the Scrapbook page.
 *
 * The month and sort rules are pinned in `utils/__tests__/scrapbookTimeline.test.ts`; this file
 * pins the component: the rail lists the months under their years, the bean row filters to a
 * bean plus the whole-family moments, owner faces, and that read-only emits nothing.
 */
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import ScrapbookTimeline from '../ScrapbookTimeline.vue';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { FamilyMember } from '@/types/models';

const { entriesRef, bindingCalls } = vi.hoisted(() => ({
  entriesRef: { value: [] as unknown[] },
  bindingCalls: { count: 0 },
}));

vi.mock('@/composables/useScrapbookFeed', () => ({
  useScrapbookFeed: () => ({
    entries: {
      get value() {
        return entriesRef.value;
      },
    },
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1' }, { id: 'm2' }] }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, currentLanguage: computed(() => 'en') }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: FamilyMember) => {
      bindingCalls.count += 1;
      return { ariaLabel: m.name };
    },
  }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const beans = [
  { id: 'm1', name: 'Leo' },
  { id: 'm2', name: 'Mia' },
] as FamilyMember[];

function entry(
  id: string,
  memberId: string | null,
  createdAt: string,
  type: ScrapType = 'favorite'
): ScrapbookEntry {
  return {
    id,
    type,
    memberId,
    effectiveDate: createdAt.slice(0, 10),
    createdAt,
    payload: { id, name: id } as unknown as ScrapbookEntry['payload'],
  };
}

const ALL = new Set<ScrapType>(['milestone', 'favorite', 'saying', 'note']);

const PieceStub = {
  name: 'ScrapbookPiece',
  props: ['entry', 'photoSize', 'emphasizePhoto', 'noteIndex', 'interactive'],
  template: '<div class="piece" :data-id="entry.id" :data-size="photoSize" />',
};

function mountTimeline(props: Record<string, unknown> = {}) {
  return mount(ScrapbookTimeline, {
    props: { beans, types: ALL, ...props },
    global: { stubs: { BeanieAvatar: true, ScrapbookPiece: PieceStub } },
  });
}

/** Text of the rail, top to bottom: year headings and month buttons interleaved. */
const railText = (w: ReturnType<typeof mountTimeline>) =>
  w
    .find('nav')
    .findAll('p, button')
    .map((n) => n.text());

const shownIds = (w: ReturnType<typeof mountTimeline>) =>
  w.findAll('.piece').map((p) => p.attributes('data-id'));

beforeEach(() => {
  setActivePinia(createPinia());
  entriesRef.value = [
    entry('nov', 'm1', '2026-11-05T12:00:00'),
    entry('oct-family', null, '2026-10-05T12:00:00', 'milestone'),
    entry('oct-mia', 'm2', '2026-10-02T12:00:00'),
    entry('dec-2025', 'm2', '2025-12-24T12:00:00'),
  ];
});

describe('ScrapbookTimeline', () => {
  it('lists the months on the rail under their year headings, newest first', () => {
    const w = mountTimeline({ readOnly: true });
    expect(railText(w)).toEqual(['2026', 'Nov', 'Oct', '2025', 'Dec']);
    expect(w.find('nav').attributes('aria-label')).toBe('scrapbook.timeline.jump');
    // Each month button is named in full, so a screen reader hears more than "Nov".
    expect(w.find('nav button').attributes('aria-label')).toBe('November 2026');
    expect(w.findAll('section h3').map((h) => h.text())).toEqual([
      'November 2026',
      'October 2026',
      'December 2025',
    ]);
  });

  it('a rail tap scrolls that month into view', async () => {
    const w = mountTimeline({ readOnly: true });
    const section = w.find('section[data-month="2025-12"]').element as HTMLElement;
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    await w.findAll('nav button')[2]!.trigger('click');
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });

  it('filters to one bean plus the whole-family moments, and back to everyone', async () => {
    const w = mountTimeline({ readOnly: true });
    expect(shownIds(w)).toEqual(['nov', 'oct-family', 'oct-mia', 'dec-2025']);

    const chips = () => w.find('[role="group"]').findAll('button');
    expect(chips().map((c) => c.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);

    await chips()[2]!.trigger('click'); // Mia
    expect(w.emitted('update:memberId')?.at(-1)).toEqual(['m2']);
    expect(shownIds(w)).toEqual(['oct-family', 'oct-mia', 'dec-2025']);
    expect(chips().map((c) => c.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);

    await chips()[0]!.trigger('click'); // Everyone
    expect(w.emitted('update:memberId')?.at(-1)).toEqual([null]);
    expect(shownIds(w)).toHaveLength(4);
  });

  it('honours a bean chosen by the parent (v-model)', () => {
    const w = mountTimeline({ readOnly: true, memberId: 'm1' });
    expect(shownIds(w)).toEqual(['nov', 'oct-family']);
  });

  it("shows the owner's face on a bean's card and none on a whole-family moment", () => {
    const w = mountTimeline({ readOnly: true });
    const cards = w.findAll('.st-card');
    const faceOn = (id: string) =>
      cards
        .find((c) => c.find(`[data-id="${id}"]`).exists())!
        .find('.st-owner')
        .exists();
    expect(faceOn('nov')).toBe(true);
    expect(faceOn('oct-family')).toBe(false);
  });

  it("takes the owner's face from the whole family, not the bean row (a pet on the wall)", () => {
    // The wall's row is humans only; Mia (m2) is not in it but is in the family.
    const w = mountTimeline({ readOnly: true, beans: [beans[0]] });
    const card = w.findAll('.st-card').find((c) => c.find('[data-id="oct-mia"]').exists())!;
    expect(card.find('.st-owner').exists()).toBe(true);
  });

  it('builds one face per bean, not one per card per render', async () => {
    entriesRef.value = Array.from({ length: 12 }, (_, i) =>
      entry(`e${i}`, i % 2 ? 'm1' : 'm2', `2026-11-${String(i + 1).padStart(2, '0')}T12:00:00`)
    );
    bindingCalls.count = 0;
    const w = mountTimeline();
    expect(w.findAll('.st-owner')).toHaveLength(12);
    expect(bindingCalls.count).toBe(2);
    await w.setProps({ types: new Set<ScrapType>(['favorite', 'milestone']) });
    expect(bindingCalls.count).toBe(2);
  });

  it('asks for screen-sized photos, so a long timeline stays light on a wall tablet', () => {
    const w = mountTimeline({ readOnly: true });
    expect(w.findAll('.piece').every((p) => p.attributes('data-size') === 'screen')).toBe(true);
  });

  it('read-only: nothing to press on a card, and nothing emitted', async () => {
    const w = mountTimeline({ readOnly: true });
    expect(w.find('.st-card button').exists()).toBe(false);
    await w.find('.piece').trigger('click');
    expect(w.emitted('entry-click')).toBeUndefined();
  });

  it('interactive: each card is a button that emits entry-click with the entry', async () => {
    const w = mountTimeline();
    const card = w.find('.st-card button');
    expect(card.exists()).toBe(true);
    await card.trigger('click');
    expect(w.emitted('entry-click')?.[0]?.[0]).toMatchObject({ id: 'nov' });
  });

  it('shows the empty slot when every type is off, never everything', () => {
    const w = mount(ScrapbookTimeline, {
      props: { beans, types: new Set<ScrapType>(), readOnly: true },
      slots: { empty: '<p class="empty-copy">nothing</p>' },
      global: { stubs: { BeanieAvatar: true, ScrapbookPiece: PieceStub } },
    });
    expect(w.find('.empty-copy').exists()).toBe(true);
    expect(w.find('nav').exists()).toBe(false);
    expect((w.vm as unknown as { isEmpty: boolean }).isEmpty).toBe(true);
  });

  it('follows the type set', async () => {
    const w = mountTimeline({ readOnly: true, types: new Set<ScrapType>(['milestone']) });
    expect(shownIds(w)).toEqual(['oct-family']);
    await w.setProps({ types: ALL });
    expect(shownIds(w)).toHaveLength(4);
  });
});
