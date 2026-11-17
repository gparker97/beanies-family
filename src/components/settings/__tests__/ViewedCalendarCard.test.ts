/**
 * ViewedCalendarCard (view-only calendars plan 2026-11-17, B): one view-only
 * calendar's settings. A view: it emits intents and never calls a store. The
 * unhealthy states show one Heritage Orange line with at most one recovery; a
 * member who cannot manage the pod sees it read-only.
 *
 * Revised after testing: the card is a row that opens (`CalendarCardShell`), a lost
 * or lapsed calendar says so on its closed row, Color is the last option, and
 * Disconnect lives in the action row at the bottom.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ViewedCalendarCard from '../ViewedCalendarCard.vue';
import { VIEW_CALENDAR_PALETTE } from '@/utils/calendar/externalEvents';
import type { ViewedCalendar } from '@/types/models';
import type { ViewCalendarState } from '@/types/externalEvents';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const CALENDAR: ViewedCalendar = {
  id: 'v1',
  viewAccountId: 'a1',
  calendarId: 'grandma@example.com',
  name: "Grandma's calendar",
  accessRole: 'reader',
  detailLevel: 'details',
  color: VIEW_CALENDAR_PALETTE[0]!,
  inBriefing: false,
  inWidgets: false,
  createdAt: '2026-11-17T00:00:00.000Z',
  updatedAt: '2026-11-17T00:00:00.000Z',
};

function mountCard(
  props: Partial<{
    calendar: ViewedCalendar;
    accountEmail: string | null;
    state: ViewCalendarState | null;
    canManage: boolean;
    canReconnect: boolean;
    busyAction: 'reconnect' | 'disconnect' | null;
    open: boolean;
  }> = {}
) {
  return mount(ViewedCalendarCard, {
    props: {
      calendar: CALENDAR,
      accountEmail: 'family@example.com',
      state: 'ok',
      canManage: true,
      canReconnect: true,
      open: true,
      ...props,
    },
    global: {
      stubs: {
        BaseButton: {
          props: ['disabled', 'loading'],
          emits: ['click'],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        ColorCircleSelector: {
          props: ['modelValue', 'colors'],
          emits: ['update:modelValue'],
          template: `<div><button v-for="c in colors" :key="c.value" class="swatch" :data-color="c.value"
            @click="$emit('update:modelValue', c.value)" /></div>`,
        },
      },
    },
  });
}

function pill(wrapper: ReturnType<typeof mountCard>, key: string) {
  return wrapper
    .get('[data-testid="viewed-calendar-detail"]')
    .findAll('button')
    .find((b) => b.text() === key)!;
}

describe('ViewedCalendarCard', () => {
  it('shows the name, who it is shared with and that it is connected, with no state line', () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain("Grandma's calendar");
    expect(wrapper.text()).toContain('calendarView.card.sharedWith');
    expect(wrapper.text()).toContain('calendarView.card.connected');
    expect(wrapper.find('[data-testid="viewed-calendar-state"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('calendarView.card.inWidgetsHint');
  });

  it('offers the neutral gray first in the color choice', () => {
    const wrapper = mountCard();
    const first = wrapper.findAll('.swatch')[0]!;
    expect(first.attributes('data-color')).toBe(VIEW_CALENDAR_PALETTE[0]);
    expect(VIEW_CALENDAR_PALETTE[0]).toBe('#6b7280');
  });

  it('emits one patch per control', async () => {
    const wrapper = mountCard();
    await pill(wrapper, 'calendarView.card.busyOnly').trigger('click');
    await wrapper.findAll('.swatch')[2]!.trigger('click');
    await wrapper.get('[data-testid="viewed-calendar-briefing"]').trigger('click');
    await wrapper.get('[data-testid="viewed-calendar-widgets"]').trigger('click');
    await wrapper.get('[data-testid="viewed-calendar-disconnect"]').trigger('click');

    expect(wrapper.emitted('update')).toEqual([
      [{ detailLevel: 'busy' }],
      [{ color: VIEW_CALENDAR_PALETTE[2] }],
      [{ inBriefing: true }],
      [{ inWidgets: true }],
    ]);
    expect(wrapper.emitted('disconnect')).toHaveLength(1);
  });

  it('does not emit a change that changes nothing', async () => {
    const wrapper = mountCard();
    await pill(wrapper, 'calendarView.card.showDetails').trigger('click');
    await wrapper.findAll('.swatch')[0]!.trigger('click');
    expect(wrapper.emitted('update')).toBeUndefined();
  });

  it('locks a free/busy calendar to busy only, with its one-line reason', async () => {
    const wrapper = mountCard({
      calendar: { ...CALENDAR, accessRole: 'freeBusyReader', detailLevel: 'details' },
    });
    expect(wrapper.find('[data-testid="viewed-calendar-busy-locked"]').text()).toBe(
      'calendarView.card.busyLocked'
    );
    // Busy only shows as selected whatever the record says.
    expect(pill(wrapper, 'calendarView.card.busyOnly').classes()).toContain('text-white');
    await pill(wrapper, 'calendarView.card.showDetails').trigger('click');
    expect(wrapper.emitted('update')).toBeUndefined();
  });

  it.each<[ViewCalendarState, string, string | null]>([
    ['unavailable', 'calendarView.card.state.unavailable', null],
    ['needs_reconnect', 'calendarView.card.state.needsReconnect', 'reconnect'],
    ['stale', 'calendarView.card.state.stale', null],
    ['truncated', 'calendarView.card.state.truncated', null],
  ])('%s shows one state line and its one recovery', async (state, key, recovery) => {
    const wrapper = mountCard({ state });
    const line = wrapper.get('[data-testid="viewed-calendar-state"]');
    expect(line.text()).toContain(key);
    // Heritage Orange with its lift, never red.
    expect(line.get('p').classes()).toEqual(
      expect.arrayContaining(['text-primary-700', 'dark:text-accent-lift'])
    );
    expect(line.html()).not.toMatch(/red-|danger/);

    const buttons = line.findAll('button');
    if (recovery === null) {
      expect(buttons).toHaveLength(0);
      return;
    }
    expect(buttons).toHaveLength(1);
    await buttons[0]!.trigger('click');
    expect(wrapper.emitted(recovery)).toHaveLength(1);
  });

  it('a lost calendar offers Disconnect once, in the action row', () => {
    const wrapper = mountCard({ state: 'unavailable' });
    expect(wrapper.findAll('[data-testid="viewed-calendar-disconnect"]')).toHaveLength(1);
    expect(
      wrapper
        .get('[data-testid="calendar-card-actions"]')
        .find('[data-testid="viewed-calendar-disconnect"]')
        .exists()
    ).toBe(true);
    expect(wrapper.text()).not.toContain('calendarView.card.connected');
  });

  it('Disconnect sits in the action row at the bottom of the body', () => {
    const wrapper = mountCard();
    const body = wrapper.get('[data-testid="calendar-card-body"]');
    const actions = body.get('[data-testid="calendar-card-actions"]');
    expect(actions.find('[data-testid="viewed-calendar-disconnect"]').exists()).toBe(true);
    expect(body.element.lastElementChild).toBe(actions.element);
  });

  it('puts Color last: detail level, the two switches, then Color', () => {
    const wrapper = mountCard();
    const order = wrapper
      .get('fieldset')
      .findAll(
        '[data-testid="viewed-calendar-detail"], [data-testid="viewed-calendar-briefing"], [data-testid="viewed-calendar-widgets"], [data-testid="viewed-calendar-color-row"]'
      )
      .map((el) => el.attributes('data-testid'));
    expect(order).toEqual([
      'viewed-calendar-detail',
      'viewed-calendar-briefing',
      'viewed-calendar-widgets',
      'viewed-calendar-color-row',
    ]);
    // Typeset like the switch labels (ToggleRow's title type), not as a section label.
    const label = wrapper.get('[data-testid="viewed-calendar-color-row"] p');
    expect(label.classes()).toEqual(
      expect.arrayContaining(['font-outfit', 'text-sm', 'font-semibold'])
    );
    expect(label.classes()).not.toContain('uppercase');
  });

  it.each<[ViewCalendarState | null, string, 'attention' | 'neutral']>([
    ['ok', 'calendarView.card.connected', 'neutral'],
    [null, 'calendarView.card.connected', 'neutral'],
    ['stale', 'calendarView.card.connected', 'neutral'],
    ['truncated', 'calendarView.card.connected', 'neutral'],
    ['unavailable', 'calendarView.card.status.unavailable', 'attention'],
    ['needs_reconnect', 'calendarView.card.status.needsReconnect', 'attention'],
  ])('the closed row shows %s as "%s" (%s)', (state, key, tone) => {
    const wrapper = mountCard({ state, open: false });
    expect(wrapper.get('[data-testid="calendar-card-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    );
    const pill = wrapper.get('[data-testid="calendar-card-status"]');
    expect(pill.text()).toBe(key);
    expect(pill.attributes('data-tone')).toBe(tone);
  });

  it('the row asks the drawer to open it', async () => {
    const wrapper = mountCard({ open: false });
    expect(wrapper.get('[data-testid="calendar-card-account"]').text()).toBe(
      'calendarView.card.sharedWith'
    );
    await wrapper.get('[data-testid="calendar-card-toggle"]').trigger('click');
    expect(wrapper.emitted('update:open')).toEqual([[true]]);
  });

  it('a read-only member can still open the row', async () => {
    const wrapper = mountCard({ canManage: false, open: false });
    await wrapper.get('[data-testid="calendar-card-toggle"]').trigger('click');
    expect(wrapper.emitted('update:open')).toEqual([[true]]);
    expect(wrapper.find('[data-testid="calendar-card-actions"]').exists()).toBe(false);
  });

  it('offers Reconnect only to whoever can finish the sign-in', () => {
    const wrapper = mountCard({ state: 'needs_reconnect', canReconnect: false });
    expect(wrapper.text()).toContain('calendarView.card.state.needsReconnect');
    expect(wrapper.find('[data-testid="viewed-calendar-reconnect"]').exists()).toBe(false);
  });

  it('is read-only for a member who cannot manage the pod', async () => {
    const wrapper = mountCard({ canManage: false, state: 'unavailable' });
    expect(wrapper.find('[data-testid="viewed-calendar-disconnect"]').exists()).toBe(false);
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(
      wrapper.get('[data-testid="viewed-calendar-briefing"]').attributes('disabled')
    ).toBeDefined();

    await pill(wrapper, 'calendarView.card.busyOnly').trigger('click');
    await wrapper.findAll('.swatch')[2]!.trigger('click');
    expect(wrapper.emitted('update')).toBeUndefined();
    expect(wrapper.emitted('disconnect')).toBeUndefined();
  });

  it('waits while an action runs on the card', async () => {
    const wrapper = mountCard({ busyAction: 'disconnect' });
    await pill(wrapper, 'calendarView.card.busyOnly').trigger('click');
    await wrapper.get('[data-testid="viewed-calendar-disconnect"]').trigger('click');
    expect(wrapper.emitted('update')).toBeUndefined();
    expect(wrapper.emitted('disconnect')).toBeUndefined();
  });
});
