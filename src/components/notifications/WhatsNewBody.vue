<script setup lang="ts">
/**
 * Rich "what's new" release content — feature cards, "try it →", "also fixed",
 * signature. Extracted VERBATIM from the retired `WhatsNewModal` body (styles +
 * the `txt()` beanie/en switch included) so nothing is lost; it now renders
 * inside the notifications drawer's detail view (`NotificationDetail` resolves
 * the release from the notification's version and passes it here).
 */
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { MARKETING_URL } from '@/utils/marketing';
import { openExternal } from '@/utils/openExternal';
import type { ReleaseNote } from '@/content/release-notes';

defineProps<{ release: ReleaseNote }>();

const router = useRouter();
const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();

function handleTryIt(route: string) {
  store.close();
  router.push(route);
}

function handleSeeAll() {
  openExternal(`${MARKETING_URL}/help/whats-new`);
}
</script>

<template>
  <div>
    <!-- Version label -->
    <div
      class="font-outfit mb-5 text-xs font-semibold tracking-[0.08em] text-gray-400/45 dark:text-gray-500/50"
    >
      {{ release.month }}
    </div>

    <!-- Brief per-deploy note: just the message (no feature cards) -->
    <p
      v-if="release.summary && !release.features?.length"
      class="text-secondary-500/75 text-[0.9375rem] leading-relaxed dark:text-gray-300"
    >
      {{ txt(release.summary) }}
    </p>

    <!-- Feature entries (curated releases) -->
    <div v-for="(feature, i) in release.features ?? []" :key="i" class="wn-feature-card">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div
            class="font-outfit text-secondary-500 mb-1 text-sm font-semibold tracking-[0.02em] dark:text-gray-200"
          >
            {{ txt(feature.title) }}
          </div>
          <div class="text-secondary-500/55 text-[0.8125rem] leading-relaxed dark:text-gray-400/80">
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
    <template v-if="release.fixes?.length">
      <hr class="border-secondary-500/10 my-5 border-t border-dashed dark:border-white/6" />
      <div
        class="font-outfit mb-2.5 text-xs font-semibold tracking-[0.06em] text-gray-400/40 dark:text-gray-500/45"
      >
        {{ t('whatsNew.alsoFixed') }}
      </div>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="(fix, i) in release.fixes"
          :key="i"
          class="text-secondary-500/45 relative pl-4 text-xs dark:text-gray-400/50"
        >
          <span class="absolute left-1 text-base leading-none font-extrabold">·</span>
          {{ txt(fix.text) }}
        </li>
      </ul>
    </template>

    <!-- Signature -->
    <div class="font-outfit mt-5 text-right text-xs text-gray-400/45 italic dark:text-gray-500/35">
      {{ release.signature ?? '— greg, head beanie developer 🫘' }}
    </div>

    <!-- See all release notes -->
    <div class="mt-4 text-center">
      <button
        class="hover:text-primary-500 dark:hover:text-primary-400 text-[0.8125rem] text-gray-400/60 transition-all dark:text-gray-500/50"
        @click="handleSeeAll"
      >
        {{ t('whatsNew.seeAll') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
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
  font-size: 0.75rem;
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
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative arrow glyph paired with adjacent button text */
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
