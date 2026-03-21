<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ViewToggle from '@/components/planner/ViewToggle.vue';
import MemberChipFilter from '@/components/common/MemberChipFilter.vue';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useFamilyStore } from '@/stores/familyStore';
import CalendarGrid from '@/components/planner/CalendarGrid.vue';
import WeeklyCalendarView from '@/components/planner/WeeklyCalendarView.vue';
import UpcomingActivities from '@/components/planner/UpcomingActivities.vue';
import TodoPreview from '@/components/planner/TodoPreview.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import ActivityViewEditModal from '@/components/planner/ActivityViewEditModal.vue';
import DayAgendaSidebar from '@/components/planner/DayAgendaSidebar.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import { confirm } from '@/composables/useConfirm';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { getActivityFallbackEmoji, getActivityCategoryName } from '@/constants/activityCategories';
import VacationSidebarCard from '@/components/vacation/VacationSidebarCard.vue';
import NookSectionCard from '@/components/nook/NookSectionCard.vue';
import VacationWizard from '@/components/vacation/VacationWizard.vue';
import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';
import type { ConfirmDetail } from '@/components/ui/CreatedConfirmModal.vue';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  CurrencyCode,
  TodoItem,
} from '@/types/models';

const { t } = useTranslation();
const { isMobile } = useBreakpoint();
const route = useRoute();
const router = useRouter();
const { canEditActivities } = usePermissions();
const activityStore = useActivityStore();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();
const transactionsStore = useTransactionsStore();
const memberFilterStore = useMemberFilterStore();
const familyStore = useFamilyStore();
const vacationStore = useVacationStore();
const {
  viewingActivity,
  viewingOccurrenceDate,
  openViewModal,
  handleViewOpenEdit: scopedViewOpenEdit,
  handleScopedSave,
} = useActivityScopeEdit();

// Open activity view modal from query param (e.g. /activities?activity=abc)
onMounted(() => {
  const activityId = route.query.activity as string | undefined;
  if (activityId) {
    openViewModal(activityId);
    // Clean up query param so refreshing doesn't re-open
    router.replace({ query: {} });
  }
});

function toggleAllMembers() {
  if (!memberFilterStore.isAllSelected) memberFilterStore.selectAll();
}
function toggleMember(id: string) {
  if (memberFilterStore.isAllSelected) {
    memberFilterStore.selectOnly(id);
  } else {
    memberFilterStore.toggleMember(id);
  }
}

const activeMemberNames = computed(() =>
  familyStore.members
    .filter((m) => memberFilterStore.isMemberSelected(m.id) && !memberFilterStore.isAllSelected)
    .map((m) => m.name)
);

const activeView = ref(isMobile.value ? 'month' : 'week');
const showInactive = ref(false);
const showMemberFilterMobile = ref(false);
const showModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);
const editingOccurrenceDate = ref<string | undefined>(undefined);
const selectedDate = ref<string | undefined>(undefined);
const sidebarDate = ref<string | null>(null);
const defaultStartTime = ref<string | undefined>(undefined);

// Activity created confirmation modal
const createdConfirm = ref<{
  open: boolean;
  title: string;
  message: string;
  details: ConfirmDetail[];
}>({ open: false, title: '', message: '', details: [] });

const calendarGridRef = ref<InstanceType<typeof CalendarGrid> | null>(null);
const weeklyViewRef = ref<InstanceType<typeof WeeklyCalendarView> | null>(null);

// Vacation wizard state
const showVacationWizard = ref(false);
const vacationWizardDefaults = ref<{ assigneeIds: string[]; date: string }>({
  assigneeIds: [],
  date: '',
});
const editingVacation = ref<import('@/types/models').FamilyVacation | null>(null);
const editVacationStep = ref<number | undefined>(undefined);

function handleStartVacationWizard(defaults: { assigneeIds: string[]; date: string }) {
  showModal.value = false;
  vacationWizardDefaults.value = defaults;
  editingVacation.value = null;
  editVacationStep.value = undefined;
  showVacationWizard.value = true;
}

function handleVacationClick(id: string) {
  router.push({ path: '/travel', query: { vacation: id } });
}

const headerSubtitle = computed(() => {
  if (activeView.value === 'week') {
    const label = weeklyViewRef.value?.weekLabel ?? '';
    const count = weeklyViewRef.value?.activityCount ?? 0;
    return t('planner.subtitle').replace('{month}', label).replace('{count}', String(count));
  }
  const month = calendarGridRef.value?.monthLabel ?? '';
  const count = calendarGridRef.value?.activityCount ?? 0;
  return t('planner.subtitle').replace('{month}', month).replace('{count}', String(count));
});

function openAddModal(date?: string, time?: string) {
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
  selectedDate.value = date;
  defaultStartTime.value = time;
  showModal.value = true;
}

function handleCalendarDateClick(date: string) {
  sidebarDate.value = date;
}

function handleSidebarAdd() {
  const date = sidebarDate.value ?? undefined;
  sidebarDate.value = null;
  defaultStartTime.value = '09:00';
  openAddModal(date);
}

function handleSidebarEdit(id: string, date: string) {
  sidebarDate.value = null;
  openViewModal(id, date);
}

function handleViewOpenEdit(activity: FamilyActivity) {
  const { activity: target, occurrenceDate } = scopedViewOpenEdit(activity);
  editingActivity.value = target;
  editingOccurrenceDate.value = occurrenceDate;
  showModal.value = true;
}

async function handleSave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  // Track payment changes (adding or removing linked recurring payment)
  const isUpdate = 'id' in data && 'data' in data;
  const isAddingPayment =
    isUpdate && data.data.payFromAccountId && !editingActivity.value?.linkedRecurringItemId;
  const isRemovingPayment =
    isUpdate && !data.data.payFromAccountId && !!editingActivity.value?.linkedRecurringItemId;
  const isPaymentChange = isAddingPayment || isRemovingPayment;

  if (isUpdate) {
    // When removing a linked payment, delete generated transactions BEFORE the activity update
    // (must happen here because activityStore can't import transactionsStore — circular dep)
    if (isRemovingPayment && editingActivity.value?.linkedRecurringItemId) {
      await transactionsStore.deleteTransactionsByRecurringItemId(
        editingActivity.value.linkedRecurringItemId
      );
    }

    if (
      editingOccurrenceDate.value &&
      editingActivity.value?.recurrence !== 'none' &&
      !isPaymentChange
    ) {
      // Recurring occurrence edit (not payment-related) — show scope modal
      const saved = await handleScopedSave(data.id, editingOccurrenceDate.value, data.data);
      if (!saved) return; // cancelled — keep modal open
    } else {
      // Direct update: non-recurring, adding/removing payment (always applies to template)
      await activityStore.updateActivity(data.id, data.data);
    }
  } else {
    const created = await activityStore.createActivity(data as CreateFamilyActivityInput);
    if (created) {
      showActivityCreatedConfirmation(data as CreateFamilyActivityInput);
    }
  }

  // When fee amount changes on a linked activity, update future materialized transactions
  // to match the new monthly amount (past transactions are historical and unchanged)
  if (isUpdate && !isRemovingPayment) {
    await nextTick();
    const savedActivity = activityStore.activities.find(
      (a) => a.id === (data as { id: string }).id
    );
    if (savedActivity?.linkedRecurringItemId) {
      const ri = recurringStore.getRecurringItemById(savedActivity.linkedRecurringItemId);
      if (ri) {
        const today = new Date().toISOString().slice(0, 10);
        const futureTxs = transactionsStore.transactions.filter(
          (tx) =>
            tx.recurringItemId === ri.id && tx.date.slice(0, 10) >= today && tx.amount !== ri.amount
        );
        for (const tx of futureTxs) {
          await transactionsStore.updateTransaction(tx.id, { amount: ri.amount });
        }
      }
    }
  }

  showModal.value = false;

  // Show success confirmation when a new linked payment was created
  if (isAddingPayment) {
    await nextTick();
    const savedActivity = activityStore.activities.find(
      (a) => a.id === (data as { id: string }).id
    );
    if (savedActivity?.linkedRecurringItemId) {
      const ri = recurringStore.getRecurringItemById(savedActivity.linkedRecurringItemId);
      const acct = accountsStore.accounts.find((a) => a.id === savedActivity.payFromAccountId);
      if (ri && acct) {
        const amt = formatCurrencyWithCode(ri.amount, ri.currency as CurrencyCode);
        const freq = ri.frequency === 'yearly' ? '/yr' : '/mo';
        const confirmed = await confirm({
          title: 'recurringPrompt.paymentCreated',
          message: 'recurringPrompt.paymentCreatedDetail',
          detail: `${amt}${freq} from ${acct.name}`,
          variant: 'info',
          confirmLabel: 'recurringPrompt.viewTransactions',
          cancelLabel: 'action.close',
        });
        if (confirmed) {
          router.push('/transactions');
        }
      }
    }
  }

  // Show confirmation when a linked payment was removed
  if (isRemovingPayment) {
    await nextTick();
    await confirm({
      title: 'recurringPrompt.paymentRemoved',
      message: 'recurringPrompt.paymentRemovedDetail',
      variant: 'info',
      showCancel: false,
    });
  }

  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

function showActivityCreatedConfirmation(data: CreateFamilyActivityInput) {
  const d = new Date(data.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const details: ConfirmDetail[] = [
    { label: t('planner.field.title'), value: data.title },
    { label: t('form.category'), value: getActivityCategoryName(data.category) },
    { label: t('form.date'), value: dateStr },
  ];
  if (data.startTime) {
    const time = data.endTime ? `${data.startTime} - ${data.endTime}` : data.startTime;
    details.push({ label: t('planner.field.startTime'), value: time });
  }
  if (data.isAllDay) {
    details.push({ label: t('planner.allDay'), value: '✓' });
  }
  if (data.recurrence !== 'none') {
    details.push({
      label: t('planner.field.recurrence'),
      value: t(`planner.recurrence.${data.recurrence}` as any),
    });
  }
  if (data.location) {
    details.push({ label: t('planner.field.location'), value: data.location });
  }
  createdConfirm.value = {
    open: true,
    title: t('planner.activityCreatedTitle'),
    message: t('planner.activityCreatedMessage'),
    details,
  };
}

async function handleDelete() {
  if (!editingActivity.value) return;
  const activityToDelete = editingActivity.value;
  showModal.value = false;
  const confirmed = await confirm({
    title: 'planner.deleteActivity',
    message: 'planner.deleteConfirm',
    variant: 'danger',
  });
  if (confirmed) {
    await activityStore.deleteActivity(activityToDelete.id);
  }
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

// --- Todo view/edit modal ---
const selectedTodo = ref<TodoItem | null>(null);

function openTodoViewModal(todo: TodoItem) {
  selectedTodo.value = todo;
}

function handleActivitySwapped(newId: string) {
  const newActivity = activityStore.activities.find((a) => a.id === newId);
  if (newActivity) viewingActivity.value = newActivity;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header row: subtitle + filters + add button -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-secondary-500/40 hidden text-sm sm:block dark:text-gray-500">
        {{ headerSubtitle }}
      </p>
      <div class="flex items-center gap-2">
        <!-- Compact member filter (mobile: dropdown, desktop: inline chips) -->
        <div class="hidden sm:flex">
          <MemberChipFilter
            :is-all-active="memberFilterStore.isAllSelected"
            :is-member-active="
              (id: string) =>
                memberFilterStore.isMemberSelected(id) && !memberFilterStore.isAllSelected
            "
            @select-all="toggleAllMembers"
            @select-member="toggleMember"
          />
        </div>
        <!-- Mobile: compact member filter button -->
        <div class="relative sm:hidden">
          <button
            type="button"
            class="font-outfit inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium transition-all"
            :class="
              memberFilterStore.isAllSelected
                ? 'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400'
                : 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
            "
            @click="showMemberFilterMobile = !showMemberFilterMobile"
          >
            <span class="text-base">👨‍👩‍👧</span>
            {{
              memberFilterStore.isAllSelected
                ? t('filter.allMembers')
                : activeMemberNames.length === 1
                  ? activeMemberNames[0]
                  : `${activeMemberNames.length} ${t('filter.members' as any)}`
            }}
            <span class="text-xs opacity-60">▾</span>
          </button>
          <!-- Mobile dropdown backdrop -->
          <div
            v-if="showMemberFilterMobile"
            class="fixed inset-0 z-20"
            @click="showMemberFilterMobile = false"
          />
          <!-- Mobile dropdown -->
          <Transition
            enter-active-class="transition-all duration-150"
            enter-from-class="opacity-0 -translate-y-1"
            leave-active-class="transition-all duration-100"
            leave-to-class="opacity-0 -translate-y-1"
          >
            <div
              v-if="showMemberFilterMobile"
              class="absolute top-full left-0 z-30 mt-1.5 min-w-[200px] rounded-2xl border border-gray-200/60 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
            >
              <button
                type="button"
                class="font-outfit flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  memberFilterStore.isAllSelected
                    ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
                    : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)] dark:text-gray-300 dark:hover:bg-slate-700'
                "
                @click="
                  toggleAllMembers();
                  showMemberFilterMobile = false;
                "
              >
                <span class="text-base">👨‍👩‍👧</span>
                {{ t('filter.allMembers') }}
              </button>
              <button
                v-for="member in familyStore.members"
                :key="member.id"
                type="button"
                class="font-outfit flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  memberFilterStore.isMemberSelected(member.id) && !memberFilterStore.isAllSelected
                    ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
                    : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)] dark:text-gray-300 dark:hover:bg-slate-700'
                "
                @click="toggleMember(member.id)"
              >
                <span
                  class="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white"
                  :style="{
                    backgroundColor: member.color,
                  }"
                >
                  {{ member.name.charAt(0).toUpperCase() }}
                </span>
                {{ member.name }}
              </button>
            </div>
          </Transition>
        </div>
        <button
          v-if="canEditActivities"
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
          @click="openAddModal()"
        >
          {{ t('planner.addActivity') }}
        </button>
      </div>
    </div>

    <!-- Upcoming vacations — prominent card above calendar -->
    <NookSectionCard
      v-if="vacationStore.upcomingVacations.length > 0"
      :title="t('vacation.upcoming')"
    >
      <div
        class="flex snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:pb-0"
      >
        <VacationSidebarCard
          v-for="vacation in vacationStore.upcomingVacations"
          :key="vacation.id"
          class="w-[280px] shrink-0 snap-start sm:w-auto sm:shrink"
          :vacation="vacation"
          @click="handleVacationClick(vacation.id)"
        />
      </div>
    </NookSectionCard>

    <!-- View toggle (compact, directly above calendar) -->
    <ViewToggle :active-view="activeView" @update:active-view="activeView = $event" />

    <!-- Calendar views (conditional on activeView) -->
    <CalendarGrid
      v-if="activeView === 'month'"
      ref="calendarGridRef"
      :selected-date="sidebarDate ?? undefined"
      @select-date="handleCalendarDateClick"
      @vacation-click="handleVacationClick"
    />

    <WeeklyCalendarView
      v-else-if="activeView === 'week'"
      ref="weeklyViewRef"
      :selected-date="sidebarDate ?? undefined"
      @select-date="handleCalendarDateClick"
      @add-activity="(date: string, time?: string) => openAddModal(date, time)"
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @view-todo="openTodoViewModal"
      @vacation-click="handleVacationClick"
    />

    <!-- Two-column layout: Upcoming + Todo preview -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <UpcomingActivities @edit="(id: string, date: string) => openViewModal(id, date)" />
      <TodoPreview @view="openTodoViewModal" />
    </div>

    <!-- Inactive activities toggle (month view only) -->
    <div v-if="activeView === 'month' && activityStore.inactiveActivities.length > 0">
      <button
        type="button"
        class="text-secondary-500/50 hover:text-secondary-500 flex items-center gap-2 text-sm transition-colors dark:text-gray-500 dark:hover:text-gray-300"
        @click="showInactive = !showInactive"
      >
        <span class="text-xs opacity-50">{{ showInactive ? '&#x25B2;' : '&#x25BC;' }}</span>
        <span class="font-semibold">
          {{ t('planner.inactiveActivities') }}
          ({{ activityStore.inactiveActivities.length }})
        </span>
      </button>

      <div v-if="showInactive" class="mt-3 space-y-1.5">
        <button
          v-for="activity in activityStore.inactiveActivities"
          :key="activity.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white/60 px-3 py-2.5 text-left opacity-60 shadow-[0_2px_10px_rgba(44,62,80,0.03)] transition-all hover:opacity-100 hover:shadow-[0_4px_16px_rgba(44,62,80,0.06)] dark:bg-slate-800/60"
          style="border-left-color: #95a5a6"
          @click="openViewModal(activity.id)"
        >
          <span class="flex-shrink-0 text-base leading-none opacity-50">
            {{ activity.icon ?? getActivityFallbackEmoji(activity.category) }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 min-w-0 flex-1 truncate text-sm font-semibold dark:text-gray-400"
          >
            {{ activity.title }}
          </span>
          <span class="text-secondary-500/30 flex-shrink-0 text-xs dark:text-gray-500">
            {{ t('planner.showInactive') }}
          </span>
        </button>
      </div>
    </div>

    <!-- Day agenda sidebar -->
    <DayAgendaSidebar
      :date="sidebarDate ?? ''"
      :open="sidebarDate !== null"
      @close="sidebarDate = null"
      @add-activity="handleSidebarAdd"
      @edit-activity="handleSidebarEdit"
      @view-todo="openTodoViewModal"
      @vacation-click="handleVacationClick"
    />

    <!-- Activity modal -->
    <ActivityModal
      :open="showModal"
      :activity="editingActivity"
      :default-date="selectedDate"
      :default-start-time="defaultStartTime"
      :read-only="!canEditActivities"
      :occurrence-date="editingOccurrenceDate"
      @close="
        showModal = false;
        defaultStartTime = undefined;
      "
      @save="handleSave"
      @delete="handleDelete"
      @start-vacation-wizard="handleStartVacationWizard"
    />

    <!-- Vacation wizard -->
    <VacationWizard
      :open="showVacationWizard"
      :vacation="editingVacation"
      :edit-step="editVacationStep"
      :default-assignee-ids="vacationWizardDefaults.assigneeIds"
      :default-date="vacationWizardDefaults.date"
      @close="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
      @saved="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
    />

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodo = null" />

    <ActivityViewEditModal
      :activity="viewingActivity"
      :occurrence-date="viewingOccurrenceDate"
      @close="viewingActivity = null"
      @open-edit="handleViewOpenEdit"
      @activity-swapped="handleActivitySwapped"
    />

    <!-- Activity Created Confirmation -->
    <CreatedConfirmModal
      :open="createdConfirm.open"
      :title="createdConfirm.title"
      :message="createdConfirm.message"
      :details="createdConfirm.details"
      @close="createdConfirm.open = false"
    />
  </div>
</template>
