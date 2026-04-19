<script setup lang="ts">
/**
 * BeanDetailPage — single-member hub under /pod/:memberId/:tab.
 *
 * Shell only: BeanHero on top, BeanTabs strip, then the active tab's
 * content. Tab components import their own stores (page-composition
 * rule from the plan — no god-page importing five stores). The route
 * param `:tab` is the source of truth for which tab is active;
 * changing tabs pushes a new URL so back/forward + deep links work.
 *
 * `/pod/:memberId` (no tab) redirects to `:memberId/overview` at the
 * router level. Missing member id → friendly not-found + back link.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanHero from '@/components/pod/BeanHero.vue';
import BeanTabs, { type BeanTabId } from '@/components/pod/BeanTabs.vue';
import BeanOverviewTab from '@/components/pod/BeanOverviewTab.vue';
import BeanFavoritesTab from '@/components/pod/BeanFavoritesTab.vue';
import BeanSayingsTab from '@/components/pod/BeanSayingsTab.vue';
import BeanNotesTab from '@/components/pod/BeanNotesTab.vue';
import BeanTabPlaceholder from '@/components/pod/BeanTabPlaceholder.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useTranslation } from '@/composables/useTranslation';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

const familyStore = useFamilyStore();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();

const memberId = computed(() => (route.params.memberId as string) ?? '');
const activeTab = computed<BeanTabId>(() => (route.params.tab as BeanTabId) ?? 'overview');

const member = computed(() => familyStore.members.find((m) => m.id === memberId.value));

const counts = computed(() => ({
  favorites: favoritesStore.byMember(memberId.value).value.length,
  sayings: sayingsStore.byMember(memberId.value).value.length,
  notes: memberNotesStore.byMember(memberId.value).value.length,
  allergies: 0,
  medications: 0,
}));

function selectTab(tab: BeanTabId): void {
  if (tab === activeTab.value) return;
  router.push(`/pod/${memberId.value}/${tab}`);
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <template v-if="member">
      <BeanHero :member="member" />
      <BeanTabs :active="activeTab" :counts="counts" @select="selectTab" />

      <BeanOverviewTab v-if="activeTab === 'overview'" :member="member" />
      <BeanFavoritesTab v-else-if="activeTab === 'favorites'" :member-id="member.id" />
      <BeanSayingsTab v-else-if="activeTab === 'sayings'" :member-id="member.id" />
      <BeanNotesTab v-else-if="activeTab === 'notes'" :member-id="member.id" />
      <BeanTabPlaceholder
        v-else-if="activeTab === 'allergies'"
        emoji="\u26A0\uFE0F"
        :message="t('bean.overview.allergies.empty')"
      />
      <BeanTabPlaceholder
        v-else-if="activeTab === 'medications'"
        emoji="\u{1F48A}"
        :message="t('bean.overview.medications.empty')"
      />
    </template>
    <div
      v-else
      class="flex flex-col items-center justify-center gap-3 rounded-[var(--sq)] bg-white/60 py-16 text-center dark:bg-slate-800/60"
    >
      <span class="text-5xl" aria-hidden="true">🫘</span>
      <h1 class="font-outfit text-secondary-500 text-xl font-bold dark:text-gray-100">
        {{ t('bean.notFound.title') }}
      </h1>
      <p class="text-secondary-500/60 text-sm">{{ t('bean.notFound.body') }}</p>
      <button
        type="button"
        class="font-outfit text-primary-500 text-sm font-semibold hover:underline"
        @click="router.push('/pod')"
      >
        {{ t('bean.backToPod') }}
      </button>
    </div>
  </main>
</template>
