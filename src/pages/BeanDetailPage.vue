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
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanHero from '@/components/pod/BeanHero.vue';
import BeanTabs, { type BeanTabId } from '@/components/pod/BeanTabs.vue';
import BeanOverviewTab from '@/components/pod/BeanOverviewTab.vue';
import BeanFavoritesTab from '@/components/pod/BeanFavoritesTab.vue';
import BeanSayingsTab from '@/components/pod/BeanSayingsTab.vue';
import BeanNotesTab from '@/components/pod/BeanNotesTab.vue';
import BeanAllergiesTab from '@/components/pod/BeanAllergiesTab.vue';
import BeanMedicationsTab from '@/components/pod/BeanMedicationsTab.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { usePermissions } from '@/composables/usePermissions';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import type { CreateFamilyMemberInput, UpdateFamilyMemberInput } from '@/types/models';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();

const familyStore = useFamilyStore();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();
const { canManagePod } = usePermissions();

const memberId = computed(() => (route.params.memberId as string) ?? '');
const activeTab = computed<BeanTabId>(() => (route.params.tab as BeanTabId) ?? 'overview');

const member = computed(() => familyStore.members.find((m) => m.id === memberId.value));

const showEditModal = ref(false);

async function handleSave(
  data: CreateFamilyMemberInput | { id: string; data: UpdateFamilyMemberInput }
): Promise<void> {
  // BeanDetailPage only ever opens the edit flow — create never fires from
  // here, but the modal's save signature is a union. Narrow to the update
  // shape and ignore the (unreachable) create branch.
  if ('id' in data) {
    await familyStore.updateMember(data.id, data.data);
    showEditModal.value = false;
  }
}

async function handleDelete(id: string): Promise<void> {
  showEditModal.value = false;
  const target = familyStore.members.find((m) => m.id === id);
  if (target?.role === 'owner') {
    await showAlert({
      title: 'confirm.cannotDeleteOwnerTitle',
      message: 'family.cannotDeleteOwner',
    });
    return;
  }
  if (await showConfirm({ title: 'confirm.deleteMemberTitle', message: 'family.deleteConfirm' })) {
    await familyStore.deleteMember(id);
    // Member is gone — bounce back to the Pod grid rather than sitting on
    // a detail page with a "missing bean" empty state.
    await router.push('/pod');
  }
}

const counts = computed(() => ({
  favorites: favoritesStore.byMember(memberId.value).value.length,
  sayings: sayingsStore.byMember(memberId.value).value.length,
  notes: memberNotesStore.byMember(memberId.value).value.length,
  allergies: allergiesStore.byMember(memberId.value).value.length,
  medications: medicationsStore.byMember(memberId.value).value.length,
}));

function selectTab(tab: BeanTabId): void {
  if (tab === activeTab.value) return;
  router.push(`/pod/${memberId.value}/${tab}`);
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <template v-if="member">
      <BeanHero :member="member" :can-manage="canManagePod" @edit="showEditModal = true" />
      <BeanTabs :active="activeTab" :counts="counts" @select="selectTab" />

      <BeanOverviewTab v-if="activeTab === 'overview'" :member="member" />
      <BeanFavoritesTab v-else-if="activeTab === 'favorites'" :member-id="member.id" />
      <BeanSayingsTab v-else-if="activeTab === 'sayings'" :member-id="member.id" />
      <BeanAllergiesTab v-else-if="activeTab === 'allergies'" :member-id="member.id" />
      <BeanMedicationsTab v-else-if="activeTab === 'medications'" :member-id="member.id" />
      <BeanNotesTab v-else-if="activeTab === 'notes'" :member-id="member.id" />

      <FamilyMemberModal
        :open="showEditModal"
        :member="member"
        @close="showEditModal = false"
        @save="handleSave"
        @delete="handleDelete"
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
