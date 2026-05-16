<script setup lang="ts">
/**
 * Visual primitive for sidebar / mobile-nav attention badges.
 *
 * Two variants, chosen via the discriminated `badge` prop:
 *   - `count` → orange Heritage pill with numeric value (attention)
 *   - `dot`   → solid 8px dot, colour depends on severity
 *               (`attention` = Heritage Orange, `info` = Sky Silk)
 *
 * Renders nothing when `badge` is null, or when its count is 0 / dot
 * inactive — callers don't have to guard.
 *
 * Positioning is the caller's concern. Wrap this component in a
 * positioned span when you need it anchored (e.g. tab corner, badge
 * floats). Keeps this component a pure visual; no fragile attribute
 * forwarding across the v-if/v-else-if branches.
 */
import type { NavBadge } from '@/composables/useNavBadges';

defineProps<{ badge: NavBadge | null }>();
</script>

<template>
  <span
    v-if="badge?.kind === 'count' && badge.count > 0"
    class="bg-primary-500 min-w-[1.2rem] rounded-full px-1.5 text-center text-xs font-semibold text-white"
    >{{ badge.count }}</span
  >
  <span
    v-else-if="badge?.kind === 'dot' && badge.active"
    class="h-2 w-2 rounded-full"
    :class="badge.severity === 'attention' ? 'bg-primary-500' : 'bg-[var(--color-sky-silk-300)]'"
    aria-hidden="true"
  />
</template>
