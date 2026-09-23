<script setup lang="ts">
/**
 * The shared shell for the small centred auth prompts (2026-09-23): the trust question,
 * the recovery-kit nag, and the sign-out kit guard. Logo, title, body, an optional error
 * line, a column of actions (the default slot) and an optional footnote. Presentational
 * only: callers pass already-translated strings and own every action.
 *
 * `layer` defaults to 'base'. ONLY the trust question passes 'top' (it must sit above the
 * onboarding wizard, z-200). The kit nag and guard stay 'base' on purpose: the unclosable
 * `RecoveryKitDisplay` they open is itself 'base', and a 'top' intro would let that kit
 * display open invisibly behind the wizard.
 */
import BaseModal from '@/components/ui/BaseModal.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    body: string;
    error?: string | null;
    footnote?: string;
    closable?: boolean;
    layer?: 'base' | 'overlay' | 'top';
  }>(),
  { error: null, footnote: undefined, closable: false, layer: 'base' }
);

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <BaseModal :open="open" size="sm" :closable="closable" :layer="layer" @close="emit('close')">
    <div class="text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-4 h-16 w-16"
      />
      <h2 class="font-outfit dark:text-ink mb-2 text-lg font-semibold text-gray-900">
        {{ title }}
      </h2>
      <p class="dark:text-ink-soft mb-6 text-sm text-gray-600">
        {{ body }}
      </p>
      <!-- Heritage Orange: these are routine alerts (not synced yet, couldn't create), never
           a destructive confirm, so Alert Red is the wrong colour (CLAUDE.md brand rules).
           primary-700 as TEXT on white: #F15D22 itself is ~3.3:1, below AA for small text. -->
      <p v-if="error" class="dark:text-accent-lift text-primary-700 mb-3 text-sm" role="alert">
        {{ error }}
      </p>
      <div class="flex flex-col gap-3">
        <slot />
      </div>
      <p v-if="footnote" class="dark:text-ink-faint mt-4 text-xs text-gray-400">
        {{ footnote }}
      </p>
    </div>
  </BaseModal>
</template>
