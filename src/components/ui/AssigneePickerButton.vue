<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

const props = withDefaults(
  defineProps<{
    modelValue: string | string[];
    /** Selection mode — single returns string, multi returns string[] */
    mode?: 'single' | 'multi';
    /** Avatar size in the trigger button */
    size?: 'sm' | 'md';
    /** Popover alignment */
    align?: 'left' | 'right';
    /**
     * Trigger appearance. `'default'` sizes to its content. `'composer'` is
     * the taller squircle slot used in the To-Do quick-add row so the picker
     * aligns with the entry bar and date picker (same height + corner), and
     * shows an explicit "Assign" label when empty. Opt-in only.
     */
    variant?: 'default' | 'composer';
  }>(),
  { mode: 'multi', size: 'md', align: 'right', variant: 'default' }
);

const { t } = useTranslation();

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]];
}>();

const familyStore = useFamilyStore();
const show = ref(false);
const el = ref<HTMLElement>();
const popoverRef = ref<HTMLElement | null>(null);

// Viewport-relative coords for the teleported popover — recalculated on open,
// scroll, and resize so it tracks its trigger even inside a clipping ancestor
// (e.g. a NookSectionCard / overflow-hidden card). Mirrors BeanieDatePicker.
const popoverStyle = ref<Record<string, string>>({});
const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT_ESTIMATE = 220;

// Close other AssigneePickerButton instances when this one opens
const CLOSE_EVENT = 'assignee-picker-close';

function openPicker() {
  // Broadcast close to all other pickers before opening
  document.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: el.value }));
  show.value = true;
  nextTick(() => positionPopover());
}

function onOtherPickerOpen(e: Event) {
  const source = (e as CustomEvent).detail;
  if (source !== el.value) {
    show.value = false;
  }
}

function positionPopover() {
  if (!el.value) return;
  const rect = el.value.getBoundingClientRect();
  const height = popoverRef.value?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
  const width = popoverRef.value?.offsetWidth ?? POPOVER_WIDTH;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - rect.bottom;

  // Flip up when there isn't room below but there is above.
  const dropUp = spaceBelow < height + 16 && rect.top > height + 16;
  const top = dropUp ? rect.top - height - 6 : rect.bottom + 6;

  // Honor `align`: 'right' anchors the popover's right edge to the trigger's
  // right edge, 'left' anchors left-to-left. Then clamp to the viewport so a
  // trigger near an edge can't push the popover off-screen.
  let left = props.align === 'right' ? rect.right - width : rect.left;
  if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
  if (left < MARGIN) left = MARGIN;

  popoverStyle.value = {
    position: 'fixed',
    top: `${Math.max(MARGIN, top)}px`,
    left: `${left}px`,
  };
}

function handleViewportChange() {
  if (show.value) positionPopover();
}

const selectedMembers = computed(() => {
  const ids = Array.isArray(props.modelValue)
    ? props.modelValue
    : props.modelValue
      ? [props.modelValue]
      : [];
  return familyStore.members.filter((m) => ids.includes(m.id));
});

const hasSelection = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue.length > 0 : !!props.modelValue
);

const avatarClasses = computed(() =>
  props.size === 'sm' ? 'h-5 w-5 text-[0.5625rem]' : 'h-6 w-6 text-[0.625rem]'
);

function handlePickerUpdate(value: string | string[]) {
  emit('update:modelValue', value);
  // Auto-close on single selection
  if (props.mode === 'single') {
    show.value = false;
  }
}

function onDocClick(e: MouseEvent) {
  const target = e.target as Node;
  // The popover is teleported to <body>, so it's no longer inside `el` — check
  // it separately to avoid closing when the user clicks a chip in the popover.
  if (el.value?.contains(target) || popoverRef.value?.contains(target)) return;
  show.value = false;
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener(CLOSE_EVENT, onOtherPickerOpen);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener(CLOSE_EVENT, onOtherPickerOpen);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
});
</script>

<template>
  <div ref="el" class="relative flex shrink-0 items-center">
    <button
      type="button"
      class="flex items-center rounded-2xl transition-colors"
      :class="[
        variant === 'composer'
          ? 'h-[3.25rem] gap-2 px-4'
          : [size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2', 'gap-1'],
        hasSelection ? 'bg-[var(--tint-purple-8)]' : 'hover:bg-[var(--tint-slate-10)]',
      ]"
      :style="!hasSelection ? 'background: var(--tint-slate-5)' : undefined"
      @click.stop="show ? (show = false) : openPicker()"
    >
      <template v-if="selectedMembers.length > 0">
        <span
          v-for="member in selectedMembers"
          :key="member.id"
          class="inline-flex items-center rounded-full font-bold text-white"
          :class="
            mode === 'single' ? 'gap-1.5 px-2.5 py-0.5 text-xs' : [avatarClasses, 'justify-center']
          "
          :style="{
            background: `linear-gradient(135deg, ${member.color}, ${member.color}cc)`,
          }"
        >
          <template v-if="mode === 'single'">{{ member.name }}</template>
          <template v-else>{{ member.name.charAt(0) }}</template>
        </span>
      </template>
      <template v-else>
        <span :class="size === 'sm' ? 'text-sm' : 'text-base'">👤</span>
        <span
          v-if="variant === 'composer'"
          class="font-outfit text-sm font-semibold text-[var(--color-text)] opacity-75"
        >
          {{ t('todo.assign') }}
        </span>
        <span class="text-xs text-[var(--color-text-muted)]">+</span>
      </template>
    </button>

    <!-- Popover — teleported to <body> so clipping ancestors (a card with
         overflow-hidden, or a scrollable section) don't cut it off when the
         trigger sits near the bottom. Positioned via fixed coords from
         positionPopover(). -->
    <Teleport to="body">
      <div
        v-if="show"
        ref="popoverRef"
        :style="popoverStyle"
        class="z-50 max-w-[280px] min-w-[200px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-700"
        @click.stop
      >
        <FamilyChipPicker
          :model-value="modelValue"
          :mode="mode"
          compact
          @update:model-value="handlePickerUpdate"
        />
      </div>
    </Teleport>
  </div>
</template>
