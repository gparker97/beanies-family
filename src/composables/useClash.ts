// Single read seam for the external-calendar clash nudge (#34).
//
// Every activity card resolves its clash through this composable — the store read,
// the key format, and the reactivity contract live in exactly ONE place, so the
// cards stay dumb and a future change to how clashes are keyed/stored touches one
// file, not five. Inputs may be refs/getters so the result stays live.

import { computed, toValue, type MaybeRefOrGetter, type ComputedRef } from 'vue';
import { useCalendarClashStore } from '@/stores/calendarClashStore';
import type { ClashInfo } from '@/utils/calendar/clashDetection';

export function useClash(
  activityId: MaybeRefOrGetter<string>,
  occurrenceDate: MaybeRefOrGetter<string>
): ComputedRef<ClashInfo | undefined> {
  const store = useCalendarClashStore();
  return computed(() => store.clashFor(toValue(activityId), toValue(occurrenceDate)));
}
