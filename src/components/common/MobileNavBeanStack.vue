<script setup lang="ts">
/**
 * Mobile bottom-nav v3 bean stack.
 *
 * Rises vertically from an anchor element (typically a `<button>` in the
 * 4-tab `MobileBottomNav`). Each row is a circular "bean" + a side card
 * carrying a label and a one-line hint. The bean stays anchored over the
 * trigger tab; the side card extends inward toward whichever screen-half
 * has more horizontal space (auto side-flip on open + on viewport resize).
 *
 * The component reads its own anchor rect on demand via the `getAnchor`
 * function prop (rather than a stale element snapshot) and registers its
 * own rAF-throttled resize listener — only while open. On close, all
 * listeners and locks are released; `onScopeDispose` is the safety net.
 *
 * Reuses two single-purpose overlay composables for behavior:
 *   - useEscapeClose    — Esc key closes the stack
 *   - useBodyScrollLock — body scroll locked while open
 *
 * Deliberately does NOT push synthetic history entries / capture the back
 * gesture. The stack is a small menu, not a full-screen modal — same
 * convention as `MobileHamburgerMenu` and `BaseModal`. The platform back
 * button performs normal browser-history navigation, which triggers the
 * parent's route-change watch and closes the stack as a side effect.
 *
 * Pattern law: NAVIGATE-only. Zero CSS-class overlap with the Quick Add
 * cluster-bloom FAB pattern. No `+` seal on beans.
 *
 * Failure modes are documented inline; nothing fails silently.
 */
import { computed, nextTick, onScopeDispose, ref, toRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useBodyScrollLock } from '@/composables/useBodyScrollLock';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { usePermissions, FINANCE_ROUTES } from '@/composables/usePermissions';
import { isRouteActive } from '@/utils/route';
import type { MobileNavCategory, MobileNavStackItem } from '@/constants/navigation';

const props = defineProps<{
  /** Returns the trigger tab element. A getter (not a snapshot) so the
   *  stack always reads a fresh rect — anchor refs cannot go stale. */
  getAnchor: () => HTMLElement | null;
  category: MobileNavCategory;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [path: string];
}>();

const route = useRoute();
const { t } = useTranslation();
const { canViewFinances } = usePermissions();
const { prefersReducedMotion } = useReducedMotion();

// Stable id so the trigger tab can reference us via aria-controls.
const stackId = `mobile-nav-stack-${props.category.id}`;

// Side-flip state: which side of the bean does the text card extend toward?
const side = ref<'left' | 'right'>('right');

// Position offset (px) from one edge of the parent viewport.
// `left` is set when side === 'left'; `right` is set when side === 'right'.
const offset = ref(0);

const beanRefs = ref<Array<HTMLButtonElement | null>>([]);
function setBeanRef(el: unknown, idx: number) {
  beanRefs.value[idx] = el instanceof HTMLButtonElement ? el : null;
}

const isOpenRef = toRef(props, 'isOpen');

// ---------------------------------------------------------------------------
// Permission filter — defensive layer below the parent-tab visibility filter.
// Even if the Money tab is shown, granular finance perms could revoke a
// specific route mid-session.
// ---------------------------------------------------------------------------
const visibleItems = computed<MobileNavStackItem[]>(() => {
  const items = props.category.items ?? [];
  if (canViewFinances.value) return items;
  return items.filter((i) => !FINANCE_ROUTES.includes(i.path));
});

// Reverse the array so the first item shows at the BOTTOM of the column
// (closest to the thumb / trigger tab). The CSS uses flex-column-reverse
// for the same effect, but reversing the array also makes "first focusable"
// = bottom bean correct without index gymnastics.
const reversedItems = computed(() => [...visibleItems.value].reverse());

function isCurrent(item: MobileNavStackItem): boolean {
  return isRouteActive(route.path, item.path);
}

function onBeanTap(item: MobileNavStackItem) {
  emit('navigate', item.path);
}

function onScrimTap() {
  emit('close');
}

// ---------------------------------------------------------------------------
// Side-flip math — runs on open + on viewport resize, rAF-throttled so iOS
// Safari URL-bar show/hide doesn't fire 30 updates per second.
// ---------------------------------------------------------------------------
let rafToken: number | null = null;
let resizeAttached = false;
let retriedAnchor = false;

function readAnchorRect(): DOMRect | null {
  let el: HTMLElement | null;
  try {
    el = props.getAnchor();
  } catch (err) {
    console.warn('[MobileNavBeanStack] getAnchor threw:', err);
    return null;
  }
  if (!el) return null;
  try {
    return el.getBoundingClientRect();
  } catch (err) {
    console.warn('[MobileNavBeanStack] getBoundingClientRect threw:', err);
    return null;
  }
}

function applyDefaultSide() {
  side.value = 'right';
  offset.value = 12;
}

function updatePosition() {
  const rect = readAnchorRect();
  if (!rect || rect.width === 0) {
    if (!retriedAnchor) {
      retriedAnchor = true;
      requestAnimationFrame(() => {
        rafToken = null;
        updatePosition();
      });
      return;
    }
    console.warn('[MobileNavBeanStack] anchor unavailable; defaulting side to right');
    applyDefaultSide();
    return;
  }
  retriedAnchor = false;

  const phoneWidth = window.innerWidth;
  const tabCenter = rect.left + rect.width / 2;
  // Bean is 46px wide; the center of the bean must align with the tabCenter.
  const beanRadius = 23;

  if (tabCenter < phoneWidth / 2) {
    side.value = 'left';
    // Stack's left edge sits at (tabCenter - beanRadius)
    offset.value = Math.max(0, tabCenter - beanRadius);
  } else {
    side.value = 'right';
    // Stack's right edge sits at (phoneWidth - (tabCenter + beanRadius))
    offset.value = Math.max(0, phoneWidth - (tabCenter + beanRadius));
  }
}

function onResize() {
  if (rafToken !== null) return;
  rafToken = requestAnimationFrame(() => {
    rafToken = null;
    updatePosition();
  });
}

function attachResize() {
  if (resizeAttached) return;
  try {
    window.addEventListener('resize', onResize, { passive: true });
    resizeAttached = true;
  } catch (err) {
    console.warn('[MobileNavBeanStack] could not attach resize listener:', err);
  }
}

function detachResize() {
  if (!resizeAttached) return;
  try {
    window.removeEventListener('resize', onResize);
  } catch (err) {
    console.warn('[MobileNavBeanStack] could not detach resize listener:', err);
  }
  if (rafToken !== null) {
    cancelAnimationFrame(rafToken);
    rafToken = null;
  }
  resizeAttached = false;
}

// ---------------------------------------------------------------------------
// Focus management — on open, focus the active bean (or the bottom bean as
// a fallback) so keyboard / screen-reader users land in a sensible place.
// Parent restores focus to the trigger tab on close.
// ---------------------------------------------------------------------------
async function focusInitialBean() {
  await nextTick();
  const items = reversedItems.value;
  // Prefer the active route's bean.
  const idx = items.findIndex(isCurrent);
  // If no active item, fall back to the bottom bean (index 0 after reverse).
  const targetIdx = idx >= 0 ? idx : 0;
  const target = beanRefs.value[targetIdx];
  if (!target) {
    console.warn('[MobileNavBeanStack] no focus target available on open');
    return;
  }
  try {
    target.focus();
  } catch (err) {
    console.warn('[MobileNavBeanStack] focus call threw:', err);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle wiring — composables + position/focus on open, cleanup on close.
// ---------------------------------------------------------------------------
useEscapeClose(isOpenRef, () => emit('close'));
useBodyScrollLock(isOpenRef);

watch(
  isOpenRef,
  (open) => {
    if (open) {
      retriedAnchor = false;
      attachResize();
      // First measurement — schedule on next frame so DOM is committed.
      requestAnimationFrame(() => updatePosition());
      void focusInitialBean();
    } else {
      detachResize();
    }
  },
  { immediate: true }
);

// Re-position when the category changes mid-open (swap from Planning →
// Money keeps the stack mounted, but the anchor element points at a
// different tab now).
watch(
  () => props.category.id,
  () => {
    if (props.isOpen) {
      requestAnimationFrame(() => updatePosition());
    }
  }
);

onScopeDispose(detachResize);

// Convenience for the template.
const sideClass = computed(() => (side.value === 'left' ? 'side-left' : 'side-right'));
</script>

<template>
  <div
    v-if="isOpen"
    class="pointer-events-none fixed inset-0 z-30"
    :class="{ 'reduced-motion': prefersReducedMotion }"
  >
    <!-- Scrim: click-to-close. Covers the full viewport. -->
    <button
      type="button"
      class="pointer-events-auto fixed inset-0 bg-black/40"
      :aria-label="t('mobile.closeMenu')"
      @click="onScrimTap"
    ></button>

    <!-- Bean stack: rises from above the bottom-nav surface. -->
    <nav
      :id="stackId"
      role="menu"
      class="bean-stack pointer-events-auto fixed"
      :class="sideClass"
      :style="
        side === 'left'
          ? { left: offset + 'px', bottom: '92px' }
          : { right: offset + 'px', bottom: '92px' }
      "
    >
      <button
        v-for="(item, idx) in reversedItems"
        :key="item.path"
        :ref="(el) => setBeanRef(el, idx)"
        type="button"
        role="menuitem"
        class="jar-item"
        :class="{ 'is-current': isCurrent(item) }"
        :aria-current="isCurrent(item) ? 'page' : undefined"
        :style="{ '--stagger-delay': idx * 60 + 'ms' }"
        @click="onBeanTap(item)"
      >
        <span class="jar-bean" aria-hidden="true">
          <span class="jar-bean-emoji">{{ item.emoji }}</span>
        </span>
        <span class="jar-text">
          <span class="jar-label font-outfit text-sm font-semibold">{{ t(item.labelKey) }}</span>
          <span class="jar-hint text-xs">{{ t(item.hintKey) }}</span>
        </span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* Bean stack column. Rises above the bottom nav. */
.bean-stack {
  display: flex;
  flex-direction: column-reverse;
  gap: 9px;
}

.bean-stack.side-left {
  align-items: flex-start;
}

.bean-stack.side-right {
  align-items: flex-end;
}

/* Each row: bean + side card. side-flip controls which side the card sits on. */
.jar-item {
  align-items: center;
  animation: jar-rise 450ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  animation-delay: var(--stagger-delay, 0ms);
  background: transparent;
  border: 0;
  cursor: pointer;
  display: flex;
  gap: 10px;

  /* Animate IN with a spring; reduced-motion block below disables. */
  opacity: 0;
  outline: none;
  padding: 0;
  transform: translateY(24px) scale(0.55);
}

.bean-stack.side-left .jar-item {
  flex-direction: row;
}

.bean-stack.side-right .jar-item {
  flex-direction: row-reverse;
}

/* Bean: circular icon with subtle gloss. */
.jar-bean {
  background: white;
  border-radius: 9999px;
  box-shadow:
    0 6px 14px rgb(44 62 80 / 12%),
    inset 0 0 0 1px rgb(44 62 80 / 8%);
  display: grid;
  flex: 0 0 auto;
  font-size: 22px;
  height: 46px;
  place-items: center;
  position: relative;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  width: 46px;
}

.jar-bean::before {
  background: radial-gradient(circle at 30% 30%, rgb(255 255 255 / 85%), transparent 55%);
  border-radius: 9999px;
  content: '';
  inset: 6px;
  pointer-events: none;
  position: absolute;
}

:global(.dark) .jar-bean {
  background: rgb(36 51 66);
  box-shadow:
    0 6px 14px rgb(0 0 0 / 40%),
    inset 0 0 0 1px rgb(255 255 255 / 8%);
}

:global(.dark) .jar-bean::before {
  background: radial-gradient(circle at 30% 30%, rgb(255 255 255 / 18%), transparent 55%);
}

.jar-item:hover .jar-bean,
.jar-item:focus-visible .jar-bean {
  transform: scale(1.06);
}

/* Active bean: Heritage Orange ring + tinted fill. CIG colors. */
.jar-item.is-current .jar-bean {
  background: rgb(241 93 34 / 8%);
  box-shadow:
    0 0 0 2px #f15d22,
    0 6px 14px rgb(44 62 80 / 12%);
}

/* Side card: text panel paired with the bean. Pointer notch via ::after. */
.jar-text {
  background: white;
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgb(44 62 80 / 8%);
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 168px;
  padding: 7px 12px 8px;
  position: relative;
}

:global(.dark) .jar-text {
  background: rgb(36 51 66);
  border-color: rgb(236 240 241 / 8%);
}

.bean-stack.side-left .jar-text {
  text-align: left;
}

.bean-stack.side-right .jar-text {
  text-align: right;
}

.jar-text::after {
  background: white;
  border: 1px solid rgb(44 62 80 / 8%);
  content: '';
  height: 8px;
  position: absolute;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  width: 8px;
}

:global(.dark) .jar-text::after {
  background: rgb(36 51 66);
  border-color: rgb(236 240 241 / 8%);
}

.bean-stack.side-left .jar-text::after {
  border-right: 0;
  border-top: 0;
  left: -5px;
}

.bean-stack.side-right .jar-text::after {
  border-bottom: 0;
  border-left: 0;
  right: -5px;
}

.jar-item.is-current .jar-text {
  border-color: rgb(241 93 34 / 22%);
}

.jar-item.is-current .jar-text::after {
  border-color: rgb(241 93 34 / 22%);
}

.jar-label {
  line-height: 1.15;
  white-space: nowrap;
}

.jar-item.is-current .jar-label {
  color: #f15d22;
}

.jar-hint {
  color: rgb(44 62 80 / 55%);
  letter-spacing: 0.005em;
  line-height: 1.3;
  white-space: nowrap;
}

:global(.dark) .jar-hint {
  color: rgb(236 240 241 / 65%);
}

/* Spring rise-in for each bean. Reduced-motion block kills it cleanly. */
@keyframes jar-rise {
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.reduced-motion .bean-stack .jar-item {
  animation: none;
  opacity: 1;
  transform: none;
}
</style>
