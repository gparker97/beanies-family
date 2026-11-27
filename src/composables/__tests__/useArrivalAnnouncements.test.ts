/**
 * The shared arrival list (#143) feeding the OS arrival reminder and the bell.
 *
 * Its one hazard is reactivity: `flightStatusStore.verificationFor` reads the store's clock,
 * which moves on every tick, so an unstabilised list would hand every tick a new array and
 * wake the reminder scheduler's deep watch (a reschedule) each time. Every store is stubbed;
 * the point is the composable's wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, effectScope, nextTick, ref, watch, type Ref } from 'vue';
import type { FamilyMember } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TravelSegmentOccurrence } from '@/utils/vacation';

interface Holder {
  arrivalsOn: Ref<boolean>;
  currentMember: Ref<FamilyMember | null>;
  members: Ref<FamilyMember[]>;
  occurrences: Ref<TravelSegmentOccurrence[]>;
  nowMs: Ref<number>;
  estimate: Ref<string | undefined>;
  range: { from: string; to: string } | null;
}
const h = vi.hoisted(() => ({}) as Holder);
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
h.arrivalsOn = ref(true);
h.currentMember = ref<FamilyMember | null>(null);
h.members = ref<FamilyMember[]>([]);
h.occurrences = ref<TravelSegmentOccurrence[]>([]);
h.nowMs = ref(0);
h.estimate = ref<string | undefined>(undefined);
h.range = null;

vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get familyArrivalAlerts() {
      return h.arrivalsOn.value;
    },
    familyArrivalLead: 60,
    remindersEnabled: true,
    todoReminderLead: 30,
    activityReminderLead: 30,
    travelReminderLeads: {},
    helpfulHintNotifyByType: {},
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return h.currentMember.value;
    },
    get members() {
      return h.members.value;
    },
  }),
}));
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({
    travelSegmentOccurrencesInRange: (from: string, to: string) => {
      h.range = { from, to };
      return h.occurrences.value;
    },
    homecomingFor: (id: string) => (id.startsWith('seg-') ? ['mum'] : []),
  }),
}));
vi.mock('@/stores/flightStatusStore', () => ({
  useFlightStatusStore: () => ({
    alertsEnabled: false,
    noticeFirstSeen: () => 0,
    // Like the real store: every read depends on the clock, and a check with an estimate
    // carries a `checkedAt` that differs on every tick.
    verificationFor: (): FlightVerification => ({
      state: 'verified',
      checkedAt: h.nowMs.value,
      live: h.estimate.value ? { estimatedArrival: h.estimate.value } : {},
    }),
  }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ activeActivitiesForMonth: [] }),
}));
vi.mock('@/stores/todoStore', () => ({ useTodoStore: () => ({ activeTodos: [] }) }));
vi.mock('@/stores/listStore', () => ({ useListStore: () => ({ lists: [] }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: ref('2026-12-13'),
    startOfToday: computed(() => new Date(2026, 11, 13)),
  }),
}));
vi.mock('@/utils/occurrenceAssembly', () => ({ assembleOccurrencesByDate: () => ({}) }));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => false }));

import { useArrivalAnnouncements } from '../useArrivalAnnouncements';
import { useScheduledReminders } from '../useScheduledReminders';
import { reportTravelRowSkipped } from '../criticalItems/travelRowSkips';

const mum = { id: 'mum', name: 'Jill', ageGroup: 'adult' } as FamilyMember;
const dad = { id: 'dad', name: 'Sam', ageGroup: 'adult' } as FamilyMember;

function home(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 1,
    segmentId: 'seg-2',
    transportType: 'flight_return',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-12',
    time: '21:00',
    title: 'LHR → SIN',
    tripAssigneeIds: ['mum', 'dad'],
    travellerIds: ['mum'],
    flightNumber: 'SQ317',
    arrivalAirport: 'SIN',
    schedule: { arrivalDate: '2026-12-13', arrivalTime: '17:05', arrivalTerminal: '1' },
    ...over,
  };
}

const scopes: ReturnType<typeof effectScope>[] = [];
function run<T>(fn: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(fn)!;
}

beforeEach(() => {
  while (scopes.length) scopes.pop()!.stop();
  reportError.mockClear();
  h.arrivalsOn.value = true;
  h.currentMember.value = dad;
  h.members.value = [mum, dad];
  h.occurrences.value = [home()];
  h.nowMs.value = 1_000;
  h.estimate.value = undefined;
  h.range = null;
});

describe('useArrivalAnnouncements', () => {
  it('maps the bell travel range for the viewer at home', () => {
    const { announcements } = run(useArrivalAnnouncements);
    expect(announcements.value.map((a) => [a.segmentId, a.names, a.time])).toEqual([
      ['seg-2', 'Jill', '17:05'],
    ]);
    expect(h.range).toEqual({ from: '2026-11-13', to: '2027-01-12' });
  });

  it('is empty with the switch off, or with nobody signed in', () => {
    const { announcements } = run(useArrivalAnnouncements);
    h.arrivalsOn.value = false;
    expect(announcements.value).toEqual([]);
    h.arrivalsOn.value = true;
    h.currentMember.value = null;
    expect(announcements.value).toEqual([]);
  });

  it('keeps its identity across a clock tick that brings no new estimate', async () => {
    const { announcements } = run(useArrivalAnnouncements);
    const first = announcements.value;
    const onChange = vi.fn();
    run(() => watch(announcements, onChange));
    h.nowMs.value += 60_000;
    await nextTick();
    expect(announcements.value).toBe(first);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes identity when an estimate arrives', async () => {
    const { announcements } = run(useArrivalAnnouncements);
    const first = announcements.value;
    h.estimate.value = '2026-12-13 17:45+08:00';
    await nextTick();
    expect(announcements.value).not.toBe(first);
    expect(announcements.value[0]).toMatchObject({ time: '17:45', estimated: true });
  });

  it('a throwing occurrence is skipped and reported once, shared with the briefing row', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = home({ segmentId: 'seg-throws' });
    Object.defineProperty(bad, 'transportType', {
      get() {
        throw new Error('boom');
      },
    });
    h.occurrences.value = [bad, home()];
    const { announcements } = run(useArrivalAnnouncements);
    expect(announcements.value.map((a) => a.segmentId)).toEqual(['seg-2']);
    h.estimate.value = '2026-12-13 17:45+08:00'; // a recompute
    await nextTick();
    void announcements.value;
    // The briefing row's own throw on the same segment reports through the same dedupe.
    reportTravelRowSkipped(bad, new Error('boom'), 'arrival');
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'daily-briefing',
        severity: 'warning',
        context: { action: 'travel_row_skipped', detail: 'arrival' },
      })
    );
    warn.mockRestore();
  });
});

describe('the reminder scheduler reads it', () => {
  it('a tick with no estimate change does not wake the reschedule watcher', async () => {
    const { reminderInput } = run(useScheduledReminders);
    expect(reminderInput.value!.arrivals!.map((a) => a.segmentId)).toEqual(['seg-2']);
    const onChange = vi.fn();
    run(() => watch(reminderInput, onChange, { deep: true }));
    h.nowMs.value += 60_000;
    await nextTick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a new estimate does wake it, with the new time', async () => {
    const { reminderInput } = run(useScheduledReminders);
    const onChange = vi.fn();
    run(() => watch(reminderInput, onChange, { deep: true }));
    h.estimate.value = '2026-12-13 18:10+08:00';
    await nextTick();
    expect(onChange).toHaveBeenCalledOnce();
    expect(reminderInput.value!.arrivals![0]).toMatchObject({ time: '18:10' });
  });
});
