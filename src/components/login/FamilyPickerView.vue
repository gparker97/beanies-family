<script setup lang="ts">
import { ref, onMounted } from 'vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useAuthStore } from '@/stores/authStore';
import { getProviderConfig } from '@/services/sync/fileHandleStore';
import { confirm as showConfirm } from '@/composables/useConfirm';
import type { PersistedProviderConfig } from '@/services/sync/fileHandleStore';

const { t } = useTranslation();
const familyContextStore = useFamilyContextStore();
const authStore = useAuthStore();

const emit = defineEmits<{
  back: [];
  'family-selected': [
    payload: {
      id: string;
      name: string;
      hasPasskeys: boolean;
      providerConfig: PersistedProviderConfig | null;
    },
  ];
  'load-different-file': [];
}>();

interface FamilyEntry {
  id: string;
  name: string;
  hasPasskeys: boolean;
  providerConfig: PersistedProviderConfig | null;
}

const families = ref<FamilyEntry[]>([]);
const isLoading = ref(true);

onMounted(async () => {
  await loadFamilies();
  isLoading.value = false;
});

async function loadFamilies() {
  const allFamilies = familyContextStore.allFamilies;
  const entries: FamilyEntry[] = [];

  for (const family of allFamilies) {
    const [hasPasskeys, providerConfig] = await Promise.all([
      authStore.checkHasRegisteredPasskeys(family.id),
      getProviderConfig(family.id),
    ]);
    entries.push({
      id: family.id,
      name: family.name ?? 'My Family',
      hasPasskeys,
      providerConfig,
    });
  }

  families.value = entries;
}

function getProviderLabel(config: PersistedProviderConfig | null): string {
  if (!config) return t('familyPicker.providerLocal');
  if (config.type === 'google_drive') return t('familyPicker.providerDrive');
  return t('familyPicker.providerLocal');
}

function getProviderFileName(config: PersistedProviderConfig | null): string | null {
  if (!config) return null;
  if (config.type === 'google_drive') return config.driveFileName ?? null;
  return null;
}

function selectFamily(family: FamilyEntry) {
  emit('family-selected', {
    id: family.id,
    name: family.name,
    hasPasskeys: family.hasPasskeys,
    providerConfig: family.providerConfig,
  });
}

async function deleteFamily(family: FamilyEntry) {
  const confirmed = await showConfirm({
    title: 'confirm.deleteLocalFamilyTitle',
    message: 'confirm.deleteLocalFamily',
  });
  if (!confirmed) return;

  await familyContextStore.deleteLocalFamily(family.id);
  families.value = families.value.filter((f) => f.id !== family.id);
}
</script>

<template>
  <div class="mx-auto max-w-[540px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="$emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header with mascot -->
    <div class="mb-6 text-center">
      <img
        src="/brand/beanies_family_icon_transparent_384x384.png"
        alt=""
        class="mx-auto mb-3 h-20 w-20"
      />
      <h2 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
        {{ t('familyPicker.title') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('familyPicker.subtitle') }}
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="py-8 text-center">
      <div
        class="border-t-primary-500 mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-300"
      ></div>
    </div>

    <!-- Family list -->
    <template v-else>
      <!-- Empty state -->
      <div v-if="families.length === 0" class="py-8 text-center">
        <div
          class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-700"
        >
          <svg
            class="h-7 w-7 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('familyPicker.noFamilies') }}
        </p>
        <button
          class="bg-primary-500 inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
          @click="$emit('load-different-file')"
        >
          {{ t('familyPicker.loadFile') }}
        </button>
      </div>

      <!-- Family cards -->
      <div v-else class="space-y-3">
        <div v-for="family in families" :key="family.id" class="flex items-center gap-2">
          <button
            class="hover:border-primary-500/40 dark:hover:border-primary-500/30 flex flex-1 items-center gap-3 rounded-2xl border-2 border-gray-200 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-600"
            @click="selectFamily(family)"
          >
            <div
              class="bg-primary-500/10 text-primary-500 flex h-10 w-10 items-center justify-center rounded-xl"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <span class="font-outfit block font-semibold text-gray-900 dark:text-gray-100">
                {{ family.name }}
              </span>
              <!-- Provider pill -->
              <CloudProviderBadge
                class="mt-1"
                :provider-type="family.providerConfig?.type ?? 'local'"
                :file-name="
                  getProviderFileName(family.providerConfig) ??
                  getProviderLabel(family.providerConfig)
                "
                :account-email="family.providerConfig?.driveAccountEmail"
                size="sm"
              />
            </div>
          </button>
          <button
            :title="t('action.delete')"
            class="shrink-0 rounded-xl p-2.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            @click.stop="deleteFamily(family)"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>

        <!-- Load different file link -->
        <button
          class="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          @click="$emit('load-different-file')"
        >
          {{ t('familyPicker.loadDifferent') }}
        </button>
      </div>
    </template>
  </div>
</template>
