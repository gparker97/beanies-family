<script setup lang="ts">
/**
 * SaveStatusIndicator — a quiet, all-roles save-status row for the sidebar
 * security-indicator cluster (and the mobile hamburger drawer footer). Reads
 * the store's `saveStatus` projection and renders one of: "Saved · <time>"
 * (soft-green), "Saving…" (Sky-Silk pulse), or "Having trouble saving"
 * (Heritage Orange — never Alert Red). Tapping opens a small popover with the
 * connection + last-saved detail; a single recovery action deep-links to the
 * Family Data modal, shown ONLY to users who can manage the pod.
 *
 * Presentation-only: it owns NO telemetry (the single save-status transition
 * log lives in syncStore, which is why two mounted instances — desktop +
 * mobile — don't double-count). The popover reuses `useEscapeClose`,
 * `CloudProviderBadge`, and the shared teleport/position/click-outside idiom.
 */
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { usePermissions } from '@/composables/usePermissions';
import { useSyncStore } from '@/stores/syncStore';
import { useRouter } from 'vue-router';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { SAVE_STATUS_PRESENTATION } from '@/components/ui/saveStatusPresentation';
import { FAMILY_DATA_DEEP_LINK } from '@/constants/deepLinks';
import { formatRelativeTime } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';

const { t, currentLanguage } = useTranslation();
const { canManagePod } = usePermissions();
const syncStore = useSyncStore();
const router = useRouter();

const el = ref<HTMLElement>();
const triggerRef = ref<HTMLButtonElement>();
const popoverRef = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const show = ref(false);

const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT_ESTIMATE = 180;

const presentation = computed(() => SAVE_STATUS_PRESENTATION[syncStore.saveStatus]);
const isDrive = computed(() => syncStore.storageProviderType === 'google_drive');
const isDegraded = computed(() => presentation.value.attention);

const relativeSaved = computed(() => formatRelativeTime(syncStore.lastSync, currentLanguage.value));

// Row label: "Saved · 2 minutes ago" / "Saving…" / "Having trouble saving".
const rowLabel = computed(() => {
  const p = presentation.value;
  if (p.usesRelativeTime) {
    return fillTemplate(t(p.labelKey), { time: relativeSaved.value });
  }
  return t(p.labelKey);
});

// Popover title by state.
const popoverTitle = computed(() => {
  const s = syncStore.saveStatus;
  if (s === 'saving') return t('saveStatus.saving');
  if (s === 'degraded' || s === 'critical') return t('saveStatus.degraded');
  return t('saveStatus.titleSafe');
});

const lastSavedLabelKey = computed(() =>
  isDegraded.value ? 'saveStatus.lastGoodSave' : 'saveStatus.lastSaved'
);
const lastSavedValue = computed(() => relativeSaved.value || t('saveStatus.never'));

// Reassurance note when there's no recovery action to show.
const reassuranceKey = computed(() => {
  if (!isDegraded.value) return 'saveStatus.reassuranceOk';
  return canManagePod.value
    ? 'saveStatus.reassuranceDegradedOwner'
    : 'saveStatus.reassuranceDegradedMember';
});

// ── Open / position (shared teleport + getBoundingClientRect + drop-up +
// viewport-clamp idiom — see TodoSortMenu.vue:32 TODO(consolidation)). ──
function positionPopover() {
  if (!el.value) return;
  const rect = el.value.getBoundingClientRect();
  const height = popoverRef.value?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
  const width = popoverRef.value?.offsetWidth ?? POPOVER_WIDTH;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - rect.bottom;
  // The row sits at the very bottom of the sidebar, so it almost always drops
  // UP; the clamp keeps it on-screen regardless.
  const dropUp = spaceBelow < height + 16 && rect.top > height + 16;
  const top = dropUp ? rect.top - height - 6 : rect.bottom + 6;
  let left = rect.left;
  if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
  if (left < MARGIN) left = MARGIN;
  popoverStyle.value = {
    position: 'fixed',
    top: `${Math.max(MARGIN, top)}px`,
    left: `${left}px`,
    width: `${POPOVER_WIDTH}px`,
  };
}

function open() {
  show.value = true;
  nextTick(positionPopover);
}
function close(returnFocus = false) {
  show.value = false;
  if (returnFocus) nextTick(() => triggerRef.value?.focus());
}
function toggle() {
  if (show.value) close();
  else open();
}

function openFamilyData() {
  // Reuse the single canonical recovery surface (Family Data modal). A
  // redundant-navigation rejection (already on /settings) is swallowed — it is
  // not a real failure and must not surface an error.
  router.push(FAMILY_DATA_DEEP_LINK).catch(() => {
    /* redundant navigation — no-op */
  });
  close();
}

useEscapeClose(show, () => close(true));

function onDocClick(e: MouseEvent) {
  const target = e.target as Node;
  if (el.value?.contains(target) || popoverRef.value?.contains(target)) return;
  show.value = false;
}
function handleViewportChange() {
  if (show.value) positionPopover();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
});
</script>

<template>
  <div v-if="presentation.visible" ref="el" class="relative">
    <button
      ref="triggerRef"
      type="button"
      class="-mx-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.05]"
      :class="{ 'bg-[var(--tint-orange-15)]': isDegraded }"
      :aria-label="t('saveStatus.rowAria')"
      aria-haspopup="dialog"
      :aria-expanded="show ? 'true' : 'false'"
      @click.stop="toggle"
    >
      <span
        class="save-dot h-2 w-2 flex-shrink-0 rounded-full"
        :class="[presentation.dotClass, { 'save-dot-pulse': presentation.pulse }]"
        aria-hidden="true"
      />
      <span class="flex-1 truncate text-xs" :class="presentation.textClass">{{ rowLabel }}</span>
      <svg
        class="h-3 w-3 flex-shrink-0 text-white/30"
        :class="{ 'text-white/60': isDegraded }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-if="show"
        ref="popoverRef"
        :style="popoverStyle"
        role="dialog"
        :aria-label="popoverTitle"
        class="dark:border-line-strong dark:bg-surface-raised z-50 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-[var(--soft-shadow)]"
        @click.stop
      >
        <p class="font-outfit text-sm font-semibold text-[var(--color-text)]">{{ popoverTitle }}</p>

        <!-- Provider identity (reused badge: filename + Drive account email;
             suppresses the connection copy for local files). -->
        <div class="mt-2.5 flex items-center gap-1.5">
          <CloudProviderBadge
            :provider-type="syncStore.storageProviderType"
            :file-name="syncStore.fileName"
            :account-email="syncStore.providerAccountEmail"
            size="sm"
            variant="light"
          />
        </div>

        <div class="dark:border-line mt-2.5 space-y-1.5 border-t border-gray-100 pt-2.5">
          <!-- Connection line: Drive only (local files have no connection). -->
          <div v-if="isDrive" class="flex items-center justify-between gap-3 text-xs">
            <span class="text-[var(--color-text-muted)]">{{ t('saveStatus.connection') }}</span>
            <span
              class="font-outfit font-medium"
              :class="
                isDegraded
                  ? 'dark:text-accent-lift text-[#F15D22]'
                  : 'dark:text-success-lift text-[#1F8F5F]'
              "
            >
              {{ isDegraded ? t('saveStatus.reconnecting') : t('saveStatus.connected') }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="text-[var(--color-text-muted)]">{{ t(lastSavedLabelKey) }}</span>
            <span class="font-outfit font-medium text-[var(--color-text)]">{{
              lastSavedValue
            }}</span>
          </div>
        </div>

        <p
          class="mt-2.5 rounded-xl px-2.5 py-2 text-xs"
          :class="
            isDegraded
              ? 'dark:text-accent-lift bg-[var(--tint-orange-8)] text-[#A8461B]'
              : 'bg-[var(--tint-silk-10)] text-[var(--color-text-muted)]'
          "
        >
          {{ t(reassuranceKey) }}
        </p>

        <button
          v-if="canManagePod"
          type="button"
          class="font-outfit mt-2.5 w-full rounded-xl bg-[#F15D22] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D14D1A]"
          @click="openFamilyData"
        >
          {{ t('saveStatus.manageConnection') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.save-dot-pulse {
  animation: save-dot-breathe 1.4s ease-in-out infinite;
}

@keyframes save-dot-breathe {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-dot-pulse {
    animation: none;
  }
}
</style>
