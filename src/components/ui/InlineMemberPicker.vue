<script setup lang="ts">
/**
 * The fold-down member picker: a "bean-jar expansion" that opens in flow, where the user tapped.
 *
 * Extracted from `QuickAddMemberPicker`, which owned both this presentation AND its binding to
 * `useQuickAdd` (`stage.pending.labelKey`, `commitPicker`, `cancelPicker`). That coupling made it
 * unreusable, so the magic-link mint surfaces would each have grown their own copy of the same
 * animation, grid, back chip and empty state. `QuickAddMemberPicker` is now a thin wrapper over
 * this file and is the reason the styles below are a VERBATIM move rather than a rewrite: a
 * restyle in the same change would make any visual regression in Quick Add indistinguishable
 * from the extraction.
 *
 * ⚠️ Pre-existing token debt was carried across deliberately, not introduced here. The raw hex
 * (`#f15d22`, `rgb(44 62 80)`, `#1e2a36`) and the `--tint-orange-*` fallbacks are what the
 * original shipped; every rule already has its `html.dark` partner, so this is lint-green and
 * behaviour-identical today. Converting it to semantic `surface-*` / `ink-*` tokens is recorded
 * as debt in `docs/STATUS.md` instead of being smuggled into an extraction commit.
 *
 * ⚠️ ONE deliberate behaviour change, and it is a bug fix: this uses the pet-aware
 * `getMemberAvatarVariant`, where the original used the pet-blind `getAvatarVariant(gender,
 * ageGroup)` overload and therefore drew a pet as a human bean. Every other member surface in
 * the app already uses the pet-aware helper. Quick Add's screenshots will change by one tile.
 *
 * Layout notes kept from the original, because they are load-bearing:
 * - No absolute positioning. Flow layout only, so there is no edge-collision maths and it works
 *   anywhere a sheet or card puts it.
 * - `scrollIntoView({ block: 'nearest' })` on mount, because the host's content is often taller
 *   than the viewport on a phone and the picker would otherwise open off-screen. Exposed as a
 *   method too, so a host that keeps this mounted while its own selection changes can re-run it.
 */
import { onMounted, nextTick, useTemplateRef } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { getMemberAvatarVariant, getMemberAvatarUrl } from '@/composables/useMemberAvatar';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  /** Who may be chosen. The host decides the roster; this file never filters it. */
  members: FamilyMember[];
  /** Uppercase kicker, e.g. "Who's signing in?". Already translated by the host. */
  title: string;
  /** Optional italic second line under the kicker, e.g. what the pick is for. */
  subtitle?: string;
  /** Back-chip label. Already translated. */
  backLabel: string;
  /** Shown instead of the grid when `members` is empty. Already translated. */
  emptyMessage: string;
  /**
   * Prefix for each tile's `data-testid`, so a host can keep ids the suite already knows.
   *
   * ⚠️ Quick Add passes `quick-add-member-inline-tile-` to preserve the exact ids it shipped
   * with before this component was extracted out of it. The extraction had no test covering it,
   * so those ids are the only contract a future test can hang off; changing them would silently
   * break work nobody has written yet.
   */
  tileTestidPrefix?: string;
  /**
   * What the dismiss chip means here.
   *
   * ⚠️ `'back'` IS NAVIGATION AND `'close'` IS DISMISSAL, AND THE DIFFERENCE IS NOT COSMETIC.
   * Quick Add opens this picker in place of an item grid, so its chip genuinely goes BACK to
   * that grid. The magic-link surfaces reveal it below a button that stays on screen, so there
   * is nowhere to go back TO — a "← Back" there reads as navigation and looked broken, because
   * it was: it called a `cancelPicker` that only flipped a flag nothing reads in mandatory mode.
   */
  dismissStyle?: 'back' | 'close';
}>();

const emit = defineEmits<{ pick: [memberId: string]; cancel: [] }>();

const rootRef = useTemplateRef<HTMLElement>('rootRef');

async function scrollIntoView(): Promise<void> {
  await nextTick();
  rootRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

onMounted(() => {
  void scrollIntoView();
});

defineExpose({ scrollIntoView });
</script>

<template>
  <section ref="rootRef" class="inline-picker" :aria-label="props.title">
    <header class="picker-header">
      <button type="button" class="back-chip" :aria-label="props.backLabel" @click="emit('cancel')">
        <span aria-hidden="true">{{ props.dismissStyle === 'close' ? '✕' : '←' }}</span>
        <span>{{ props.backLabel }}</span>
      </button>
      <div class="picker-title-stack">
        <span class="picker-kicker">{{ props.title }}</span>
        <span v-if="props.subtitle" class="picker-for-label">{{ props.subtitle }}</span>
      </div>
    </header>

    <div v-if="props.members.length === 0" class="empty">
      <span class="empty-emoji" aria-hidden="true">🌱</span>
      <p class="empty-message">{{ props.emptyMessage }}</p>
    </div>

    <div v-else class="grid">
      <button
        v-for="(member, idx) in props.members"
        :key="member.id"
        type="button"
        class="tile"
        :style="{ '--stagger-delay': `${60 + idx * 50}ms` }"
        :data-testid="`${props.tileTestidPrefix ?? 'inline-member-tile-'}${member.id}`"
        @click="emit('pick', member.id)"
      >
        <BeanieAvatar
          :variant="getMemberAvatarVariant(member)"
          :color="member.color"
          size="sm"
          :photo-url="getMemberAvatarUrl(member) ?? undefined"
          :aria-label="member.name"
        />
        <span class="name">{{ member.name }}</span>
        <!-- Lets a host annotate a tile BEFORE it is tapped, e.g. "hasn't joined yet", so the
             user is not surprised by a different flow after choosing. -->
        <slot name="badge" :member="member" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.inline-picker {
  animation: inline-expand 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
  background: linear-gradient(
    135deg,
    var(--tint-orange-15, rgb(241 93 34 / 15%)) 0%,
    var(--tint-orange-8, rgb(241 93 34 / 8%)) 100%
  );
  border: 1px solid var(--tint-orange-15, rgb(241 93 34 / 22%));
  border-radius: 18px;
  padding: 14px;
  transform-origin: top center;
}

@keyframes inline-expand {
  from {
    opacity: 0;
    transform: translateY(-4px) scaleY(0.94);
  }

  to {
    opacity: 1;
    transform: translateY(0) scaleY(1);
  }
}

.picker-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.back-chip {
  align-items: center;
  background: white;
  border: 1px solid rgb(241 93 34 / 22%);
  border-radius: 999px;
  color: #f15d22;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 4px;
  padding: 5px 11px;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 0.15s ease-out,
    border-color 0.15s ease-out;
}

.back-chip:hover {
  background: rgb(241 93 34 / 10%);
  border-color: rgb(241 93 34 / 38%);
}

.back-chip:active {
  transform: scale(0.97);
}

.back-chip:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

html.dark .back-chip {
  background: #1e2a36;
}

.picker-title-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.picker-kicker {
  color: #f15d22;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
  text-transform: uppercase;
}

.picker-for-label {
  color: rgb(44 62 80 / 65%);
  font-family: Inter, sans-serif;
  font-size: 0.75rem;
  font-style: italic;
  font-weight: 400;
  line-height: 1.2;
}

html.dark .picker-for-label {
  color: rgb(241 242 244 / 65%);
}

.grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (width >= 480px) {
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.tile {
  align-items: center;
  animation: tile-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: var(--stagger-delay, 0ms);
  background: white;
  border: 1px solid rgb(241 93 34 / 15%);
  border-radius: 14px;
  box-shadow: 0 2px 6px -2px rgb(44 62 80 / 10%);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 6px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.15s ease-out,
    border-color 0.15s ease-out,
    box-shadow 0.15s ease-out;
}

.tile:hover {
  border-color: rgb(241 93 34 / 38%);
  box-shadow: 0 6px 12px -4px rgb(241 93 34 / 28%);
  transform: translateY(-2px);
}

.tile:active {
  transform: translateY(0) scale(0.97);
}

.tile:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

html.dark .tile {
  background: #1e2a36;
  border-color: rgb(241 93 34 / 28%);
}

.name {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html.dark .name {
  color: rgb(241 242 244);
}

.empty {
  color: rgb(44 62 80 / 65%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 12px;
  text-align: center;
}

html.dark .empty {
  color: rgb(241 242 244 / 65%);
}

.empty-emoji {
  font-size: 1.75rem;
  line-height: 1;
}

.empty-message {
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  margin: 0;
}

@keyframes tile-pop {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.7);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .inline-picker,
  .tile {
    animation: none;
  }

  .tile:hover {
    transform: none;
  }
}
</style>
