/**
 * The wall's stars sheet (#154), read in real English. What these pin: the state precedence
 * (off, then adult, then loading, then bare, then stars), so a grown-up with rewards off reads
 * "off", a weekly reward with no special reward is still "stars", stores not loaded show the
 * quiet loading line and never read a strip, and no children means no chips; the earned banner
 * when the weekly reward is reached; a complete special reward's Earned badge; the week's gifts
 * through the store's getter and its net-only answer; a child chip asking to switch; and the
 * telemetry (the state once per bean shown, unknown-member at warn, gifts-net-only at info, only
 * the `action` key).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import type { ChoreAward, ChoreStarGift, FamilyMember } from '@/types/models';
import type { WeekStars } from '@/utils/choreStars';

vi.mock('@/composables/useTranslation', async () => {
  const { computed } = await import('vue');
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  const strings = UI_STRINGS as Record<string, string>;
  return {
    useTranslation: () => ({
      t: (k: string) => strings[k] ?? k,
      currentLanguage: computed(() => 'en'),
    }),
  };
});
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

const kid = { id: 'kid', name: 'Mia Lee' } as FamilyMember;
const sib = { id: 'sib', name: 'Leo Lee' } as FamilyMember;
const dad = { id: 'dad', name: 'Sam Lee' } as FamilyMember;
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [kid, sib, dad] }),
}));

function week(over: Partial<WeekStars> = {}): WeekStars {
  return {
    weekStart: '2026-11-16',
    stars: 12,
    bonus: 0,
    total: 12,
    full: 20,
    bar: 16,
    days: [4, 4, 4, 0, 0, 0, 0],
    done: 12,
    due: 14,
    openToday: 2,
    ahead: 6,
    ...over,
  };
}

const store = vi.hoisted(() => ({ state: null as null | Record<string, unknown> }));
vi.mock('@/stores/starStore', () => ({ useStarStore: () => store.state }));

function award(id: string, over: Partial<ChoreAward> = {}): ChoreAward {
  return {
    id,
    title: 'Theme Park Day',
    emoji: '🎢',
    kind: 'saved',
    unit: 'stars',
    price: 120,
    ...over,
  } as ChoreAward;
}

const gift = (id: string, date: string, stars: number, note?: string): ChoreStarGift =>
  ({ id, memberId: 'kid', date, stars, by: 'dad', note }) as ChoreStarGift;

let s: {
  isOn: boolean;
  earners: string[];
  earnerMembers: FamilyMember[];
  rewards: Record<string, unknown>;
  strip: { week: WeekStars; reached: boolean } | null;
  awards: { award: ChoreAward; progress: Record<string, unknown> }[];
  gifts: ChoreStarGift[] | null;
};

beforeEach(() => {
  logEvent.mockReset();
  s = reactive({
    isOn: true,
    earners: ['kid', 'sib'],
    earnerMembers: [kid, sib],
    rewards: { on: true, weeklyOn: true, title: 'Ice cream', emoji: '🍦', barPct: 80 },
    strip: { week: week(), reached: false },
    awards: [],
    gifts: [],
  });
  store.state = {
    get isOn() {
      return s.isOn;
    },
    get earners() {
      return s.earners;
    },
    get earnerMembers() {
      return s.earnerMembers;
    },
    get rewards() {
      return s.rewards;
    },
    stripFor: () =>
      s.strip
        ? {
            week: s.strip.week,
            path: { reached: s.strip.reached },
            nearest: null,
            thisWeek: null,
          }
        : null,
    awardsFor: () => s.awards,
    weekGiftsFor: () => s.gifts,
    weekFor: (id: string) => (id === 'kid' ? week() : id === 'sib' ? week({ total: 9 }) : null),
  };
});

import WallStarsSheet from '../WallStarsSheet.vue';

function mountSheet(memberId = 'kid') {
  return mount(WallStarsSheet, {
    props: { memberId },
    global: { stubs: { StarPathStrip: true, BeanieAvatar: true } },
  });
}

const stateOf = (w: ReturnType<typeof mountSheet>) =>
  w.get('[data-testid="wall-stars-sheet"]').attributes('data-state');
const stateEvents = () =>
  logEvent.mock.calls.map(([e]) => e).filter((e) => e.message === 'stars_sheet_state');

describe('WallStarsSheet: which state', () => {
  it('rewards off reads "off", for a grown-up too', () => {
    s.isOn = false;
    const w = mountSheet('dad');
    expect(stateOf(w)).toBe('off');
    expect(w.text()).toContain('Stars and Rewards Is Not Turned On');
    expect(w.text()).toContain('under The Choreboard, then Rewards');
    expect(stateEvents()).toEqual([
      {
        level: 'info',
        surface: 'beanie-wall',
        message: 'stars_sheet_state',
        context: { action: 'off' },
      },
    ]);
  });

  it('a grown-up: one friendly line and a chip per child that asks to switch', async () => {
    const w = mountSheet('dad');
    expect(stateOf(w)).toBe('adult');
    expect(w.text()).toContain('Stars Are for the Kids');
    expect(w.text()).toContain('Tap a child to see their stars.');
    const chips = w.findAll('[data-testid="wall-stars-kid"]');
    expect(chips.map((c) => c.attributes('aria-label'))).toEqual([
      "Show Mia's Stars",
      "Show Leo's Stars",
    ]);
    expect(chips[1]!.text()).toContain('9');
    await chips[1]!.trigger('click');
    expect(w.emitted('switch-member')).toEqual([['sib']]);
  });

  it('no children at all: no chips and no "tap a child" line', () => {
    s.earners = [];
    s.earnerMembers = [];
    const w = mountSheet('dad');
    expect(stateOf(w)).toBe('adult');
    expect(w.find('[data-testid="wall-stars-kid"]').exists()).toBe(false);
    expect(w.text()).not.toContain('Tap a child');
  });

  it('a member this device no longer knows: the adult explanation, logged at warn', () => {
    const w = mountSheet('ghost');
    expect(stateOf(w)).toBe('adult');
    expect(stateEvents()).toEqual([
      {
        level: 'warn',
        surface: 'beanie-wall',
        message: 'stars_sheet_state',
        context: { action: 'unknown-member' },
      },
    ]);
  });

  it('stores not loaded: the quiet loading line, nothing logged until the state is known', async () => {
    s.strip = null;
    const w = mountSheet();
    expect(stateOf(w)).toBe('loading');
    expect(w.get('[data-testid="wall-stars-loading"]').text()).toBe('Loading...');
    expect(stateEvents()).toEqual([]);
    s.strip = { week: week(), reached: false };
    await nextTick();
    expect(stateOf(w)).toBe('stars');
    expect(stateEvents().map((e) => e.context)).toEqual([{ action: 'stars' }]);
  });

  it('on, but no weekly reward and no special reward: their stars this week and where to add one', () => {
    s.rewards = { ...s.rewards, weeklyOn: false };
    const w = mountSheet();
    expect(stateOf(w)).toBe('bare');
    expect(w.get('[data-testid="empty-state-title"]').text()).toBe('12 stars this week');
    expect(w.get('[data-testid="empty-state-title"]').classes()).toContain('text-2xl');
    expect(w.text()).toContain('No reward is set up for Mia yet.');
  });

  it('a weekly reward with no special reward is still "stars"', () => {
    const w = mountSheet();
    expect(stateOf(w)).toBe('stars');
    expect(w.find('[data-testid="wall-stars-week"]').exists()).toBe(true);
    expect(w.find('[data-testid="wall-stars-awards"]').exists()).toBe(false);
    expect(w.find('[data-testid="reward-earned-banner"]').exists()).toBe(false);
  });

  it('a chip switch logs the new bean’s state once', async () => {
    const w = mountSheet('dad');
    await w.setProps({ memberId: 'kid' });
    expect(stateEvents().map((e) => e.context)).toEqual([{ action: 'adult' }, { action: 'stars' }]);
    // Only the `action` key, never a name or an id.
    for (const e of logEvent.mock.calls.map(([x]) => x)) {
      expect(Object.keys(e.context)).toEqual(['action']);
    }
  });
});

describe('WallStarsSheet: a child with stars', () => {
  it('the weekly reward reached: the earned banner with the reward, the day and the stars', () => {
    s.strip = { week: week({ total: 18, hitOn: '2026-11-19' }), reached: true };
    const w = mountSheet();
    const banner = w.get('[data-testid="reward-earned-banner"]');
    expect(banner.text()).toContain('Ice cream earned!');
    expect(banner.text()).toContain('Mia reached the weekly reward on Thursday with 18 stars.');
    expect(banner.get('[data-testid="reward-earned-emoji"]').text()).toContain('🍦');
  });

  it('an unnamed weekly reward earned reads "Weekly reward earned!", capitalised', () => {
    s.rewards = { ...s.rewards, title: '' };
    s.strip = { week: week({ total: 18, hitOn: '2026-11-19' }), reached: true };
    const w = mountSheet();
    expect(w.get('[data-testid="reward-earned-banner"]').text()).toContain('Weekly reward earned!');
  });

  it('each special reward with its progress; a complete one says Earned over a full bar', () => {
    s.awards = [
      {
        award: award('gum', { title: 'Bubble Gum Ice Cream', emoji: '🍨' }),
        progress: {
          fraction: 1,
          have: 120,
          need: 120,
          cycles: 1,
          stars: 120,
          achievedOn: '2026-11-18',
        },
      },
      {
        award: award('park'),
        progress: { fraction: 0.375, have: 45, need: 120, cycles: 0, stars: 45 },
      },
    ];
    const w = mountSheet();
    const rows = w.findAll('[data-testid="wall-stars-award"]');
    expect(rows.map((r) => r.attributes('data-state'))).toEqual(['achieved', 'progress']);
    expect(rows[0]!.get('[data-testid="wall-stars-earned"]').text()).toContain('Earned!');
    expect(rows[0]!.get('[data-testid="wall-stars-award-bar"]').attributes('style')).toContain(
      'width: 100%'
    );
    expect(rows[1]!.find('[data-testid="wall-stars-earned"]').exists()).toBe(false);
    expect(rows[1]!.text()).toContain('45 of 120 stars');
  });

  it("the week's bonus and take-away entries: who, the day, the note and the signed amount", () => {
    s.gifts = [gift('g1', '2026-11-17', 2, 'Helped Grandma'), gift('g2', '2026-11-18', -1)];
    const w = mountSheet();
    const rows = w.findAll('[data-testid="wall-stars-gift"]');
    expect(rows.map((r) => r.attributes('data-kind'))).toEqual(['bonus', 'take']);
    expect(rows[0]!.text()).toContain('Sam gave 2 bonus stars');
    expect(rows[0]!.text()).toContain('Helped Grandma');
    expect(rows.map((r) => r.get('[data-testid="wall-stars-gift-amount"]').text())).toEqual([
      '+2',
      '-1',
    ]);
  });

  it('wall scale: the strip, reward rows and bonus rows at lg; two columns from a wide sheet', () => {
    s.awards = [
      {
        award: award('park'),
        progress: { fraction: 0.375, have: 45, need: 120, cycles: 0, stars: 45 },
      },
    ];
    s.gifts = [gift('g1', '2026-11-17', 2, 'Helped Grandma')];
    const w = mountSheet();
    expect(w.get('star-path-strip-stub').attributes('size')).toBe('lg');
    const grid = w.get('[data-testid="wall-stars-week"]').element.parentElement!;
    expect(grid.className).toContain('@3xl:grid-cols-2');
    expect(grid.getAttribute('style')).toBeNull();
    expect(w.get('[data-testid="wall-stars-week"]').classes()).not.toContain('col-span-full');
    expect(w.get('[data-testid="wall-stars-gifts"]').classes()).toContain('col-span-full');
    expect(w.get('[data-testid="wall-stars-award"] [role="progressbar"]').classes()).toContain(
      'h-3'
    );
    expect(w.get('[data-testid="wall-stars-gift-amount"]').classes()).toContain('text-xl');
  });

  it('no special rewards: This Week takes the full width', () => {
    const w = mountSheet();
    expect(w.get('[data-testid="wall-stars-week"]').classes()).toContain('col-span-full');
  });

  it('no gifts this week: no gifts card', () => {
    const w = mountSheet();
    expect(w.find('[data-testid="wall-stars-gifts"]').exists()).toBe(false);
  });

  it('entries that no longer add up: the net alone, logged at info', () => {
    s.gifts = null;
    s.strip = { week: week({ bonus: 3, total: 15 }), reached: false };
    const w = mountSheet();
    const net = w.get('[data-testid="wall-stars-gifts-net"]');
    expect(net.text()).toContain('Bonus stars, given and taken away');
    expect(net.text()).toContain('+3');
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'beanie-wall',
      message: 'stars_sheet_gifts',
      context: { action: 'gifts-net-only' },
    });
  });
});
