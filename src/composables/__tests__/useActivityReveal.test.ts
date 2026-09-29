/**
 * Revealing a just-created activity on the planner: which occurrence is targeted, that the view
 * is moved BEFORE the reveal is flushed, the lookup order (exact occurrence, then its day cell,
 * then any chip of the activity), that every match gets the ring pulse, that cancel stops a
 * flush already in flight, that `revealNow` lets a moved view's own scroll settle first, and that
 * a miss is logged rather than thrown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import type { FamilyActivity } from '@/types/models';

const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ reveal, pulse: vi.fn() }),
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { useActivityReveal, findRevealElement } from '@/composables/useActivityReveal';
import { useActivityStore } from '@/stores/activityStore';

function activity(overrides: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'act-1',
    title: 'Swim',
    date: '2030-10-13',
    recurrence: 'none',
    category: 'swimming',
    isActive: true,
    createdBy: 'm1',
    createdAt: '2030-01-01T00:00:00Z',
    updatedAt: '2030-01-01T00:00:00Z',
    ...overrides,
  } as FamilyActivity;
}

function dayCell(date: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.date = date;
  return el;
}

function chip(id: string, date: string): HTMLElement {
  const el = document.createElement('button');
  el.dataset.activityId = id;
  el.dataset.occurrenceDate = date;
  return el;
}

const actions = () =>
  logEvent.mock.calls
    .map((c) => c[0] as { surface: string; context: { action: string; detail?: string } })
    .filter((e) => e.surface === 'planner-reveal')
    .map((e) => e.context);

let root: HTMLElement;
let scroller: HTMLElement;
let showDate: ReturnType<typeof vi.fn>;

function setup() {
  return useActivityReveal({
    root: ref(root),
    showDate: showDate as unknown as (ymd: string) => boolean,
    viewKind: () => 'month-mobile',
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers();
  // The app scroller is the page's `<main>` (`getAppScroller`).
  scroller = document.createElement('main');
  root = document.createElement('div');
  scroller.appendChild(root);
  document.body.appendChild(scroller);
  showDate = vi.fn().mockReturnValue(true);
});

afterEach(() => {
  scroller.remove();
  vi.useRealTimers();
});

describe('useActivityReveal', () => {
  it('targets a one-off on its date and moves the view there', () => {
    useActivityStore().activities = [activity({})];
    const r = setup();
    expect(r.prepare('act-1', 'created')).toBe(true);
    expect(showDate).toHaveBeenCalledWith('2030-10-13');
    expect(r.pending.value).toEqual({ id: 'act-1', date: '2030-10-13' });
    expect(actions()[0]).toMatchObject({ action: 'reveal_prepared', detail: 'view_moved' });
  });

  it('targets the FIRST occurrence on or after the start date, expanding one month only', () => {
    const store = useActivityStore();
    const a = activity({ recurrence: 'weekly', date: '2030-10-13' });
    store.activities = [a];
    // Start date is a Sunday but the repeat runs on Tuesdays: the first drawn one is the 15th.
    const monthEvents = vi.fn().mockReturnValue([
      { activity: a, date: '2030-10-22' },
      { activity: a, date: '2030-10-15' },
      { activity: activity({ id: 'other' }), date: '2030-10-14' },
    ]);
    store.monthEvents = monthEvents as never;
    expect(setup().firstOccurrenceDate('act-1')).toBe('2030-10-15');
    // Found in the start month, so no later month is expanded.
    expect(monthEvents).toHaveBeenCalledTimes(1);
    expect(monthEvents).toHaveBeenCalledWith(2030, 9);
  });

  it('scans forward month by month, and stops at the first month holding one', () => {
    const store = useActivityStore();
    const a = activity({ recurrence: 'yearly', date: '2030-10-13' });
    store.activities = [a];
    const monthEvents = vi.fn((year: number, month: number) =>
      year === 2031 && month === 1 ? [{ activity: a, date: '2031-02-02' }] : []
    );
    store.monthEvents = monthEvents as never;
    expect(setup().firstOccurrenceDate('act-1')).toBe('2031-02-02');
    // Oct, Nov, Dec, Jan, Feb: five months, not the whole 366-day horizon.
    expect(monthEvents).toHaveBeenCalledTimes(5);
  });

  it('falls back to the start date when nothing is drawn within the horizon', () => {
    const store = useActivityStore();
    store.activities = [activity({ recurrence: 'weekly' })];
    const monthEvents = vi.fn().mockReturnValue([]);
    store.monthEvents = monthEvents as never;
    expect(setup().firstOccurrenceDate('act-1')).toBe('2030-10-13');
    // Bounded: 13 months cover the 366-day horizon from mid-October.
    expect(monthEvents).toHaveBeenCalledTimes(13);
  });

  it('skips (and says so) when the activity is not in the store', () => {
    const r = setup();
    expect(r.prepare('ghost', 'created')).toBe(false);
    expect(showDate).not.toHaveBeenCalled();
    expect(actions()[0]).toMatchObject({ action: 'reveal_skipped' });
  });

  it('reveals the exact occurrence with the ring pulse once it renders', async () => {
    useActivityStore().activities = [activity({})];
    const r = setup();
    r.prepare('act-1', 'created');
    root.appendChild(chip('act-1', '2030-10-06'));
    const exact = chip('act-1', '2030-10-13');
    // Renders a few frames after the flush starts, as a moved view does.
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(50);
    root.appendChild(exact);
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith(exact, 'attention-ring');
    expect(r.pending.value).toBeNull();
    expect(actions().at(-1)).toMatchObject({ action: 'revealed', detail: 'occurrence' });
  });

  it('takes another chip of the activity only once the exact one has had its chance, with no day cell', async () => {
    useActivityStore().activities = [activity({})];
    const elsewhere = chip('act-1', '2030-10-06');
    root.appendChild(elsewhere);
    const r = setup();
    r.prepare('act-1', 'created');
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(100);
    expect(reveal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith(elsewhere, 'attention-ring');
    expect(actions().at(-1)).toMatchObject({ action: 'revealed', detail: 'activity' });
  });

  it("falls back to the day cell (ring pulse) before another week's chip of the repeat", async () => {
    useActivityStore().activities = [activity({})];
    // The target occurrence is folded into its cell's "+N" overflow; another week's chip of the
    // same repeat IS drawn, and must not win: it points at the wrong day.
    const day = dayCell('2030-10-13');
    root.append(chip('act-1', '2030-10-20'), day);
    const r = setup();
    r.prepare('act-1', 'created');
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(day, 'attention-ring');
    expect(actions().at(-1)).toMatchObject({ action: 'revealed', detail: 'day' });
  });

  it('logs a miss, never throws, when nothing is rendered', async () => {
    useActivityStore().activities = [activity({})];
    const r = setup();
    r.prepare('act-1', 'created');
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(actions().at(-1)).toMatchObject({ action: 'reveal_missed', detail: 'not_rendered' });
  });

  it('cancel during the wait for the chip stops the flush (no late scroll + pulse)', async () => {
    useActivityStore().activities = [activity({})];
    const r = setup();
    r.prepare('act-1', 'created');
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(50);
    r.cancel();
    root.appendChild(chip('act-1', '2030-10-13'));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(actions().at(-1)).toMatchObject({ action: 'reveal_cancelled', detail: 'superseded' });
  });

  it('a newer prepare supersedes a flush in flight, and stays parked for its own flush', async () => {
    const store = useActivityStore();
    store.activities = [activity({}), activity({ id: 'act-2', date: '2030-10-14' })];
    const r = setup();
    r.prepare('act-1', 'created');
    const done = r.flush('confirm_close');
    await vi.advanceTimersByTimeAsync(50);
    r.prepare('act-2', 'created');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(r.pending.value).toEqual({ id: 'act-2', date: '2030-10-14' });
  });

  it("revealNow waits for a moved view's own scroll to end before revealing", async () => {
    useActivityStore().activities = [activity({})];
    const exact = chip('act-1', '2030-10-13');
    root.appendChild(exact);
    const r = setup();
    const done = r.revealNow('act-1', 'eager_create');
    // The stream's anchor scroll starts a tick later and runs for a while.
    await vi.advanceTimersByTimeAsync(20);
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    expect(reveal).not.toHaveBeenCalled();
    scroller.dispatchEvent(new Event('scrollend'));
    await vi.advanceTimersByTimeAsync(20);
    await expect(done).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith(exact, 'attention-ring');
    expect(actions()).toContainEqual(
      expect.objectContaining({ action: 'view_settled', detail: 'scrollend' })
    );
  });

  it('revealNow waits only the short start window when the moved view does not scroll', async () => {
    useActivityStore().activities = [activity({})];
    root.appendChild(chip('act-1', '2030-10-13'));
    const r = setup();
    const done = r.revealNow('act-1', 'eager_create');
    await vi.advanceTimersByTimeAsync(250);
    expect(reveal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBe(true);
    expect(actions()).toContainEqual(
      expect.objectContaining({ action: 'view_settled', detail: 'no_scroll' })
    );
  });

  it('revealNow reveals at once when the view did not move', async () => {
    useActivityStore().activities = [activity({})];
    const exact = chip('act-1', '2030-10-13');
    root.appendChild(exact);
    showDate.mockReturnValue(false);
    const r = setup();
    await expect(r.revealNow('act-1', 'eager_create')).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith(exact, 'attention-ring');
  });

  it("cancel during revealNow's scroll wait drops the reveal", async () => {
    useActivityStore().activities = [activity({})];
    root.appendChild(chip('act-1', '2030-10-13'));
    const r = setup();
    const done = r.revealNow('act-1', 'eager_create');
    await vi.advanceTimersByTimeAsync(50);
    r.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('flush is a no-op after cancel', async () => {
    useActivityStore().activities = [activity({})];
    root.appendChild(chip('act-1', '2030-10-13'));
    const r = setup();
    r.prepare('act-1', 'created');
    r.cancel();
    await expect(r.flush('confirm_close')).resolves.toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe('findRevealElement', () => {
  it('prefers the exact occurrence, then the day cell, then any element of the activity', () => {
    const host = document.createElement('div');
    const target = { id: 'act-1', date: '2030-10-13' };
    const other = chip('act-1', '2030-10-06');
    host.append(chip('act-2', '2030-10-13'), other, dayCell('2030-10-06'));
    expect(findRevealElement(host, target)).toEqual({ el: other, match: 'activity' });
    const day = dayCell('2030-10-13');
    host.append(day);
    expect(findRevealElement(host, target)).toEqual({ el: day, match: 'day' });
    const exact = chip('act-1', '2030-10-13');
    host.append(exact);
    expect(findRevealElement(host, target)).toEqual({ el: exact, match: 'occurrence' });
    expect(findRevealElement(host, { id: 'nope', date: '2030-12-01' })).toBeNull();
  });
});
