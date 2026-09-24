<script setup lang="ts">
/**
 * Manage Kits (tracker #99): every recovery kit on file, live first, then invalidated.
 *
 * A pure view. It takes the rows and the permission as props and emits intents; it
 * imports no store and no permission composable, so `RecoverySettings` (which already
 * owns the kit flow and the one-time kit modal) stays the single orchestrator and this
 * component tests with props alone. Names are the one roster read, through
 * `useMemberInfo`, because a creator id means nothing to a person.
 *
 * Row markup mirrors the passkeys list in Account & Sign-In, the nearest existing
 * "per-row destructive action" surface. Red is correct on Invalidate: it is destructive
 * and irreversible, the CIG's one exception to Heritage Orange.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import SettingsAdminOnlyNotice from '@/components/settings/SettingsAdminOnlyNotice.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDate } from '@/utils/date';
import type { RecoveryKitSummary } from '@/services/auth/recoveryKit';

const props = defineProps<{
  open: boolean;
  kits: RecoveryKitSummary[];
  canManage: boolean;
  /**
   * A store action is in flight (observe → tombstone → push can take 40 s on a slow
   * link). Every action is disabled meanwhile, so a second invalidation cannot be started
   * from the same open list and race the first one to the last-kit guard.
   */
  busy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  create: [];
  invalidate: [kit: RecoveryKitSummary];
  replace: [kit: RecoveryKitSummary];
}>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();

const liveCount = computed(() => props.kits.filter((k) => k.status === 'live').length);
const newestKitId = computed(() => props.kits.find((k) => k.status === 'live')?.kitId);

function rowLabel(kit: RecoveryKitSummary): string {
  return fillTemplate(t('recovery.kitRowLabel'), { kitId: kit.kitId });
}

function memberName(id: string): string {
  return getMemberName(id, t('family.unknownMemberInline'));
}

function meta(kit: RecoveryKitSummary): string {
  if (kit.status === 'live') {
    const date = formatDate(kit.createdAt);
    return kit.createdBy
      ? fillTemplate(t('recovery.kitCreatedBy'), { date, name: memberName(kit.createdBy) })
      : fillTemplate(t('recovery.kitCreatedOn'), { date });
  }
  const date = formatDate(kit.revokedAt);
  return kit.revokedBy
    ? fillTemplate(t('recovery.kitInvalidatedBy'), { date, name: memberName(kit.revokedBy) })
    : fillTemplate(t('recovery.kitInvalidatedOn'), { date });
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="t('recovery.kitsModalTitle')"
    size="md"
    fullscreen-mobile
    @close="emit('close')"
  >
    <p class="dark:text-ink-soft mb-4 text-sm text-gray-600">
      {{ t('recovery.kitsModalIntro') }}
    </p>

    <SettingsAdminOnlyNotice v-if="!canManage" class="mb-3" />

    <p v-if="kits.length === 0" class="dark:text-accent-lift mb-4 text-sm text-[#F15D22]">
      {{ t('recovery.kitNone') }}
    </p>

    <div v-else class="mb-4 space-y-2">
      <div
        v-for="kit in kits"
        :key="kit.kitId"
        class="flex items-center gap-3 rounded-2xl border px-4 py-3"
        :class="
          kit.status === 'live'
            ? 'dark:border-line border-gray-200'
            : 'dark:bg-surface-overlay border-transparent bg-gray-50'
        "
        :data-kit-status="kit.status"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p
              class="text-sm font-medium tracking-wide"
              :class="
                kit.status === 'live'
                  ? 'dark:text-ink text-gray-900'
                  : 'dark:text-ink-faint text-gray-400 line-through'
              "
            >
              {{ rowLabel(kit) }}
            </p>
            <span
              v-if="kit.status === 'live' && kit.kitId === newestKitId"
              class="dark:text-accent-lift rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 text-xs font-medium text-[#F15D22]"
            >
              {{ t('recovery.kitNewest') }}
            </span>
            <span
              v-else-if="kit.status === 'invalidated'"
              class="dark:bg-surface-hover dark:text-ink-faint rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500"
            >
              {{ t('recovery.kitInvalidatedPill') }}
            </span>
          </div>
          <p
            class="mt-0.5 text-xs"
            :class="
              kit.status === 'live'
                ? 'dark:text-ink-soft text-gray-500'
                : 'dark:text-ink-faint text-gray-400'
            "
          >
            {{ meta(kit) }}
          </p>
        </div>

        <template v-if="canManage && kit.status === 'live'">
          <button
            v-if="liveCount > 1"
            type="button"
            :disabled="busy"
            class="dark:text-danger-lift shrink-0 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:hover:border-red-700 dark:hover:bg-red-900/20"
            @click="emit('invalidate', kit)"
          >
            {{ t('recovery.kitInvalidate') }}
          </button>
          <div v-else class="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              :disabled="busy"
              class="dark:border-line-strong dark:text-ink dark:hover:bg-surface-hover rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              @click="emit('replace', kit)"
            >
              {{ t('recovery.kitReplace') }}
            </button>
            <span class="dark:text-ink-faint max-w-40 text-right text-xs text-gray-500">
              {{ t('recovery.kitReplaceHint') }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <BaseButton variant="ghost" type="button" @click="emit('close')">
          {{ t('action.close') }}
        </BaseButton>
        <!-- A kit is a full-access key that resets every PIN, so minting one is manager-only
             (the same people who may retire one); `authStore.createRecoveryKit` refuses too. -->
        <BaseButton
          v-if="canManage"
          variant="secondary"
          type="button"
          :disabled="busy"
          @click="emit('create')"
        >
          {{ t('recovery.kitRegenerate') }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
