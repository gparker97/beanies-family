<script setup lang="ts">
/**
 * The fridge sheet's two conventional page actions, shared by the Meal Planner and Who Owns
 * What (both run on `useSheetExportRunner`): **Share** (an image to the OS share sheet) and
 * **Export as PDF**.
 *
 * Below `md` (48rem, the same line as `useBreakpoint().isMobile`) Export is hidden and
 * Share compacts to a round gradient icon: on a phone Export only ends in the same share
 * sheet (native) or a download (mobile web), and the two labelled pills wrapped the header
 * onto extra rows. CSS only, so this has no width logic of its own; the icon keeps its
 * accessible name (`aria-label`) at every width.
 *
 * While a format builds, both buttons are disabled and the building one carries `aria-busy`.
 * Share shows a white ring spinner (never an empty circle on a phone; a `<span>`, valid
 * inside a button; it pulses instead of spinning under reduced motion) and the building
 * label as its name; Export shows the building label as its text.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type { SheetExportFormat } from '@/composables/useSheetExportRunner';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

const props = withDefaults(
  defineProps<{
    /** The runner's `exportingFormat`: which format is building, null when idle. */
    exportingFormat: SheetExportFormat | null;
    /** Share's translated label (the pages word it differently). */
    shareLabel: string;
    /** Test id prefix: `${testid}-share` / `${testid}-export`. */
    testid?: string;
  }>(),
  { testid: undefined }
);
const emit = defineEmits<{ run: [format: SheetExportFormat] }>();

const { t } = useTranslation();

const disabled = computed(() => props.exportingFormat !== null);
const sharing = computed(() => props.exportingFormat === 'image');
const shareText = computed(() => (sharing.value ? t('sheetExport.building') : props.shareLabel));
const testidFor = (suffix: string) => (props.testid ? `${props.testid}-${suffix}` : undefined);
</script>

<template>
  <div class="inline-flex items-center gap-2">
    <button
      type="button"
      class="from-primary-500 to-terracotta-400 font-outfit dark:focus-visible:ring-offset-surface-ground inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2 disabled:opacity-60 md:h-auto md:w-auto md:rounded-2xl md:px-4 md:py-2.5"
      :disabled="disabled"
      :aria-label="shareText"
      :aria-busy="sharing || undefined"
      :data-testid="testidFor('share')"
      @click="emit('run', 'image')"
    >
      <span
        v-if="sharing"
        aria-hidden="true"
        class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-pulse"
      />
      <BeanieIcon v-else name="share" size="sm" />
      <span class="hidden md:inline">{{ shareText }}</span>
    </button>
    <button
      type="button"
      class="font-outfit text-secondary-500 dark:bg-surface-raised dark:text-ink dark:focus-visible:ring-offset-surface-ground hidden items-center gap-1.5 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2 disabled:opacity-60 md:inline-flex"
      :disabled="disabled"
      :aria-busy="exportingFormat === 'pdf' || undefined"
      :data-testid="testidFor('export')"
      @click="emit('run', 'pdf')"
    >
      <BeanieIcon v-if="exportingFormat !== 'pdf'" name="download" size="sm" />
      {{ exportingFormat === 'pdf' ? t('sheetExport.building') : t('sheetExport.exportPdf') }}
    </button>
  </div>
</template>
