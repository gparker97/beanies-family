/**
 * View-only external events on the wall grid (plan 2026-11-17, C4): timed ones as
 * `WallExternalBlock`s in the plot, all-day ones as striped buttons in the band, both
 * opening `{ kind: 'external' }`. With nothing viewed the grid renders exactly as it
 * did: no external element, and the activity blocks where they always were.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import WallTimeGrid from '../WallTimeGrid.vue';
import { wallExternalItems } from '@/utils/wallExternalEvents';
import { externalEvent, externalExtra } from '@/test/monthCellFixtures';
import type { FamilyActivity } from '@/types/models';
import type { WallBandReference } from '@/utils/wallActivities';

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
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const DAY = '2026-09-03';
function occ(id: string, startTime: string, endTime: string) {
  return {
    activity: {
      id,
      title: id,
      date: DAY,
      category: 'other',
      assigneeIds: [],
      startTime,
      endTime,
      createdAt: '',
      updatedAt: '',
    } as unknown as FamilyActivity,
    date: DAY,
  };
}

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
      columns: [{ key: DAY, occurrences: [occ('piano', '15:00', '16:00')] }],
      allDaySpans: [],
      now: new Date(`${DAY}T09:00:00`),
      dimPast: false,
      showNow: false,
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

const blockStyles = (w: Awaited<ReturnType<typeof mountGrid>>) =>
  w.findAll('.wall-tblock').map((b) => b.attributes('style'));

beforeEach(() => stubMeasurement());

describe('WallTimeGrid: view-only external events', () => {
  it('renders nothing external, and the same blocks, when no calendar is viewed', async () => {
    const without = await mountGrid();
    const withEmpty = await mountGrid({
      columns: [{ key: DAY, occurrences: [occ('piano', '15:00', '16:00')], externals: [] }],
      bandReferences: [],
    });
    for (const w of [without, withEmpty]) {
      expect(w.find('[data-testid="wall-external-block"]').exists()).toBe(false);
      expect(w.find('[data-testid="wall-external-allday"]').exists()).toBe(false);
    }
    expect(blockStyles(withEmpty)).toEqual(blockStyles(without));
  });

  it('packs a timed external beside the activity it overlaps and opens it', async () => {
    const event = externalEvent('Bridge club', { ymd: DAY, start: '15:30', end: '17:00' });
    const w = await mountGrid({
      columns: [
        {
          key: DAY,
          occurrences: [occ('piano', '15:00', '16:00')],
          externals: wallExternalItems([event], DAY),
        },
      ],
    });
    const block = w.get('[data-testid="wall-external-block"]');
    // Two lanes: each takes part of the column, neither the whole of it.
    expect(block.attributes('style')).not.toContain('width: calc(100% - 0px)');
    expect(w.get('.wall-tblock').attributes('style')).not.toContain('width: calc(100% - 0px)');
    // Not "nothing on": the column has content.
    expect(w.text()).not.toContain('wall.day.nothingOn');

    await block.trigger('click');
    expect(w.emitted('open')).toEqual([[{ kind: 'external', event }]]);
  });

  it('counts an external-only day as not empty', async () => {
    const event = externalEvent('Busy', { ymd: DAY, start: '10:00' });
    const w = await mountGrid({
      columns: [{ key: DAY, occurrences: [], externals: wallExternalItems([event], DAY) }],
    });
    expect(w.find('[data-testid="wall-external-block"]').exists()).toBe(true);
    expect(w.text()).not.toContain('wall.day.nothingOn');
  });

  it('draws an all-day external in the band as a striped button with its calendar name', async () => {
    const event = externalEvent('Conference', { ymd: DAY, allDay: true, color: '#1a7f8e' });
    const bandReferences: WallBandReference[] = [
      { reference: { ...externalExtra(event, DAY), label: 'Conference' }, startCol: 0, span: 1 },
    ];
    const w = await mountGrid({ bandReferences });
    const pill = w.get('[data-testid="wall-external-allday"]');
    expect(pill.element.tagName).toBe('BUTTON');
    expect(pill.classes()).toContain('view-only-stripes');
    expect(pill.attributes('style')).toContain('--vo-hue: #1a7f8e');
    // No color edge: that is the activity / birthday vocabulary, not view only.
    expect(pill.attributes('style') ?? '').not.toContain('border-left');
    expect(pill.text()).toContain('Conference');
    expect(pill.text()).toContain("Grandma's calendar");

    await pill.trigger('click');
    expect(w.emitted('open')).toEqual([[{ kind: 'external', event }]]);
    expect(w.emitted('open-birthday')).toBeUndefined();
  });

  it('leaves a holiday in the band a non-interactive div, as today', async () => {
    const w = await mountGrid({
      bandReferences: [
        {
          reference: { kind: 'holiday', id: 'h', ymd: DAY, label: 'Labour Day' },
          startCol: 0,
          span: 1,
        },
      ],
    });
    const pill = w.findAll('.wall-allday').find((p) => p.text().includes('Labour Day'))!;
    expect(pill.element.tagName).toBe('DIV');
  });
});
