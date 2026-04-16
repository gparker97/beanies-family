<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useWhatsNew } from '@/composables/useWhatsNew';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { MARKETING_URL } from '@/utils/marketing';

const router = useRouter();
const settingsStore = useSettingsStore();
const { t } = useTranslation();
const { shouldShowModal, latestReleaseNote, dismissModal } = useWhatsNew();

function txt(val: { en: string; beanie: string }): string {
  return settingsStore.beanieMode ? val.beanie : val.en;
}

function handleDismiss() {
  dismissModal();
}

function handleTryIt(route: string) {
  dismissModal();
  router.push(route);
}

function handleSeeAll() {
  dismissModal();
  window.open(`${MARKETING_URL}/help/whats-new`, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <BaseModal
    :open="shouldShowModal"
    size="lg"
    fullscreen-mobile
    custom-header
    @close="handleDismiss"
  >
    <!-- Custom header: gradient strip + title -->
    <template #header>
      <div>
        <!-- Edge-to-edge gradient strip -->
        <div class="wn-strip" />

        <!-- Title row -->
        <div class="flex items-center justify-between px-7 pt-5 pb-0">
          <div class="flex items-center gap-2.5">
            <div
              class="justify-content flex h-9 w-9 items-center rounded-xl bg-[rgba(241,93,34,0.08)]"
            >
              <span class="mx-auto text-lg">🌱</span>
            </div>
            <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
              {{ t('whatsNew.title') }}
            </h2>
          </div>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[rgba(44,62,80,0.05)] text-gray-400 transition-all hover:bg-[rgba(44,62,80,0.1)] dark:bg-white/5 dark:text-gray-500 dark:hover:bg-white/10"
            @click="handleDismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </template>

    <!-- Body -->
    <div v-if="latestReleaseNote" class="-mx-6 -mt-6 -mb-6 px-7 py-6">
      <!-- Version label -->
      <div
        class="font-outfit mb-5 text-xs font-semibold tracking-[0.08em] text-gray-400/45 dark:text-gray-500/50"
      >
        {{ latestReleaseNote.month }}
      </div>

      <!-- Feature entries -->
      <div v-for="(feature, i) in latestReleaseNote.features" :key="i" class="wn-feature-card">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div
              class="font-outfit text-secondary-500 mb-1 text-sm font-semibold tracking-[0.02em] dark:text-gray-200"
            >
              {{ txt(feature.title) }}
            </div>
            <div class="text-secondary-500/55 text-[13px] leading-relaxed dark:text-gray-400/80">
              {{ txt(feature.description) }}
            </div>
          </div>
          <button
            v-if="feature.tryItRoute"
            class="wn-tryit"
            @click="handleTryIt(feature.tryItRoute!)"
          >
            {{ t('whatsNew.tryIt') }}
            <span class="wn-tryit-arrow">→</span>
          </button>
        </div>
      </div>

      <!-- Fixes -->
      <template v-if="latestReleaseNote.fixes?.length">
        <hr class="border-secondary-500/10 my-5 border-t border-dashed dark:border-white/6" />
        <div
          class="font-outfit mb-2.5 text-xs font-semibold tracking-[0.06em] text-gray-400/40 dark:text-gray-500/45"
        >
          {{ t('whatsNew.alsoFixed') }}
        </div>
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="(fix, i) in latestReleaseNote.fixes"
            :key="i"
            class="text-secondary-500/45 relative pl-4 text-xs dark:text-gray-400/50"
          >
            <span class="absolute left-1 text-base leading-none font-extrabold">·</span>
            {{ txt(fix.text) }}
          </li>
        </ul>
      </template>

      <!-- Signature -->
      <div
        class="font-outfit mt-5 text-right text-xs text-gray-400/45 italic dark:text-gray-500/35"
      >
        {{ latestReleaseNote.signature ?? '— greg, head beanie developer 🫘' }}
      </div>
    </div>

    <!-- Footer -->
    <template #footer>
      <div class="flex flex-col items-center gap-3">
        <button
          class="from-primary-500 to-terracotta-400 font-outfit w-full rounded-2xl bg-gradient-to-br px-6 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(241,93,34,0.25)] transition-all hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(241,93,34,0.35)]"
          @click="handleDismiss"
        >
          {{ t('whatsNew.gotItThanks') }}
        </button>
        <button
          class="hover:text-primary-500 dark:hover:text-primary-400 text-[13px] text-gray-400/60 transition-all dark:text-gray-500/50"
          @click="handleSeeAll"
        >
          {{ t('whatsNew.seeAll') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.wn-strip {
  background: linear-gradient(90deg, var(--heritage-orange, #f15d22), var(--terracotta, #e67e22));
  height: 3px;
}

.wn-feature-card {
  background: var(--cloud-white, #f8f9fa);
  border-radius: 16px;
  margin-bottom: 16px;
  padding: 14px 16px;
  transition: background 0.15s;
}

.wn-feature-card:hover {
  background: #f0f2f4;
}

.wn-feature-card:last-of-type {
  margin-bottom: 0;
}

:global(.dark) .wn-feature-card {
  background: rgb(255 255 255 / 4%);
}

:global(.dark) .wn-feature-card:hover {
  background: rgb(255 255 255 / 7%);
}

.wn-tryit {
  align-items: center;
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border: none;
  border-radius: 10px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  font-family: Outfit, sans-serif;
  font-size: 12px;
  font-weight: 600;
  gap: 5px;
  margin-top: 2px;
  padding: 6px 12px;
  transition: all 0.15s;
  white-space: nowrap;
}

.wn-tryit:hover {
  background: var(--tint-orange-15, rgb(241 93 34 / 15%));
}

.wn-tryit-arrow {
  font-size: 14px;
  transition: transform 0.15s;
}

.wn-tryit:hover .wn-tryit-arrow {
  transform: translateX(2px);
}

:global(.dark) .wn-tryit {
  background: rgb(241 93 34 / 10%);
  color: #f15d22;
}

:global(.dark) .wn-tryit:hover {
  background: rgb(241 93 34 / 18%);
}
</style>
