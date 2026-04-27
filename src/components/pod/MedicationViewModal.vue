<script setup lang="ts">
/**
 * Read-mostly drawer view for a medication. Follows the site's
 * convention (right-side drawer via BeanieFormModal `variant="drawer"`,
 * same pattern as TodoViewEditModal, MedicationFormModal, etc.).
 *
 * Footer matches the site convention: `[✏️ Edit] [Close]`, mirroring
 * `ActivityViewEditModal`. The drawer's native save slot is "Close",
 * Edit lives in `#footer-start`. The primary action — "Give a dose" —
 * is elevated to a hero CTA inside the modal body (after the title
 * block, before the recent-doses list) so it owns the visual moment
 * and remains thumb-reachable on long, scrolling logs.
 *
 * Edit is delegated to the existing `MedicationFormModal` via `@edit`
 * so we never re-implement form logic.
 *
 * Reactive auto-close: if `medication` becomes `null` while the drawer
 * is open (e.g. the record was deleted on another device and merged
 * via CRDT), we close + surface an info toast.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import MedicationLogRow from '@/components/pod/MedicationLogRow.vue';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { useGiveDose } from '@/composables/useGiveDose';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import { getMemberRoleLabel } from '@/composables/useMemberInfo';
import { formatLogEntryTime } from '@/utils/date';
import type { AvatarVariant } from '@/constants/avatars';
import type { Medication } from '@/types/models';

const props = defineProps<{
  open: boolean;
  medication: Medication | null;
}>();

const emit = defineEmits<{
  close: [];
  edit: [medication: Medication];
}>();

const { t } = useTranslation();
const medicationsStore = useMedicationsStore();
const familyStore = useFamilyStore();
const { giveDose } = useGiveDose();
const { pulse } = useAttentionPulse();

// Member resolution (the bean this medication is FOR)
const member = computed(() =>
  props.medication
    ? familyStore.members.find((m) => m.id === props.medication!.memberId)
    : undefined
);
const memberVariant = computed<AvatarVariant>(
  () => (member.value?.avatar as AvatarVariant | undefined) ?? 'adult-other'
);
const memberColor = computed(() => member.value?.color ?? '#AED6F1');
const memberName = computed(() => member.value?.name ?? t('medicationLog.someone'));
const roleLabel = computed(() => (member.value ? getMemberRoleLabel(member.value, t) : ''));
const { url: memberAvatarUrl } = useAvatarPhotoUrl(() => member.value?.avatarPhotoId);

// Medication photo
const medicationPhotoId = computed(() => props.medication?.photoIds?.[0]);
const { url: medicationPhotoUrl } = useAvatarPhotoUrl(medicationPhotoId);

// Log list
const logs = computed(() =>
  props.medication ? medicationsStore.logsForMedication(props.medication.id).value : []
);
const logCount = computed(() => logs.value.length);
const lastDose = computed(() =>
  props.medication ? medicationsStore.lastDoseAt(props.medication.id) : null
);
const dosesTodayCount = computed(() =>
  props.medication ? medicationsStore.dosesToday(props.medication.id) : 0
);

// Visible window: show 5 by default, expand to all
const INITIAL_VISIBLE = 5;
const showAll = ref(false);
const visibleLogs = computed(() =>
  showAll.value ? logs.value : logs.value.slice(0, INITIAL_VISIBLE)
);
const hasMoreLogs = computed(() => logs.value.length > INITIAL_VISIBLE);

// Reset expanded state when the medication changes
watch(
  () => props.medication?.id,
  () => {
    showAll.value = false;
  }
);

// Auto-close if the medication is deleted while the drawer is open
watch(
  () => props.medication,
  (next, prev) => {
    if (props.open && prev && !next) {
      showToast('info', t('medicationLog.medDeleted'));
      emit('close');
    }
  }
);

const photoLightboxOpen = ref(false);

// Log list ref for pulse targeting
const logListEl = ref<HTMLElement | null>(null);

async function handleGiveDose(): Promise<void> {
  if (!props.medication) return;
  const logId = await giveDose(props.medication);
  if (!logId) return;
  await nextTick();
  const row = logListEl.value?.querySelector(`[data-log-id="${logId}"]`);
  if (row instanceof HTMLElement) pulse(row);
}

async function handleDeleteLog(id: string): Promise<void> {
  const confirmed = await confirm({
    variant: 'danger',
    title: 'medicationLog.deleteConfirm.title',
    message: 'medicationLog.deleteConfirm.body',
  });
  if (!confirmed) return;
  await medicationsStore.deleteMedicationLog(id);
}

function handleEdit(): void {
  if (!props.medication) return;
  emit('edit', props.medication);
}

// Meta-line pieces
const scheduleMeta = computed(() => {
  const m = props.medication;
  if (!m) return '';
  if (m.ongoing) return '';
  const parts: string[] = [];
  if (m.startDate) parts.push(`started ${m.startDate}`);
  if (m.endDate) parts.push(`ends ${m.endDate}`);
  return parts.join(' · ');
});
</script>

<template>
  <BeanieFormModal
    :open="open && !!medication"
    variant="drawer"
    size="narrow"
    :title="medication?.name ?? ''"
    icon="💊"
    :save-label="t('action.close')"
    @close="emit('close')"
    @save="emit('close')"
  >
    <template v-if="medication">
      <!-- Photo hero — extends edge-to-edge by escaping BeanieFormModal's
           px-6 py-5 body padding. Tap opens PhotoViewer lightbox when a
           photo exists. -->
      <div class="-mx-6 -mt-5">
        <button
          v-if="medicationPhotoUrl"
          type="button"
          class="relative block h-40 w-full overflow-hidden bg-slate-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#AED6F1] dark:bg-slate-900"
          :aria-label="t('photos.viewer.open')"
          @click="photoLightboxOpen = true"
        >
          <img
            :src="medicationPhotoUrl"
            :alt="medication.name"
            class="h-full w-full object-cover"
          />
        </button>
        <div
          v-else
          class="relative flex h-32 w-full items-center justify-center overflow-hidden"
          style="
            background: linear-gradient(
              135deg,
              rgb(174 214 241 / 35%) 0%,
              rgb(248 249 250 / 100%) 55%,
              rgb(230 126 34 / 14%) 100%
            );
          "
          aria-hidden="true"
        >
          <span
            class="absolute inset-0"
            style="
              background-image: repeating-linear-gradient(
                -45deg,
                transparent 0,
                transparent 10px,
                rgb(44 62 80 / 4%) 10px,
                rgb(44 62 80 / 4%) 11px
              );
            "
          />
          <span class="font-outfit text-5xl">💊</span>
        </div>
      </div>

      <!-- Identity ribbon: pure "For whom" caption — no controls. Edit
           moved to the footer per site convention; primary action is
           the hero "Give a dose" button below the title block. -->
      <div
        class="-mx-6 flex items-center gap-3 bg-[var(--tint-slate-5)] px-6 py-3 dark:bg-slate-800/60"
      >
        <BeanieAvatar
          :variant="memberVariant"
          :color="memberColor"
          :photo-url="memberAvatarUrl"
          size="sm"
          :aria-label="memberName"
        />
        <div class="min-w-0 flex-1">
          <p
            class="font-outfit text-[10px] font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase"
          >
            For
          </p>
          <p class="font-outfit truncate text-sm font-semibold text-[#2C3E50] dark:text-gray-100">
            {{ memberName
            }}<span v-if="roleLabel" class="text-[#2C3E50]/50"> · {{ roleLabel }}</span>
          </p>
        </div>
      </div>

      <!-- Title block -->
      <div class="space-y-1.5">
        <h2 class="font-outfit text-2xl leading-tight font-bold text-[#2C3E50] dark:text-gray-100">
          {{ medication.name }}
        </h2>
        <p class="font-outfit text-sm text-[#2C3E50]/70 dark:text-gray-300">
          <span class="font-semibold text-[#F15D22]">{{ medication.dose }}</span>
          <span class="mx-1.5 text-[#2C3E50]/30" aria-hidden="true">·</span>
          <span>{{ medication.frequency }}</span>
        </p>
        <p
          v-if="scheduleMeta"
          class="font-outfit text-xs font-semibold tracking-[0.08em] text-[#2C3E50]/50 uppercase"
        >
          {{ scheduleMeta }}
        </p>
        <p
          v-if="medication.notes"
          class="font-inter mt-2 text-sm text-[#2C3E50]/75 italic dark:text-gray-300"
        >
          "{{ medication.notes }}"
        </p>
        <!-- Last-dose caption — contextual summary directly above the
             hero CTA so the user sees how recent the last dose was
             before tapping "Give a dose". -->
        <p class="font-inter pt-1 text-xs text-[#2C3E50]/55 dark:text-gray-400">
          <template v-if="lastDose">
            {{ t('medicationLog.lastDosePrefix') }} {{ formatLogEntryTime(lastDose) }}
            <span v-if="dosesTodayCount >= 1">
              · {{ dosesTodayCount }} {{ t('medicationLog.dosesTodaySuffix') }}
            </span>
          </template>
          <template v-else>
            {{ t('medicationLog.lastDoseNever') }}
          </template>
        </p>
      </div>

      <!-- Hero CTA — primary action of this surface, elevated from the
           footer to a generous in-body button so it owns the visual
           moment between context (title + last-dose) and history (log
           list). One-shot sheen on open as a soft attention nudge,
           gated on prefers-reduced-motion. -->
      <button
        type="button"
        class="give-dose-hero group font-outfit relative w-full overflow-hidden rounded-2xl px-5 py-4 text-base font-bold text-white shadow-md transition-all hover:shadow-lg focus-visible:ring-2 focus-visible:ring-[#F15D22] focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
        @click="handleGiveDose"
      >
        <span class="relative z-10 flex items-center justify-center gap-2.5">
          <span class="text-xl leading-none" aria-hidden="true">💊</span>
          <span>{{ t('medicationLog.giveDose') }}</span>
          <span
            class="ml-0.5 transition-transform duration-200 group-hover:translate-x-0.5 group-active:translate-x-1"
            aria-hidden="true"
            >→</span
          >
        </span>
      </button>

      <!-- Recent doses -->
      <div>
        <h3
          class="font-outfit mb-2 text-xs font-semibold tracking-[0.14em] text-[#2C3E50]/55 uppercase dark:text-gray-400"
        >
          {{ t('medicationLog.recentHeader') }}
        </h3>
        <div
          v-if="logCount === 0"
          class="rounded-2xl bg-[var(--tint-slate-5)] px-3 py-4 text-center dark:bg-slate-800/60"
        >
          <p class="font-inter text-sm text-[#2C3E50]/60 italic dark:text-gray-400">
            {{ t('medicationLog.empty') }}
          </p>
        </div>
        <div v-else ref="logListEl" class="space-y-2">
          <MedicationLogRow
            v-for="entry in visibleLogs"
            :key="entry.id"
            :entry="entry"
            @delete="handleDeleteLog"
          />
          <button
            v-if="hasMoreLogs"
            type="button"
            class="font-outfit w-full rounded-xl py-2 text-xs font-semibold text-[#F15D22] underline-offset-2 transition-colors hover:underline focus:underline focus:outline-none"
            @click="showAll = !showAll"
          >
            {{ showAll ? t('medicationLog.showLess') : t('medicationLog.viewAll') }}
          </button>
        </div>
      </div>
    </template>

    <!-- Footer-start: Edit button. Matches the site convention used by
         ActivityViewEditModal and TodoViewEditModal — the modal's
         native save slot is "Close", footer-start holds the secondary
         action (here, Edit). -->
    <template #footer-start>
      <button
        type="button"
        class="font-outfit flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-300 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
        @click="handleEdit"
      >
        ✏️ {{ t('action.edit') }}
      </button>
    </template>
  </BeanieFormModal>

  <!-- Photo lightbox — separate z-layer; modal (z-50) sits above drawer (z-40) -->
  <PhotoViewer
    v-if="medication?.photoIds?.length"
    :open="photoLightboxOpen"
    :photo-ids="medication.photoIds"
    read-only
    @close="photoLightboxOpen = false"
  />
</template>

<style scoped>
/* Hero "Give a dose" CTA — Heritage Orange → Terracotta gradient with a
 * one-time sheen sweep on open as a soft attention nudge. Scoped to
 * this modal; the gradient + sheen are specific to the dose-log primary
 * action and shouldn't bleed into other CTAs. */
.give-dose-hero {
  background: linear-gradient(135deg, #f15d22 0%, #e67e22 100%);
}

.give-dose-hero::before {
  animation: give-dose-sheen 1.4s ease-out 0.3s 1 forwards;
  background: linear-gradient(115deg, transparent 30%, rgb(255 255 255 / 22%) 50%, transparent 70%);
  content: '';
  inset: 0;
  position: absolute;
  transform: translateX(-100%);
}

@keyframes give-dose-sheen {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .give-dose-hero::before {
    animation: none;
  }
}
</style>
