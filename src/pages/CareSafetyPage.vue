<script setup lang="ts">
/**
 * Care & Safety — cross-family view of allergies and active medications,
 * with a preview of key emergency contacts (full UI ships in P5).
 *
 * Allergies sort severity-first so severe hits are at the top. Medications
 * filter to active only — history lives on each bean's detail page.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import StatStrip from '@/components/pod/shared/StatStrip.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import type { Allergy, AllergySeverity, FamilyMember, Medication } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();

const SEVERITY_ORDER: Record<AllergySeverity, number> = { severe: 0, moderate: 1, mild: 2 };

const allergies = computed(() =>
  [...allergiesStore.allergies].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )
);

const activeMeds = computed(() => medicationsStore.active);

const severeCount = computed(() => allergies.value.filter((a) => a.severity === 'severe').length);

const stats = computed(() => [
  {
    value: allergies.value.length,
    label: t('careSafety.stats.allergies'),
    emoji: '⚠️',
    accent: 'primary' as const,
  },
  {
    value: severeCount.value,
    label: t('careSafety.stats.severe'),
    emoji: '🚨',
    accent: severeCount.value > 0 ? ('primary' as const) : ('secondary' as const),
  },
  {
    value: activeMeds.value.length,
    label: t('careSafety.stats.activeMeds'),
    emoji: '💊',
    accent: 'silk' as const,
  },
]);

const SEVERITY_STYLE: Record<AllergySeverity, { bar: string; badge: string }> = {
  severe: {
    bar: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  moderate: {
    bar: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  mild: {
    bar: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
};

function memberFor(memberId: string): FamilyMember | undefined {
  return familyStore.members.find((m) => m.id === memberId);
}

function openAllergy(a: Allergy): void {
  router.push(`/pod/${a.memberId}/allergies`);
}

function openMedication(m: Medication): void {
  router.push(`/pod/${m.memberId}/medications`);
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <header
      class="mb-6 rounded-[var(--sq)] bg-gradient-to-br from-[rgba(174,214,241,0.35)] to-[rgba(241,93,34,0.08)] px-8 py-7"
    >
      <h1 class="font-outfit text-secondary-500 text-3xl font-bold dark:text-gray-100">
        🩺 {{ t('careSafety.title') }}
      </h1>
      <p class="text-secondary-500/70 mt-1 text-sm">{{ t('careSafety.subtitle') }}</p>
    </header>

    <StatStrip :stats="stats" class="mb-6" />

    <section
      class="mb-6 rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <h2 class="font-outfit text-secondary-500 mb-3 text-lg font-bold dark:text-gray-100">
        ⚠️ {{ t('careSafety.section.allergies') }}
      </h2>
      <ul v-if="allergies.length" class="grid gap-2 md:grid-cols-2">
        <li
          v-for="a in allergies"
          :key="a.id"
          class="group relative flex cursor-pointer flex-col gap-1 overflow-hidden rounded-xl bg-[var(--tint-slate-5)] px-4 py-3 pl-5 transition-colors hover:bg-[var(--tint-orange-4)] dark:bg-slate-700/40"
          @click="openAllergy(a)"
        >
          <span
            class="absolute top-0 bottom-0 left-0 w-1.5"
            :class="SEVERITY_STYLE[a.severity].bar"
            aria-hidden="true"
          />
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-100">
                {{ a.name }}
              </h3>
              <p class="text-secondary-500/60 text-xs">{{ memberFor(a.memberId)?.name ?? '—' }}</p>
            </div>
            <span
              class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
              :class="SEVERITY_STYLE[a.severity].badge"
            >
              {{ t(`allergies.severity.${a.severity}`) }}
            </span>
          </div>
          <p
            v-if="a.reaction"
            class="font-outfit text-secondary-500/70 line-clamp-2 text-xs dark:text-gray-400"
          >
            {{ a.reaction }}
          </p>
        </li>
      </ul>
      <EmptyState v-else emoji="⚠️" :message="t('careSafety.empty.allergies')" />
    </section>

    <section
      class="mb-6 rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <h2 class="font-outfit text-secondary-500 mb-3 text-lg font-bold dark:text-gray-100">
        💊 {{ t('careSafety.section.medications') }}
      </h2>
      <ul v-if="activeMeds.length" class="grid gap-2 md:grid-cols-2">
        <li
          v-for="m in activeMeds"
          :key="m.id"
          class="flex cursor-pointer flex-col gap-0.5 rounded-xl bg-[var(--tint-slate-5)] px-4 py-3 transition-colors hover:bg-[var(--tint-orange-4)] dark:bg-slate-700/40"
          @click="openMedication(m)"
        >
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-100">
              {{ m.name }}
            </h3>
            <span class="text-secondary-500/60 text-[11px]">{{
              memberFor(m.memberId)?.name ?? '—'
            }}</span>
          </div>
          <p class="font-outfit text-secondary-500/70 text-xs">{{ m.dose }} · {{ m.frequency }}</p>
        </li>
      </ul>
      <EmptyState v-else emoji="💊" :message="t('careSafety.empty.medications')" />
    </section>

    <section class="rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-outfit text-secondary-500 text-lg font-bold dark:text-gray-100">
          🆘 {{ t('careSafety.section.keyContacts') }}
        </h2>
        <button
          type="button"
          class="font-outfit text-primary-500 text-xs font-semibold hover:underline"
          @click="router.push('/pod/contacts')"
        >
          {{ t('careSafety.keyContacts.cta') }}
        </button>
      </div>
      <EmptyState emoji="🆘" :message="t('careSafety.empty.keyContacts')" />
    </section>
  </main>
</template>
