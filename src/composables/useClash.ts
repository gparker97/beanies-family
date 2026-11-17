// Single read seam for the external-calendar clash nudge (#34).
//
// Every activity card resolves its clash through this composable — the store read,
// the key format, the acknowledge-memory join, and the reactivity contract live in
// exactly ONE place, so the cards stay dumb and a future change touches one file,
// not five. Inputs may be refs/getters so the result stays live.
//
// `resolve()` is the lone enrichment formula: detection (calendarClashStore) gives
// the raw ClashInfo; the acknowledge memory (overlapAckStore) decides quiet vs
// active. Reading both the reactive `clashes` map (via clashFor) and `docVersion`
// (via isAcknowledged) means acknowledging in the drawer flips every surface.
// It is also the one place the calendar's display label is worded (i18n stays out
// of the store and the pure util), so every render site names it the same way.

import { computed, toValue, type MaybeRefOrGetter, type ComputedRef } from 'vue';
import { useCalendarClashStore } from '@/stores/calendarClashStore';
import { useOverlapAckStore } from '@/stores/overlapAckStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ClashInfo } from '@/utils/calendar/clashDetection';

/** A detected clash enriched with whether the family has quieted it. */
export interface ResolvedClash extends ClashInfo {
  acknowledged: boolean;
  /** The calendar as a reader sees it, filling `{calendar}` in
   *  `calendarSync.clash.overlaps`: "your {email} calendar" for a connection, the
   *  viewed calendar's name exactly as stored for a view-only calendar. */
  label: string;
}

type Translate = ReturnType<typeof useTranslation>['t'];

export function useClash(
  activityId: MaybeRefOrGetter<string>,
  occurrenceDate: MaybeRefOrGetter<string>
): ComputedRef<ResolvedClash | undefined> {
  const store = useCalendarClashStore();
  const ackStore = useOverlapAckStore();
  const { t } = useTranslation();
  return computed(() =>
    resolve(ackStore, t, store.clashFor(toValue(activityId), toValue(occurrenceDate)))
  );
}

/**
 * Sibling seam for views that render activities inside a `v-for`, where a
 * per-iteration `useClash()` is impossible (a composable must run in `setup()`,
 * not inside a loop). Call once in `setup()` and invoke the returned function
 * inline in the template — it re-reads the reactive `clashes` map + ack memory on
 * every render, so indicators stay live. Keeps ALL store coupling in this one file.
 */
export function useClashLookup(): (
  activityId: string,
  occurrenceDate: string
) => ResolvedClash | undefined {
  const store = useCalendarClashStore();
  const ackStore = useOverlapAckStore();
  const { t } = useTranslation();
  return (activityId, occurrenceDate) =>
    resolve(ackStore, t, store.clashFor(activityId, occurrenceDate));
}

/** The one enrichment formula — short-circuits when there's no clash (so the ack
 *  store is never consulted for the empty-string / no-clash case). */
function resolve(
  ackStore: ReturnType<typeof useOverlapAckStore>,
  t: Translate,
  raw: ClashInfo | undefined
): ResolvedClash | undefined {
  if (!raw) return undefined;
  return {
    ...raw,
    acknowledged: ackStore.isAcknowledged(
      raw.activityId,
      raw.occurrenceDate,
      raw.sourceId,
      raw.fingerprint
    ),
    label: clashLabel(t, raw),
  };
}

/** The display label for a clash's calendar (see `ResolvedClash.label`). */
function clashLabel(t: Translate, raw: ClashInfo): string {
  return raw.source === 'own'
    ? fillTemplate(t('calendarSync.clash.ownCalendarLabel'), { email: raw.sourceName })
    : raw.sourceName;
}
