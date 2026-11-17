/**
 * `ExternalEventRow` (plan 2026-11-17, C2): a view-only event in the day agenda. A row has
 * room, so it spells out "view only" after the calendar's name.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import ExternalEventRow from '../ExternalEventRow.vue';
import { externalEvent, FIXTURE_DATE } from '@/test/monthCellFixtures';
import { UI_STRINGS } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (UI_STRINGS as Record<string, string>)[k] ?? k }),
}));

describe('ExternalEventRow', () => {
  it('shows the title, the time, the calendar and the words "View Only"', () => {
    const w = mount(ExternalEventRow, {
      props: { event: externalEvent('Bridge club', { start: '15:00' }), date: FIXTURE_DATE },
    });
    expect(w.text()).toContain('Bridge club');
    expect(w.text()).toContain('3pm-4pm');
    expect(w.text()).toContain("Grandma's calendar · View Only");
    expect(w.classes()).toContain('view-only-stripes');
  });

  it('is a named button that opens the details and carries no activity hooks', async () => {
    const event = externalEvent('Bridge club');
    const w = mount(ExternalEventRow, { props: { event, date: FIXTURE_DATE } });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('aria-label')).toBe("Bridge club, 3pm-4pm, view only, Grandma's calendar");
    expect(w.attributes('data-activity-id')).toBeUndefined();
    await w.trigger('click');
    expect(w.emitted('open')?.[0]).toEqual([event]);
  });

  it('reads "Busy" for a busy-only event', () => {
    const w = mount(ExternalEventRow, {
      props: {
        event: externalEvent('x', { busyOnly: true, title: undefined, calendarName: "Dad's work" }),
        date: FIXTURE_DATE,
      },
    });
    expect(w.text()).toContain('Busy');
    expect(w.text()).toContain("Dad's work");
  });
});
