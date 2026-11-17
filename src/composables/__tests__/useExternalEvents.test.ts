/**
 * `useExternalEvents` owner tokens (view-only calendars plan 2026-11-17, A4). Route
 * transitions overlap: the next page mounts before the last one is disposed. A
 * disposing page must never clear the window its successor just set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { effectScope } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useExternalEvents } from '../useExternalEvents';
import { useCalendarViewStore } from '@/stores/calendarViewStore';

const MONTH = { startYmd: '2026-10-25', endYmd: '2027-01-09' };
const WEEK = { startYmd: '2026-11-09', endYmd: '2026-11-29' };

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useExternalEvents', () => {
  it('a page sets the screen window and clears it when its scope is disposed', () => {
    const store = useCalendarViewStore();
    const page = effectScope();
    page.run(() => useExternalEvents().setScreenWindow(MONTH));
    expect(store.screenWindow).toEqual(MONTH);
    page.stop();
    expect(store.screenWindow).toBeNull();
  });

  it('a disposing page cannot clear the window its successor set', () => {
    const store = useCalendarViewStore();
    const planner = effectScope();
    const wall = effectScope();
    planner.run(() => useExternalEvents().setScreenWindow(MONTH));
    wall.run(() => useExternalEvents().setScreenWindow(WEEK));
    planner.stop();
    expect(store.screenWindow).toEqual(WEEK);
    wall.stop();
    expect(store.screenWindow).toBeNull();
  });

  it('the owner can update its window and clear it with null', () => {
    const store = useCalendarViewStore();
    const scope = effectScope();
    scope.run(() => {
      const ext = useExternalEvents();
      ext.setScreenWindow(MONTH);
      ext.setScreenWindow(WEEK);
      expect(store.screenWindow).toEqual(WEEK);
      ext.setScreenWindow(null);
    });
    expect(store.screenWindow).toBeNull();
    scope.stop();
  });

  it('a reader that never set a window clears nothing on dispose', () => {
    const store = useCalendarViewStore();
    const host = effectScope();
    const reader = effectScope();
    host.run(() => useExternalEvents().setScreenWindow(MONTH));
    reader.run(() => {
      const ext = useExternalEvents();
      expect(ext.eventsForDate('2026-11-20')).toEqual([]);
      expect(ext.isActive.value).toBe(false);
    });
    reader.stop();
    expect(store.screenWindow).toEqual(MONTH);
    host.stop();
  });
});
