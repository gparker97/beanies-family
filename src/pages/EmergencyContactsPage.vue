<script setup lang="ts">
/**
 * Emergency Contacts — `/pod/contacts`. Family phonebook that sitters
 * and grandparents can reach for in a pinch. Search + category filter
 * chips on top, then a list grouped by category, then a share-with-
 * sitter affordance (ships its own composable in a follow-up).
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import EmergencyContactFormModal from '@/components/pod/EmergencyContactFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { usePermissions } from '@/composables/usePermissions';
import { CATEGORY_EMOJI, CATEGORY_ORDER } from '@/constants/emergencyContacts';
import type { EmergencyContact, EmergencyContactCategory } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const store = useEmergencyContactsStore();
const { canManagePod } = usePermissions();

const search = ref('');
const filter = ref<EmergencyContactCategory | 'all'>('all');

const modalOpen = ref(false);
const editing = ref<EmergencyContact | null>(null);

// Quick-add FAB → open blank Add Emergency Contact modal.
useQuickAddIntent((action) => {
  if (action === 'add-emergency') {
    editing.value = null;
    modalOpen.value = true;
  }
});

// Search + filter pipeline — search is case-insensitive across name /
// role / phone / email (matches the store's `search()` getter); filter
// narrows by category chip.
const filtered = computed<EmergencyContact[]>(() => {
  const q = search.value.trim().toLowerCase();
  const baseList = store.contacts;
  const searched = q
    ? baseList.filter((c) =>
        [c.name, c.role, c.phone, c.email]
          .filter((v): v is string => !!v)
          .some((v) => v.toLowerCase().includes(q))
      )
    : baseList;
  if (filter.value === 'all') return searched;
  return searched.filter((c) => c.category === filter.value);
});

const countsByCategory = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const c of store.contacts) counts[c.category] = (counts[c.category] ?? 0) + 1;
  return counts;
});

const grouped = computed(() => {
  const by = new Map<EmergencyContactCategory, EmergencyContact[]>();
  for (const c of filtered.value) {
    const list = by.get(c.category) ?? [];
    list.push(c);
    by.set(c.category, list);
  }
  return CATEGORY_ORDER.filter((cat) => by.has(cat)).map((cat) => ({
    category: cat,
    entries: (by.get(cat) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
});

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(c: EmergencyContact): void {
  editing.value = c;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}

function callFor(c: EmergencyContact, e: Event): void {
  // Stop propagation so the call/email action buttons don't also open
  // the edit modal (the full row is a click target).
  e.stopPropagation();
  if (c.phone) window.location.href = `tel:${c.phone.replace(/[^\d+]/g, '')}`;
}

function emailFor(c: EmergencyContact, e: Event): void {
  e.stopPropagation();
  if (c.email) window.location.href = `mailto:${c.email}`;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Hero -->
    <header
      class="relative mb-6 flex flex-wrap items-start gap-4 overflow-hidden rounded-[var(--sq)] border border-[rgb(241_93_34_/_15%)] bg-gradient-to-br from-[rgb(241_93_34_/_6%)] via-white to-[rgb(174_214_241_/_20%)] px-4 py-5 sm:gap-5 sm:px-6 sm:py-6 dark:bg-slate-800"
    >
      <div
        class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-[var(--card-shadow)] sm:h-14 sm:w-14 sm:text-3xl"
        aria-hidden="true"
      >
        🏥
      </div>
      <div class="min-w-0 flex-1">
        <button
          type="button"
          class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
          @click="router.push('/pod')"
        >
          <BeanieIcon name="chevron-left" size="xs" />
          <span>{{ t('bean.backToPod') }}</span>
        </button>
        <h1
          class="font-outfit text-secondary-500 text-xl leading-tight font-extrabold sm:text-2xl dark:text-gray-100"
        >
          {{ t('contacts.title') }}
        </h1>
        <p class="text-secondary-500/75 mt-1 text-sm">
          <span class="font-caveat text-[#E67E22]">{{ t('contacts.subtitleLead') }}</span>
          <br />
          {{ t('contacts.subtitle') }}
        </p>
      </div>
      <div v-if="canManagePod" class="flex w-full flex-shrink-0 items-center gap-2 sm:w-auto">
        <button
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)] sm:w-auto"
          @click="openAdd"
        >
          <span aria-hidden="true">＋</span>
          <span>{{ t('contacts.addContact') }}</span>
        </button>
      </div>
    </header>

    <!-- Search + filter toolbar -->
    <div v-if="store.contacts.length" class="mb-5 flex flex-wrap items-center gap-3">
      <label
        class="flex min-w-[240px] flex-1 items-center gap-2 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-2.5 focus-within:border-[var(--color-primary)] dark:bg-slate-800"
      >
        <span aria-hidden="true" class="text-secondary-500/50">🔍</span>
        <input
          v-model="search"
          type="search"
          class="font-inter w-full border-none bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] dark:text-gray-100"
          :placeholder="t('contacts.searchPlaceholder')"
        />
      </label>
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="font-outfit inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            filter === 'all'
              ? 'bg-[var(--color-primary)] text-white shadow-sm'
              : 'text-secondary-500 bg-[var(--tint-slate-5)] hover:bg-[var(--tint-orange-4)] dark:bg-slate-700 dark:text-gray-200'
          "
          @click="filter = 'all'"
        >
          <span>{{ t('contacts.filter.all') }}</span>
          <span class="opacity-70">· {{ store.contacts.length }}</span>
        </button>
        <button
          v-for="cat in CATEGORY_ORDER"
          :key="cat"
          type="button"
          class="font-outfit inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            filter === cat
              ? 'bg-[var(--color-primary)] text-white shadow-sm'
              : 'text-secondary-500 bg-[var(--tint-slate-5)] hover:bg-[var(--tint-orange-4)] dark:bg-slate-700 dark:text-gray-200'
          "
          :disabled="!countsByCategory[cat]"
          @click="filter = cat"
        >
          <span aria-hidden="true">{{ CATEGORY_EMOJI[cat] }}</span>
          <span>{{ t(`contacts.category.${cat}`) }}</span>
          <span class="opacity-70">· {{ countsByCategory[cat] ?? 0 }}</span>
        </button>
      </div>
    </div>

    <!-- Grouped list -->
    <div v-if="grouped.length" class="space-y-6">
      <section v-for="group in grouped" :key="group.category">
        <h2
          class="font-outfit text-secondary-500/70 mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.08em] uppercase dark:text-gray-400"
        >
          <span aria-hidden="true" class="text-base">{{ CATEGORY_EMOJI[group.category] }}</span>
          <span>{{ t(`contacts.category.${group.category}`) }}</span>
          <span class="text-secondary-500/40 text-[10px] font-semibold">{{
            group.entries.length
          }}</span>
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="c in group.entries"
            :key="c.id"
            role="button"
            tabindex="0"
            class="flex cursor-pointer items-start gap-3 rounded-[var(--sq)] bg-white p-4 shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            @click="openEdit(c)"
            @keyup.enter="openEdit(c)"
          >
            <div
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-xl"
              aria-hidden="true"
            >
              {{ CATEGORY_EMOJI[c.category] }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
                  {{ c.name }}
                </h3>
                <span
                  v-if="c.category === 'other' && c.customCategory"
                  class="font-outfit inline-flex items-center rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[var(--color-primary)] uppercase"
                >
                  {{ c.customCategory }}
                </span>
              </div>
              <p
                v-if="c.role"
                class="font-inter text-secondary-500/70 mt-0.5 text-sm dark:text-gray-400"
              >
                {{ c.role }}
              </p>
              <div
                v-if="c.phone || c.email || c.address"
                class="font-inter text-secondary-500/60 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs dark:text-gray-400"
              >
                <span v-if="c.phone">📞 {{ c.phone }}</span>
                <span v-if="c.email">✉️ {{ c.email }}</span>
                <span v-if="c.address">📍 {{ c.address }}</span>
              </div>
              <p
                v-if="c.notes"
                class="font-inter text-secondary-500/60 mt-1.5 text-xs italic dark:text-gray-400"
              >
                {{ c.notes }}
              </p>
            </div>
            <div class="flex flex-shrink-0 gap-1">
              <a
                v-if="c.phone"
                :href="`tel:${c.phone.replace(/[^\d+]/g, '')}`"
                class="text-primary-500 hover:bg-primary-500/10 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                :title="t('contacts.action.call')"
                @click="(e: Event) => callFor(c, e)"
              >
                📞
              </a>
              <a
                v-if="c.email"
                :href="`mailto:${c.email}`"
                class="text-primary-500 hover:bg-primary-500/10 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                :title="t('contacts.action.email')"
                @click="(e: Event) => emailFor(c, e)"
              >
                ✉️
              </a>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <!-- Empty / no-results state -->
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="🆘"
        :message="store.contacts.length ? t('contacts.noResults') : t('contacts.empty')"
        :action-label="canManagePod && store.contacts.length === 0 ? t('contacts.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <EmergencyContactFormModal :open="modalOpen" :contact="editing" @close="closeModal" />
  </div>
</template>
