<script setup lang="ts">
/**
 * The quick-add surface the FAB opens in place (#119, direction A of
 * `docs/mockups/magic-beans-fab-composer-2026-10-03.html`): the magic-beans composer at the
 * top, the Everyday beans tiles directly below as the manual path, and the Family, Money and
 * Care groups behind one disclosure row.
 *
 * WHY A SELF-RENDERED SHELL, NOT `BaseModal`. The card is anchored to the FAB's corner rather
 * than centred, grows from that corner, tracks the on-screen keyboard, and on desktop is
 * NON-MODAL (no backdrop, no scroll lock, the page stays usable, like a chat window). Putting
 * that into `BaseModal`, the foundation of ~100 modals, would add four special cases to every
 * modal for one consumer. The house precedent for an anchored overlay is `MobileNavBeanStack`,
 * which renders its own scrim and panel and composes the same overlay composables; this
 * follows it. The phone/desktop overlay split, keyboard inset and focus restore live in
 * `useAnchoredOverlay`; the per-open composer latch, draft and `sent` / `dismissed` telemetry
 * live in `useComposerSession`. This file is template and wiring.
 *
 * Phone (< 768px): the card sits ABOVE the bottom tab bar at the FAB's anchor, over a dim that
 * covers the page, the FAB and the tab bar (still visible, dimmed); tap the dim to close.
 * Desktop (768px and up): a ~420px card in the FAB's corner with no dim.
 * Both close on the × and Escape. A phone open also pushes a history marker, so the back gesture
 * closes it (`useQuickAdd`); a desktop open pushes none. Either closes on a confirmed PATH change
 * (the `router.afterEach` below).
 *
 * The composer is shown only for an unscoped FAB open by a member who can read (the latch in
 * `useComposerSession`); scoped opens (Family Scrapbook / Timeline / Care & Safety) and
 * `startItem` picker opens get the tiles only.
 *
 * Section ordering is driven entirely by `QUICK_ADD_BY_GROUP`: no hard-coded item lists in the
 * template, so adding an entity to the config automatically lands it in the right place.
 */
import { computed, nextTick, onScopeDispose, ref } from 'vue';
import { useRouter } from 'vue-router';
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import MagicBeansComposer from '@/components/ai/MagicBeansComposer.vue';
import QuickAddPicker from '@/components/common/QuickAddPicker.vue';
import QuickAddMemberPicker from '@/components/common/QuickAddMemberPicker.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ShowMoreToggle from '@/components/ui/ShowMoreToggle.vue';
import {
  QUICK_ADD_BY_GROUP,
  type QuickAddGroup,
  type QuickAddItem,
} from '@/constants/quickAddItems';
import { FOCUS_RING, MAGIC_TILE_AT_REST, MAGIC_TILE_SELECTED } from '@/constants/tileStyles';
import {
  closeSheetForNavigation,
  hasSheetHistoryMarker,
  quickAddPushedHistoryMarker,
  useQuickAdd,
} from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';
import { useToast } from '@/composables/useToast';
import { useQuickAddAvailability } from '@/composables/useQuickAddAvailability';
import { useMagicReader } from '@/composables/useMagicReader';
import { useAnchoredOverlay } from '@/composables/useAnchoredOverlay';
import {
  COMPOSER_SURFACE,
  useComposerSession,
  type ComposerHandoffSource,
} from '@/composables/useComposerSession';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const { showToast } = useToast();
const { itemAllowedForMember } = useQuickAddAvailability();
const { isOpen, stage, allowedActions, openSeq, close, triggerAction } = useQuickAdd();
const { canReadAny } = useMagicReader();

// Close on a confirmed PATH change. `afterEach` only, so a cancelled or failed navigation
// (`failure` set) leaves the surface and its draft alone. Query- or hash-only replaces are the
// page behind the desktop card updating its own URL (a list filter, a deep-link param being
// consumed) and must not close it. The in-sheet paths close first themselves, so this sees them
// closed and does nothing.
//
// Desktop pushed no history marker, so there is nothing to clean up. On phones this is all but
// unreachable while open (the dim covers the tab bar and scroll is locked), except when a
// navigation started before the open lands after it on a slow network. That push goes over the
// marker, leaving a dead Back step under the new page. It is logged (`marker_orphaned`) and the
// surface still closes; history is not repaired, since rewriting it under a live navigation is
// worse than one extra Back.
const router = useRouter();
onScopeDispose(
  router.afterEach((to, from, failure) => {
    if (!isOpen.value || failure || to.path === from.path) return;
    if (quickAddPushedHistoryMarker() && !hasSheetHistoryMarker()) {
      logEvent({
        level: 'warn',
        surface: COMPOSER_SURFACE,
        message: 'navigation landed over the history marker',
        context: { action: 'marker_orphaned' },
      });
    }
    closeSheetForNavigation();
  })
);

const card = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof MagicBeansComposer> | null>(null);
const door = ref<InstanceType<typeof MagicBeansDoor> | null>(null);

// ORDER MATTERS: the overlay's open watcher remembers `document.activeElement` (the FAB) and
// must run before the session's open watcher moves focus into the card. Both are `pre` flush
// and run in creation order.
const { isMobile, inset } = useAnchoredOverlay(isOpen, close, { surface: COMPOSER_SURFACE });

/** The disclosure row's state; closed again on every open. */
const moreOpen = ref(false);

const {
  composerShown,
  draft,
  markHandedOff: markSessionHandedOff,
} = useComposerSession(isOpen, openSeq, {
  composerAllowed: () => canReadAny.value && !allowedActions.value && stage.value.mode === 'main',
  onOpen: (shown) => {
    moreOpen.value = false;
    // Invariant 5 of MagicBeansDoor: the denominator at the tap, segmented by entry point.
    if (shown) {
      withDoor('open', (d) =>
        d.open({ stage: 'composer', format: isMobile.value ? 'phone' : 'desktop' })
      );
    }
    void focusOnOpen(shown);
  },
});

/**
 * The ONE focus owner (the composer does not focus itself). The field when the composer is
 * shown, otherwise the card, so a keyboard user is never left on `<body>`. On iOS a focus that
 * runs after the tap handler may not raise the keyboard; the field is still focused and one tap
 * raises it.
 */
async function focusOnOpen(composerIsShown: boolean): Promise<void> {
  await nextTick();
  if (!isOpen.value) return;
  if (composerIsShown) {
    if (composer.value?.focus()) return;
    logEvent({
      level: 'warn',
      surface: COMPOSER_SURFACE,
      message: 'composer focus failed',
      context: { action: 'focus_failed' },
    });
  }
  card.value?.focus({ preventScroll: true });
}

type DoorApi = InstanceType<typeof MagicBeansDoor>;

/**
 * Every call into the door goes through here, so the guard and its report exist once. The door
 * is mounted at this component's root, which is mounted once in App.vue and never unmounted, so
 * a missing ref means a refactor moved it: a user action failed, so it pages.
 */
function withDoor(action: 'open' | 'send' | 'camera' | 'file', fn: (d: DoorApi) => void): void {
  const d = door.value;
  if (!d) {
    console.error('[QuickAddSheet] MagicBeansDoor ref missing; it must be mounted at the root');
    reportError({
      surface: COMPOSER_SURFACE,
      message: 'composer action with no door',
      severity: 'critical',
      context: { action },
    });
    if (action !== 'open') {
      showToast('error', t('error.unexpectedFailure'), t('error.unexpectedFailureHelp'));
    }
    return;
  }
  fn(d);
}

/**
 * The door committed a capture. Close SYNCHRONOUSLY, here, before the door's next line starts
 * the ingest or opens the picker (MagicBeansDoor invariant 4): that releases the phone scroll
 * lock and the overlay registration `openQuickAdd` refuses on, and pops the history marker.
 */
function onHandoff(source: ComposerHandoffSource): void {
  markSessionHandedOff(source);
  close();
}

// --- Tiles -------------------------------------------------------------------

/**
 * Per-member filter applied to every group. Items declare a `requiredPermission`
 * ('finance' | 'activities'); the surface hides any item the current member can't act on, and
 * hides a whole section when it ends up empty.
 *
 * Caller-supplied `allowedActions` (set via `openQuickAdd({ filter })`) scopes the surface to
 * a subset of actions, used by consolidation pages (Family Scrapbook, Family Timeline).
 */
function itemAllowed(item: QuickAddItem): boolean {
  // Flag + permission gate is shared with QuickAddFab via useQuickAddAvailability; the surface
  // layers only its caller-supplied action filter on top.
  if (!itemAllowedForMember(item)) return false;
  const filter = allowedActions.value;
  if (filter) return filter.includes(item.action);
  // Unfiltered (the main FAB surface): tiles marked `onlyWhenFiltered` stay out.
  return !item.onlyWhenFiltered;
}

const allowedByGroup = computed<Record<QuickAddGroup, readonly QuickAddItem[]>>(() => ({
  everyday: QUICK_ADD_BY_GROUP.everyday.filter(itemAllowed),
  family: QUICK_ADD_BY_GROUP.family.filter(itemAllowed),
  money: QUICK_ADD_BY_GROUP.money.filter(itemAllowed),
  care: QUICK_ADD_BY_GROUP.care.filter(itemAllowed),
}));

/** Narrowed picker-stage payload: `null` in main mode. */
const pickerItem = computed<QuickAddItem | null>(() =>
  stage.value.mode === 'picker' ? stage.value.pending : null
);

/**
 * Member-required items get an INLINE picker slotted after the tapped tile's section, so the
 * person stays spatially anchored to their tap. Recipe + medication pickers stay a full
 * view-swap: they're list-shaped and can be long.
 */
const isMemberInlinePicker = computed(() => pickerItem.value?.contextKey === 'memberId');

/** True when the view-swap picker (recipe / medication) replaces the header and tiles. */
const isSwapPicker = computed(() => pickerItem.value !== null && !isMemberInlinePicker.value);

/** Highlights the tapped tile while its inline picker is open. */
function isPending(item: QuickAddItem): boolean {
  return pickerItem.value?.id === item.id;
}

/**
 * Inline-picker layout: the picker slots in DIRECTLY AFTER the section holding the pending
 * item; sections BELOW it hide while the picker is open (otherwise the picker lands mid-card
 * with more content under it), and sections at or above it stay so the person can change their
 * mind without pressing Back.
 */
const GROUP_ORDER: Record<QuickAddGroup, number> = {
  everyday: 0,
  family: 1,
  money: 2,
  care: 3,
};

function showSection(group: QuickAddGroup): boolean {
  if (!isMemberInlinePicker.value || !pickerItem.value) return true;
  return GROUP_ORDER[group] <= GROUP_ORDER[pickerItem.value.group];
}

function pickerAfter(group: QuickAddGroup): boolean {
  if (!isMemberInlinePicker.value || !pickerItem.value) return false;
  return pickerItem.value.group === group;
}

/** The secondary groups, in display order, behind the disclosure row. */
const SECONDARY_GROUPS: readonly {
  id: QuickAddGroup;
  titleKey:
    'quickAdd.groups.family.title' | 'quickAdd.groups.money.title' | 'quickAdd.groups.care.title';
  suffixKey?: 'quickAdd.groups.money.setup';
}[] = [
  { id: 'family', titleKey: 'quickAdd.groups.family.title' },
  {
    id: 'money',
    titleKey: 'quickAdd.groups.money.title',
    suffixKey: 'quickAdd.groups.money.setup',
  },
  { id: 'care', titleKey: 'quickAdd.groups.care.title' },
];

/** Secondary groups this member has anything in; their titles make the disclosure label. */
const secondaryWithItems = computed(() =>
  SECONDARY_GROUPS.filter((g) => allowedByGroup.value[g.id].length > 0)
);

/** "Family · Money · Care", from the groups actually behind the row. */
const moreLabel = computed(() => secondaryWithItems.value.map((g) => t(g.titleKey)).join(' · '));

/**
 * The disclosure is forced open, with no toggle, when collapsing would hide what the person
 * came for: a scoped open, a tiles-only open (no composer above to make room for), an empty
 * Everyday group, or an inline picker pending on a secondary group's item. Decided once, here.
 */
const forceExpanded = computed(
  () =>
    allowedActions.value !== null ||
    !composerShown.value ||
    allowedByGroup.value.everyday.length === 0 ||
    (isMemberInlinePicker.value &&
      pickerItem.value !== null &&
      pickerItem.value.group !== 'everyday')
);

const groupsExpanded = computed(() => moreOpen.value || forceExpanded.value);

function handleItemClick(item: QuickAddItem): void {
  triggerAction(item);
}
</script>

<template>
  <!-- The door lives HERE, outside the Teleport and outside the card's v-if, NOT inside the
       surface. The surface unmounts its content on close (that keeps the field fresh and the
       allowance re-read); a door inside it would lose its hidden picker input and its held
       consent grant at the handoff, while the native camera is open, and the photo would land
       on a dead input. This component is mounted once in App.vue and never unmounted. -->
  <MagicBeansDoor ref="door" inline @handoff="onHandoff" />

  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <!-- Phone only: dims the page, the FAB and the tab bar (still visible under it). A
           decorative scrim with no text, so the opacity here is allowed. -->
      <div
        v-if="isOpen && isMobile"
        class="fixed inset-0 z-[45] bg-[rgb(44_62_80/0.35)] dark:bg-black/50"
        aria-hidden="true"
        data-testid="quick-add-dim"
        @click="close"
      />
    </Transition>

    <Transition name="qa-card">
      <section
        v-if="isOpen"
        id="quick-add-surface"
        ref="card"
        role="dialog"
        :aria-modal="isMobile ? 'true' : 'false'"
        :aria-labelledby="isSwapPicker ? undefined : 'quick-add-title'"
        tabindex="-1"
        data-testid="quick-add-sheet"
        class="qa-card dark:bg-surface-raised dark:border-line fixed z-[45] flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-3xl bg-white p-4 shadow-[0_8px_40px_rgba(44,62,80,0.18)] focus:outline-none dark:border dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
        :style="{ '--kb-inset': `${inset}px` }"
      >
        <header v-if="!isSwapPicker" class="flex items-start gap-2">
          <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-2">
            <h2
              id="quick-add-title"
              class="font-outfit dark:text-ink m-0 text-lg leading-tight font-bold text-[var(--color-text)]"
            >
              {{ composerShown ? t('ai.capture.title') : t('quickAdd.title') }}
            </h2>
            <p
              v-if="composerShown"
              class="text-primary-500 dark:text-accent-lift font-caveat m-0 text-base leading-tight font-bold"
            >
              {{ t('ai.capture.taglineShort') }}
            </p>
          </div>
          <button
            type="button"
            class="text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft dark:hover:bg-surface-hover inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--tint-slate-5)] transition-colors hover:bg-[var(--tint-slate-10)] motion-reduce:transition-none"
            :class="FOCUS_RING"
            :aria-label="t('quickAdd.close')"
            :title="t('quickAdd.close')"
            data-testid="quick-add-close-x"
            @click="close"
          >
            <BeanieIcon name="close" size="sm" />
          </button>
        </header>

        <!-- Latched once per open (useComposerSession). v-show, not v-if, under the swap picker:
             the draft is owned here, but the field keeps its place and caret on the way back. -->
        <MagicBeansComposer
          v-if="composerShown"
          v-show="!isSwapPicker"
          ref="composer"
          v-model="draft"
          :is-mobile="isMobile"
          @send="(text: string) => withDoor('send', (d) => d.send(text))"
          @camera="withDoor('camera', (d) => d.camera())"
          @file="withDoor('file', (d) => d.file())"
        />

        <!-- Recipe / medication picker: full view-swap. -->
        <QuickAddPicker v-if="isSwapPicker" :pending="pickerItem!" />

        <template v-else>
          <!-- Everyday beans: one tap away, directly under the composer. -->
          <section
            v-if="allowedByGroup.everyday.length > 0"
            class="flex flex-col gap-2"
            :class="
              composerShown ? 'dark:border-line border-t border-[var(--tint-slate-10)] pt-3' : ''
            "
            aria-labelledby="quick-add-everyday-kicker"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-2">
              <span
                id="quick-add-everyday-kicker"
                class="font-outfit text-secondary-500 dark:text-ink-soft text-xs font-bold tracking-[0.04em] uppercase"
              >
                {{ t('quickAdd.groups.everyday.kicker') }}
              </span>
              <span class="text-secondary-400 dark:text-ink-faint text-xs">
                {{
                  composerShown
                    ? t('quickAdd.groups.everyday.byHand')
                    : t('quickAdd.groups.everyday.subhint')
                }}
              </span>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="item in allowedByGroup.everyday"
                :key="item.id"
                type="button"
                class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-2.5 text-center transition-colors motion-reduce:transition-none"
                :class="[isPending(item) ? MAGIC_TILE_SELECTED : MAGIC_TILE_AT_REST, FOCUS_RING]"
                :data-testid="`quick-add-item-${item.id}`"
                :aria-pressed="isPending(item) ? 'true' : undefined"
                @click="handleItemClick(item)"
              >
                <span class="text-xl leading-none" aria-hidden="true">{{ item.emoji }}</span>
                <span
                  class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]"
                >
                  {{ t(item.labelKey) }}
                </span>
              </button>
            </div>
          </section>

          <!-- Inline picker slotted after Everyday when one of its tiles is pending. -->
          <QuickAddMemberPicker v-if="pickerAfter('everyday')" />

          <!-- Family, Money (setup), Care: behind the disclosure row unless forced open. Each may
               render its inline picker directly after it; sections below the pending one hide
               (`showSection`) to keep the picker at the visible bottom. -->
          <template v-if="groupsExpanded">
            <template v-for="group in SECONDARY_GROUPS" :key="group.id">
              <section
                v-if="showSection(group.id) && allowedByGroup[group.id].length > 0"
                class="flex flex-col gap-2"
              >
                <h3
                  class="font-outfit text-secondary-500 dark:text-ink-soft m-0 text-xs font-bold tracking-[0.08em] uppercase"
                >
                  {{ t(group.titleKey) }}
                  <em
                    v-if="group.suffixKey"
                    class="text-secondary-400 dark:text-ink-faint ml-1 font-sans text-xs font-normal tracking-normal normal-case"
                  >
                    · {{ t(group.suffixKey) }}
                  </em>
                </h3>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="item in allowedByGroup[group.id]"
                    :key="item.id"
                    type="button"
                    class="flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none"
                    :class="[
                      isPending(item)
                        ? MAGIC_TILE_SELECTED
                        : 'dark:bg-surface-overlay dark:border-line dark:hover:bg-surface-hover border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-slate-5)]',
                      FOCUS_RING,
                    ]"
                    :data-testid="`quick-add-item-${item.id}`"
                    :aria-pressed="isPending(item) ? 'true' : undefined"
                    @click="handleItemClick(item)"
                  >
                    <span class="shrink-0 text-xl leading-none" aria-hidden="true">{{
                      item.emoji
                    }}</span>
                    <span class="flex min-w-0 flex-col gap-0.5">
                      <span
                        class="font-outfit dark:text-ink text-sm leading-tight font-semibold text-[var(--color-text)]"
                      >
                        {{ t(item.labelKey) }}
                      </span>
                      <span class="text-secondary-400 dark:text-ink-faint text-xs leading-snug">
                        {{ t(item.hintKey) }}
                      </span>
                    </span>
                  </button>
                </div>
              </section>
              <QuickAddMemberPicker v-if="pickerAfter(group.id)" />
            </template>
          </template>

          <!-- The "Family · Money · Care" row expands the groups in place (house List
               Disclosure rule: never navigates). -->
          <ShowMoreToggle
            v-if="!forceExpanded && secondaryWithItems.length > 0"
            :can-show-more="!moreOpen"
            :can-show-less="moreOpen"
            :more-label="moreLabel"
            tone="on-light"
            data-testid="quick-add-more"
            @show-more="moreOpen = true"
            @show-less="moreOpen = false"
          />
        </template>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Layout only, no colour (every paint is a utility with its dark partner above). ONE rule for
   every width: the anchor variables in src/style.css already switch at 768px. The card sits on
   the FAB's corner, and lifts to sit 0.5rem above an on-screen keyboard when that is higher
   (`--kb-inset`, from useVisualViewportInset); small insets (toolbar wobble) never move it. */
.qa-card {
  --qa-bottom: max(var(--fab-anchor-bottom), calc(var(--kb-inset, 0px) + 0.5rem));

  bottom: var(--qa-bottom);
  max-height: calc(100dvh - var(--qa-bottom) - env(safe-area-inset-top, 0px) - 1rem);
  right: var(--fab-anchor-side);
  transform-origin: 100% 100%;
  width: min(26.25rem, calc(100vw - 2 * var(--fab-anchor-side)));
}

/* Grows from the FAB's corner. Reduced motion keeps the fade and drops the scale. */
.qa-card-enter-active,
.qa-card-leave-active {
  transition:
    opacity 200ms ease-out,
    transform 200ms ease-out;
}

.qa-card-enter-from,
.qa-card-leave-to {
  opacity: 0;
  transform: scale(0.6);
}

@media (prefers-reduced-motion: reduce) {
  .qa-card-enter-from,
  .qa-card-leave-to {
    transform: none;
  }
}
</style>
