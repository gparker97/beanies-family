/**
 * `ExternalChip` (plan 2026-11-17, C2): a view-only external event as a striped month
 * chip. Never an activity: no drag source, no reveal hooks, no edge bar; a click asks for
 * the read-only details and nothing else.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import ExternalChip from '../ExternalChip.vue';
import { DEFAULT_CELL_CHIPS, MONTH_CELL_CHIPS, type MonthCellChips } from '../monthCellChipsKey';
import { externalEvent, FIXTURE_DATE } from '@/test/monthCellFixtures';
import { UI_STRINGS } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (UI_STRINGS as Record<string, string>)[k] ?? k }),
}));

function factory(
  event = externalEvent('School pickup', { start: '15:00' }),
  ctx: Partial<MonthCellChips> | null = null
) {
  return mount(ExternalChip, {
    props: { event, date: FIXTURE_DATE },
    global: ctx
      ? { provide: { [MONTH_CELL_CHIPS as symbol]: ref({ ...DEFAULT_CELL_CHIPS, ...ctx }) } }
      : {},
  });
}

beforeEach(() => setActivePinia(createPinia()));

describe('ExternalChip', () => {
  it('draws the stripes in the calendar color, with no edge bar and no inline background', () => {
    const w = factory(externalEvent('Bridge club', { color: '#14b8a6' }));
    expect(w.classes()).toContain('view-only-stripes');
    expect(w.classes().some((c) => c.startsWith('border-l'))).toBe(false);
    const style = w.attributes('style') ?? '';
    expect(style).toContain('--vo-hue: #14b8a6');
    expect(style).not.toContain('background');
  });

  it('shows the title and start time, and a hollow dot', () => {
    const w = factory();
    expect(w.text()).toContain('School pickup');
    expect(w.text()).toContain('3pm');
    expect(w.find('.view-only-dot').exists()).toBe(true);
  });

  it('is a button named "{title}, {time}, view only, {calendar}"', () => {
    const w = factory();
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('aria-label')).toBe("School pickup, 3pm, view only, Grandma's calendar");
  });

  it('reads "Busy" for a busy-only event, and drops the time for an all-day one', () => {
    const busy = factory(externalEvent('x', { busyOnly: true, title: undefined }));
    expect(busy.text()).toContain('Busy');
    const allDay = factory(externalEvent('Grandma away', { allDay: true }));
    expect(allDay.attributes('aria-label')).toBe("Grandma away, view only, Grandma's calendar");
  });

  it('carries no drag source or activity hooks', () => {
    const w = factory();
    expect(w.attributes('data-activity-id')).toBeUndefined();
    expect(w.attributes('data-occurrence-date')).toBeUndefined();
    expect(w.attributes('draggable')).toBeUndefined();
    expect(w.attributes('aria-describedby')).toBeUndefined();
  });

  it('emits open with the event and stops the click reaching the day under it', async () => {
    const event = externalEvent('School pickup');
    const parent = vi.fn();
    const w = mount(
      {
        components: { ExternalChip },
        props: ['event'],
        emits: ['open'],
        template: `<div @click="parent"><ExternalChip :event="event" date="${FIXTURE_DATE}" @open="(e) => $emit('open', e)" /></div>`,
        methods: { parent },
      },
      { props: { event } }
    );
    await w.find('[data-testid="external-chip"]').trigger('click');
    expect(w.emitted('open')?.[0]).toEqual([event]);
    expect(parent).not.toHaveBeenCalled();
  });

  it('inside a phone cell (not interactive) is an aria-hidden span that emits nothing', async () => {
    const w = factory(undefined, { interactive: false });
    expect(w.element.tagName).toBe('SPAN');
    expect(w.attributes('aria-hidden')).toBe('true');
    await w.trigger('click');
    expect(w.emitted('open')).toBeUndefined();
  });
});
