<script setup lang="ts">
/**
 * Shared nudge-card chrome for the notification bell's detail bodies
 * (`InstallNudgeBody`, `CommunityNudgeBody`). Wraps the `CelebrationDetail`
 * shell and renders the common layout: a centered message line, one gradient
 * primary CTA, and a row of subtle secondary actions. Callers supply the kick
 * line + CTA content via slots and the secondary actions via the `actions`
 * prop; the primary CTA click is surfaced as the `cta` event.
 *
 * The CTA's `:deep(svg)` ring rule lives here so a CTA glyph (e.g. the Discord
 * mark on the community nudge) is styled consistently; it's inert for CTAs
 * without an icon.
 */
import CelebrationDetail from '@/components/notifications/CelebrationDetail.vue';

// Both nudges use the one hugging-beanies medallion — inlined (no caller overrides it).
const MEDALLION_SRC = '/brand/beanies_family_hugging_transparent_512x512.png';

defineProps<{
  message: string;
  /** Secondary actions rendered as subtle text buttons under the CTA. */
  actions: { label: string; onClick: () => void }[];
}>();

defineEmits<{ cta: [] }>();
</script>

<template>
  <CelebrationDetail date-label="" :medallion-src="MEDALLION_SRC">
    <template #kick><slot name="kick" /></template>

    <p class="nudge-message">{{ message }}</p>

    <button type="button" class="nudge-cta" @click="$emit('cta')">
      <slot name="cta" />
    </button>

    <div class="nudge-actions">
      <button
        v-for="action in actions"
        :key="action.label"
        type="button"
        class="nudge-secondary"
        @click="action.onClick"
      >
        {{ action.label }}
      </button>
    </div>
  </CelebrationDetail>
</template>

<style scoped>
.nudge-message {
  color: rgb(44 62 80 / 80%);
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.6;
  margin: auto 0 0;
  text-align: center;
}

html.dark .nudge-message {
  color: rgb(226 232 240 / 82%);
}

.nudge-cta {
  align-items: center;
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border: none;
  border-radius: 0.875rem;
  box-shadow: 0 4px 14px rgb(241 93 34 / 28%);
  color: #fff;
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 1.125rem;
  padding: 0.8125rem 1.125rem;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  width: 100%;
}

.nudge-cta:hover {
  box-shadow: 0 6px 18px rgb(241 93 34 / 36%);
  transform: translateY(-1px);
}

/* Keep a CTA glyph (e.g. the Discord mark) recognizable on the orange CTA — a
   white ring lifts it. Inert when the CTA has no icon. */
.nudge-cta :deep(svg) {
  background: #fff;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 3px;
}

.nudge-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 0.75rem;
}

.nudge-secondary {
  background: none;
  border: none;
  color: rgb(44 62 80 / 55%);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0.375rem 0.5rem;
  transition: color 0.15s;
}

.nudge-secondary:hover {
  color: #f15d22;
}

html.dark .nudge-secondary {
  color: rgb(226 232 240 / 60%);
}
</style>
