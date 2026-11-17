<script setup lang="ts">
/**
 * The add step for a Google calendar (view-only calendars plan 2026-11-17, B).
 *
 * Consent first, then the choice of calendar. A consent writes nothing: the store
 * holds the credential in memory and only "Connect Calendar" creates the record,
 * on the calendar picked here. Closing or cancelling abandons the consent (the
 * store revokes it unless something else uses that Google account).
 *
 * With `viewOnlyCalendars` on (and a member who may manage the pod), two role cards
 * sit at the top: "Sync from beanies.family" (default) and "View only". The role
 * decides everything below it: which Google permission is asked for, which
 * accounts already hold it, which calendars are eligible, and what "Connect
 * Calendar" does (`confirmConnect` / `addViewedCalendar`). With the flag off the
 * step is exactly the sync-only flow, and this step never touches the view store
 * (other readers may instantiate it; with the flag off it is inert).
 *
 * View only: the accounts that already hold the view grant are offered as rows,
 * plus "Use a Different Google Account" (a fresh view consent). With none, the
 * single "Continue with Google". The pending slot holds ONE credential, so
 * switching role abandons the other role's pending consent.
 *
 * MVO: this view only reads store state and emits intents; the stores orchestrate.
 *
 * Mounted with `v-if` as a sibling drawer of the settings drawer, like
 * `CalendarImportModal`, and opened by the settings drawer whenever a consent is
 * pending (which is how a redirect return lands straight on the calendar list).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { isFlagEnabled } from '@/config/flags';
import { fillTemplate } from '@/utils/fillTemplate';
import { connectFailureToast } from '@/utils/calendar/connectFailureToast';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import {
  useCalendarViewStore,
  type ListViewCalendarsResult,
  type ViewConnectFailure,
} from '@/stores/calendarViewStore';
import {
  syncIneligibility,
  viewIneligibility,
  type SyncIneligibility,
} from '@/utils/calendar/connectEligibility';
import type { CalendarSummary } from '@/services/calendar/CalendarClient';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = withDefaults(
  defineProps<{
    /** The member may add a view-only calendar (`canManagePod`). Ignored with the flag off. */
    canAddViewOnly?: boolean;
  }>(),
  { canAddViewOnly: false }
);
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const store = useCalendarSyncStore();
// Created only with the flag on, so the flag-off step never touches the view store.
const viewStore = isFlagEnabled('viewOnlyCalendars') ? useCalendarViewStore() : null;
/** The role cards are offered. */
const viewAvailable = computed(() => viewStore !== null && props.canAddViewOnly);

/** What the connected calendar will be used for. */
type ConnectRole = 'sync' | 'view';
const role = ref<ConnectRole>('sync');

/** `account`: view only, pick a known view account. `consent`: the single Google action. */
type Step = 'account' | 'consent' | 'loading' | 'choose';
const step = ref<Step>('consent');
const calendars = ref<CalendarSummary[]>([]);
const selectedId = ref<string | null>(null);
/** View only: the account row picked on the `account` step (`DIFFERENT` = a new consent). */
const DIFFERENT = '__different__';
const accountChoice = ref<string>(DIFFERENT);
/** View only: where the listed calendars came from (the pending consent, or a view account id). */
const listSource = ref<string>('pending');
/**
 * A consent or a confirm is in flight: the drawer cannot be closed mid-way.
 *
 * OWNED: only the operation that set it may clear it (`claimBusy` / `releaseBusy`).
 * A consent whose list load was superseded (the member switched role while it
 * listed, then started the other role's consent) must not clear the `busy` of the
 * consent now in flight, or the drawer could close mid-popup and the pending watch
 * below would list a second time. Never assign `busy` directly.
 */
const busy = ref(false);
let busyOwner: symbol | null = null;

/** Mark a consent or confirm as in flight; the returned token is what releases it. */
function claimBusy(): symbol {
  const owner = Symbol('busy');
  busyOwner = owner;
  busy.value = true;
  return owner;
}

/** Clear `busy`, but only for the operation that still owns it. */
function releaseBusy(owner: symbol): void {
  if (busyOwner !== owner) return;
  busyOwner = null;
  busy.value = false;
}
/** Set while a confirm writes, so an unmount then never abandons the credential. */
let confirming = false;

/** The two role cards, in order, with their copy. */
const ROLES: ReadonlyArray<{ role: ConnectRole; title: UIStringKey; body: UIStringKey }> = [
  {
    role: 'sync',
    title: 'calendarSync.connect.role.sync.title',
    body: 'calendarSync.connect.role.sync.body',
  },
  {
    role: 'view',
    title: 'calendarSync.connect.role.view.title',
    body: 'calendarSync.connect.role.view.body',
  },
];

const REASON_KEYS: Record<SyncIneligibility, UIStringKey> = {
  'already-connected': 'calendarSync.connect.reason.alreadyConnected',
  'view-only': 'calendarSync.connect.reason.viewOnly',
};

const viewAccounts = computed(() => viewStore?.accounts ?? []);
/** Google ids of every view-only calendar (any account): already connected for both roles. */
const viewedIds = computed(() => (viewStore?.calendars ?? []).map((c) => c.calendarId));

/** The account the listed calendars belong to. */
const listAccountEmail = computed<string | null>(() => {
  if (role.value === 'sync') return store.pendingConnect?.accountEmail ?? null;
  if (listSource.value === 'pending') return viewStore?.pendingViewConnect?.accountEmail ?? null;
  return viewAccounts.value.find((a) => a.id === listSource.value)?.accountEmail ?? null;
});

/** Why this calendar cannot be chosen for the current role, or `null`. */
function ineligibility(calendar: CalendarSummary): SyncIneligibility | null {
  switch (role.value) {
    case 'sync':
      return syncIneligibility(
        calendar,
        listAccountEmail.value,
        store.connections,
        viewedIds.value
      );
    case 'view':
      return viewIneligibility(
        calendar,
        listAccountEmail.value,
        store.connections,
        viewedIds.value
      );
  }
}

const rows = computed(() =>
  calendars.value.map((calendar) => ({ calendar, reason: ineligibility(calendar) }))
);
const hasEligible = computed(() => rows.value.some((r) => r.reason === null));

const title = computed(() =>
  t(
    store.connections.length > 0 || viewedIds.value.length > 0
      ? 'calendarSync.action.connectAnother'
      : 'calendarSync.action.connect'
  )
);

const accountLine = computed(() => {
  const email = listAccountEmail.value;
  return email ? fillTemplate(t('calendarSync.connect.account'), { account: email }) : '';
});

function calendarName(calendar: CalendarSummary): string {
  if (calendar.summary) return calendar.summary;
  return t(calendar.primary ? 'calendarSync.primaryCalendar' : 'calendarImport.choose.untitled');
}

/** View only: what the account may do with the calendar in Google, on its row. */
function accessKey(calendar: CalendarSummary): UIStringKey {
  switch (calendar.accessRole) {
    case 'freeBusyReader':
      return 'calendarSync.connect.access.freeBusy';
    case 'writer':
    case 'owner':
      return 'calendarSync.connect.access.edit';
    default:
      return 'calendarSync.connect.access.reader';
  }
}

/** One look for every single-choice row here (role cards, accounts, calendars). */
function optionClass(selected: boolean, disabled: boolean): string {
  if (disabled) {
    return 'dark:border-line dark:bg-surface-raised cursor-not-allowed border-gray-200 bg-white';
  }
  return selected
    ? 'border-primary-500 dark:border-accent-lift dark:bg-surface-overlay cursor-pointer bg-[var(--tint-orange-8)]'
    : 'dark:border-line-strong dark:bg-surface-raised dark:hover:bg-surface-hover cursor-pointer border-gray-200 bg-white hover:bg-gray-50';
}

/** Where a role starts: view only with known accounts offers them first. */
function startStep(): Step {
  return role.value === 'view' && viewAccounts.value.length > 0 ? 'account' : 'consent';
}

/**
 * Bumped by every list load and by `resetToStart`. A list that resolves after the step
 * moved on (the member switched role, or closed and reopened a step) must not touch
 * the step: each load checks its own sequence number before writing.
 */
let listLoadSeq = 0;

function resetToStart(): void {
  listLoadSeq++;
  calendars.value = [];
  selectedId.value = null;
  listSource.value = 'pending';
  accountChoice.value = viewAccounts.value[0]?.id ?? DIFFERENT;
  step.value = startStep();
}

/** Drop the pending consent of a role (each store's abandon is a no-op for the other kind). */
function abandonFor(r: ConnectRole): void {
  if (r === 'sync') store.abandonConnect();
  else viewStore?.abandonViewConnect();
}

function selectRole(next: ConnectRole): void {
  if (busy.value || next === role.value) return;
  // The slot holds one credential: the other role's consent must not linger.
  abandonFor(role.value);
  role.value = next;
  resetToStart();
}

/**
 * Show a listed account's calendars. Sync preselects the primary calendar when it is
 * eligible (the usual destination). View only preselects nothing: the calendar worth
 * viewing is someone else's, never the member's own primary, so the choice is theirs.
 */
function showList(list: CalendarSummary[]): void {
  calendars.value = list;
  const eligible = rows.value.filter((r) => r.reason === null);
  selectedId.value =
    role.value === 'sync'
      ? ((eligible.find((r) => r.calendar.primary) ?? eligible[0])?.calendar.id ?? null)
      : null;
  step.value = 'choose';
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/** Read the pending account's calendars. */
async function loadCalendars(): Promise<void> {
  const loadSeq = ++listLoadSeq;
  step.value = 'loading';
  const list = await store.listPendingCalendars(); // never throws; falls back to primary only
  if (loadSeq !== listLoadSeq) return; // the step moved on while listing
  if (!store.pendingConnect) {
    // The consent went away while listing (sign-out, or another tab of this flow).
    step.value = 'consent';
    return;
  }
  showList(list);
}

async function onContinue(): Promise<void> {
  const owner = claimBusy();
  try {
    // First statement, no await before it: the consent popup must open inside the tap.
    const result = await store.beginConnect();
    if (result.status === 'pending') {
      releaseBusy(owner);
      await loadCalendars();
    } else if (result.status === 'failed') {
      // The shared mapper: translated copy; a declined permission is the person's own
      // choice on Google's screen, so it says what was not granted without paging.
      const toast = connectFailureToast('sync', result, t);
      if (toast) {
        showToast('error', toast.title, toast.message, {
          silent: toast.silent,
          surface: 'calendar-sync',
          context: { action: 'begin-connect', error_code: result.code },
          actionLabel: t('action.tryAgain'),
          actionFn: onContinue,
        });
      }
    }
    // `redirecting`: the page is leaving (web) or the system browser is open
    // (native); the resume brings the member back to the calendar list.
  } catch (e) {
    showToast(
      'error',
      t('calendarSync.toast.connectFailed.title'),
      t('calendarSync.reconnect.bannerError'),
      { surface: 'calendar-sync', error: e, context: { action: 'begin-connect' } }
    );
  } finally {
    releaseBusy(owner);
  }
}

async function onConfirm(): Promise<void> {
  const chosen = selectedId.value;
  if (!chosen) return;
  const owner = claimBusy();
  confirming = true;
  try {
    const result = await store.confirmConnect(chosen);
    if (result.status === 'connected') {
      showToast(
        'success',
        t('calendarSync.toast.connected.title'),
        t('calendarSync.toast.connected.message')
      );
      emit('close');
      return;
    }
    if (result.reason === 'no-pending') {
      // The consent is gone (signed out in between): start again from Google.
      step.value = 'consent';
    }
    // The store already reported the failure (critical for a failed write), so the
    // toast is silent and carries the recovery.
    showToast(
      'error',
      t('calendarSync.toast.connectFailed.title'),
      t(
        result.reason === 'already-connected'
          ? 'calendarSync.connect.reason.alreadyConnected'
          : 'calendarSync.toast.confirmFailed.message'
      ),
      {
        silent: true,
        actionLabel: t('action.tryAgain'),
        actionFn: result.reason === 'no-pending' ? onContinue : onConfirm,
      }
    );
  } catch (e) {
    showToast(
      'error',
      t('calendarSync.toast.connectFailed.title'),
      t('calendarSync.toast.confirmFailed.message'),
      {
        critical: true,
        surface: 'calendar-sync',
        error: e,
        context: { action: 'confirm-connect' },
        actionLabel: t('action.tryAgain'),
        actionFn: onConfirm,
      }
    );
  } finally {
    confirming = false;
    releaseBusy(owner);
  }
}

// ── View only ────────────────────────────────────────────────────────────────

/** A view consent that produced no credential: say what happened, with another go. */
function onViewConsentFailed(result: ViewConnectFailure, loginHint?: string): void {
  // The shared mapper (the redirect resume uses it too). `cancelled` is the member's
  // choice and `unexpected` was reported and toasted by the store: both map to null.
  const toast = connectFailureToast('view', result, t);
  if (!toast) return;
  showToast('error', toast.title, toast.message, {
    silent: toast.silent,
    actionLabel: t('action.tryAgain'),
    actionFn: () => onViewContinue(loginHint),
  });
}

/** Start a fresh view-only consent. `loginHint` when the account is known. */
async function onViewContinue(loginHint?: string): Promise<void> {
  if (!viewStore) return;
  const owner = claimBusy();
  try {
    // A sync consent must not linger in the one slot (synchronous, so the popup
    // below still opens inside the tap).
    store.abandonConnect();
    const result = await viewStore.beginViewConnect(loginHint);
    if (result.status === 'pending') {
      releaseBusy(owner);
      await loadPendingView();
    } else if (result.status === 'failed') {
      onViewConsentFailed(result, loginHint);
    }
    // `redirecting`: the resume fills the slot and the drawer reopens this step.
  } finally {
    releaseBusy(owner);
  }
}

/**
 * A calendar list that could not be read: say what happened and offer the right next
 * step. `retry` reads the same list again.
 */
function onListFailed(
  reason: Extract<ListViewCalendarsResult, { status: 'failed' }>['reason'],
  accountEmail: string | null,
  retry: () => void
): void {
  // Only a consent WITHOUT the list scope is no use to anyone: revoke it now, or the
  // pending watch below would only try to list it again. A read that failed (a
  // network blip, a Google error) keeps the consent, so another go needs no new
  // sign-in.
  if (reason === 'no-list-scope' && listSource.value === 'pending') {
    viewStore?.abandonViewConnect();
  }
  resetToStart();
  const tryAgain = { actionLabel: t('action.tryAgain') };
  if (reason === 'no-list-scope') {
    showToast(
      'error',
      t('calendarView.toast.connectFailed.title'),
      t('calendarSync.connect.viewNoListScope'),
      { silent: true, ...tryAgain, actionFn: () => onViewContinue(accountEmail ?? undefined) }
    );
  } else if (reason === 'read-failed') {
    // The store reported the failure; this toast only carries the retry.
    showToast(
      'error',
      t('calendarView.toast.listFailed.title'),
      t('calendarView.toast.listFailed.message'),
      { silent: true, ...tryAgain, actionFn: retry }
    );
  } else {
    // The consent or the account went away (signed out, removed on another device).
    // The store logged it; the member is told and starts again.
    showToast(
      'error',
      t('calendarView.toast.listFailed.title'),
      t(
        reason === 'no-account'
          ? 'calendarView.toast.accountGone.message'
          : 'calendarView.toast.consentGone.message'
      ),
      { silent: true }
    );
  }
}

/** Read the pending consent's list again, if View only is still the role and the consent is still held. */
function retryPendingList(): void {
  if (role.value !== 'view') return;
  if (viewStore?.pendingViewConnect) void loadPendingView();
  else void onViewContinue();
}

async function loadPendingView(): Promise<void> {
  if (!viewStore) return;
  const loadSeq = ++listLoadSeq;
  step.value = 'loading';
  listSource.value = 'pending';
  const email = viewStore.pendingViewConnect?.accountEmail ?? null;
  const result = await viewStore.listPendingViewCalendars(); // never throws
  if (loadSeq !== listLoadSeq) return; // the step moved on while listing
  if (result.status === 'failed') {
    onListFailed(result.reason, email, retryPendingList);
    return;
  }
  if (!viewStore.pendingViewConnect) {
    // The consent went away while listing (sign-out, or another tab of this flow).
    resetToStart();
    return;
  }
  showList(result.calendars);
}

async function loadAccountCalendars(accountId: string): Promise<void> {
  if (!viewStore) return;
  const loadSeq = ++listLoadSeq;
  step.value = 'loading';
  listSource.value = accountId;
  const email = viewAccounts.value.find((a) => a.id === accountId)?.accountEmail ?? null;
  const result = await viewStore.listCalendarsForAccount(accountId); // never throws
  if (loadSeq !== listLoadSeq) return; // the step moved on while listing
  if (result.status === 'failed') {
    onListFailed(result.reason, email, () => {
      if (role.value === 'view') void loadAccountCalendars(accountId);
    });
    return;
  }
  showList(result.calendars);
}

async function onViewConfirm(): Promise<void> {
  const chosen = calendars.value.find((c) => c.id === selectedId.value);
  if (!viewStore || !chosen) return;
  const owner = claimBusy();
  confirming = true;
  try {
    const result = await viewStore.addViewedCalendar({
      viewAccountId: listSource.value,
      calendar: chosen,
    });
    if (result.status === 'added') {
      showToast(
        'success',
        t('calendarView.toast.added.title'),
        t('calendarView.toast.added.message')
      );
      emit('close');
      return;
    }
    if (result.reason === 'already-added') {
      showToast(
        'error',
        t('calendarView.toast.saveFailed.title'),
        t('calendarSync.connect.reason.alreadyConnected'),
        { silent: true }
      );
    } else if (result.reason === 'no-pending' || result.reason === 'no-account') {
      // The consent or the account is gone (signed out, removed on another device).
      // The store logged it; tell the member and start again.
      resetToStart();
      showToast(
        'error',
        t('calendarView.toast.saveFailed.title'),
        t(
          result.reason === 'no-account'
            ? 'calendarView.toast.accountGone.message'
            : 'calendarView.toast.consentGone.message'
        ),
        { silent: true }
      );
    }
    // `write-failed`: the store reported (critical) and toasted; the step stays open.
  } catch (e) {
    showToast(
      'error',
      t('calendarView.toast.saveFailed.title'),
      t('calendarView.toast.addFailed.message'),
      {
        critical: true,
        surface: 'calendar-view',
        error: e,
        context: { action: 'add' },
        actionLabel: t('action.tryAgain'),
        actionFn: onViewConfirm,
      }
    );
  } finally {
    confirming = false;
    releaseBusy(owner);
  }
}

// ── Footer ───────────────────────────────────────────────────────────────────

const saveLabel = computed(() => {
  if (step.value === 'choose') return t('calendarSync.connect.confirm');
  if (step.value === 'account' && accountChoice.value !== DIFFERENT) {
    return t('calendarSync.connect.next');
  }
  return t('calendarSync.connect.continue');
});

/** The footer is a Google action right now (the breadth sentence sits above it). */
const footerIsGoogle = computed(
  () =>
    role.value === 'view' &&
    (step.value === 'consent' || (step.value === 'account' && accountChoice.value === DIFFERENT))
);

function onSave(): void {
  if (role.value === 'sync') {
    if (step.value === 'consent') void onContinue();
    else if (step.value === 'choose') void onConfirm();
    return;
  }
  if (step.value === 'consent') void onViewContinue();
  else if (step.value === 'account') {
    if (accountChoice.value === DIFFERENT) void onViewContinue();
    else void loadAccountCalendars(accountChoice.value);
  } else if (step.value === 'choose') void onViewConfirm();
}

function onClose(): void {
  if (busy.value) return;
  abandonFor(role.value);
  emit('close');
}

// A consent that arrives while this step waits on it goes straight to the list:
// a redirect return (already pending at mount), or a native round trip that comes
// back through the deep link while the drawer stayed open. The popup path loads the
// list itself (`onContinue`), and is busy while the slot fills, so it never doubles.
watch(
  () => store.pendingConnect,
  (pending) => {
    if (pending && role.value === 'sync' && step.value === 'consent' && !busy.value) {
      void loadCalendars();
    }
  },
  { immediate: true }
);

// The same for a view consent: a returning view redirect reopens this step with
// View only selected, at the calendar list.
if (viewStore) {
  watch(
    () => viewStore.pendingViewConnect,
    (pending) => {
      if (!pending || busy.value) return;
      if (role.value === 'view' && (step.value === 'loading' || step.value === 'choose')) return;
      role.value = 'view';
      void loadPendingView();
    },
    { immediate: true }
  );
}

// Any other way out (navigating away from Settings) abandons too. A no-op once the
// consent was confirmed or abandoned, since the slot is then empty.
onBeforeUnmount(() => {
  if (!confirming) abandonFor(role.value);
});
</script>

<template>
  <BeanieFormModal
    :open="true"
    variant="drawer"
    :title="title"
    icon="📅"
    icon-bg="var(--tint-silk-20)"
    :save-label="saveLabel"
    :save-disabled="step === 'loading' || (step === 'choose' && !selectedId)"
    :is-submitting="busy"
    :submitting-label="t('calendarSync.connect.connecting')"
    save-testid="calendar-connect-save"
    @close="onClose"
    @save="onSave"
  >
    <template #footer-start>
      <BaseButton variant="secondary" :disabled="busy" @click="onClose">
        {{ t('action.cancel') }}
      </BaseButton>
    </template>

    <!-- 0. The role (view-only calendars on): single choice, Sync by default. -->
    <div v-if="viewAvailable">
      <div
        id="calendar-connect-role"
        class="font-outfit text-secondary-400 dark:text-ink-faint mb-2 text-xs font-semibold tracking-[0.08em] uppercase"
      >
        {{ t('calendarSync.connect.roleLabel') }}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="calendar-connect-role"
        class="flex flex-col gap-2"
        data-testid="calendar-connect-roles"
      >
        <label
          v-for="option in ROLES"
          :key="option.role"
          class="flex items-start gap-3 rounded-2xl border px-3 py-2.5 transition-colors"
          :class="optionClass(role === option.role, busy)"
          :data-testid="`calendar-connect-role-${option.role}`"
        >
          <input
            type="radio"
            name="calendar-connect-role"
            :value="option.role"
            :checked="role === option.role"
            :disabled="busy"
            class="accent-primary-500 dark:accent-accent-lift mt-1 h-4 w-4 shrink-0"
            @change="selectRole(option.role)"
          />
          <span class="min-w-0">
            <span
              class="font-outfit text-secondary-500 dark:text-ink block text-base font-semibold"
            >
              {{ t(option.title) }}
            </span>
            <span class="text-secondary-400 dark:text-ink-soft block text-xs leading-snug">
              {{ t(option.body) }}
            </span>
          </span>
        </label>
      </div>
    </div>

    <!-- 1a. View only, known accounts: pick one, or sign in another. -->
    <div v-if="step === 'account'">
      <div
        id="calendar-connect-account"
        class="font-outfit text-secondary-400 dark:text-ink-faint mb-2 text-xs font-semibold tracking-[0.08em] uppercase"
      >
        {{ t('calendarSync.connect.accountLabel') }}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="calendar-connect-account"
        class="flex flex-col gap-2"
        data-testid="calendar-connect-accounts"
      >
        <label
          v-for="account in viewAccounts"
          :key="account.id"
          class="flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors"
          :class="optionClass(accountChoice === account.id, busy)"
          :data-testid="`calendar-connect-account-${account.id}`"
        >
          <input
            v-model="accountChoice"
            type="radio"
            name="calendar-connect-account"
            :value="account.id"
            :disabled="busy"
            class="accent-primary-500 dark:accent-accent-lift h-4 w-4 shrink-0"
          />
          <span class="text-secondary-500 dark:text-ink min-w-0 truncate text-sm font-medium">
            {{ account.accountEmail }}
          </span>
        </label>
        <label
          class="flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors"
          :class="optionClass(accountChoice === DIFFERENT, busy)"
          data-testid="calendar-connect-account-different"
        >
          <input
            v-model="accountChoice"
            type="radio"
            name="calendar-connect-account"
            :value="DIFFERENT"
            :disabled="busy"
            class="accent-primary-500 dark:accent-accent-lift h-4 w-4 shrink-0"
          />
          <span class="text-secondary-500 dark:text-ink min-w-0 text-sm font-medium">
            {{ t('calendarSync.connect.differentAccount') }}
          </span>
        </label>
      </div>
    </div>

    <!-- 1b. Consent: one expectation-setting sentence, and the footer's single
         "Continue with Google". For view only that sentence is the grant's breadth,
         shown below for every view Google action. -->
    <p
      v-else-if="step === 'consent' && role === 'sync'"
      class="text-secondary-400 dark:text-ink-soft text-sm leading-snug"
      data-testid="calendar-connect-consent"
    >
      {{ t('calendarSync.connect.expectation') }}
    </p>

    <!-- 2. Reading the account's calendars -->
    <p
      v-else-if="step === 'loading'"
      class="text-secondary-400 dark:text-ink-soft py-8 text-center text-sm"
    >
      {{ t('calendarSync.connect.loading') }}
    </p>

    <!-- 3. Choose the calendar. -->
    <template v-else-if="step === 'choose'">
      <p v-if="accountLine" class="text-secondary-400 dark:text-ink-soft truncate text-sm">
        {{ accountLine }}
      </p>

      <div>
        <div
          id="calendar-connect-choose"
          class="font-outfit text-secondary-400 dark:text-ink-faint mb-2 text-xs font-semibold tracking-[0.08em] uppercase"
        >
          {{ t('calendarSync.connect.chooseLabel') }}
        </div>
        <div
          role="radiogroup"
          aria-labelledby="calendar-connect-choose"
          class="flex flex-col gap-2"
          data-testid="calendar-connect-list"
        >
          <label
            v-for="row in rows"
            :key="row.calendar.id"
            class="flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors"
            :class="optionClass(selectedId === row.calendar.id, row.reason !== null)"
            :data-testid="`calendar-connect-row-${row.calendar.id}`"
          >
            <input
              v-model="selectedId"
              type="radio"
              name="calendar-connect"
              :value="row.calendar.id"
              :disabled="row.reason !== null || busy"
              class="accent-primary-500 dark:accent-accent-lift h-4 w-4 shrink-0"
            />
            <span class="min-w-0">
              <!-- A fainter ink, never `opacity-*`, for a row that cannot be chosen. -->
              <span
                class="font-outfit block truncate text-base font-semibold"
                :class="
                  row.reason === null
                    ? 'text-secondary-500 dark:text-ink'
                    : 'text-secondary-400 dark:text-ink-faint'
                "
              >
                {{ calendarName(row.calendar) }}
              </span>
              <span
                v-if="row.reason !== null"
                class="text-secondary-400 dark:text-ink-faint block text-xs"
              >
                {{ t(REASON_KEYS[row.reason]) }}
              </span>
              <span
                v-else-if="role === 'view'"
                class="text-secondary-400 dark:text-ink-faint block text-xs"
                data-testid="calendar-connect-access"
              >
                {{ t(accessKey(row.calendar)) }}
              </span>
            </span>
          </label>
        </div>
      </div>

      <p v-if="!hasEligible" class="text-secondary-400 dark:text-ink-soft text-sm">
        {{
          t(
            role === 'view'
              ? 'calendarSync.connect.viewNoneEligible'
              : 'calendarSync.connect.noneEligible'
          )
        }}
      </p>

      <!-- View only: everyone in the pod will see these events. -->
      <p
        v-if="role === 'view'"
        class="text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft rounded-xl bg-[var(--tint-silk-10)] px-3 py-2 text-sm leading-snug"
        data-testid="calendar-connect-reminder"
      >
        {{ t('calendarSync.connect.viewReminder') }}
      </p>
    </template>

    <!-- View only: what signing in allows, above every Google action of this role. -->
    <div v-if="footerIsGoogle || (role === 'view' && step === 'choose')" class="space-y-2">
      <p
        class="text-secondary-400 dark:text-ink-soft text-sm leading-snug"
        data-testid="calendar-connect-breadth"
      >
        {{ t('calendarSync.connect.viewBreadth') }}
      </p>
      <button
        v-if="step === 'choose'"
        type="button"
        class="text-secondary-500 dark:text-ink-soft hover:text-secondary-600 dark:hover:text-ink text-sm font-medium underline underline-offset-2"
        :disabled="busy"
        data-testid="calendar-connect-different"
        @click="onViewContinue()"
      >
        {{ t('calendarSync.connect.differentAccount') }}
      </button>
    </div>
  </BeanieFormModal>
</template>
