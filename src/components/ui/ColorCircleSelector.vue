<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import type { FamilyMember } from '@/types/models';

interface ColorOption {
  value: string;
  gradient?: string;
}

interface Props {
  modelValue: string;
  colors: ColorOption[];
  /**
   * Colours already held by another bean, mapped to their holder.
   *
   * A colour identifies a person now, so two beans sharing one makes the whole
   * system ambiguous. Pass `takenColors(members, editingId)` — the `excludeId`
   * matters: without it, a bean created before uniqueness was enforced would see
   * its OWN swatch as taken and could never be saved.
   */
  taken?: Map<string, FamilyMember>;
}

const props = withDefaults(defineProps<Props>(), { taken: undefined });

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

function holderOf(value: string): FamilyMember | undefined {
  return props.taken?.get(value);
}

/**
 * Its own colour is always selectable; only someone else's is barred.
 *
 * AND never all of them. A bean on an off-palette or retired colour in a family that
 * already holds every hue would otherwise see six disabled swatches and no selection —
 * an unrecoverable form, because the one thing it needs to do is change that colour.
 * When nothing is left, the lock comes off entirely and the collision notice explains
 * why; a duplicate the user chose knowingly beats a form that cannot be saved.
 */
const anySelectable = computed(() =>
  props.colors.some((c) => c.value === props.modelValue || !holderOf(c.value))
);

/**
 * True when the palette is exhausted and the lock has come off — so a caller can say
 * so. Unlocking without explaining is the worst of both: an ordinary-looking picker
 * that quietly creates a duplicate. The holder badges stay visible in this state for
 * the same reason (they key off `holderOf`, not `isTaken`).
 */
const allTaken = computed(() => !anySelectable.value);
defineExpose({ allTaken });

function isTaken(value: string): boolean {
  if (!anySelectable.value) return false;
  return value !== props.modelValue && Boolean(holderOf(value));
}

/**
 * The uniqueness rule lives HERE, not only in the `disabled` attribute.
 *
 * A DOM attribute is presentation: swap it for `aria-disabled` (so the swatch stays
 * focusable and its tooltip renders) or for `pointer-events-none`, and duplicate
 * assignment silently comes back. Worse, the test that was supposed to catch that
 * could not: @vue/test-utils no-ops `trigger()` on a disabled BUTTON
 * (`vue-test-utils.cjs.js:7215`), so the assertion was satisfied by the library rather
 * than by this component.
 */
function select(value: string): void {
  if (isTaken(value)) return;
  emit('update:modelValue', value);
}

function titleFor(value: string): string {
  const holder = holderOf(value);
  return holder && isTaken(value)
    ? fillTemplate(t('family.colorTakenBy'), { name: holder.name })
    : '';
}
</script>

<template>
  <div class="flex flex-wrap gap-2.5">
    <div v-for="color in colors" :key="color.value" class="relative">
      <button
        type="button"
        class="h-8 w-8 rounded-full transition-all duration-150"
        :class="[
          isTaken(color.value) ? 'cursor-not-allowed opacity-40' : 'hover:scale-115',
          modelValue === color.value
            ? 'shadow-[0_0_0_2px_white,0_0_0_4px_var(--color-secondary)]'
            : '',
        ]"
        :style="{ background: color.gradient || color.value }"
        :disabled="isTaken(color.value)"
        :aria-disabled="isTaken(color.value)"
        :title="titleFor(color.value)"
        :aria-label="titleFor(color.value) || undefined"
        @click="select(color.value)"
      />
      <!--
        The holder's own face on the swatch, so "taken" needs no sentence to explain
        itself. A disabled swatch with no explanation reads as a bug.
      -->
      <!--
        Wrapped in a positioned span rather than passing `absolute` to BeanieAvatar:
        its root already carries `relative`, and Tailwind emits `.relative` after
        `.absolute` at equal specificity, so the class fell through and the badge sat
        in normal flow beneath the swatch. The ring separates it from the same-coloured
        swatch behind it.
      -->
      <span
        v-if="holderOf(color.value) && color.value !== modelValue"
        class="dark:ring-surface-raised pointer-events-none absolute -right-1 -bottom-1 rounded-full ring-2 ring-white"
      >
        <BeanieAvatar
          v-bind="memberAvatarBindings(holderOf(color.value)!)"
          fallback="initials"
          size="xs"
        />
      </span>
    </div>
  </div>
</template>
