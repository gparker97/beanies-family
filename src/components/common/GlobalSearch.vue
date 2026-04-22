<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getActivityCategoryById } from '@/constants/activityCategories';
import { tripTypeEmoji } from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';
import { getTransactionVisual } from '@/utils/transactionLabel';

type ResultType =
  | 'activity'
  | 'vacation'
  | 'todo'
  | 'account'
  | 'transaction'
  | 'goal'
  | 'asset'
  | 'member';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const router = useRouter();
const activityStore = useActivityStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const goalsStore = useGoalsStore();
const assetsStore = useAssetsStore();
const familyStore = useFamilyStore();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

// Focus input when modal opens
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      query.value = '';
      await nextTick();
      inputRef.value?.focus();
    }
  }
);

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
}

function matches(q: string, ...fields: (string | undefined | null)[]): boolean {
  return fields.some((f) => f?.toLowerCase().includes(q));
}

const accountTypeIcons: Record<string, string> = {
  checking: '🏦',
  savings: '💰',
  credit_card: '💳',
  investment: '📈',
  crypto: '₿',
  cash: '💵',
  loan: '🏠',
  other: '🏦',
};

const assetTypeIcons: Record<string, string> = {
  real_estate: '🏠',
  vehicle: '🚗',
  investment: '📊',
  crypto: '₿',
  collectible: '🎨',
  other: '💎',
};

const results = computed<SearchResult[]>(() => {
  const q = query.value.toLowerCase().trim();
  if (!q) return [];

  const all: SearchResult[] = [];

  // Activities (exclude vacation-linked and child overrides of recurring activities)
  for (const a of activityStore.activeActivities) {
    if (a.vacationId) continue;
    if (a.parentActivityId) continue;
    if (matches(q, a.title, a.description, a.location, a.category)) {
      const cat = getActivityCategoryById(a.category);
      const recLabel = a.recurrence !== 'none' ? 'recurring' : 'one-time';
      const datePart = a.date ? formatDateShort(a.date) : '';
      const catPart = cat?.name || '';
      const parts = [recLabel, catPart, datePart].filter(Boolean);
      all.push({
        id: a.id,
        type: 'activity',
        title: a.title,
        subtitle: parts.join(' · '),
        icon: a.icon || cat?.emoji || '📌',
        color: a.color || cat?.color,
      });
    }
  }

  // Vacations
  for (const v of vacationStore.vacations) {
    if (matches(q, v.name)) {
      all.push({
        id: v.id,
        type: 'vacation',
        title: v.name,
        icon: tripTypeEmoji(v.tripType, v.tripPurpose) || '✈️',
      });
    }
  }

  // Todos
  for (const todo of todoStore.todos) {
    if (matches(q, todo.title, todo.description)) {
      const parts: string[] = [];
      if (todo.completed) parts.push('✓ done');
      if (todo.dueDate) parts.push(formatDateShort(todo.dueDate));
      all.push({
        id: todo.id,
        type: 'todo',
        title: todo.title,
        subtitle: parts.join(' · ') || undefined,
        icon: todo.completed ? '✅' : '☐',
      });
    }
  }

  // Accounts
  for (const acc of accountsStore.accounts) {
    if (matches(q, acc.name, acc.institution, acc.type)) {
      all.push({
        id: acc.id,
        type: 'account',
        title: acc.name,
        subtitle: acc.institution || acc.type,
        icon: accountTypeIcons[acc.type] || '🏦',
      });
    }
  }

  // Transactions (search recent, limit source to avoid perf issues)
  const txSlice = transactionsStore.transactions.slice(0, 500);
  for (const tx of txSlice) {
    if (matches(q, tx.description, tx.category)) {
      all.push({
        id: tx.id,
        type: 'transaction',
        title: tx.description,
        subtitle: `${tx.type} · ${tx.currency} ${tx.amount}${tx.date ? ' · ' + formatDateShort(tx.date) : ''}`,
        icon: getTransactionVisual(tx).icon,
      });
    }
  }

  // Goals
  for (const g of goalsStore.goals) {
    if (matches(q, g.name)) {
      all.push({
        id: g.id,
        type: 'goal',
        title: g.name,
        subtitle: g.isCompleted ? '✓ achieved' : `${g.priority} priority`,
        icon: '🎯',
      });
    }
  }

  // Assets
  for (const a of assetsStore.assets) {
    if (matches(q, a.name, a.type)) {
      all.push({
        id: a.id,
        type: 'asset',
        title: a.name,
        subtitle: a.type.replace(/_/g, ' '),
        icon: assetTypeIcons[a.type] || '💎',
      });
    }
  }

  // Family members
  for (const m of familyStore.members) {
    if (matches(q, m.name, m.email)) {
      all.push({
        id: m.id,
        type: 'member',
        title: m.name,
        subtitle: m.role,
        icon: '👤',
        color: m.color,
      });
    }
  }

  return all.slice(0, 25);
});

const groupOrder: { type: ResultType; labelKey: string }[] = [
  { type: 'activity', labelKey: 'search.activities' },
  { type: 'vacation', labelKey: 'search.vacations' },
  { type: 'todo', labelKey: 'search.todos' },
  { type: 'account', labelKey: 'search.accounts' },
  { type: 'transaction', labelKey: 'search.transactions' },
  { type: 'goal', labelKey: 'search.goals' },
  { type: 'asset', labelKey: 'search.assets' },
  { type: 'member', labelKey: 'search.members' },
];

const groupedResults = computed(() => {
  const groups: { key: string; label: string; items: SearchResult[] }[] = [];
  for (const { type, labelKey } of groupOrder) {
    const items = results.value.filter((r) => r.type === type);
    if (items.length) {
      groups.push({ key: type, label: t(labelKey as any), items });
    }
  }
  return groups;
});

function selectResult(result: SearchResult) {
  emit('close');
  switch (result.type) {
    case 'activity':
      router.push({ path: '/activities', query: { activity: result.id } });
      break;
    case 'vacation':
      router.push({ path: '/travel', query: { vacation: result.id } });
      break;
    case 'todo':
      router.push({ path: '/todo', query: { view: result.id } });
      break;
    case 'account':
      router.push({ path: '/accounts', query: { view: result.id } });
      break;
    case 'transaction':
      router.push({ path: '/transactions', query: { view: result.id } });
      break;
    case 'goal':
      router.push({ path: '/goals', query: { view: result.id } });
      break;
    case 'asset':
      router.push({ path: '/assets', query: { view: result.id } });
      break;
    case 'member':
      router.push({ path: '/family', query: { edit: result.id } });
      break;
  }
}

const resultCount = computed(() => results.value.length);
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop with warm tint -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 bg-[rgba(44,62,80,0.55)] backdrop-blur-[2px]"
        @click="emit('close')"
      />
    </Transition>

    <!-- Search panel -->
    <Transition
      enter-active-class="transition-all duration-250 ease-out"
      enter-from-class="opacity-0 -translate-y-6"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-4"
    >
      <div
        v-if="open"
        class="fixed inset-x-0 top-0 z-50 mx-auto mt-14 w-full max-w-lg px-4 sm:mt-20 md:max-w-xl lg:max-w-2xl"
        @keydown="handleKeydown"
      >
        <div
          class="search-card overflow-hidden rounded-[20px] bg-white shadow-[0_20px_60px_rgba(44,62,80,0.22),0_0_0_1px_rgba(44,62,80,0.06)] dark:bg-slate-800 dark:shadow-[0_20px_60px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.06)]"
        >
          <!-- Search input with gradient accent bar -->
          <div class="relative">
            <div
              class="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[var(--heritage-orange)] via-[var(--terracotta)] to-[var(--sky-silk)]"
            />
            <div class="flex items-center gap-3 px-5 pt-4 pb-3">
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
                :class="
                  query.trim()
                    ? 'bg-gradient-to-br from-[var(--heritage-orange)] to-[var(--terracotta)] text-white shadow-[0_2px_8px_rgba(241,93,34,0.2)]'
                    : 'bg-[var(--tint-slate-5)] text-gray-400 dark:bg-slate-700 dark:text-gray-500'
                "
              >
                <svg
                  class="h-[16px] w-[16px] transition-transform duration-200"
                  :class="query.trim() ? 'scale-105' : ''"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="20" y1="20" x2="16" y2="16" />
                </svg>
              </div>
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                :placeholder="t('search.placeholder')"
                class="font-outfit w-full bg-transparent text-base font-semibold text-[var(--color-text)] outline-none placeholder:font-medium placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
              />
              <button
                v-if="query"
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tint-slate-5)] text-xs text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:bg-slate-700 dark:hover:bg-slate-600 dark:hover:text-gray-300"
                @click="query = ''"
              >
                ✕
              </button>
            </div>
            <!-- Result count pill -->
            <div v-if="query.trim() && resultCount > 0" class="px-5 pb-2.5">
              <span
                class="font-outfit inline-flex items-center rounded-full bg-gradient-to-r from-[var(--tint-orange-8)] to-[rgba(230,126,34,0.06)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--heritage-orange)]"
              >
                {{ resultCount }} {{ resultCount === 1 ? 'result' : 'results' }}
              </span>
            </div>
            <div class="mx-4 border-b border-[var(--tint-slate-5)] dark:border-slate-700" />
          </div>

          <!-- Results -->
          <div class="search-results max-h-[22rem] overflow-y-auto">
            <!-- Grouped results -->
            <template v-if="groupedResults.length">
              <div
                v-for="(group, gi) in groupedResults"
                :key="group.key"
                class="py-2"
                :class="
                  gi > 0 ? 'border-t border-[var(--tint-slate-5)] dark:border-slate-700/50' : ''
                "
              >
                <div
                  class="font-outfit flex items-center gap-2 px-5 py-1.5 text-[10px] font-bold tracking-[0.12em] text-gray-400/70 uppercase dark:text-gray-500"
                >
                  <span>{{ group.label }}</span>
                  <span
                    class="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--tint-slate-5)] px-1 text-[9px] font-bold text-gray-400 dark:bg-slate-700"
                  >
                    {{ group.items.length }}
                  </span>
                </div>
                <button
                  v-for="(item, ii) in group.items"
                  :key="item.id"
                  type="button"
                  class="search-result group flex w-full items-center gap-3 px-5 py-2 text-left transition-all duration-150 hover:bg-[var(--tint-orange-8)] dark:hover:bg-[rgba(241,93,34,0.06)]"
                  :style="{ animationDelay: `${(gi * 3 + ii) * 30}ms` }"
                  @click="selectResult(item)"
                >
                  <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-base shadow-[0_1px_3px_rgba(44,62,80,0.06)] transition-transform duration-150 group-hover:scale-110"
                    :style="
                      item.color
                        ? {
                            backgroundColor: item.color + '12',
                            boxShadow: `0 2px 8px ${item.color}15`,
                          }
                        : {}
                    "
                    :class="!item.color ? 'bg-[var(--tint-slate-5)] dark:bg-slate-700' : ''"
                  >
                    {{ item.icon }}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div
                      class="font-outfit truncate text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
                    >
                      {{ item.title }}
                    </div>
                    <div
                      v-if="item.subtitle"
                      class="truncate text-xs text-gray-400 dark:text-gray-500"
                    >
                      {{ item.subtitle }}
                    </div>
                  </div>
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-transparent text-gray-300 transition-all duration-150 group-hover:bg-[var(--tint-orange-15)] group-hover:text-[var(--heritage-orange)] dark:text-gray-600 dark:group-hover:text-[var(--heritage-orange)]"
                  >
                    <svg
                      class="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      viewBox="0 0 24 24"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                </button>
              </div>
            </template>

            <!-- No results -->
            <div v-else-if="query.trim()" class="px-5 py-12 text-center">
              <div
                class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--tint-slate-5)] text-xl dark:bg-slate-700"
              >
                🔍
              </div>
              <p class="font-outfit text-sm font-semibold text-gray-400 dark:text-gray-500">
                {{ t('search.noResults') }}
              </p>
              <p class="mt-1 text-xs text-gray-300 dark:text-gray-600">try a different keyword</p>
            </div>

            <!-- Empty state (no query yet) -->
            <div v-else class="px-5 py-10 text-center">
              <div
                class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--tint-orange-8)] to-[var(--tint-silk-10)] text-lg"
              >
                🫘
              </div>
              <p class="font-outfit text-xs font-medium text-gray-400 dark:text-gray-500">
                find your beans...
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-results::-webkit-scrollbar {
  width: 4px;
}

.search-results::-webkit-scrollbar-track {
  background: transparent;
}

.search-results::-webkit-scrollbar-thumb {
  background: rgb(44 62 80 / 10%);
  border-radius: 4px;
}

.search-results::-webkit-scrollbar-thumb:hover {
  background: rgb(44 62 80 / 20%);
}

.search-result {
  animation: search-fade-in 200ms ease-out both;
}

@keyframes search-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
