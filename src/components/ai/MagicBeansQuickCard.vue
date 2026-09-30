<script setup lang="ts">
/**
 * The "✨ Magic beans" quick-start card at the top of an ADD drawer (the activity drawer's
 * Quick start row, the transaction drawer's statement import). One component so every add
 * drawer offers magic beans the same way; the caller decides visibility (its own reader gate)
 * and passes the line under the title.
 *
 * The door owns the sheet, the consent and the ingest; this is only its trigger. The sheet opens
 * at `layer="top"`, so it sits above the drawer this card lives in. The gradient, sheen and
 * shadow are `MagicBeansCardButton`'s (shared with the week shopping list's Find Duplicates).
 */
import MagicBeansCardButton from '@/components/ai/MagicBeansCardButton.vue';
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { ShareKind } from '@/types/magicPayload';

defineProps<{
  /** The line under "Magic beans". */
  subtitle: string;
  /** A kind to pre-pick in the sheet (the transaction drawer picks `transactions`). */
  hint?: ShareKind;
}>();

const { t } = useTranslation();
</script>

<template>
  <MagicBeansDoor :hint="hint">
    <template #trigger="{ open }">
      <MagicBeansCardButton class="p-3" @click="open">
        <span class="flex flex-col gap-1">
          <span aria-hidden="true" class="text-lg leading-none">✨</span>
          <span class="font-outfit text-sm font-extrabold">{{ t('ai.magic.perform') }}</span>
          <!-- Full white, no opacity: this line is read (CIG, no opacity on readable text). -->
          <span class="text-xs leading-snug text-white">{{ subtitle }}</span>
        </span>
      </MagicBeansCardButton>
    </template>
  </MagicBeansDoor>
</template>
