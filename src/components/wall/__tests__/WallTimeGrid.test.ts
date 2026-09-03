/**
 * The grid renderer. `wallTimeGrid.test.ts` proves the arithmetic; this proves
 * the things only a rendered DOM can: paint order, which rows exist, and that a
 * failure is visible rather than silent.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import WallTimeGrid from '../WallTimeGrid.vue';
import type { FamilyActivity } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useActivityIdentity', () => ({
  useActivityIdentity: () => ({
    identityFor: () => ({
      color: '#F15D22',
      kind: 'solo',
      stackMembers: [],
      emoji: '📌',
      celebration: { celebrating: false },
      sticker: '',
      style: {},
      edgeStyle: { borderLeftColor: '#F15D22' },
      dashed: false,
    }),
  }),
}));
const logEvent = vi.fn();
const reportError = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

let seq = 0;
function occ(startTime: string, endTime?: string, over: Partial<FamilyActivity> = {}) {
  return {
    activity: {
      id: `e${seq++}`,
      title: `Event ${seq}`,
      date: '2026-09-03',
      category: 'other',
      assigneeIds: [],
      startTime,
      endTime,
      createdAt: '',
      updatedAt: '',
      ...over,
    } as FamilyActivity,
    date: '2026-09-03',
  };
}

/** jsdom gives every element a zero client rect, so the plot must be told a size. */
function stubMeasurement(height = 480, width = 700) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

async function mountGrid(props: Record<string, unknown> = {}) {
  const wrapper = mount(WallTimeGrid, {
    props: {
      columns: [{ key: 'a', occurrences: [occ('07:30', '08:00'), occ('15:20', '15:50')] }],
      allDaySpans: [],
      now: new Date('2026-09-03T15:30:00'),
      dimPast: true,
      showNow: true,
      axisWidth: 62,
      viewId: 'test',
      ...props,
    },
    global: { stubs: { CelebrationConfetti: true, ActivityOwnerStack: true } },
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  seq = 0;
  logEvent.mockClear();
  reportError.mockClear();
  stubMeasurement();
});

describe('WallTimeGrid', () => {
  it('renders a fold band labelled with the time the day resumes', async () => {
    const w = await mountGrid();
    expect(w.find('.wall-fold').exists()).toBe(true);
    expect(w.text()).toContain('wall.grid.quietUntil');
  });

  it('⭐ paints the now-line BEFORE the blocks, so it cannot strike through a title', async () => {
    // Drawn over the blocks it struck a line through the title of the very event
    // it was marking. DOM order is what puts it behind.
    const w = await mountGrid();
    const html = w.find('.wall-nowline');
    expect(html.exists()).toBe(true);
    const plotHtml = w.html();
    expect(plotHtml.indexOf('wall-nowline')).toBeLessThan(plotHtml.indexOf('wall-tblock'));
  });

  it('paints the fold LABEL after the blocks, so a nudged block cannot bury it', async () => {
    const w = await mountGrid();
    const html = w.html();
    expect(html.indexOf('wall-fold-label')).toBeGreaterThan(html.indexOf('wall-tblock'));
  });

  it('renders a shared all-day item ONCE, spanning, rather than per column', async () => {
    const shared = occ('00:00', undefined, { isAllDay: true, title: 'Term starts' });
    const w = await mountGrid({
      columns: [
        { key: 'a', occurrences: [occ('09:00', '10:00')] },
        { key: 'b', occurrences: [occ('09:00', '10:00')] },
        { key: 'c', occurrences: [occ('09:00', '10:00')] },
      ],
      allDaySpans: [{ occurrence: shared, startCol: 0, span: 3, everyone: true }],
    });
    // The wrong answer is three copies of the same sentence.
    expect(w.text().match(/Term starts/g)).toHaveLength(1);
    expect(w.text()).toContain('wall.grid.everyone');
  });

  it('renders a single-day all-day item in the band', async () => {
    const birthday = occ('00:00', undefined, { isAllDay: true, title: 'Birthday' });
    const w = await mountGrid({
      allDaySpans: [{ occurrence: birthday, startCol: 0, span: 1, everyone: false }],
    });
    expect(w.text()).toContain('Birthday');
  });

  it('⭐ shows an unreadable-time event in the band rather than losing it', async () => {
    const w = await mountGrid({
      columns: [
        {
          key: 'a',
          occurrences: [occ('abc', undefined, { title: 'Broken' }), occ('09:00', '10:00')],
        },
      ],
    });
    expect(w.text()).toContain('Broken');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'wall_grid_unreadable_time' })
    );
  });

  it('reports the layout tier once per transition, not once per render', async () => {
    const w = await mountGrid();
    const tierCalls = () => logEvent.mock.calls.filter((c) => c[0]?.message === 'wall_grid_tier');
    expect(tierCalls()).toHaveLength(1);
    // A re-render with the same shape must not emit again — the wall never
    // unmounts, and logEvent drops everything on a surface past 50/min.
    await w.setProps({ now: new Date('2026-09-03T15:31:00') });
    await nextTick();
    expect(tierCalls()).toHaveLength(1);
  });

  it('emits nothing and renders an empty plot when there is nothing on', async () => {
    const w = await mountGrid({ columns: [{ key: 'a', occurrences: [] }] });
    expect(w.text()).toContain('wall.day.nothingOn');
  });

  it('does not render a now-line on a day that is not today', async () => {
    const w = await mountGrid({ showNow: false });
    expect(w.find('.wall-nowline').exists()).toBe(false);
  });

  it('⭐ keeps the last good HEIGHT and WIDTH when the plot measures zero', async () => {
    // ⚠️ The earlier version of this dispatched a window 'resize' — which under
    // happy-dom registers no listener at all, because `useElementSize` only
    // attaches one on the no-ResizeObserver branch. It passed with the guard
    // deleted. Drive the real observer callback instead.
    //
    // The WIDTH half is the sharper half: a zero height stops the layout, but a
    // zero width did not — it left the grid fully populated with every block
    // collapsed to `sliver` density and every title thrown away.
    let fire: (() => void) | null = null;
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    try {
      const w = await mountGrid();
      expect(w.findAll('.wall-tblock').length).toBeGreaterThan(0);
      expect(w.text()).toContain('Event 1');

      stubMeasurement(0, 0);
      fire!();
      await nextTick();
      await nextTick();

      expect(w.findAll('.wall-tblock').length).toBeGreaterThan(0);
      // The titles must survive too — this is what the width fallback protects.
      expect(w.text()).toContain('Event 1');
    } finally {
      globalThis.ResizeObserver = Real;
    }
  });
});
