/**
 * `MonthDayPopover` (#141): the desktop "+N more" popover, one instance per grid, keyed by
 * date. Opened through its exposed `openFor`, the way `CalendarGrid` does.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'planner.moreEventsShort') return 'more';
      if (key === 'planner.moreEvents') return '{count} more activities';
      return key;
    },
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const MEMBERS = [member('m-aria', 'Aria'), member('m-bo', 'Bo')];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: MEMBERS, humans: MEMBERS }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string) => MEMBERS.find((m) => m.id === id),
    getMemberName: (id: string) => MEMBERS.find((m) => m.id === id)?.name ?? 'Unknown',
    getMemberColor: (id: string, fallback = '#6b7280') =>
      MEMBERS.find((m) => m.id === id)?.color ?? fallback,
  }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  document.body.innerHTML = '';
});

import MonthDayPopover from '../MonthDayPopover.vue';
import type { MonthDayCellData } from '@/utils/monthCells';
import { allDay, birthday, cell, timed } from '@/test/monthCellFixtures';

interface Exposed {
  openFor: (date: string, trigger: HTMLElement) => void;
  close: (returnFocus?: boolean) => void;
}

const popoverEl = () =>
  document.body.querySelector<HTMLElement>('[data-testid="month-day-popover"]');
const chips = () => document.body.querySelectorAll('[data-testid="month-chip"]');

function makeTrigger(): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = '+2 more';
  document.body.appendChild(b);
  return b;
}

function mountPopover(initial: MonthDayCellData | null) {
  const wrapper = mount(MonthDayPopover, { props: { cell: initial }, attachTo: document.body });
  return { wrapper, api: wrapper.vm as unknown as Exposed };
}

const busyDay = (n = 3, extra: Partial<MonthDayCellData> = {}) =>
  cell({
    timedOccurrences: Array.from({ length: n }, (_, i) => timed(`t${i}`, `0${i + 8}:00`)),
    ...extra,
  });

beforeEach(() => vi.mocked(logEvent).mockClear());

describe('MonthDayPopover', () => {
  it('openFor lists every item at full anatomy, under the day caption', async () => {
    const day = busyDay(8, { allDayItems: [allDay('ad1')], extras: [birthday()] });
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    expect(popoverEl()).not.toBeNull();
    expect(popoverEl()!.getAttribute('role')).toBe('dialog');
    expect(chips()).toHaveLength(8);
    expect(document.body.querySelectorAll('[data-testid="all-day-activity-chip"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[data-testid="birthday-chip"]')).toHaveLength(1);
    // Full anatomy: times shown, no "+N more" of its own.
    expect(popoverEl()!.textContent).toContain('8am');
    expect(document.body.querySelector('[data-testid="day-contents-more"]')).toBeNull();
    expect(popoverEl()!.getAttribute('aria-label')).toBeTruthy();
    wrapper.unmount();
  });

  it('openFor emits update:date and logs day_opened with stage more', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    expect(wrapper.emitted('update:date')).toEqual([[day.date]]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'day_opened',
        context: { action: 'day_opened', format: 'desktop', stage: 'more' },
      })
    );
    wrapper.unmount();
  });

  it('emits update:date with the date on open and null when it closes itself', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    expect(wrapper.emitted('update:date')).toEqual([[day.date]]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(wrapper.emitted('update:date')).toEqual([[day.date], [null]]);
    wrapper.unmount();
  });

  it('opening again on the same trigger closes it', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    const trigger = makeTrigger();
    api.openFor(day.date, trigger);
    await nextTick();
    expect(popoverEl()).not.toBeNull();
    api.openFor(day.date, trigger);
    await nextTick();
    expect(popoverEl()).toBeNull();
    wrapper.unmount();
  });

  it('a changed cell prop re-renders live', async () => {
    const day = busyDay(2);
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    expect(chips()).toHaveLength(2);
    await wrapper.setProps({ cell: busyDay(5) });
    expect(chips()).toHaveLength(5);
    wrapper.unmount();
  });

  it('a null cell closes it', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    await wrapper.setProps({ cell: null });
    await nextTick();
    expect(popoverEl()).toBeNull();
    // And a later cell does not resurrect it.
    await wrapper.setProps({ cell: day });
    expect(popoverEl()).toBeNull();
    wrapper.unmount();
  });

  it('a disconnected trigger closes it on the next cell update', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    const trigger = makeTrigger();
    api.openFor(day.date, trigger);
    await nextTick();
    trigger.remove(); // a sync removed items, so the day's "+N more" unmounted
    await wrapper.setProps({ cell: busyDay(1) });
    await nextTick();
    expect(popoverEl()).toBeNull();
    wrapper.unmount();
  });

  it('a chip click emits view-activity, closes it, and never emits select-date', async () => {
    const day = busyDay(2);
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    chips()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('view-activity')).toEqual([['t1', day.date]]);
    expect(popoverEl()).toBeNull();
    expect(wrapper.emitted('select-date')).toBeUndefined();
    wrapper.unmount();
  });

  it('forwards birthday-click, closing first', async () => {
    const b = birthday('m1', 'Joey');
    const day = cell({ extras: [b], timedOccurrences: [timed('t1')] });
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    document.body
      .querySelector('[data-testid="birthday-chip"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('birthday-click')).toEqual([[b.birthday]]);
    expect(popoverEl()).toBeNull();
    wrapper.unmount();
  });

  it('Escape closes it and returns focus to the trigger', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    const trigger = makeTrigger();
    api.openFor(day.date, trigger);
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(popoverEl()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it('closing from a cell that vanished does not move focus', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    const trigger = makeTrigger();
    const other = makeTrigger();
    other.focus();
    api.openFor(day.date, trigger);
    await nextTick();
    other.focus();
    await wrapper.setProps({ cell: null });
    await nextTick();
    expect(document.activeElement).toBe(other);
    wrapper.unmount();
  });

  it('a click inside the panel does not close it', async () => {
    const day = busyDay();
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    popoverEl()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(popoverEl()).not.toBeNull();
    wrapper.unmount();
  });

  it('ArrowDown roves focus across the data-day-item rows', async () => {
    const day = busyDay(3);
    const { wrapper, api } = mountPopover(day);
    api.openFor(day.date, makeTrigger());
    await nextTick();
    await nextTick();
    const rows = Array.from(document.body.querySelectorAll<HTMLElement>('[data-day-item]'));
    expect(rows).toHaveLength(3);
    rows[0]!.focus();
    popoverEl()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    wrapper.unmount();
  });
});
