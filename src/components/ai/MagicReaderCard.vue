<script setup lang="ts">
/**
 * "beanies can do magic" — the FAB quick-add sheet card.
 *
 * ONE button since #84. It used to carry three chips (📸 invite / ✈️ travel booking /
 * 🍳 recipe), each opening a different reader, which meant the user had to declare what their
 * photo or document WAS before beanies had looked at it. That is the AI's job — and picking
 * wrong produced a bad extraction rather than a helpful error. See `MagicBeansSheet`.
 *
 * Since the doors were unified this component is ONLY the gradient card and its button: the
 * capture protocol — the sheet, the picker, consent, the busy guard, the funnel denominator —
 * all lives in `MagicBeansDoor`, which every other door mounts too. Five copies of that
 * protocol is what this refactor removed; do not reintroduce a local one here.
 *
 * The card renders inside the door's `#trigger` slot, so `canReadAny` removes the affordance
 * and its tap together rather than leaving a button whose handler does nothing.
 */
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import BetaBadge from '@/components/ui/BetaBadge.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <MagicBeansDoor>
    <template #trigger="{ open }">
      <section
        class="magic-shimmer from-primary-500 to-terracotta-400 rounded-3xl bg-gradient-to-br p-4 text-white shadow-[0_12px_26px_-10px_rgba(241,93,34,0.65)]"
      >
        <h2 class="font-outfit flex items-center gap-2 text-base font-extrabold">
          <span aria-hidden="true">✨</span>
          <span>{{ t('ai.magic.title') }}</span>
          <BetaBadge tone="onAccent" class="ml-auto" />
        </h2>
        <p class="mt-1.5 text-xs leading-snug opacity-90">{{ t('ai.magic.subtitle') }}</p>

        <!-- `relative z-[1]` lifts the CTA above the `.magic-shimmer` sheen, which is an
             absolutely-positioned ::after with no z-index of its own. -->
        <div class="relative z-[1] mt-3">
          <button
            type="button"
            class="font-outfit text-primary-600 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold whitespace-nowrap shadow-[0_3px_8px_-3px_rgba(44,62,80,0.28)] transition-transform hover:scale-[1.02]"
            @click="open"
          >
            <span aria-hidden="true">✨</span>
            <span class="truncate">{{ t('ai.magic.action') }}</span>
          </button>
        </div>
      </section>
    </template>
  </MagicBeansDoor>
</template>
