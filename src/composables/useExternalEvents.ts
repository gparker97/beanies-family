/**
 * View-only external calendar events, for the calendar surfaces (plan 2026-11-17, A4).
 *
 * Components only READ: the selectors here are read-only passthroughs of
 * `calendarViewStore`. Only a page host (the planner page, the wall page) calls
 * `setScreenWindow`, so nothing fights over the one `screen` window.
 *
 * Ownership: each `useExternalEvents()` call holds its own owner token. Setting a
 * window takes it over; clearing (explicitly, or automatically when the caller's
 * scope is disposed) only clears a window this caller still owns. So a page being
 * torn down after its successor mounted (route transitions overlap) cannot wipe the
 * successor's window.
 */
import { computed, getCurrentScope, onScopeDispose, type ComputedRef } from 'vue';
import { useCalendarViewStore } from '@/stores/calendarViewStore';
import type { ExternalEvent, ViewCalendarState, YmdRange } from '@/types/externalEvents';

export interface UseExternalEvents {
  /** Page hosts only: the visible range already widened by one period each side, or `null` to clear. */
  setScreenWindow: (range: YmdRange | null) => void;
  isActive: ComputedRef<boolean>;
  events: ComputedRef<readonly ExternalEvent[]>;
  eventsByDate: ComputedRef<ReadonlyMap<string, ExternalEvent[]>>;
  briefingEvents: ComputedRef<readonly ExternalEvent[]>;
  widgetEvents: ComputedRef<readonly ExternalEvent[]>;
  standingSettled: ComputedRef<boolean>;
  eventsForDate: (ymd: string) => readonly ExternalEvent[];
  timedForDate: (ymd: string) => readonly ExternalEvent[];
  allDayForDate: (ymd: string) => readonly ExternalEvent[];
  calendarState: (viewedCalendarId: string) => ViewCalendarState | null;
}

export function useExternalEvents(): UseExternalEvents {
  const store = useCalendarViewStore();
  let owner: symbol | null = null;

  function setScreenWindow(range: YmdRange | null): void {
    if (range) {
      owner = store.setScreenWindow(range, owner ?? undefined);
      return;
    }
    if (owner) store.clearScreenWindow(owner);
    owner = null;
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (owner) store.clearScreenWindow(owner);
      owner = null;
    });
  }

  return {
    setScreenWindow,
    isActive: computed(() => store.isActive),
    events: computed(() => store.events),
    eventsByDate: computed(() => store.eventsByDate),
    briefingEvents: computed(() => store.briefingEvents),
    widgetEvents: computed(() => store.widgetEvents),
    standingSettled: computed(() => store.standingSettled),
    eventsForDate: (ymd) => store.eventsForDate(ymd),
    timedForDate: (ymd) => store.timedForDate(ymd),
    allDayForDate: (ymd) => store.allDayForDate(ymd),
    calendarState: (id) => store.calendarState(id),
  };
}
