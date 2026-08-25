<script setup lang="ts">
import { safeExternalHref, safeHttpsUrl } from '@/utils/url';
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fetchLinkPreview, extractDomain, type LinkPreview } from '@/utils/linkPreview';
import type { VacationIdea, VacationIdeaCategory, CurrencyCode } from '@/types/models';

interface Props {
  open: boolean;
  idea?: VacationIdea;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  save: [idea: VacationIdea];
  delete: [];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

const title = ref('');
const description = ref('');
const category = ref<VacationIdeaCategory | undefined>(undefined);
const location = ref('');
const suggestedDate = ref('');
const costType = ref<'free' | 'paid' | undefined>(undefined);
const estimatedCost = ref<number | undefined>(0);
const estimatedCostCurrency = ref<CurrencyCode>('USD');
const duration = ref<string>('');
const needsBooking = ref<boolean | undefined>(undefined);
const isPlanned = ref(false);
const isSkipped = ref(false);

function togglePlanned() {
  isPlanned.value = !isPlanned.value;
  if (isPlanned.value) isSkipped.value = false;
}

function toggleSkipped() {
  isSkipped.value = !isSkipped.value;
  if (isSkipped.value) isPlanned.value = false;
}
const link = ref('');
const linkPreview = ref<LinkPreview | null>(null);
const linkPreviewLoading = ref(false);
const notes = ref('');

const { isEditing } = useFormModal(
  () => props.idea,
  () => props.open,
  {
    onEdit(idea) {
      title.value = idea.title ?? '';
      description.value = idea.description ?? '';
      category.value = idea.category;
      location.value = idea.location ?? '';
      suggestedDate.value = idea.suggestedDate ?? '';
      costType.value = idea.costType;
      estimatedCost.value = idea.estimatedCost ?? 0;
      estimatedCostCurrency.value =
        idea.estimatedCostCurrency ?? (settingsStore.displayCurrency as CurrencyCode);
      duration.value = idea.duration ?? '';
      needsBooking.value = idea.needsBooking;
      isPlanned.value = idea.isPlanned ?? false;
      isSkipped.value = idea.isSkipped ?? false;
      link.value = idea.link ?? '';
      linkPreview.value = idea.linkPreview ?? null;
      notes.value = idea.notes ?? '';
      // Baseline for the dirty check in handleClose.
      openSnapshot.value = currentFormJson();
    },
    onNew() {
      title.value = '';
      description.value = '';
      category.value = undefined;
      location.value = '';
      suggestedDate.value = '';
      costType.value = undefined;
      estimatedCost.value = 0;
      estimatedCostCurrency.value = settingsStore.displayCurrency as CurrencyCode;
      duration.value = '';
      needsBooking.value = undefined;
      isPlanned.value = false;
      isSkipped.value = false;
      link.value = '';
      linkPreview.value = null;
      notes.value = '';
      // Baseline for the dirty check in handleClose.
      openSnapshot.value = currentFormJson();
    },
  }
);

const categories: { key: VacationIdeaCategory; emoji: string }[] = [
  { key: 'beach', emoji: '🏖️' },
  { key: 'activity', emoji: '🎭' },
  { key: 'food', emoji: '🍽️' },
  { key: 'sightseeing', emoji: '📸' },
  { key: 'shopping', emoji: '🛍️' },
  { key: 'nightlife', emoji: '🎉' },
  { key: 'other', emoji: '✨' },
];

const durations = ['30min', '1hr', '2hrs', 'half_day', 'full_day'] as const;

const voters = computed(() => {
  if (!props.idea) return [];
  return props.idea.votes
    .map((v) => familyStore.members.find((m) => m.id === v.memberId))
    .filter(Boolean);
});

// Track the last URL we fetched a preview for to avoid duplicate requests
let lastFetchedUrl = '';

// On blur: normalize the link (add https:// if missing) then fetch preview
async function handleLinkBlur() {
  const trimmed = link.value.trim();
  if (!trimmed) {
    linkPreview.value = null;
    lastFetchedUrl = '';
    return;
  }
  // Auto-format the link with https:// if missing
  link.value = normalizeLink(trimmed);

  const url = link.value;
  // Skip if we already fetched this exact URL
  if (url === lastFetchedUrl && linkPreview.value) return;

  lastFetchedUrl = url;
  linkPreviewLoading.value = true;
  linkPreview.value = await fetchLinkPreview(url);
  linkPreviewLoading.value = false;
}

/**
 * Add a scheme to a bare domain so `beanies.family` works as typed. SCREENING is a separate
 * job and belongs to `safeExternalHref`, which the three sibling drawers already use — this
 * one hand-rolled its own normalizer and then bound the result straight into an href,
 * duplicating `ensureHttpUrl` and skipping the screen the others get.
 */
function normalizeLink(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Screened before it can ever reach an href. Null when the link is not safely navigable. */
const normalizedLink = computed(() => safeExternalHref(normalizeLink(link.value)));

/**
 * The preview image, screened before it reaches `<img :src>`.
 *
 * This came back from microlink — a third party — and was bound unscreened, so a hostile or
 * simply odd preview could point the family's browser at any URL on render. Everywhere else
 * in this codebase remote images are screened or fetched-and-stored rather than hot-linked.
 */
const previewImage = computed(() => safeHttpsUrl(linkPreview.value?.image ?? ''));

/**
 * A snapshot of the form as it looked when the drawer opened, for the dirty check below.
 * Serialized because the comparison is field-by-field equality, not identity.
 */
const openSnapshot = ref('');

function currentFormJson(): string {
  return JSON.stringify([
    title.value,
    description.value,
    category.value,
    location.value,
    suggestedDate.value,
    costType.value,
    estimatedCost.value,
    estimatedCostCurrency.value,
    duration.value,
    needsBooking.value,
    isPlanned.value,
  ]);
}

/**
 * Closing must not write anything the user did not change.
 *
 * The drawer auto-saves on close — reasonable for an edit-in-place surface — but it did so
 * UNCONDITIONALLY, from the snapshot taken when it opened, behind a button labelled
 * "Close". So: device A opens an idea just to read it; device B rewrites the description,
 * sets a budget and marks it planned; that merges to A; A taps Close and the stale snapshot
 * reverts every one of B's edits. A user who deliberately chose not to save had silently
 * undone another parent's work.
 *
 * The dirty check keeps the convenience and removes the harm: an untouched form writes
 * nothing at all. `close` is emitted either way — it was declared but never emitted, so the
 * page's `@close` handler was dead, and the `!props.idea` early return (an idea deleted
 * elsewhere while open) left every dismissal path a no-op and the user trapped until reload.
 */
function handleClose() {
  if (props.idea && currentFormJson() !== openSnapshot.value) handleSave();
  emit('close');
}

function handleSave() {
  if (!props.idea) {
    emit('close');
    return;
  }
  emit('save', {
    ...props.idea,
    title: title.value,
    description: description.value || undefined,
    category: category.value,
    location: location.value || undefined,
    suggestedDate: suggestedDate.value || undefined,
    costType: costType.value,
    estimatedCost: costType.value === 'paid' ? estimatedCost.value || undefined : undefined,
    estimatedCostCurrency: costType.value === 'paid' ? estimatedCostCurrency.value : undefined,
    duration: (duration.value as VacationIdea['duration']) || undefined,
    needsBooking: needsBooking.value,
    isPlanned: isPlanned.value || undefined,
    isSkipped: isSkipped.value || undefined,
    link: normalizedLink.value || undefined,
    linkPreview: linkPreview.value ?? undefined,
    notes: notes.value || undefined,
  });
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="isEditing ? (idea?.title ?? '') : ''"
    icon="🌟"
    icon-bg="bg-[rgba(255,217,61,0.1)]"
    save-gradient="teal"
    :save-label="t('action.close')"
    :show-delete="isEditing"
    @close="handleClose"
    @save="handleSave"
    @delete="$emit('delete')"
  >
    <div class="space-y-5">
      <!-- Category pills (above title) -->
      <FormFieldGroup :label="t('vacation.ideas.category')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="cat in categories"
            :key="cat.key"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              category === cat.key
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            @click="category = cat.key"
          >
            {{ cat.emoji }} {{ t(`vacation.ideas.category.${cat.key}`) }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Title -->
      <FormFieldGroup :label="t('vacation.field.title')" required>
        <BaseInput v-model="title" />
      </FormFieldGroup>

      <!-- Description -->
      <FormFieldGroup :label="t('vacation.field.description')">
        <BaseTextarea
          v-model="description"
          :placeholder="t('vacation.ideas.descriptionPlaceholder')"
          :rows="3"
        />
      </FormFieldGroup>

      <!-- Date + Location -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.ideas.whichDay')">
          <BeanieDatePicker v-model="suggestedDate" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.location')">
          <BaseInput v-model="location" :placeholder="t('vacation.field.locationPlaceholder')" />
        </FormFieldGroup>
      </div>

      <!-- Link -->
      <FormFieldGroup :label="t('vacation.field.link')">
        <div class="flex items-center gap-2">
          <BaseInput
            v-model="link"
            type="url"
            placeholder="https://..."
            class="flex-1"
            @blur="handleLinkBlur"
          />
          <a
            v-if="normalizedLink"
            :href="normalizedLink"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(0,180,216,0.08)] text-sm transition-colors hover:bg-[rgba(0,180,216,0.15)]"
            :title="t('action.visitLink')"
          >
            🔗
          </a>
        </div>
        <!-- Link preview card -->
        <div v-if="linkPreviewLoading" class="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <span class="animate-pulse">{{ t('action.loading') }}</span>
        </div>
        <a
          v-else-if="linkPreview && normalizedLink"
          :href="normalizedLink"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-2 flex overflow-hidden rounded-xl border border-gray-200/80 bg-white transition-all hover:border-[rgba(0,180,216,0.3)] hover:shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <img
            v-if="previewImage"
            :src="previewImage"
            alt=""
            class="h-20 w-20 shrink-0 object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div class="min-w-0 flex-1 px-3 py-2">
            <div
              v-if="linkPreview.siteName"
              class="font-outfit mb-0.5 truncate text-[0.625rem] font-semibold tracking-wide text-[#00B4D8] uppercase"
            >
              {{ linkPreview.siteName }}
            </div>
            <div
              v-else-if="normalizedLink"
              class="font-outfit mb-0.5 truncate text-[0.625rem] font-semibold tracking-wide text-gray-400 uppercase"
            >
              {{ extractDomain(normalizedLink) }}
            </div>
            <div
              v-if="linkPreview.title"
              class="font-outfit truncate text-xs font-semibold text-gray-900 dark:text-gray-100"
            >
              {{ linkPreview.title }}
            </div>
            <div
              v-if="linkPreview.description"
              class="mt-0.5 line-clamp-2 text-[0.6875rem] leading-relaxed text-gray-400 dark:text-gray-500"
            >
              {{ linkPreview.description }}
            </div>
          </div>
        </a>
      </FormFieldGroup>

      <!-- Cost toggle + Duration (side by side) -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.ideas.estimatedCost')">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="ct in ['free', 'paid'] as const"
              :key="ct"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                costType === ct
                  ? ct === 'free'
                    ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                    : 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="costType = ct"
            >
              {{ ct === 'free' ? '🆓' : '💰' }} {{ t(`vacation.ideas.${ct}`) }}
            </button>
          </div>
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.ideas.duration')">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="dur in durations"
              :key="dur"
              type="button"
              class="rounded-full border px-2 py-1 text-xs font-medium transition-colors"
              :class="
                duration === dur
                  ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="duration = dur"
            >
              {{ t(`vacation.duration.${dur}`) }}
            </button>
          </div>
        </FormFieldGroup>
      </div>

      <!-- Price input (own row when paid — full width for mobile) -->
      <CurrencyAmountInput
        v-if="costType === 'paid'"
        v-model:amount="estimatedCost"
        v-model:currency="estimatedCostCurrency"
        font-size="0.95rem"
      />

      <!-- Booking needed + Planned (side by side) -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.ideas.bookingNeeded')">
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                needsBooking === false
                  ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="needsBooking = false"
            >
              ✓ {{ t('vacation.ideas.noBookingNeeded') }}
            </button>
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                needsBooking === true
                  ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="needsBooking = true"
            >
              📋 {{ t('vacation.ideas.needsBooking') }}
            </button>
          </div>
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.ideas.planned')">
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                isPlanned
                  ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="togglePlanned"
            >
              {{ isPlanned ? t('vacation.ideas.plannedPill') : t('vacation.ideas.markPlanned') }}
            </button>
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                isSkipped
                  ? 'border-gray-400 bg-gray-100 text-gray-600 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-300'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="toggleSkipped"
            >
              {{ isSkipped ? t('vacation.ideas.skippedPill') : t('vacation.ideas.markSkipped') }}
            </button>
          </div>
        </FormFieldGroup>
      </div>

      <!-- Notes -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseTextarea
          v-model="notes"
          :placeholder="t('vacation.field.notesPlaceholder')"
          :rows="3"
        />
      </FormFieldGroup>

      <!-- Who's interested (full name chips) -->
      <FormFieldGroup v-if="voters.length" :label="t('vacation.ideas.whosInterested')">
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            v-for="voter in voters"
            :key="voter!.id"
            class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-slate-5)] px-2.5 py-0.5 text-[0.6875rem] font-medium text-gray-600 dark:bg-slate-700 dark:text-gray-300"
          >
            <span
              class="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold text-white"
              :style="{ backgroundColor: voter!.color }"
            >
              {{ voter!.name.charAt(0).toUpperCase() }}
            </span>
            {{ voter!.name }}
          </span>
        </div>
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
