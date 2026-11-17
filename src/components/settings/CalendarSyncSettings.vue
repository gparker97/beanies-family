<script setup lang="ts">
// Google Calendar sync settings (#32 Layer 6). Mirrors the AiSettings card→drawer
// pattern (BeanieFormModal variant="drawer"). Lets the user connect one or more
// Google calendars (family-wide), sync now, import, reconnect, and disconnect.
// Standalone official feature — reached from the Settings → Google Calendar card,
// gated on the googleCalendarSync flag (a kill-switch), not the Lab.
//
// The destination calendar is chosen once, in the add step (`CalendarConnectModal`),
// and shown here as fixed text. There is no dropdown to switch it: to use another
// calendar, connect another or disconnect this one (view-only calendars plan
// 2026-11-17, B).
//
// With `viewOnlyCalendars` on, the drawer holds two groups: "Synced from
// beanies.family" (one `SyncedCalendarCard` per connection) and "View only" (one
// `ViewedCalendarCard` per viewed calendar). With the flag off it is the sync-only
// drawer: the view store is never even instantiated.
//
// Every calendar is one row that opens (`CalendarCardShell`), so the drawer stays
// short however many are connected. The clash toggle applies to every calendar, so
// it sits in its own "All Calendars" group below both. Neither is part of the gated
// feature: the rows, the "Synced from beanies.family" heading with its "(push only)"
// link, and the "All Calendars" group show with the flag off too.
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import { isFlagEnabled } from '@/config/flags';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import CalendarImportModal from '@/components/settings/CalendarImportModal.vue';
import CalendarConnectModal from '@/components/settings/CalendarConnectModal.vue';
import ViewedCalendarCard from '@/components/settings/ViewedCalendarCard.vue';
import SyncedCalendarCard, {
  type SyncedCalendarAction,
} from '@/components/settings/SyncedCalendarCard.vue';
import { openExternal } from '@/utils/openExternal';
import { MARKETING_URL } from '@/utils/marketing';
import { useCalendarViewStore, type ViewedCalendarSettingsPatch } from '@/stores/calendarViewStore';
import { useCalendarImportStore } from '@/stores/calendarImportStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import { resolveConnectionOwner, canViewerRepair } from '@/utils/calendar/connectionOwner';
import { connectFailureToast } from '@/utils/calendar/connectFailureToast';
import { reportError } from '@/utils/errorReporter';
import type { CalendarConnection, CalendarViewAccount, ViewedCalendar } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const store = useCalendarSyncStore();

// #34 clash nudge — only surfaced when its flag is on (launch-coupled with sync).
const clashNudgeFlagOn = isFlagEnabled('calendarClashNudge');
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const { canManagePod } = usePermissions();

// View-only calendars (plan 2026-11-17). Gated at setup: with the flag off this
// drawer never touches the view store (other readers may instantiate it; with the
// flag off it is inert) and every computed below is empty.
const viewFlagOn = isFlagEnabled('viewOnlyCalendars');
const viewStore = viewFlagOn ? useCalendarViewStore() : null;
const viewedCalendars = computed<ViewedCalendar[]>(() => viewStore?.calendars ?? []);
const viewAccountsById = computed(
  () => new Map((viewStore?.accounts ?? []).map((a) => [a.id, a] as const))
);

/** A sync connection or a viewed calendar: the add button reads "another", the clash toggle shows. */
const anythingConnected = computed(
  () => store.connections.length > 0 || viewedCalendars.value.length > 0
);

/**
 * Only offer the repair to whoever can actually complete it.
 *
 * The consent is account-bound — `finalizeConnected` refuses a reconnect made as
 * a different Google account — so showing this button to a member who does not
 * hold the account produces a sign-in screen they cannot get past, then an error.
 * Same predicate as the reconnect toast (`canViewerRepair`), so the two surfaces
 * cannot drift apart about who is asked. A view account is bound the same way.
 */
function canRepairAccount(account: {
  id: string;
  accountEmail: string;
  connectedBy?: string;
}): boolean {
  const verdict = resolveConnectionOwner(
    { connectionId: account.id, email: account.accountEmail, connectedBy: account.connectedBy },
    familyStore.members
  );
  return canViewerRepair(verdict, familyStore.currentMemberId ?? null, canManagePod.value);
}

function canRepair(connection: CalendarConnection): boolean {
  return canRepairAccount(connection);
}

async function onToggleClash(enabled: boolean) {
  try {
    await settingsStore.setCalendarClashNudgeEnabled(enabled);
  } catch {
    // setCalendarClashNudgeEnabled already toasts + logs the failure; the toggle
    // reverts automatically because its model-value reads the (unchanged) store.
  }
}

/**
 * `${connectionId}:${action}`, not a bare connection id. It used to be the id
 * alone, so starting any per-connection action spun EVERY button on that card.
 * With the import added that becomes four buttons pretending to be busy because
 * one of them is. One helper, four buttons correct, no extra state.
 */
const busyId = ref<string | null>(null);
type ConnAction = SyncedCalendarAction;
function busyKey(connectionId: string, action: ConnAction): string {
  return `${connectionId}:${action}`;
}
/** Does THIS button show a spinner? One action, one spinner. */
function isBusy(connectionId: string, action: ConnAction): boolean {
  return busyId.value === busyKey(connectionId, action);
}
/**
 * Is ANY action running on this connection? Splitting `busyId` per action fixed
 * four buttons spinning at once, but it also removed the mutual exclusion the old
 * bare-id key gave for free — and the disconnect button never read the flag at
 * all. So "Sync now" stayed live all through a teardown, and one click re-inserted
 * events onto a calendar whose links were being deleted, leaving orphans in the
 * user's Google account that beanies no longer knew about.
 *
 * The spinner stays per-action; DISABLING is per-connection: the card is handed
 * the one running action and disables all four buttons while it is set.
 */
function syncBusyAction(connectionId: string): SyncedCalendarAction | null {
  const actions: SyncedCalendarAction[] = ['reconnect', 'sync', 'import', 'disconnect'];
  return actions.find((a) => isBusy(connectionId, a)) ?? null;
}

/** The one-time import (#94). Its own drawer, opened per connection. */
const importConnectionId = ref<string | null>(null);

// ── Which rows are open ───────────────────────────────────────────────────────
// Local UI state, never persisted. A row starts open when it is the only calendar
// in the drawer, or when it was added while the drawer is open; every other row
// starts closed. Decided once per row per drawer session, so adding a second
// calendar never snaps the first one shut.
const syncRowKey = (id: string) => `sync:${id}`;
const viewRowKey = (id: string) => `view:${id}`;
const rowKeys = computed(() => [
  ...store.connections.map((c) => syncRowKey(c.id)),
  ...viewedCalendars.value.map((c) => viewRowKey(c.id)),
]);
const openRows = ref<ReadonlySet<string>>(new Set());
let seenRows = new Set<string>();

function startDrawerSession(): void {
  const keys = rowKeys.value;
  seenRows = new Set(keys);
  openRows.value = new Set(keys.length === 1 ? keys : []);
}
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) startDrawerSession();
  },
  { immediate: true }
);
watch(rowKeys, (keys) => {
  const added = keys.filter((k) => !seenRows.has(k));
  if (added.length === 0) return;
  for (const k of added) seenRows.add(k);
  // While closed, the next open starts a fresh session and decides again.
  if (!props.open) return;
  openRows.value = new Set([...openRows.value, ...added]);
});

function isRowOpen(key: string): boolean {
  return openRows.value.has(key);
}
function setRowOpen(key: string, value: boolean): void {
  const next = new Set(openRows.value);
  if (value) next.add(key);
  else next.delete(key);
  openRows.value = next;
}

/** The section label above each group (theme: UI label, Outfit caption, uppercase). */
const groupHeadingClass =
  'font-outfit text-secondary-400 dark:text-ink-faint text-xs font-semibold tracking-[0.08em] uppercase';

/** The "(push only)" link: the sync help article's section on why it is one-way. */
function openPushOnlyHelp(): void {
  openExternal(`${MARKETING_URL}/help/security/google-calendar-sync#push-only`);
}

async function onImport(connection: CalendarConnection) {
  busyId.value = busyKey(connection.id, 'import');
  try {
    await useCalendarImportStore().open(connection.id);
    importConnectionId.value = connection.id;
  } catch (e) {
    // NOT `calendarImport.failed.*` — that copy says "nothing was imported",
    // which is about a COMMIT. Nothing has been offered yet at this point; the
    // chooser simply could not be opened.
    showToast('error', t('calendarImport.scanFailed.title'), t('calendarImport.scanFailed.body'), {
      surface: 'calendar-import',
      error: e,
    });
  } finally {
    busyId.value = null;
  }
}
/**
 * connectionId → a LEGACY connection's calendar name, resolved from Google's list
 * (`resolveDestinationName`, which also writes it back). A connection made in the add
 * step stores its name (`destinationCalendarName`) and needs no read; the card prefers
 * that, and decides what an unknown name reads as (`SyncedCalendarCard`'s `title`).
 */
const destinationNames = ref<Record<string, string>>({});
/**
 * One attempt per connection per (status, grant): a read that failed because the
 * token was dead or the grant lacked the list scope is tried again once a reconnect
 * changes either, never on every reactive tick.
 */
const nameAttempts = new Set<string>();

function nameAttemptKey(connection: CalendarConnection): string {
  return `${connection.id}|${connection.status}|${[...connection.grantedScopes].sort().join(' ')}`;
}

async function resolveDestinationName(connection: CalendarConnection): Promise<void> {
  try {
    // Never throws for a Google failure (it returns null); a doc read failing is the
    // only thing that lands below.
    const name = await store.resolveDestinationName(connection.id);
    if (name) destinationNames.value = { ...destinationNames.value, [connection.id]: name };
  } catch (e) {
    reportError({
      surface: 'calendar-sync',
      message: "[calendarSync] resolving a connection's calendar name failed",
      error: e,
      severity: 'warning',
      context: { action: 'destination-name' },
    });
  }
}

// Only while the drawer is OPEN: the drawer stays mounted on the Settings page, and
// a legacy name resolved here is written back to the doc, which must come from a
// member looking at it, never from merely visiting Settings.
watch(
  () => (props.open ? store.connections : []),
  (connections) => {
    for (const c of connections) {
      if (c.destinationCalendarName || destinationNames.value[c.id]) continue;
      const key = nameAttemptKey(c);
      if (nameAttempts.has(key)) continue;
      nameAttempts.add(key);
      void resolveDestinationName(c);
    }
  },
  { immediate: true, deep: true }
);

/** The add step. Open while a consent is pending, so a redirect return lands on the list. */
const connectOpen = ref(false);
watch(
  () => !!store.pendingConnect || !!viewStore?.pendingViewConnect,
  (pending) => {
    if (pending) connectOpen.value = true;
  },
  { immediate: true }
);

const connectLabel = computed(() =>
  t(anythingConnected.value ? 'calendarSync.action.connectAnother' : 'calendarSync.action.connect')
);

async function onReconnect(connection: CalendarConnection) {
  busyId.value = busyKey(connection.id, 'reconnect');
  try {
    const result = await store.reconnect(connection.id);
    if (result.status === 'connected') {
      showToast(
        'success',
        t('calendarSync.toast.reconnected.title'),
        t('calendarSync.toast.reconnected.message')
      );
    } else if (result.status === 'redirecting') {
      // Redirect transport handed off — resume toasts post-redirect.
    } else {
      // The shared mapper: translated copy, and a mismatch's account email is shown
      // but never reported.
      const toast = connectFailureToast('sync', result, t);
      if (toast) showToast('error', toast.title, toast.message, { silent: toast.silent });
    }
  } finally {
    busyId.value = null;
  }
}

async function onSyncNow(connection: CalendarConnection) {
  busyId.value = busyKey(connection.id, 'sync');
  try {
    // syncNow swallows API errors into the connection status, so toast from the
    // returned outcome — NOT an unconditional "Synced!".
    const outcome = await store.syncNow(connection.id);
    if (outcome === 'needs_reconnect') {
      showToast(
        'error',
        t('calendarSync.toast.syncReconnect.title'),
        t('calendarSync.toast.syncReconnect.message'),
        { silent: true } // user-recoverable (reconnect); no Slack noise
      );
    } else if (outcome === 'error') {
      showToast(
        'error',
        t('calendarSync.toast.syncFailed.title'),
        t('calendarSync.toast.syncFailed.message'),
        { silent: true } // the store already reported the API error to Slack
      );
    } else {
      // 'ok' | 'skipped' (a no-op is still "up to date").
      showToast(
        'success',
        t('calendarSync.toast.synced.title'),
        t('calendarSync.toast.synced.message')
      );
    }
  } catch (e) {
    // Unexpected throw (e.g. IndexedDB write) — never fail silently.
    showToast(
      'error',
      t('calendarSync.toast.syncFailed.title'),
      t('calendarSync.toast.syncFailed.message'),
      {
        silent: true,
        surface: 'calendar-sync',
        error: e,
        context: { action: 'syncNow', connectionId: connection.id },
      }
    );
  } finally {
    busyId.value = null;
  }
}

// ── View-only calendars (flag on) ─────────────────────────────────────────────
// The card emits intents; these call the store. The store toasts and reports its
// own failures (`critical` for a failed save), so these only toast the outcomes.

function viewAccountOf(calendar: ViewedCalendar): CalendarViewAccount | undefined {
  return viewAccountsById.value.get(calendar.viewAccountId);
}

function canReconnectView(calendar: ViewedCalendar): boolean {
  const account = viewAccountOf(calendar);
  return !!account && canRepairAccount(account);
}

function viewBusyAction(calendar: ViewedCalendar): 'reconnect' | 'disconnect' | null {
  if (isBusy(calendar.id, 'reconnect')) return 'reconnect';
  if (isBusy(calendar.id, 'disconnect')) return 'disconnect';
  return null;
}

async function onViewUpdate(calendar: ViewedCalendar, patch: ViewedCalendarSettingsPatch) {
  if (!viewStore || !canManagePod.value) return;
  await viewStore.updateViewedCalendar(calendar.id, patch);
}

async function onViewDisconnect(calendar: ViewedCalendar) {
  if (!viewStore || !canManagePod.value) return;
  const ok = await confirm({
    title: 'calendarView.disconnect.title',
    message: 'calendarView.disconnect.message',
    variant: 'danger',
    confirmLabel: 'calendarSync.disconnect.confirm',
  });
  if (!ok) return;
  busyId.value = busyKey(calendar.id, 'disconnect');
  try {
    const result = await viewStore.removeViewedCalendar(calendar.id);
    if (result.status === 'removed') {
      showToast(
        'success',
        t('calendarView.toast.disconnected.title'),
        t('calendarView.toast.disconnected.message')
      );
    }
  } finally {
    busyId.value = null;
  }
}

async function onViewReconnect(calendar: ViewedCalendar) {
  if (!viewStore || !canReconnectView(calendar)) return;
  // No await before the store call: the consent popup must open inside the tap.
  busyId.value = busyKey(calendar.id, 'reconnect');
  try {
    const result = await viewStore.reconnectViewAccount(calendar.viewAccountId);
    if (result.status === 'reconnected') {
      showToast(
        'success',
        t('calendarView.toast.reconnected.title'),
        t('calendarView.toast.reconnected.message')
      );
    } else if (result.status === 'failed') {
      // The same mapper as the redirect resume. `unexpected` was already reported and
      // toasted by the store; `cancelled` is the member's choice (both map to null).
      const toast = connectFailureToast('view', result, t);
      if (toast) {
        showToast('error', toast.title, toast.message, {
          silent: toast.silent,
          ...(result.code === 'missing_scope'
            ? { actionLabel: t('action.tryAgain'), actionFn: () => onViewReconnect(calendar) }
            : {}),
        });
      }
    }
    // `redirecting`: the resume finishes the reconnect and toasts.
  } finally {
    busyId.value = null;
  }
}

async function onDisconnect(connection: CalendarConnection) {
  const ok = await confirm({
    title: 'calendarSync.disconnect.title',
    message: 'calendarSync.disconnect.message',
    variant: 'danger',
    confirmLabel: 'calendarSync.disconnect.confirm',
  });
  if (!ok) return;
  busyId.value = busyKey(connection.id, 'disconnect');
  try {
    // disconnect returns whether teardown fully completed — a partial teardown
    // leaves the connection parked 'disconnecting', so don't claim success.
    const cleared = await store.disconnect(connection.id);
    if (cleared) {
      showToast(
        'success',
        t('calendarSync.toast.disconnected.title'),
        t('calendarSync.toast.disconnected.message')
      );
    } else {
      showToast(
        'error',
        t('calendarSync.toast.disconnectPartial.title'),
        t('calendarSync.toast.disconnectPartial.message'),
        { silent: true }
      );
    }
  } catch (e) {
    showToast(
      'error',
      t('calendarSync.toast.syncFailed.title'),
      t('calendarSync.toast.syncFailed.message'),
      {
        silent: true,
        surface: 'calendar-sync',
        error: e,
        context: { action: 'disconnect', connectionId: connection.id },
      }
    );
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('settings.card.calendarSync')"
    icon="📅"
    icon-bg="var(--tint-silk-20)"
    :save-label="t('action.close')"
    @close="emit('close')"
    @save="emit('close')"
  >
    <div class="space-y-5">
      <p class="text-secondary-400 dark:text-ink-soft text-sm leading-snug">
        {{ t(viewFlagOn ? 'calendarSync.introWithView' : 'calendarSync.intro') }}
      </p>

      <!-- Synced calendars. The heading and its "(push only)" link show with the
           flag off too: they explain the one-way sync, which is not the gated part. -->
      <section v-if="store.connections.length > 0" class="space-y-3">
        <div class="flex flex-wrap items-baseline gap-x-1.5">
          <h3 :class="groupHeadingClass" data-testid="calendar-sync-group-synced">
            {{ t('calendarSync.group.synced') }}
          </h3>
          <button
            type="button"
            class="text-secondary-400 dark:text-ink-soft focus-visible:ring-sky-silk-300 hover:text-primary-700 dark:hover:text-accent-lift rounded text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('calendarSync.pushOnly.ariaLabel')"
            data-testid="calendar-sync-push-only"
            @click="openPushOnlyHelp"
          >
            {{ t('calendarSync.pushOnly.link') }}
          </button>
        </div>
        <SyncedCalendarCard
          v-for="connection in store.connections"
          :key="connection.id"
          :open="isRowOpen(syncRowKey(connection.id))"
          :connection="connection"
          :calendar-name="destinationNames[connection.id] ?? ''"
          :can-repair="canRepair(connection)"
          :busy-action="syncBusyAction(connection.id)"
          @update:open="setRowOpen(syncRowKey(connection.id), $event)"
          @reconnect="onReconnect(connection)"
          @sync="onSyncNow(connection)"
          @import="onImport(connection)"
          @disconnect="onDisconnect(connection)"
        />
      </section>

      <!-- View-only calendars (flag on): the group is omitted when there are none. -->
      <section v-if="viewedCalendars.length > 0" class="space-y-3">
        <h3 :class="groupHeadingClass" data-testid="calendar-sync-group-view">
          {{ t('calendarSync.group.viewOnly') }}
        </h3>
        <ViewedCalendarCard
          v-for="calendar in viewedCalendars"
          :key="calendar.id"
          :open="isRowOpen(viewRowKey(calendar.id))"
          :calendar="calendar"
          :account-email="viewAccountOf(calendar)?.accountEmail ?? null"
          :state="viewStore?.calendarState(calendar.id) ?? null"
          :can-manage="canManagePod"
          :can-reconnect="canReconnectView(calendar)"
          :busy-action="viewBusyAction(calendar)"
          @update:open="setRowOpen(viewRowKey(calendar.id), $event)"
          @update="onViewUpdate(calendar, $event)"
          @disconnect="onViewDisconnect(calendar)"
          @reconnect="onViewReconnect(calendar)"
        />
      </section>

      <!-- Settings for every calendar (#34 clash nudge), shown once anything is connected. -->
      <section
        v-if="clashNudgeFlagOn && anythingConnected"
        class="space-y-3"
        data-testid="calendar-sync-group-all"
      >
        <h3 :class="groupHeadingClass">{{ t('calendarSync.group.all') }}</h3>
        <div class="dark:border-line rounded-2xl border border-[var(--tint-slate-10)] p-3">
          <ToggleRow
            :model-value="settingsStore.calendarClashNudgeEnabled"
            :title="t('calendarSync.clashNudge.title')"
            :hint="t('calendarSync.clashNudge.hint')"
            testid="calendar-clash-toggle"
            @update:model-value="onToggleClash"
          />
        </div>
      </section>

      <!-- Opens the add step (consent, then the calendar). Works on every surface:
           popup on desktop, redirect transport on PWA/iOS/native. -->
      <BaseButton variant="primary" data-testid="calendar-sync-connect" @click="connectOpen = true">
        {{ connectLabel }}
      </BaseButton>
    </div>
  </BeanieFormModal>

  <!-- The one-time import (#94). A sibling drawer, not nested: it has its own
       scroll container and sticky action bar, and nesting two drawers would put
       two scroll contexts inside one another. -->
  <!-- `v-if`, not just `:open`. The modal resolves its own Pinia store at setup,
       so binding `:open` alone would construct the store and the whole component
       every time anyone opens calendar settings, for a drawer most people never
       use. Gating instantiation costs a close transition on a rare surface, which
       is the better trade. -->
  <CalendarImportModal
    v-if="importConnectionId !== null"
    :open="true"
    :connection-id="importConnectionId"
    @close="importConnectionId = null"
  />

  <!-- The add step: the same sibling-drawer + `v-if` shape as the import above. -->
  <!-- View only is offered to members who may manage the pod (flag on only). -->
  <CalendarConnectModal
    v-if="connectOpen"
    :can-add-view-only="viewFlagOn && canManagePod"
    @close="connectOpen = false"
  />
</template>
