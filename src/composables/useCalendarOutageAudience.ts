/**
 * Who should this device's viewer be shown when a Google Calendar grant dies —
 * the actionable prompt, a dismissable notice, or nothing.
 *
 * Wiring ONLY. The decision itself lives in `@/utils/calendar/connectionOwner`,
 * which is pure: it has the Drive guarantee, the four-rung ownership ladder and
 * the dismissal logic, and it can be table-tested without a Pinia, a translator
 * or a `localStorage`. This file reads stores, persists a dismissal, and emits
 * telemetry — nothing else. It deliberately resolves NO copy: the verdict carries
 * the owner as data and the component renders it, matching the `titleKey`/`bodyKey`
 * shape `useReconnectCoordinator` already uses.
 *
 * Takes the coordinator's refs as PARAMETERS rather than calling
 * `useReconnectCoordinator()` again: that composable is a plain factory, so a
 * second call would build a second `isReconnecting`/`reconnectError` pair inside
 * one component tree. The caller already holds the one instance — and passing refs
 * in makes this composable's own test injectable with no coordinator mock at all.
 */
import { computed, watch, type ComputedRef, type Ref } from 'vue';
import { createPerMemberStore } from '@/composables/perMemberStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { usePermissions } from '@/composables/usePermissions';
import { logEvent } from '@/services/telemetry';
import {
  decideOutageAudience,
  type CalendarDownDescriptor,
  type OutageAudience,
} from '@/utils/calendar/connectionOwner';
import type { DownFeature } from '@/composables/useReconnectCoordinator';

type PromptVariant = 'drive' | 'calendar' | 'both';

interface ReconnectNoticeState {
  schemaVersion: 1;
  /**
   * Connection ids this member has dismissed a notice for, on this device.
   *
   * ⚠️ An ID SET, not a fingerprint of the outage. A single sorted-and-joined key
   * re-nags when the outage gets BETTER: dismiss with A down, B also breaks (key
   * changes, correctly re-shown), dismiss again, then B is repaired — the key
   * reverts to "A", which differs from "A,B", so the notice returns for an outage
   * already dismissed twice, triggered by something healing. A set answers the
   * question that actually matters: is anything down that this member has not
   * already been told about?
   */
  dismissedConnectionIds: string[];
}

/**
 * The dismissed list holds ids that are down RIGHT NOW and have been dismissed.
 *
 * Pruning healed ids is not tidiness — it is what re-arms the notice. Connection
 * ids are stable across a reconnect (`finalizeConnected` updates in place), so
 * without this a member who dismissed connection `c1` would never be told about
 * `c1` again: Mum repairs it, the grant dies afresh six months later, and the id
 * is still on the list, so the notice stays hidden permanently.
 *
 * Guarded on a hydrated store. `connections` is `[]` until the Automerge doc
 * loads, so pruning against an empty list would wipe every dismissal on each cold
 * start and resurface a notice the member had already closed.
 */
function prunedToStillDown(current: readonly string[], downIds: Set<string>): string[] | null {
  const kept = current.filter((id) => downIds.has(id));
  return kept.length === current.length ? null : kept;
}

const SCHEMA_VERSION = 1 as const;

function emptyState(): ReconnectNoticeState {
  return { schemaVersion: SCHEMA_VERSION, dismissedConnectionIds: [] };
}

const store = createPerMemberStore<ReconnectNoticeState>({
  prefix: 'bean-reconnect-notice',
  label: 'useCalendarOutageAudience',
  saveSurface: 'reconnect-notice-save',
  saveMessage: 'localStorage write failed for reconnect-notice',
  empty: emptyState,
  clearOnSignOut: true,
  fromParsed: (parsed) => {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
    ) {
      const ids = (parsed as Record<string, unknown>).dismissedConnectionIds;
      return {
        state: {
          schemaVersion: SCHEMA_VERSION,
          dismissedConnectionIds: Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === 'string')
            : [],
        },
      };
    }
    return { state: emptyState() };
  },
});

const state = store.state;

export function useCalendarOutageAudience(
  downFeatures: ComputedRef<readonly DownFeature[]> | Ref<readonly DownFeature[]>,
  variant: ComputedRef<PromptVariant | null> | Ref<PromptVariant | null>
) {
  store.useMemberSync();
  const familyStore = useFamilyStore();
  const calendarStore = useCalendarSyncStore();
  const { canManagePod } = usePermissions();

  // Re-arm: drop dismissals for connections that are no longer down. See
  // `prunedToStillDown` for why this is correctness rather than housekeeping.
  watch(
    () => calendarStore.connections.map((c) => `${c.id}:${c.status}`).join(','),
    () => {
      const conns = calendarStore.connections;
      if (conns.length === 0) return; // doc not loaded — pruning here wipes real dismissals
      const downIds = new Set(conns.filter((c) => c.status === 'needs_reconnect').map((c) => c.id));
      const kept = prunedToStillDown(state.value.dismissedConnectionIds, downIds);
      if (!kept) return;
      const next: ReconnectNoticeState = { ...state.value, dismissedConnectionIds: kept };
      state.value = next;
      store.save(next);
    },
    { immediate: true }
  );

  /** Narrow the coordinator's discriminated union — NOT a second store query. */
  const downConnections = computed<CalendarDownDescriptor[]>(() =>
    downFeatures.value.filter((f) => f.kind === 'calendar')
  );

  const audience = computed<OutageAudience>(() => {
    // Nothing is down: the caller's own `v-if` already hides the toast, but be
    // explicit rather than relying on a sibling's guard.
    if (!variant.value) return { mode: 'hidden', reason: 'nothing-down' };
    return decideOutageAudience({
      variant: variant.value,
      downConnections: downConnections.value,
      members: familyStore.members,
      viewerId: familyStore.currentMemberId ?? null,
      viewerCanManagePod: canManagePod.value,
      dismissedIds: state.value.dismissedConnectionIds,
    });
  });

  /**
   * Stop asking this member about every connection that is down right now.
   *
   * SET, not union, so ids that have since healed are pruned rather than
   * accumulating across a family's whole history.
   *
   * The write failure is deliberately not surfaced — the same call the calendar
   * nudge makes (`useCalendarNudge.dismiss`). The state flips in memory so the
   * notice hides regardless; `perMemberStore` already `reportError`s a failed
   * write at severity 'warning'; and the only consequence is the notice returning
   * after a reload, which is self-correcting. A toast about a failed dismissal
   * would land in the very screen region this feature exists to unblock.
   */
  function dismiss(): void {
    const next: ReconnectNoticeState = {
      ...state.value,
      dismissedConnectionIds: downConnections.value.map((c) => c.connectionId),
    };
    state.value = next;
    store.save(next);
    logEvent({
      level: 'info',
      surface: 'unified-reconnect',
      message: 'reconnect notice dismissed',
      context: { action: 'notice-dismissed:calendar' },
    });
  }

  /**
   * Report the DECISION, not just failures (CLAUDE.md observability rule 1).
   *
   * `via` is what makes "she still can't dismiss it" diagnosable from CloudWatch
   * without a repro, and the owner/notice ratio is the success-path signal that
   * says whether this change did what it set out to do.
   *
   * A watch on the resolved tuple, not a per-render call and not a session
   * registry: an unchanged verdict simply does not fire, so there is no second
   * piece of state to keep in step with the persisted one.
   *
   * ⚠️ The alarm to build is on `prompt-shown:drive:notice:*` and
   * `prompt-shown:both:notice:*` — NOT on the `:drive:` prefix, which every
   * ordinary Drive prompt emits as `prompt-shown:drive:owner:n-a`. Non-calendar
   * variants are `owner` by construction, so a `notice` on one would mean the
   * Drive data-at-risk warning had been filtered by a calendar dismissal.
   *
   * `hidden:roster` is reported too: it is the one outcome where somebody who
   * could fix the outage is shown nothing, and it would otherwise be invisible.
   */
  watch(
    () => {
      const a = audience.value;
      if (a.mode === 'hidden') {
        return a.reason === 'roster' ? `prompt-shown:${variant.value}:hidden:roster` : null;
      }
      const via =
        a.mode === 'notice' ? (a.owner.kind === 'member' ? a.owner.via : 'managers') : 'n-a';
      return `prompt-shown:${variant.value}:${a.mode}:${via}`;
    },
    (action) => {
      if (!action) return;
      logEvent({
        level: 'info',
        surface: 'unified-reconnect',
        message: 'reconnect prompt shown',
        context: { action },
      });
    },
    { immediate: true }
  );

  return { audience, dismiss };
}
