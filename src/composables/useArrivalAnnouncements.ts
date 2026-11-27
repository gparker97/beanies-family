/**
 * Live flight checks (#143): the family flights home this device's member is told about, as
 * ONE reactive list read by the OS arrival reminder (`useScheduledReminders`, through
 * `ReminderInput.arrivals`) and the bell (`notificationsStore`, through `DeriveInput.arrivals`),
 * so the two cannot disagree. The briefing row runs the same decision (`arrivalAnnouncement`)
 * on its own narrower range.
 *
 * Empty when the device's "Family Flight Arrivals" switch is off or nobody is signed in.
 * Otherwise the departures in the bell's own travel range (`bellTravelRange`, re-read when the
 * day turns), mapped by `arrivalAnnouncements`; an occurrence that throws is skipped and
 * reported once (`reportTravelRowSkipped`, shared with the briefing row).
 *
 * STABILISED: `flightStatusStore.verificationFor` reads the store's clock, which moves on every
 * tick and foreground, so a plain computed would hand every tick a new array and wake the
 * reminder scheduler's deep watch each time. The previous value is kept while the plain data
 * is the same, so the list changes identity only when an announcement does (a new estimate, a
 * terminal, the flight closing).
 *
 * Not a store: the flight-status store orchestrates the Lambda and its cache, and viewer
 * audience and windows do not belong in it. One shared instance per Pinia, the
 * `useScheduledReminders` pattern. Must not import `useCriticalItems` or `notificationsStore`
 * (the store reads this composable).
 */
import { computed, effectScope, type ComputedRef } from 'vue';
import { getActivePinia } from 'pinia';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useFlightStatusStore } from '@/stores/flightStatusStore';
import { useToday } from '@/composables/useToday';
import { reportTravelRowSkipped } from '@/composables/criticalItems/travelRowSkips';
import { WINDOW_DAYS } from '@/utils/notifications';
import { bellTravelRange } from '@/utils/notifications/travel';
import {
  arrivalAnnouncements,
  type ArrivalAnnouncement,
} from '@/utils/flightStatus/arrivalAnnouncement';

export interface ArrivalAnnouncementSource {
  announcements: ComputedRef<readonly ArrivalAnnouncement[]>;
}

const sharedSources = new WeakMap<object, ArrivalAnnouncementSource>();

export function useArrivalAnnouncements(): ArrivalAnnouncementSource {
  const pinia = getActivePinia();
  if (!pinia) return createArrivalAnnouncementSource();
  const cached = sharedSources.get(pinia);
  if (cached) return cached;
  const source = effectScope(true).run(createArrivalAnnouncementSource)!;
  sharedSources.set(pinia, source);
  return source;
}

const NONE: readonly ArrivalAnnouncement[] = Object.freeze([]);

function createArrivalAnnouncementSource(): ArrivalAnnouncementSource {
  const settingsStore = useSettingsStore();
  const familyStore = useFamilyStore();
  const vacationStore = useVacationStore();
  const flightStatusStore = useFlightStatusStore();
  const { startOfToday } = useToday();

  function build(): readonly ArrivalAnnouncement[] {
    const viewer = familyStore.currentMember;
    if (!settingsStore.familyArrivalAlerts || !viewer) return NONE;
    const range = bellTravelRange(startOfToday.value.getTime(), WINDOW_DAYS);
    return arrivalAnnouncements(
      vacationStore.travelSegmentOccurrencesInRange(range.from, range.to),
      {
        viewer,
        members: familyStore.members,
        resolveMember: (id) => familyStore.members.find((m) => m.id === id),
        homecomingFor: vacationStore.homecomingFor,
        verificationFor: flightStatusStore.verificationFor,
      },
      (o, err) => reportTravelRowSkipped(o, err, 'arrival')
    );
  }

  const announcements = computed<readonly ArrivalAnnouncement[]>((prev) => {
    const next = build();
    // Plain data (`ArrivalAnnouncement`), so its JSON is its identity; the repo has no
    // deep-equal helper, and the list is a handful of flights.
    return prev !== undefined && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  });

  return { announcements };
}
