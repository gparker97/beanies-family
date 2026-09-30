<script setup lang="ts">
// Dev-only Feature Flags card (issue #31). Lists every registered flag with its
// committed PRODUCTION state and lets a dev toggle it. Toggling rewrites the
// committed config via the dev Vite endpoint (setProdFlag) — so it ships to all
// prod users on the next deploy.
//
// This component (and its setProdFlag import) is loaded ONLY via an
// `import.meta.env.DEV` dynamic import in SettingsPage, so it is tree-shaken out
// of production. It is a dev tool never seen by users → inline literal copy, no
// i18n keys (keeps dev strings out of the prod translation payload).
import { ref } from 'vue';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import SmoothHeight from '@/components/ui/SmoothHeight.vue';
import { listFlags } from '@/config/flags';
import { setProdFlag } from '@/services/featureFlags/devFlagWriter';
import { useToast } from '@/composables/useToast';
import type { DevFlag } from '@/config/flagRegistry';

const { showToast } = useToast();

// Local, mutable copy of committed (prod) state for optimistic UI.
const rows = ref(listFlags());
const showReload = ref(false);

// Collapsed by default (greg, 2026-10-01): the list outgrew the page. Same disclosure shape
// as the Beanie Lab row above it, so Settings has one way of folding a section away.
const expanded = ref(false);

async function onToggle(flag: DevFlag, value: boolean): Promise<void> {
  const row = rows.value.find((r) => r.id === flag);
  if (!row) return;
  const previous = row.committed;
  row.committed = value; // optimistic
  try {
    await setProdFlag(flag, value);
    showReload.value = true;
  } catch (err) {
    row.committed = previous; // revert — never lie about persisted state
    showToast(
      'error',
      'Could not save flag',
      err instanceof Error ? err.message : 'Unknown error writing the committed flags file.',
      {
        surface: 'feature-flags-write',
        error: err instanceof Error ? err : undefined,
        context: { flag, enabled: value },
      }
    );
  }
}

function reload(): void {
  window.location.reload();
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
    <!-- Disclosure header: always visible, quiet when collapsed -->
    <button
      type="button"
      class="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors"
      :class="
        expanded
          ? 'dark:text-ink text-[var(--deep-slate)]'
          : 'dark:text-ink-soft text-[var(--deep-slate)]/60'
      "
      :aria-expanded="expanded"
      aria-controls="dev-flags-body"
      data-testid="dev-flags-toggle"
      @click="expanded = !expanded"
    >
      <span aria-hidden="true">🚩</span>
      <span class="font-outfit flex-1 text-sm font-semibold">Feature flags · dev only</span>
      <span class="dark:text-ink-faint text-xs text-[var(--deep-slate)]/45"
        >{{ rows.length }} flags</span
      >
      <span class="chev text-xs opacity-60" :class="{ 'chev-open': expanded }">&#x25BC;</span>
    </button>

    <!-- Collapsible body -->
    <SmoothHeight :revision="expanded">
      <div v-show="expanded" id="dev-flags-body" class="px-6 pb-2">
        <p class="dark:text-ink-soft py-3 text-xs leading-snug text-[var(--deep-slate)]/60">
          These toggles control <strong>production</strong> availability. Toggling rewrites the
          committed config (<code>featureFlags.committed.ts</code>): commit + deploy to apply for
          all users. In development every flag is always on regardless of these switches. Changes
          apply after reload.
        </p>
        <SettingToggleRow
          v-for="(row, i) in rows"
          :key="row.id"
          :model-value="row.committed"
          :title="row.label"
          :hint="row.description"
          :divider="i < rows.length - 1 || showReload"
          :testid="`flag-${row.id}`"
          @update:model-value="(v: boolean) => onToggle(row.id, v)"
        />
        <div v-if="showReload" class="flex items-center justify-between py-3.5">
          <p class="dark:text-ink-soft text-xs text-[var(--deep-slate)]/60">
            Saved. Reload to apply the change in this session.
          </p>
          <BaseButton variant="primary" size="sm" @click="reload">Reload to apply</BaseButton>
        </div>
      </div>
    </SmoothHeight>
  </section>
</template>

<style scoped>
.chev {
  transition: transform 0.28s ease;
}

.chev-open {
  transform: rotate(180deg);
}
</style>
