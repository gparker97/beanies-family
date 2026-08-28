<script setup lang="ts">
/**
 * Top-level paging strip for the Family Scrapbook page.
 *
 * Each tab is a prominent avatar + name — reads as a stack of "page
 * tabs" sticking out of a binder, one per bean plus an "Everyone"
 * overview tab. Tapping a tab pages the spread underneath via the
 * page-turn transition owned by the parent page.
 *
 * Stateless. Parent owns `activeId`; this component just emits
 * `select` on tap. The parent computes the transition direction
 * (forward / backward) from the new vs old position in the roster
 * before mutating `activeId`, so the page-turn always animates in
 * the visually-correct direction.
 *
 * Avatar rendering reuses `<BeanieAvatar>` (handles photo / beanie
 * variant / fallback) and `getMemberAvatarUrl` from the established
 * `useMemberInfo` helpers — same trio used by `<QuickAddPicker>`,
 * `<PersonSelectView>`, and `<ProfileHeader>`.
 */
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember, UUID } from '@/types/models';

defineProps<{
  beans: FamilyMember[];
  activeId: 'everyone' | UUID;
}>();

defineEmits<{
  select: [id: 'everyone' | UUID];
}>();

const { t, isBeanieMode } = useTranslation();

// Stable per-bean tilt for the inactive state — alternating left/right
// so the strip reads like a row of paper tabs sticking up from a
// binder. Hash from id keeps the value deterministic even when the
// roster reorders.
function inactiveTilt(id: string): number {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2 === 0 ? -2.5 : 2.5;
}

function nameFor(name: string): string {
  return isBeanieMode.value ? name.toLowerCase() : name;
}
</script>

<template>
  <nav
    class="scrapbook-spine -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pt-2 pb-3 sm:mx-0 sm:gap-3 sm:px-0"
    :aria-label="t('scrapbook.spine.everyone')"
  >
    <!-- Everyone tab — kraft-tinted circle with 🏡 instead of a beanie
         avatar. Same footprint + tab metaphor, distinct visual so it
         reads as the family-overview rather than a single bean. -->
    <button
      type="button"
      class="spine-tab"
      :class="{ 'is-active': activeId === 'everyone' }"
      :style="
        activeId === 'everyone' ? {} : { transform: `rotate(${inactiveTilt('everyone')}deg)` }
      "
      :aria-pressed="activeId === 'everyone' ? 'true' : 'false'"
      @click="$emit('select', 'everyone')"
    >
      <span class="spine-avatar everyone-avatar" aria-hidden="true">🏡</span>
      <span class="spine-label">{{ t('scrapbook.spine.everyone') }}</span>
    </button>

    <!-- Per-bean tabs — full BeanieAvatar handles photo / beanie /
         fallback in one place. -->
    <button
      v-for="bean in beans"
      :key="bean.id"
      type="button"
      class="spine-tab"
      :class="{ 'is-active': activeId === bean.id }"
      :style="activeId === bean.id ? {} : { transform: `rotate(${inactiveTilt(bean.id)}deg)` }"
      :aria-pressed="activeId === bean.id ? 'true' : 'false'"
      @click="$emit('select', bean.id)"
    >
      <span class="spine-avatar">
        <BeanieAvatar
          :variant="(bean.avatar as AvatarVariant | undefined) ?? 'adult-other'"
          :color="bean.color"
          :photo-url="getMemberAvatarUrl(bean)"
          size="xl"
          :aria-label="bean.name"
          @photo-error="markMemberAvatarError(bean)"
        />
      </span>
      <span class="spine-label">{{ nameFor(bean.name) }}</span>
    </button>
  </nav>
</template>

<style scoped>
.scrapbook-spine {
  scroll-snap-type: x proximity;
}

.scrapbook-spine > button {
  scroll-snap-align: start;
}

.spine-tab {
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem 0.625rem;
  position: relative;
  transform-origin: bottom center;
  transition:
    transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 200ms ease;
}

.spine-tab:focus-visible {
  border-radius: 1rem;
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
}

.spine-tab:hover:not(.is-active) {
  filter: brightness(1.04);
}

.spine-tab.is-active {
  /* "Page is open" — pulled out of the binder, no tilt, lifted shadow.
     Slight scale-up so the active tab clearly dominates the strip. */
  transform: scale(1.08) translateY(-2px) !important;
  z-index: 1;
}

.spine-avatar {
  align-items: center;
  border-radius: 9999px;
  display: inline-flex;
  height: 4rem;
  justify-content: center;
  position: relative;
  width: 4rem;
}

/* Everyone tab — kraft-tinted circle with the 🏡 emoji centered. */
.everyone-avatar {
  background: linear-gradient(135deg, #ffe4d6, #d4f1f4);
  box-shadow: 0 2px 8px rgb(241 93 34 / 18%);
  font-size: 1.875rem;
  line-height: 1;
}

/* Active state ring — Heritage Orange halo around the active avatar. */
.spine-tab.is-active .spine-avatar {
  box-shadow:
    0 0 0 3px rgb(241 93 34 / 90%),
    0 8px 18px rgb(241 93 34 / 28%);
}

.spine-label {
  color: var(--color-text);
  font-family: var(--font-outfit, 'Outfit', sans-serif);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  max-width: 5rem;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spine-tab.is-active .spine-label {
  color: var(--color-primary);
}

:root.dark .spine-label {
  color: rgb(229 231 235);
}

:root.dark .spine-tab.is-active .spine-label {
  color: rgb(255 167 110);
}

@media (prefers-reduced-motion: reduce) {
  .spine-tab,
  .spine-tab.is-active {
    transform: none !important;
    transition: none;
  }
}
</style>
