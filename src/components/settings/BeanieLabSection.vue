<script setup lang="ts">
/**
 * The Beanie Lab — a quiet, collapsed disclosure at the bottom of Settings that
 * lets a user opt in (per device) to in-development features. Off by default;
 * the only persistent footprint for everyone else is one muted, collapsed row.
 *
 * Reuses existing primitives — SmoothHeight (body open/close), ConditionalSection
 * (the cards reveal), SettingsCard + BetaBadge (the feature cards + "Testing" tag),
 * SettingToggleRow (the master switch). Visibility gating lives in useBeanieLab so
 * the card list here can't drift from SettingsPage's drawer / deep-link guards.
 */
import { computed, ref } from 'vue';
import SmoothHeight from '@/components/ui/SmoothHeight.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import SettingsCard from '@/components/settings/SettingsCard.vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import BetaBadge from '@/components/ui/BetaBadge.vue';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieLab } from '@/composables/useBeanieLab';
import { useSettingsStore } from '@/stores/settingsStore';

// AI (Tinfoil readers) is the sole Beanie Lab feature. Google Calendar graduated
// to an official Settings card (2026-07-03). A single card lives inline below —
// re-introduce the array pattern if a second Lab feature ever lands.
const emit = defineEmits<{ 'open-ai': [] }>();

const { t } = useTranslation();
const { prefersReducedMotion } = useReducedMotion();
const settingsStore = useSettingsStore();
const { labEnabled, aiVisible } = useBeanieLab();

const expanded = ref(false);
const animateBeaker = computed(() => expanded.value && !prefersReducedMotion.value);

async function onToggleLab(enabled: boolean): Promise<void> {
  try {
    await settingsStore.setBeanieLabEnabled(enabled);
  } catch {
    // setBeanieLabEnabled already surfaced this (toast + console.error) and
    // re-threw so the contract isn't swallowed. The toggle reads the persisted
    // value, so a failed write simply leaves it where it was — nothing to undo.
  }
}
</script>

<template>
  <section
    class="overflow-hidden rounded-[var(--sq)] border transition-colors duration-300"
    :class="
      expanded
        ? 'dark:border-line dark:bg-surface-raised border-solid border-[var(--tint-slate-10)] bg-white shadow-[0_2px_12px_rgba(44,62,80,0.04)]'
        : 'dark:border-line-strong border-dashed border-[var(--deep-slate)]/15'
    "
  >
    <!-- Disclosure header — always visible, quiet when collapsed -->
    <button
      type="button"
      class="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors"
      :class="
        expanded
          ? 'dark:text-ink text-[var(--deep-slate)]'
          : 'dark:text-ink-soft text-[var(--deep-slate)]/60'
      "
      :aria-expanded="expanded"
      aria-controls="beanie-lab-body"
      data-testid="beanie-lab-toggle"
      @click="expanded = !expanded"
    >
      <span class="lab-ico" :class="{ 'lab-ico-animate': animateBeaker }" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            class="lab-outline"
            d="M10 3.5 L10 9 L4.8 18.6 Q4.2 20.5 6.4 20.5 L17.6 20.5 Q19.8 20.5 19.2 18.6 L14 9 L14 3.5"
            stroke-width="1.4"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <path class="lab-outline" d="M9 3.5 L15 3.5" stroke-width="1.4" stroke-linecap="round" />
          <path
            class="lab-liquid"
            d="M7.2 15 L16.8 15 L17.6 18.6 Q18 20 16.6 20 L7.4 20 Q6 20 6.4 18.6 Z"
          />
          <path
            class="lab-leaf"
            d="M12 9.2 C12 7.4 13.4 6.4 14.8 6.6 C14.8 8.2 13.6 9.2 12 9.2 Z"
          />
          <circle class="lab-bubble" cx="10" cy="17" r="0.9" />
          <circle class="lab-bubble lab-bubble-2" cx="13" cy="18" r="0.7" />
          <circle class="lab-bubble lab-bubble-3" cx="12" cy="16.5" r="0.6" />
          <path class="lab-bolt" d="M19.4 3 L17.2 6.2 L18.7 6.4 L17.4 9 L20.2 5.4 L18.6 5.2 Z" />
        </svg>
      </span>
      <span class="font-outfit flex-1 text-sm font-semibold">{{
        t('settings.beanieLab.title')
      }}</span>
      <span class="chev text-xs opacity-60" :class="{ 'chev-open': expanded }">&#x25BC;</span>
    </button>

    <!-- Collapsible body -->
    <SmoothHeight :revision="expanded">
      <div v-show="expanded" id="beanie-lab-body" class="px-4 pb-4">
        <p class="dark:text-ink-faint mb-3.5 text-xs leading-relaxed text-[var(--deep-slate)]/45">
          {{ t('settings.beanieLab.blurb') }}
        </p>

        <!-- Master toggle -->
        <div class="dark:bg-surface-ground/40 rounded-[14px] bg-slate-50 px-4">
          <SettingToggleRow
            testid="beanie-lab-master"
            :title="t('settings.beanieLab.enableLabel')"
            :hint="t('settings.beanieLab.enableHint')"
            :model-value="labEnabled"
            @update:model-value="onToggleLab"
          />
        </div>

        <!-- Revealed feature card (AI — the sole Lab feature) -->
        <ConditionalSection :show="labEnabled">
          <div class="space-y-3">
            <SettingsCard
              v-if="aiVisible"
              icon="&#x1F916;"
              :title="t('settings.card.ai')"
              :description="t('settings.card.aiDesc')"
              icon-bg="var(--tint-silk-20)"
              data-testid="beanie-lab-card-ai"
              @click="emit('open-ai')"
            >
              <template #badge>
                <BetaBadge label="settings.beanieLab.testingTag" />
              </template>
            </SettingsCard>
          </div>
        </ConditionalSection>

        <!-- Empty state when the Lab is off -->
        <p
          v-if="!labEnabled"
          class="dark:text-ink-faint px-1 py-1.5 text-center text-xs text-[var(--deep-slate)]/45 italic"
        >
          {{ t('settings.beanieLab.empty') }}
        </p>
      </div>
    </SmoothHeight>
  </section>
</template>

<style scoped>
.lab-ico {
  flex: 0 0 1.5rem;
  height: 1.5rem;
  width: 1.5rem;
}

.lab-ico svg {
  display: block;
  height: 100%;
  overflow: visible;
  width: 100%;
}

.lab-outline {
  opacity: 0.75;
  stroke: currentcolor;
}

.lab-liquid {
  fill: var(--terracotta, #e67e22);
  opacity: 0.55;
  transition: opacity 0.3s ease;
}

.lab-ico-animate .lab-liquid {
  opacity: 0.85;
}

.lab-leaf {
  fill: #5ba86b;
  opacity: 0.55;
  transition: opacity 0.3s ease;
}

.lab-ico-animate .lab-leaf {
  opacity: 1;
}

.lab-bubble {
  fill: #fff;
  opacity: 0;
}

.lab-ico-animate .lab-bubble {
  animation: lab-bubble 2.2s ease-in infinite;
}

.lab-ico-animate .lab-bubble-2 {
  animation-delay: 0.75s;
}

.lab-ico-animate .lab-bubble-3 {
  animation-delay: 1.45s;
}

.lab-bolt {
  fill: var(--heritage-orange, #f15d22);
  opacity: 0;
}

.lab-ico-animate .lab-bolt {
  animation: lab-zap 3.4s steps(1, end) infinite;
  opacity: 1;
}

.chev {
  transition: transform 0.28s ease;
}

.chev-open {
  transform: rotate(180deg);
}

@keyframes lab-bubble {
  0% {
    opacity: 0;
    transform: translateY(0);
  }

  25% {
    opacity: 0.9;
  }

  100% {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@keyframes lab-zap {
  0%,
  86%,
  100% {
    opacity: 1;
  }

  88% {
    opacity: 0.15;
  }

  90% {
    opacity: 1;
  }

  92% {
    opacity: 0.3;
  }

  94% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lab-ico-animate .lab-bubble,
  .lab-ico-animate .lab-bolt {
    animation: none;
  }
}
</style>
