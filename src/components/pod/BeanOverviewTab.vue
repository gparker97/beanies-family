<script setup lang="ts">
/**
 * Bean Overview tab — StatStrip + 6-module dashboard.
 *
 * Per the plan's page-composition rule, the dashboard itself should
 * stay thin and let each module own its own store import. For P2-B we
 * render all six modules inline with OverviewModule as the shell; when
 * favorites/sayings/notes get full UI in P2-C we'll extract each into
 * its own `Overview{Type}Module.vue` so the domain logic lives next
 * to the tab surface that owns it.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import OverviewModule from '@/components/pod/shared/OverviewModule.vue';
import StatStrip from '@/components/pod/shared/StatStrip.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
}>();

const router = useRouter();
const { t } = useTranslation();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();

const favorites = computed(() => favoritesStore.byMember(props.member.id).value);
const sayings = computed(() => sayingsStore.byMember(props.member.id).value);
const notes = computed(() => memberNotesStore.byMember(props.member.id).value);

const ageValue = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob?.year) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.year;
  const before =
    today.getMonth() + 1 < dob.month ||
    (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (before) age -= 1;
  return age >= 0 ? age : null;
});

type StatRow = {
  value: string | number;
  label: string;
  accent: 'primary' | 'secondary' | 'success' | 'silk' | 'terracotta';
};

const stats = computed<StatRow[]>(() => {
  const rows: StatRow[] = [
    { value: favorites.value.length, label: t('bean.stats.favorites'), accent: 'primary' },
    { value: sayings.value.length, label: t('bean.stats.sayings'), accent: 'silk' },
    { value: notes.value.length, label: t('bean.stats.notes'), accent: 'terracotta' },
  ];
  if (ageValue.value !== null) {
    rows.unshift({ value: ageValue.value, label: t('bean.stats.age'), accent: 'secondary' });
  }
  return rows;
});

function go(tab: string): void {
  router.push(`/pod/${props.member.id}/${tab}`);
}

const viewAllLabel = computed(() => t('bean.overview.viewAll'));
</script>

<template>
  <div class="space-y-6">
    <StatStrip :stats="stats" />

    <div class="grid gap-4 md:grid-cols-2">
      <!-- About -->
      <OverviewModule :title="t('bean.overview.about')" emoji="🫘" :count="null">
        <p class="text-secondary-500/70 text-sm dark:text-gray-400">
          {{ t('bean.overview.comingSoon') }}
        </p>
      </OverviewModule>

      <!-- Favorites -->
      <OverviewModule
        :title="t('bean.tab.favorites')"
        emoji="💝"
        :count="favorites.length"
        :view-all-label="favorites.length ? viewAllLabel : ''"
        @view-all="go('favorites')"
      >
        <ul v-if="favorites.length" class="space-y-1">
          <li
            v-for="f in favorites.slice(0, 3)"
            :key="f.id"
            class="font-outfit text-secondary-500/80 text-sm dark:text-gray-300"
          >
            · {{ f.name }}
          </li>
        </ul>
        <EmptyState v-else emoji="💝" :message="t('bean.overview.favorites.empty')" />
      </OverviewModule>

      <!-- Sayings -->
      <OverviewModule
        :title="t('bean.tab.sayings')"
        emoji="💬"
        :count="sayings.length"
        :view-all-label="sayings.length ? viewAllLabel : ''"
        @view-all="go('sayings')"
      >
        <div v-if="sayings.length" class="space-y-2">
          <StickyNote
            v-for="(s, i) in sayings.slice(0, 2)"
            :key="s.id"
            :text="s.words"
            :index="i"
            size="sm"
          />
        </div>
        <EmptyState v-else emoji="💬" :message="t('bean.overview.sayings.empty')" />
      </OverviewModule>

      <!-- Allergies (P3) -->
      <OverviewModule :title="t('bean.tab.allergies')" emoji="⚠️" :count="0">
        <EmptyState emoji="⚠️" :message="t('bean.overview.allergies.empty')" />
      </OverviewModule>

      <!-- Medications (P3) -->
      <OverviewModule :title="t('bean.tab.medications')" emoji="💊" :count="0">
        <EmptyState emoji="💊" :message="t('bean.overview.medications.empty')" />
      </OverviewModule>

      <!-- Notes -->
      <OverviewModule
        :title="t('bean.tab.notes')"
        emoji="📝"
        :count="notes.length"
        :view-all-label="notes.length ? viewAllLabel : ''"
        @view-all="go('notes')"
      >
        <ul v-if="notes.length" class="space-y-1">
          <li
            v-for="n in notes.slice(0, 3)"
            :key="n.id"
            class="font-outfit text-secondary-500/80 text-sm dark:text-gray-300"
          >
            · {{ n.title }}
          </li>
        </ul>
        <EmptyState v-else emoji="📝" :message="t('bean.overview.notes.empty')" />
      </OverviewModule>
    </div>
  </div>
</template>
