/**
 * Stars and rewards (#148): the Star Report view, read in real English. What these pin:
 *  - the main table IS the Chores Done board (`ChoreWeekPanel`) for the week the page hands it,
 *    with the stepper in the board's header and the star facts as the board's extras;
 *  - stepping back asks the page for that week (`update:week`) and then reads it from the store
 *    (the frozen record), the board drawing that week's seven days;
 *  - a closed week with no record reads "No record for this week", never a zero, while the board
 *    still draws that child's chores;
 *  - the Bonus column is a signed net ("+2", "-1", a plain "0"), never "moved back"; it is a
 *    button only for a child with a bonus or take-away entry that week, and opens that child's
 *    summary (newest first: who gave or took away, the signed amount, the day and the note);
 *    an entry of the open week can be removed there behind the confirm, a closed week's cannot;
 *  - the weekly reward shows Achieved with the day; each special reward a line per child in the
 *    Special Rewards Progress card, drawn as a bar with "N of M stars", or Achieved with its day
 *    (its DATE when it was reached in an earlier week, never a weekday of the week showing);
 *  - Stars by Week: a well per kid with the kid's total directly under the name, a bar per week
 *    offered (each kid against their own weeks), the open week flagged, a missing week a gap
 *    (never a zero bar), and the subtitle naming how many weeks are drawn;
 *  - Special Rewards Progress: Add Special Reward opens the drawer empty; Rewards Settings asks
 *    the page for the Rewards view; a special reward's row opens the drawer on it; no weekly
 *    reward tile and no bonus list; one plain line when there are no special rewards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { reactive } from 'vue';

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
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ weekStartDay: 1 }) }));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
const confirmFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn }));

import type { WeekStars } from '@/utils/choreStars';
import type { ChoreAward, ChoreStarGift } from '@/types/models';

const THIS = '2026-11-16';
const LAST = '2026-11-09';
const WEEKS = [THIS, LAST, '2026-11-02', '2026-10-26', '2026-10-19'];

const ss = vi.hoisted(() => ({
  state: null as null | {
    weeks: Record<string, Record<string, WeekStars | null>>;
    awards: ChoreAward[];
    gifts: ChoreStarGift[];
  },
  removeGift: vi.fn(),
  weekFor: vi.fn(),
}));
vi.mock('@/stores/starStore', async () => {
  const kit = await import('./choreTestKit');
  return {
    useStarStore: () => ({
      earners: ['kid', 'sib'],
      get earnerMembers() {
        return kit.earnerMembersOf(['kid', 'sib']);
      },
      get sortedAwards() {
        return kit.sortedAwardsOf(ss.state!.awards);
      },
      rewards: { on: true, weeklyOn: true, title: 'Ice cream', emoji: '🍦', barPct: 80 },
      lookbackWeeks: WEEKS,
      get awards() {
        return ss.state!.awards;
      },
      get gifts() {
        return ss.state!.gifts;
      },
      weekFor: (id: string, ymd?: string) => {
        ss.weekFor(id, ymd);
        return ss.state!.weeks[id]?.[ymd ?? THIS] ?? null;
      },
      // Pip reached Disneyland on Friday 11-13 (LAST week); as of any later week it stays
      // achieved (a one-time award), with that day.
      awardsFor: (id: string, asOf?: string) =>
        ss.state!.awards.map((award) => ({
          award,
          progress:
            id === 'kid' && (asOf ?? THIS) >= LAST
              ? { fraction: 1, have: 4, need: 4, cycles: 1, stars: 160, achievedOn: '2026-11-13' }
              : { fraction: 0.25, have: 1, need: 4, cycles: 0, stars: 40 },
        })),
      removeGift: ss.removeGift,
    }),
  };
});

import StarReportView from '../StarReportView.vue';
import { repoFile } from '@/test/repoFile';
import { clock, resetKit } from './choreTestKit';

function week(start: string, over: Partial<WeekStars> = {}): WeekStars {
  return {
    weekStart: start,
    stars: 30,
    bonus: 0,
    total: 30,
    full: 40,
    bar: 32,
    days: [5, 8, 5, 4, 8, 0, 0],
    done: 27,
    due: 33,
    openToday: 0,
    ahead: 0,
    ...over,
  };
}

const gift = (id: string, date: string, stars: number, note?: string): ChoreStarGift => ({
  id,
  memberId: 'sib',
  date,
  stars,
  by: 'dad',
  note,
  createdAt: `${date}T10:00:00.000Z`,
  updatedAt: `${date}T10:00:00.000Z`,
});

beforeEach(() => {
  resetKit();
  clock.ymd = '2026-11-19';
  confirmFn.mockReset();
  logEvent.mockReset();
  ss.removeGift.mockReset();
  ss.removeGift.mockResolvedValue(true);
  ss.weekFor.mockReset();
  ss.state = reactive({
    weeks: {
      kid: {
        [THIS]: week(THIS, { stars: 10, total: 10, done: 9, due: 10, days: [4, 3, 3, 0, 0, 0, 0] }),
        [LAST]: week(LAST, { stars: 33, total: 33, hitOn: '2026-11-13' }),
        '2026-11-02': week('2026-11-02', { total: 20 }),
        '2026-10-26': null,
      },
      sib: {
        [THIS]: week(THIS, { stars: 4, bonus: 2, total: 6, full: 20, bar: 16 }),
        [LAST]: null,
        '2026-11-02': week('2026-11-02', { total: 12, full: 20, bar: 16 }),
        '2026-10-26': week('2026-10-26', { total: 15, full: 20, bar: 16 }),
      },
    },
    awards: [
      {
        id: 'a1',
        title: 'Disneyland',
        emoji: '🏰',
        kind: 'saved' as const,
        unit: 'weeks' as const,
        price: 4,
        weekStart: '2026-10-26',
        createdBy: 'mom',
        createdAt: '2026-10-26',
        updatedAt: '2026-10-26',
      },
    ],
    gifts: [gift('g1', '2026-11-17', 2, 'Helped'), gift('g0', '2026-11-11', -1, 'Bike')],
  });
});

/** Mounted as the page drives it: the week is the page's, set back from `update:week`. */
async function mountView(): Promise<VueWrapper> {
  const w: VueWrapper = mount(StarReportView, {
    props: {
      weeks: WEEKS,
      week: THIS,
      'onUpdate:week': (v: string) => w.setProps({ week: v }),
    },
    global: { stubs: { BeanieAvatar: true, BeanieIcon: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

/** A kid's star facts on the board. */
const row = (w: VueWrapper, id: string) =>
  w.get(`[data-testid="chore-week-panel-extras"][data-member-id="${id}"]`);
const fact = (w: VueWrapper, id: string, testid: string) =>
  row(w, id).get(`[data-testid="${testid}"]`).text();
/** A kid's Bonus number, when it is a button. */
const bonusButton = (w: VueWrapper, id: string) =>
  row(w, id).get('[data-testid="star-report-bonus"] [data-testid="chore-week-panel-fact-action"]');
const bonusPopover = () => document.body.querySelector('[data-testid="star-bonus-popover"]');
const stepBack = async (w: VueWrapper) => {
  await w.get('[data-testid="chore-week-stepper"] [aria-label="Previous period"]').trigger('click');
  await flushPromises();
};

describe('StarReportView', () => {
  it('the main table is the Chores Done board for the week, its stepper in the header', async () => {
    const w = await mountView();
    const view = w.get('[data-testid="star-report-view"]');
    expect(view.attributes('data-week')).toBe(THIS);
    const board = view.get('[data-testid="chore-week-panel"]');
    expect(board.get('[data-testid="chore-week-stepper"]').attributes('data-week')).toBe(THIS);
    expect(board.find('[data-testid="chore-lookback-notice"]').exists()).toBe(false);
    // The heads: stars, bonus, and the weekly reward by its name.
    expect(board.findAll('.board-extra-head').map((h) => h.text())).toEqual([
      'Stars',
      'Bonus',
      '🍦 Ice cream',
    ]);
    // One row of cells per kid, from the chore marks, and the facts beside them.
    expect(board.findAll('[data-testid="chore-week-panel-total"]')).toHaveLength(2);
    expect(fact(w, 'kid', 'star-report-stars')).toContain('10');
    expect(fact(w, 'kid', 'star-report-bonus')).toBe('Bonus0');
    expect(fact(w, 'kid', 'star-report-weekly')).toContain('10 of 32');
    expect(fact(w, 'sib', 'star-report-bonus')).toContain('+2');
    // The old bespoke table and phone cards are gone.
    expect(w.find('[data-testid="star-report-table"]').exists()).toBe(false);
    expect(w.find('[data-testid="star-report-cards"]').exists()).toBe(false);
    w.unmount();
  });

  it('the Bonus column is signed: "+2" for a bonus, "-3" for a take-away, never "moved back"', async () => {
    ss.state!.weeks.sib![THIS] = week(THIS, { stars: 4, bonus: -3, total: 1, full: 20, bar: 16 });
    // The entries that make that net (the Bonus number is a button only when they add up).
    ss.state!.gifts = [gift('t3', '2026-11-17', -3, 'Toys')];
    const w = await mountView();
    expect(bonusButton(w, 'sib').text()).toBe('-3');
    expect(fact(w, 'sib', 'star-report-bonus')).not.toMatch(/moved back/i);
    // A net take-away is neutral ink, never red and never the bonus green.
    expect(bonusButton(w, 'sib').classes()).toEqual(
      expect.arrayContaining(['text-secondary-500', 'dark:text-ink'])
    );
    expect(bonusButton(w, 'sib').html()).not.toMatch(/red-|danger|green-/);
    w.unmount();
  });

  it('a child with no entries that week: a plain "0", not a button', async () => {
    const w = await mountView();
    const bonus = row(w, 'kid').get('[data-testid="star-report-bonus"]');
    expect(bonus.find('[data-testid="chore-week-panel-fact-action"]').exists()).toBe(false);
    expect(bonus.find('button').exists()).toBe(false);
    expect(bonus.text()).toBe('Bonus0');
    // Juno has one this week: her net is a button with an accessible name.
    expect(bonusButton(w, 'sib').attributes('aria-label')).toBe("Show Juno's bonus stars (+2)");
    expect(bonusButton(w, 'sib').attributes('aria-expanded')).toBe('false');
    w.unmount();
  });

  it('the Bonus number opens the summary: newest first, who, the signed amount, the day and the note', async () => {
    ss.state!.gifts.push(gift('g2', '2026-11-18', -1, 'Toys on the stairs'));
    ss.state!.weeks.sib![THIS] = week(THIS, { stars: 4, bonus: 1, total: 5, full: 20, bar: 16 });
    const w = await mountView();
    expect(bonusButton(w, 'sib').text()).toBe('+1');
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    const pop = bonusPopover()!;
    expect(pop).not.toBeNull();
    expect(pop.getAttribute('aria-label')).toBe("Juno's Bonus Stars");
    expect(pop.textContent).toContain('Week of Nov 16');
    expect(bonusButton(w, 'sib').attributes('aria-expanded')).toBe('true');
    const entries = [...pop.querySelectorAll('[data-testid="star-bonus-entry"]')];
    expect(entries.map((e) => e.getAttribute('data-gift-id'))).toEqual(['g2', 'g1']);
    expect(entries[0]!.textContent).toContain('Papa took away 1 star');
    expect(entries[0]!.textContent).toContain('Wed. "Toys on the stairs"');
    expect(entries[0]!.querySelector('[data-testid="star-bonus-entry-amount"]')!.textContent).toBe(
      '-1'
    );
    expect(entries[1]!.textContent).toContain('Papa gave 2 bonus stars');
    expect(entries[1]!.textContent).toContain('Tue. "Helped"');
    expect(entries[1]!.querySelector('[data-testid="star-bonus-entry-amount"]')!.textContent).toBe(
      '+2'
    );
    expect(pop.textContent).not.toMatch(/moved back/i);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'report-action', context: { action: 'bonus-summary' } })
    );
    // Escape closes it and focus goes back to the number.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(bonusPopover()).toBeNull();
    expect(document.activeElement).toBe(bonusButton(w, 'sib').element);
    // An outside click closes it too.
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    expect(bonusPopover()).not.toBeNull();
    document.body.click();
    await flushPromises();
    expect(bonusPopover()).toBeNull();
    w.unmount();
  });

  it("Stars by Week: a week's bar is a button that opens its breakdown, adding up to the bar; a gap is not a button", async () => {
    ss.state!.weeks.sib![THIS] = week(THIS, {
      stars: 4,
      bonus: 2,
      total: 6,
      full: 20,
      bar: 16,
      days: [1, 2, 1, 0, 0, 0, 0],
    });
    const w = await mountView();
    const bar = (id: string, ws: string) =>
      w.get(
        `[data-testid="star-report-trend-kid"][data-member-id="${id}"] [data-testid="star-report-bar"][data-week="${ws}"]`
      );
    // A gap (no record) is a picture, never a button.
    expect(bar('sib', LAST).element.tagName).toBe('DIV');
    expect(bar('sib', LAST).attributes('role')).toBe('img');
    const sibNow = bar('sib', THIS);
    expect(sibNow.element.tagName).toBe('BUTTON');
    expect(sibNow.attributes('aria-label')).toBe(
      'Juno, week of Nov 16, 6 stars. Show the breakdown'
    );
    expect(sibNow.attributes('aria-expanded')).toBe('false');
    await sibNow.trigger('click');
    await flushPromises();
    const pop = document.body.querySelector('[data-testid="star-week-popover"]')!;
    expect(pop.getAttribute('aria-label')).toBe("Juno's Week");
    expect(pop.textContent).toContain('Week of Nov 16');
    expect(sibNow.attributes('aria-expanded')).toBe('true');
    const days = [...pop.querySelectorAll('[data-testid="star-week-day"]')];
    expect(
      days.map((d) => d.querySelector('[data-testid="star-week-day-stars"]')!.textContent)
    ).toEqual(['1 star', '2 stars', '1 star', '0 stars', '0 stars', '0 stars', '0 stars']);
    expect(days[0]!.textContent).toContain('Mon');
    // The bonus entries (who and the note), then the total: 4 + 2 = 6, the bar's number.
    const entries = [...pop.querySelectorAll('[data-testid="star-week-entry"]')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('Papa gave 2 bonus stars');
    expect(entries[0]!.textContent).toContain('"Helped"');
    expect(pop.querySelector('[data-testid="star-week-total-value"]')!.textContent).toBe('6 stars');
    expect(pop.querySelector('[data-testid="star-week-floor"]')).toBeNull();
    // Read only: nothing to remove here.
    expect(pop.querySelector('[data-testid="star-bonus-entry-remove"]')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'report-action', context: { action: 'week-breakdown' } })
    );
    // ✕ closes it and focus goes back to the bar.
    (pop.querySelector('[data-testid="star-week-popover-close"]') as HTMLElement).click();
    await flushPromises();
    expect(document.body.querySelector('[data-testid="star-week-popover"]')).toBeNull();
    expect(document.activeElement).toBe(sibNow.element);
    w.unmount();
  });

  it("one rule for the Bonus number and the week's breakdown: a closed week whose frozen bonus never took a late gift in shows a plain net, and neither lists the gift", async () => {
    // Last week was frozen with no bonus; a +2 dated in it synced later (after the re-settle
    // window), so the record never counted it.
    ss.state!.weeks.sib![LAST] = week(LAST, {
      stars: 12,
      bonus: 0,
      total: 12,
      full: 20,
      bar: 16,
      days: [4, 4, 4, 0, 0, 0, 0],
    });
    ss.state!.gifts = [gift('late', '2026-11-12', 2, 'Late')];
    const w = await mountView();
    await stepBack(w);
    const bonus = row(w, 'sib').get('[data-testid="star-report-bonus"]');
    expect(bonus.text()).toBe('Bonus0');
    expect(bonus.find('[data-testid="chore-week-panel-fact-action"]').exists()).toBe(false);
    await w
      .get(
        `[data-testid="star-report-trend-kid"][data-member-id="sib"] [data-testid="star-report-bar"][data-week="${LAST}"]`
      )
      .trigger('click');
    await flushPromises();
    const pop = document.body.querySelector('[data-testid="star-week-popover"]')!;
    expect(pop.querySelector('[data-testid="star-week-entries"]')).toBeNull();
    expect(pop.textContent).not.toContain('+2');
    expect(pop.querySelector('[data-testid="star-week-total-value"]')!.textContent).toBe(
      '12 stars'
    );
    w.unmount();
  });

  it('the open week: the Bonus number and the breakdown list the same entries', async () => {
    const w = await mountView();
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    const fromBonus = [
      ...document.body.querySelectorAll(
        '[data-testid="star-bonus-popover"] [data-testid="star-bonus-entry"]'
      ),
    ].map((e) => e.getAttribute('data-gift-id'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    await w
      .get(
        `[data-testid="star-report-trend-kid"][data-member-id="sib"] [data-testid="star-report-bar"][data-week="${THIS}"]`
      )
      .trigger('click');
    await flushPromises();
    const fromWeek = document.body.querySelectorAll(
      '[data-testid="star-week-popover"] [data-testid="star-week-entry"]'
    );
    expect(fromBonus).toEqual(['g1']);
    expect(fromWeek).toHaveLength(1);
    expect(fromWeek[0]!.textContent).toContain('Tue. "Helped"');
    w.unmount();
  });

  it('a closed week whose entries are gone shows one net line; a take-away past zero says a week never goes below zero', async () => {
    ss.state!.weeks.kid![LAST] = week(LAST, {
      stars: 2,
      bonus: -3,
      total: 0,
      days: [2, 0, 0, 0, 0, 0, 0],
    });
    const w = await mountView();
    await w
      .get(
        `[data-testid="star-report-trend-kid"][data-member-id="kid"] [data-testid="star-report-bar"][data-week="${LAST}"]`
      )
      .trigger('click');
    await flushPromises();
    const pop = document.body.querySelector('[data-testid="star-week-popover"]')!;
    expect(pop.querySelector('[data-testid="star-week-entries"]')).toBeNull();
    expect(pop.querySelector('[data-testid="star-week-net"]')!.textContent).toContain('-3');
    expect(pop.querySelector('[data-testid="star-week-total-value"]')!.textContent).toBe('0 stars');
    expect(pop.querySelector('[data-testid="star-week-floor"]')!.textContent).toContain(
      'never goes below zero'
    );
    w.unmount();
  });

  it('stepping back asks the page for that week, then reads it from the store: its days, Achieved with the day', async () => {
    const w = await mountView();
    await stepBack(w);
    expect(w.emitted('update:week')).toEqual([[LAST]]);
    expect(w.get('[data-testid="star-report-view"]').attributes('data-week')).toBe(LAST);
    expect(ss.weekFor).toHaveBeenCalledWith('kid', LAST);
    // The board draws that week's seven days, and says it is looking back.
    const days = [
      ...new Set(w.findAll('[data-testid="chore-day-cell"]').map((c) => c.attributes('data-ymd'))),
    ];
    expect(days).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(w.find('[data-testid="chore-lookback-notice"]').exists()).toBe(true);
    expect(fact(w, 'kid', 'star-report-stars')).toContain('33');
    expect(fact(w, 'kid', 'star-report-weekly')).toContain('Achieved Fri');
    expect(fact(w, 'kid', 'star-report-weekly')).toContain('33 of 32');
    // The saved-up special reward: a line per kid in the progress card, Achieved that week.
    const line = w.get('[data-testid="star-report-award"][data-member-id="kid"]');
    expect(line.attributes('data-award-id')).toBe('a1');
    expect(line.text()).toContain('Achieved Fri');
    w.unmount();
  });

  it('a closed week with no record reads "No record for this week", never a zero; the board still has its chores', async () => {
    const w = await mountView();
    await stepBack(w);
    const sib = row(w, 'sib');
    expect(sib.get('[data-testid="chore-week-panel-note"]').text()).toContain(
      'No record for this week'
    );
    expect(sib.find('[data-testid="star-report-stars"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="chore-day-cell"][data-member-id="sib"]')).toHaveLength(7);
    // No saved-up line for a child with no record that week.
    expect(w.find('[data-testid="star-report-award"][data-member-id="sib"]').exists()).toBe(false);
    w.unmount();
  });

  it('the open week: a saved-up line per kid, "Not started yet" before the award counts', async () => {
    ss.state!.awards[0]!.weekStart = '2026-11-23';
    const w = await mountView();
    const lines = w.findAll('[data-testid="star-report-award"]');
    expect(lines.map((l) => l.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    expect(lines[0]!.text()).toContain('Not started yet');
    w.unmount();
  });

  it('Stars by Week: a column per kid, its total over the weeks drawn, each kid against their own weeks', async () => {
    const w = await mountView();
    const card = w.get('[data-testid="star-report-trend"]');
    expect(card.get('h3').text()).toBe('Stars by Week');
    // All five weeks offered are drawn, so the subtitle says so.
    expect(card.get('[data-testid="star-report-trend-span"]').text()).toBe(
      'This week and the four before it'
    );
    const kid = (id: string) =>
      w.get(`[data-testid="star-report-trend-kid"][data-member-id="${id}"]`);
    const bars = (id: string) => kid(id).findAll('[data-testid="star-report-bar"]');
    // Oldest first, "Now" last; 10-19 has no data in the fake (a gap for each).
    expect(bars('kid').map((b) => b.attributes('data-total'))).toEqual([
      'none',
      'none',
      '20',
      '33',
      '10',
    ]);
    expect(bars('sib').map((b) => b.attributes('data-total'))).toEqual([
      'none',
      '15',
      '12',
      'none',
      '6',
    ]);
    expect(bars('kid')[4]!.attributes('data-open')).toBe('true');
    expect(bars('kid')[0]!.find('.trend-gap').exists()).toBe(true);
    // The total directly under each kid's name, in the same head: the stars over the weeks shown.
    const total = (id: string) => kid(id).get('[data-testid="star-report-trend-total"]');
    expect(total('kid').text()).toBe('63 stars');
    expect(total('kid').attributes('aria-label')).toBe('Pip: 63 stars over these weeks');
    expect(total('sib').text()).toBe('33 stars');
    // Scaled to the kid's own best week: Pip's 33 and Juno's 15 are both full height.
    const height = (b: VueWrapper['element'] | undefined) =>
      (b as HTMLElement).querySelector('i')!.style.getPropertyValue('--bar');
    expect(height(bars('kid')[3]!.element)).toBe('1');
    expect(height(bars('sib')[1]!.element)).toBe('1');
    w.unmount();
  });

  it("Stars by Week: each kid's total sits under their own name, in their own well", async () => {
    const w = await mountView();
    for (const [id, name, total] of [
      ['kid', 'Pip', '63 stars'],
      ['sib', 'Juno', '33 stars'],
    ] as const) {
      const kid = w.get(`[data-testid="star-report-trend-kid"][data-member-id="${id}"]`);
      const head = kid.get('[data-testid="star-report-trend-head"]');
      // Name then total, together in one block (left-aligned, the total under the name).
      const block = head.get('[data-testid="star-report-trend-name"]').element.parentElement!;
      expect([...block.children].map((c) => c.textContent)).toEqual([name, total]);
      expect(block.contains(head.get('[data-testid="star-report-trend-total"]').element)).toBe(
        true
      );
      // Each kid is a well with a dark partner: the columns read apart from each other.
      expect(kid.classes()).toEqual(
        expect.arrayContaining([
          'rounded-2xl',
          'bg-[var(--tint-slate-5)]',
          'dark:bg-surface-overlay',
        ])
      );
    }
    w.unmount();
  });

  it('Stars by Week: fewer weeks offered, the subtitle counts them', async () => {
    const w: VueWrapper = mount(StarReportView, {
      props: { weeks: [THIS, LAST], week: THIS },
      global: { stubs: { BeanieAvatar: true, BeanieIcon: true } },
    });
    await flushPromises();
    expect(w.get('[data-testid="star-report-trend-span"]').text()).toBe(
      'This week and the one before it'
    );
    expect(
      w
        .get('[data-testid="star-report-trend-kid"][data-member-id="kid"]')
        .findAll('[data-testid="star-report-bar"]')
    ).toHaveLength(2);
    w.unmount();
  });

  it("a bonus entry's day and note are one template per language (no hard-coded English full stop)", async () => {
    const { ZH_STRINGS } = await import('@/services/translation/zh');
    expect(ZH_STRINGS['choreStars.report.bonusEntry.sub']).toBe('{day}。{note}');
    expect(repoFile('src/components/chores/StarReportView.vue')).not.toContain(".join('. ')");
  });

  it('Stars by Week: the layout is a column per kid across the card, the bars stretching to a cap', () => {
    const css = repoFile('src/components/chores/StarReportView.vue');
    expect(css).toMatch(/\.trend-card \{\s*container: star-trend \/ inline-size;/);
    expect(css).toMatch(
      /@container star-trend \(width >= 26rem\) \{\s*\.trend-grid \{\s*grid-auto-columns: minmax\(0, 1fr\);\s*grid-auto-flow: column;/
    );
    expect(css).toMatch(/\.trend-bars \{\s*justify-content: center;/);
    expect(css).toMatch(/\.trend-col \{\s*max-width: 3\.5rem;/);
  });

  it('Special Rewards Progress: Add Special Reward opens the drawer empty; Rewards Settings asks for the Rewards view', async () => {
    const w = await mountView();
    const card = w.get('[data-testid="star-report-entries"]');
    expect(card.get('h3').text()).toBe('Special Rewards Progress');
    // The drawer is the page's (ONE, shared with the Rewards view): this view only asks.
    expect(w.findComponent({ name: 'ChoreAwardModal' }).exists()).toBe(false);
    await card.get('[data-testid="star-report-add-award"]').trigger('click');
    expect(w.emitted('open-award')).toEqual([[null]]);
    expect(card.get('[data-testid="star-report-add-award"]').text()).toContain(
      'Add Special Reward'
    );
    await card.get('[data-testid="star-report-rewards-settings"]').trigger('click');
    expect(w.emitted('open-rewards')).toEqual([[]]);
    expect(logEvent.mock.calls.map((c) => c[0].context.action)).toEqual([
      'add-award',
      'rewards-settings',
    ]);
    expect(logEvent.mock.calls[0]![0]).toMatchObject({
      surface: 'chore-stars',
      message: 'report-action',
    });
    w.unmount();
  });

  it("a special reward's row opens the drawer on it", async () => {
    const w = await mountView();
    // The saved-up award's own row, with an accessible name and a chevron.
    const edit = w.get('[data-testid="star-report-saved-edit"][data-award-id="a1"]');
    expect(edit.element.tagName).toBe('BUTTON');
    expect(edit.attributes('aria-label')).toBe('Edit Disneyland');
    expect(edit.text()).toContain('›');
    await edit.trigger('click');
    expect((w.emitted('open-award')![0]![0] as ChoreAward).id).toBe('a1');
    w.unmount();
  });

  it('a special reward for one kid: a line for that kid only, and its title row says who', async () => {
    ss.state!.awards = [{ ...ss.state!.awards[0]!, memberIds: ['sib'] }];
    const w = await mountView();
    const lines = w
      .findAll('[data-testid="star-report-award"][data-award-id="a1"]')
      .map((l) => l.attributes('data-member-id'));
    expect(lines).toEqual(['sib']);
    const who = w.get('[data-testid="star-report-saved-for"]');
    expect(who.attributes('data-count')).toBe('1');
    expect(who.text()).toContain('For Juno');
    w.unmount();
  });

  it('a special reward for every kid: a line per kid, no "for" mark', async () => {
    const w = await mountView();
    expect(w.findAll('[data-testid="star-report-award"][data-award-id="a1"]')).toHaveLength(2);
    expect(w.find('[data-testid="star-report-saved-for"]').exists()).toBe(false);
    w.unmount();
  });

  it('saved-up progress is drawn: a bar and "N of M stars" per kid; achieved in an earlier week reads its date', async () => {
    const w = await mountView();
    const line = (id: string) =>
      w.get(`[data-testid="star-report-award"][data-award-id="a1"][data-member-id="${id}"]`);
    // Juno: a quarter of the way, in stars at her own full week (4 full weeks of 20).
    expect(line('sib').attributes('data-state')).toBe('progress');
    const bar = line('sib').get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('25');
    expect(bar.attributes('aria-label')).toBe('Juno, Disneyland: 20 of 80 stars');
    expect(line('sib').get('[data-testid="star-report-award-bar"]').attributes('style')).toContain(
      'width: 25%'
    );
    expect(line('sib').text()).toContain('20 of 80 stars');
    // Pip reached it on Friday LAST week: this week reads the date, never "Achieved Fri".
    expect(line('kid').attributes('data-state')).toBe('achieved');
    expect(line('kid').find('[role="progressbar"]').exists()).toBe(false);
    const tag = line('kid').get('[data-testid="star-report-award-achieved"]').text();
    expect(tag).toContain('Achieved Nov 13');
    expect(tag).not.toContain('Fri');
    // Stepped back to that week, it reads the weekday.
    await stepBack(w);
    expect(line('kid').text()).toContain('Achieved Fri');
    w.unmount();
  });

  it('dark mode: every new surface and bar has its dark partner, no raw grey, no opacity on text', async () => {
    const w = await mountView();
    const card = w.get('[data-testid="star-report-entries"]');
    const settings = card.get('[data-testid="star-report-rewards-settings"]');
    expect(settings.classes()).toEqual(
      expect.arrayContaining(['bg-white', 'dark:bg-surface-overlay', 'dark:text-ink'])
    );
    const edit = card.get('[data-testid="star-report-saved-edit"]');
    expect(edit.classes()).toEqual(
      expect.arrayContaining(['dark:text-ink', 'dark:hover:bg-surface-hover'])
    );
    expect(w.get('[data-testid="star-report-trend-total"]').classes()).toEqual(
      expect.arrayContaining(['text-primary-700', 'dark:text-accent-lift'])
    );
    // The two cards this view draws itself (the board and its stepper are their own).
    for (const id of ['star-report-trend', 'star-report-entries']) {
      const html = w.get(`[data-testid="${id}"]`).html();
      expect(html).not.toMatch(/dark:(text|bg)-(gray|slate)-/);
      expect(html).not.toMatch(/text-[a-z-]+-\d+\/\d+/);
    }
    w.unmount();
  });

  it('Special Rewards Progress: both kinds, only special rewards; no weekly tile, no bonus list', async () => {
    ss.state!.awards.push({
      id: 'a2',
      title: 'Park day',
      emoji: '🛝',
      kind: 'week' as const,
      unit: 'stars' as const,
      price: 20,
      weekStart: '2026-10-26',
      createdBy: 'mom',
      createdAt: '2026-10-27',
      updatedAt: '2026-10-27',
    });
    const w = await mountView();
    const card = w.get('[data-testid="star-report-entries"]');
    const groups = card.findAll('[data-testid="star-report-saved"]');
    expect(groups.map((g) => [g.attributes('data-award-id'), g.attributes('data-kind')])).toEqual([
      ['a1', 'saved'],
      ['a2', 'week'],
    ]);
    expect(groups[0]!.get('[data-testid="star-report-saved-kind"]').text()).toBe('Saved Up');
    expect(groups[1]!.get('[data-testid="star-report-saved-kind"]').text()).toBe('This Week');
    // A line per kid on the This Week one too, with its progress toward its price.
    const lines = groups[1]!.findAll('[data-testid="star-report-award"]');
    expect(lines.map((l) => l.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    expect(lines[1]!.attributes('data-state')).toBe('progress');
    // The fake's standing for Juno: a quarter of a 4-star price (a stars price reads in stars).
    expect(lines[1]!.text()).toContain('1 of 4 stars');
    expect(lines[1]!.find('[role="progressbar"]').exists()).toBe(true);
    // Nothing else: no weekly reward tile, no bonus or take-away list.
    expect(card.find('[data-testid="star-report-achieved"]').exists()).toBe(false);
    expect(card.find('[data-testid="star-report-entry"]').exists()).toBe(false);
    expect(card.text()).not.toContain('Ice cream');
    expect(card.text()).not.toMatch(/bonus/i);
    expect(card.find('[data-testid="star-report-entries-empty"]').exists()).toBe(false);
    w.unmount();
  });

  it('Special Rewards Progress with none: one plain line, the Add button still there', async () => {
    ss.state!.awards = [];
    const w = await mountView();
    const card = w.get('[data-testid="star-report-entries"]');
    expect(card.get('[data-testid="star-report-entries-empty"]').text()).toBe(
      'No special rewards yet.'
    );
    expect(card.find('[data-testid="star-report-saved"]').exists()).toBe(false);
    expect(card.find('[data-testid="star-report-add-award"]').exists()).toBe(true);
    w.unmount();
  });

  it('the summary of the open week: a grown-up removes an entry behind the confirm, once', async () => {
    const w = await mountView();
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    const remove = () =>
      bonusPopover()!.querySelector<HTMLElement>('[data-testid="star-bonus-entry-remove"]');
    expect(bonusPopover()!.textContent).toContain('Made a mistake? Remove it here.');
    confirmFn.mockResolvedValue(false);
    remove()!.click();
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(ss.removeGift).not.toHaveBeenCalled();
    // The summary closed for the confirm; open it again and remove for real.
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    confirmFn.mockResolvedValue(true);
    remove()!.click();
    await flushPromises();
    expect(ss.removeGift).toHaveBeenCalledTimes(1);
    expect(ss.removeGift).toHaveBeenCalledWith('g1', 'mom');
    w.unmount();
  });

  it('the summary of a closed week is read only: no remove', async () => {
    ss.state!.weeks.sib![LAST] = week(LAST, { stars: 10, bonus: -1, total: 9, full: 20, bar: 16 });
    const w = await mountView();
    await stepBack(w);
    expect(bonusButton(w, 'sib').text()).toBe('-1');
    await bonusButton(w, 'sib').trigger('click');
    await flushPromises();
    const pop = bonusPopover()!;
    const entries = [...pop.querySelectorAll('[data-testid="star-bonus-entry"]')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.getAttribute('data-kind')).toBe('take');
    expect(entries[0]!.textContent).toContain('Papa took away 1 star');
    expect(entries[0]!.textContent).toContain('Wed. "Bike"');
    expect(pop.querySelector('[data-testid="star-bonus-entry-remove"]')).toBeNull();
    expect(pop.textContent).toContain('Read Only');
    w.unmount();
  });
});
