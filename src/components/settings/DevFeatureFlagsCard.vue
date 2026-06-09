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
import { listFlags } from '@/config/flags';
import { setProdFlag } from '@/services/featureFlags/devFlagWriter';
import { useToast } from '@/composables/useToast';
import type { DevFlag } from '@/config/flagRegistry';

const { showToast } = useToast();

// Local, mutable copy of committed (prod) state for optimistic UI.
const rows = ref(listFlags());
const showReload = ref(false);

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
  <section>
    <h2
      class="font-outfit mb-4 text-[0.75rem] font-bold tracking-[0.1em] text-[var(--deep-slate)]/35 uppercase dark:text-slate-500"
    >
      🚩 Feature Flags · dev only
    </h2>
    <div
      class="rounded-[var(--sq)] bg-white px-6 py-2 shadow-[0_2px_12px_rgba(44,62,80,0.04)] dark:bg-slate-800"
    >
      <p class="py-3 text-xs leading-snug text-[var(--deep-slate)]/60 dark:text-slate-400">
        These toggles control <strong>production</strong> availability. Toggling rewrites the
        committed config (<code>featureFlags.committed.ts</code>) — commit + deploy to apply for all
        users. In development every flag is always on regardless of these switches. Changes apply
        after reload.
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
        <p class="text-xs text-[var(--deep-slate)]/60 dark:text-slate-400">
          Saved. Reload to apply the change in this session.
        </p>
        <BaseButton variant="primary" size="sm" @click="reload">Reload to apply</BaseButton>
      </div>
    </div>
  </section>
</template>
