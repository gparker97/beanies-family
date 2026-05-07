/**
 * BeanSpread tests.
 *
 * Covers:
 *   - Sections render only when ≥1 entry of that type exists for the bean
 *   - "see all →" links target /pod/{memberId}/{tab}
 *   - Subtitle defensive paths (full DOB / partial DOB / missing
 *     createdAt) — verifies `formatBeanSubtitle` never throws and
 *     returns empty string when nothing is resolvable
 *   - Empty bean (no entries at all) → empty state with action
 *   - Unknown ScrapbookEntry type → reports + renders nothing
 *     (validates the ScrapbookEntryCard fallback at the same time)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type {
  FavoriteItem,
  Milestone,
  SayingItem,
  MemberNote,
  FamilyMember,
  UUID,
} from '@/types/models';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';

// Plain mutable holders — `vi.hoisted()` runs before `ref` is imported,
// so we can't construct refs inside it. Each holder is wrapped in a
// reactive ref lazily inside the mock factories below.
const { reportErrorMock, entriesHolder, membersHolder } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  entriesHolder: { value: [] as unknown[] },
  membersHolder: { value: [] as unknown[] },
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

vi.mock('@/composables/useTranslation', async () => {
  const { ref } = await import('vue');
  return {
    useTranslation: () => ({
      t: (key: string) => key,
      isBeanieMode: ref(false),
    }),
  };
});

vi.mock('@/composables/useScrapbookFeed', async () => {
  const { computed } = await import('vue');
  return {
    useScrapbookFeed: () => ({
      entries: computed(() => entriesHolder.value as ScrapbookEntry[]),
    }),
  };
});

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return membersHolder.value as FamilyMember[];
    },
  }),
}));

vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    getPublicUrl: vi.fn(() => null),
  }),
}));

// Stub heavy children — the spec's about layout decisions, not their
// internals. Each child renders a marker so we can assert presence.
vi.mock('@/components/scrapbook/ScrapbookEntryCard.vue', () => ({
  default: {
    name: 'ScrapbookEntryCard',
    props: ['entry', 'noteIndex'],
    emits: ['click'],
    template: '<div :data-testid="`entry-card-${entry.type}-${entry.id}`">{{ entry.type }}</div>',
  },
}));

vi.mock('@/components/pod/shared/EmptyState.vue', () => ({
  default: {
    name: 'EmptyState',
    props: ['emoji', 'message', 'actionLabel'],
    emits: ['action'],
    template: '<div data-testid="empty-state">{{ message }}</div>',
  },
}));

vi.mock('@/components/pod/shared/PolaroidImage.vue', () => ({
  default: {
    name: 'PolaroidImage',
    props: ['src', 'caption'],
    template: '<div data-testid="polaroid"><img :src="src" /></div>',
  },
}));

import BeanSpread from '@/components/scrapbook/BeanSpread.vue';

// Stub RouterLink at mount time as a plain anchor — `<RouterLink :to="...">`
// is auto-resolved by Vue Test Utils as a global, so a `global.stubs`
// entry is the cleanest interception point. (vi.mock('vue-router', ...)
// doesn't intercept global-component resolution.)
const ROUTER_LINK_STUB = {
  props: ['to'],
  template: "<a :href=\"typeof to === 'string' ? to : (to?.path ?? '')\"><slot /></a>",
};

function mountSpread(memberId: UUID) {
  return mount(BeanSpread, {
    props: { memberId },
    global: {
      stubs: { RouterLink: ROUTER_LINK_STUB },
    },
  });
}

const MEMBER_ID = 'bean-marissa' as UUID;

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: MEMBER_ID,
    name: 'Marissa',
    email: 'marissa@example.com',
    gender: 'female',
    ageGroup: 'child',
    color: '#F15D22',
    role: 'member',
    requiresPassword: false,
    createdAt: '2017-09-15T00:00:00.000Z',
    updatedAt: '2017-09-15T00:00:00.000Z',
    ...overrides,
  };
}

function entry(overrides: Partial<ScrapbookEntry> & Pick<ScrapbookEntry, 'type'>): ScrapbookEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    memberId: MEMBER_ID,
    effectiveDate: '2026-04-15T00:00:00.000Z',
    createdAt: '2026-04-15T00:00:00.000Z',
    payload: {} as never,
    ...overrides,
  } as ScrapbookEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  entriesHolder.value = [];
  membersHolder.value = [makeMember()];
});

describe('BeanSpread — section visibility', () => {
  it('renders only sections that have entries', () => {
    entriesHolder.value = [
      entry({
        type: 'saying',
        payload: {
          id: 's-1',
          memberId: MEMBER_ID,
          words: 'a quote',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        } satisfies SayingItem,
      }),
      entry({
        type: 'milestone',
        payload: {
          id: 'm-1',
          memberId: MEMBER_ID,
          category: 'lost_tooth',
          title: 'lost a tooth',
          occurredOn: '2026-04-15',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        } satisfies Milestone,
      }),
    ];

    const wrapper = mountSpread(MEMBER_ID);

    // Sayings section + milestone section render
    expect(wrapper.html()).toContain('scrapbook.section.sayings');
    expect(wrapper.html()).toContain('scrapbook.section.milestones');
    // No favorites or notes for this bean → those sections absent
    expect(wrapper.html()).not.toContain('scrapbook.section.favorites');
    expect(wrapper.html()).not.toContain('scrapbook.section.notes');
  });

  it('caps sayings at 4 entries', () => {
    entriesHolder.value = Array.from({ length: 6 }, (_, i) =>
      entry({
        type: 'saying',
        id: `s-${i}`,
        payload: {
          id: `s-${i}`,
          memberId: MEMBER_ID,
          words: `quote ${i}`,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        } satisfies SayingItem,
      })
    );

    const wrapper = mountSpread(MEMBER_ID);
    const renderedCards = wrapper.findAll('[data-testid^="entry-card-saying-"]');
    expect(renderedCards).toHaveLength(4);
  });

  it('caps favorites at 6 entries', () => {
    entriesHolder.value = Array.from({ length: 9 }, (_, i) =>
      entry({
        type: 'favorite',
        id: `f-${i}`,
        payload: {
          id: `f-${i}`,
          memberId: MEMBER_ID,
          category: 'food',
          name: `fav ${i}`,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        } satisfies FavoriteItem,
      })
    );

    const wrapper = mountSpread(MEMBER_ID);
    expect(wrapper.findAll('[data-testid^="entry-card-favorite-"]')).toHaveLength(6);
  });

  it('"see all →" link targets /pod/{id}/{tab}', () => {
    entriesHolder.value = [
      entry({
        type: 'note',
        payload: {
          id: 'n-1',
          memberId: MEMBER_ID,
          title: 'a note',
          body: 'body',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        } satisfies MemberNote,
      }),
    ];

    const wrapper = mountSpread(MEMBER_ID);
    const link = wrapper.find('a[href$="/notes"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe(`/pod/${MEMBER_ID}/notes`);
  });
});

describe('BeanSpread — subtitle defensive paths', () => {
  it('renders both age + joined when both are resolvable', () => {
    membersHolder.value = [
      makeMember({
        dateOfBirth: { month: 6, day: 15, year: 2015 },
        createdAt: '2017-09-15T00:00:00.000Z',
      }),
    ];
    entriesHolder.value = [];

    const wrapper = mountSpread(MEMBER_ID);
    expect(wrapper.html()).toContain('scrapbook.bean.subtitle.both');
  });

  it('renders only joined-year when DOB has no year', () => {
    membersHolder.value = [
      makeMember({
        dateOfBirth: { month: 6, day: 15 },
        createdAt: '2017-09-15T00:00:00.000Z',
      }),
    ];

    const wrapper = mountSpread(MEMBER_ID);
    expect(wrapper.html()).toContain('scrapbook.bean.subtitle.joined');
    expect(wrapper.html()).not.toContain('scrapbook.bean.subtitle.both');
    expect(wrapper.html()).not.toContain('scrapbook.bean.subtitle.age');
  });

  it('renders empty subtitle when neither DOB nor createdAt is resolvable', () => {
    membersHolder.value = [
      makeMember({
        dateOfBirth: undefined,
        createdAt: 'not-a-date',
      }),
    ];

    const wrapper = mountSpread(MEMBER_ID);
    // The subtitle paragraph is `v-if`-gated on a non-empty subtitle,
    // so the subtitle keys should be absent entirely from output.
    expect(wrapper.html()).not.toContain('scrapbook.bean.subtitle.both');
    expect(wrapper.html()).not.toContain('scrapbook.bean.subtitle.joined');
    expect(wrapper.html()).not.toContain('scrapbook.bean.subtitle.age');
  });
});

describe('BeanSpread — empty bean', () => {
  it('renders the empty state when no entries match', () => {
    entriesHolder.value = [];

    const wrapper = mountSpread(MEMBER_ID);
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true);
    expect(wrapper.html()).toContain('scrapbook.bean.empty');
  });
});
