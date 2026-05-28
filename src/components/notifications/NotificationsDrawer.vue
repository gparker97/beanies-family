<script setup lang="ts">
/**
 * The single notifications drawer (Treatment B): one `BaseSidePanel` that slides
 * list → detail. Relies on the panel's built-in Escape + scroll-lock + teleport
 * (via `useFullscreenOverlay`) — does NOT re-wire them. Mounted ONCE in App.vue.
 *
 * Back behaviour (option C from the plan — chosen for robustness):
 *   • Escape / scrim / X (panel `@close`) → `store.back()` (pops detail→list, or
 *     closes from list) — hierarchical.
 *   • Platform-back gesture → `store.close()` via a SINGLE `useBackGestureClose`
 *     instance, so it always closes the drawer cleanly with exactly one history
 *     marker (never escapes to app navigation). We deliberately avoid the
 *     two-instance per-layer wiring (option A) — its `list→detail` forward
 *     transition races `history.back()` (async) against `pushState` (sync), and
 *     that two-concurrent-instance configuration is unproven in this codebase.
 *   • The in-header back arrow → `store.back()` for the explicit detail→list pop.
 */
import { computed, toRef } from 'vue';
import BaseSidePanel from '@/components/ui/BaseSidePanel.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import NotificationRow from '@/components/notifications/NotificationRow.vue';
import WhatsNewGiftCard from '@/components/notifications/WhatsNewGiftCard.vue';
import AnnouncementCard from '@/components/notifications/AnnouncementCard.vue';
import NotificationDetail from '@/components/notifications/NotificationDetail.vue';
import {
  isCelebratoryWhatsNew,
  isAnnouncementCard,
} from '@/components/notifications/notificationKinds';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBackGestureClose } from '@/composables/useBackGestureClose';
import { relativeDayLabel, toDateInputValue } from '@/utils/date';
import type { AppNotification } from '@/types/notifications';

const store = useNotificationsStore();
const { t } = useTranslation();

// Platform-back closes the whole drawer (single marker, no churn — see header doc).
useBackGestureClose(toRef(store, 'isOpen'), () => store.close());

/** Group newest-first notifications by their local day; header via relativeDayLabel. */
const groups = computed(() => {
  const byDay = new Map<string, AppNotification[]>();
  for (const n of store.notifications) {
    const day = toDateInputValue(new Date(n.occurredAt));
    const bucket = byDay.get(day);
    if (bucket) bucket.push(n);
    else byDay.set(day, [n]);
  }
  return [...byDay.entries()].map(([day, items]) => ({
    day,
    label: relativeDayLabel(day, t),
    items,
  }));
});

const isEmpty = computed(() => store.notifications.length === 0);

/** Detail header title — whats-new reads "what's new" (the hero carries the date). */
const detailTitle = computed(() => {
  const n = store.selected;
  if (!n) return t('notifications.title');
  if (n.kind === 'whats-new') return t('notifications.kindWhatsNew');
  if (n.kind === 'announcement') return t('notifications.kindAnnouncement');
  return n.title;
});

// Direction of the list⇄detail slide. Entering the detail is "forward" (push:
// detail in from the right, list out to the left); entering the list is "back"
// (the reverse). Computed from the target view, which is correct for the
// `out-in` swap — the leave + enter both read the post-change direction.
const navName = computed(() => (store.view === 'detail' ? 'nav-forward' : 'nav-back'));

/** Row pip → flip read-state without opening the detail. */
function onToggleRead(id: string) {
  const n = store.notifications.find((x) => x.id === id);
  if (!n) return;
  if (n.read) store.markUnread(id);
  else store.markRead(id);
}
</script>

<template>
  <BaseSidePanel :open="store.isOpen" side="right" size="narrow" @close="store.back()">
    <template #header>
      <!-- Detail: back arrow + item title. List: title + mark-all-read.
           Cross-fade so the header swap stays in step with the body slide. -->
      <Transition name="nd-fade" mode="out-in">
        <div v-if="store.view === 'detail'" key="detail" class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="text-secondary-500/70 hover:text-secondary-500 -ml-1 flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-700"
            :aria-label="t('notifications.back')"
            @click="store.back()"
          >
            <BeanieIcon name="chevron-left" size="md" />
          </button>
          <h2
            class="font-outfit text-secondary-500 truncate text-lg font-semibold dark:text-gray-100"
          >
            {{ detailTitle }}
          </h2>
        </div>
        <div v-else key="list" class="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2">
          <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
            {{ t('notifications.title') }}
          </h2>
          <button
            v-if="store.hasUnread"
            type="button"
            class="text-primary-500 hover:bg-primary-500/10 font-outfit rounded-xl px-2.5 py-1 text-xs font-semibold transition-colors"
            @click="store.markAllRead()"
          >
            {{ t('notifications.markAllRead') }}
          </button>
        </div>
      </Transition>
    </template>

    <!-- List ⇄ detail slide as one "drawer push": detail enters from the right
         as the list slides left (forward), and reverses on back. `out-in` keeps a
         single view in normal flow at a time, so the detail's full-height breakout
         layout is preserved. -->
    <Transition :name="navName" mode="out-in">
      <div :key="store.view" class="nd-view h-full">
        <!-- Detail view -->
        <NotificationDetail
          v-if="store.view === 'detail' && store.selected"
          :notification="store.selected"
        />

        <!-- List view -->
        <template v-else>
          <!-- Empty state -->
          <div
            v-if="isEmpty"
            class="flex flex-col items-center justify-center gap-3 py-16 text-center"
          >
            <img
              src="/brand/beanies_celebrating_circle_transparent_300x300.png"
              alt=""
              class="h-20 w-20 opacity-90"
            />
            <p class="font-outfit text-secondary-500 text-base font-semibold dark:text-gray-200">
              {{ t('notifications.empty') }}
            </p>
            <p class="text-secondary-500/55 max-w-[16rem] text-sm dark:text-gray-400">
              {{ t('notifications.emptyHint') }}
            </p>
          </div>

          <!-- Grouped list -->
          <div v-else class="-mx-2 space-y-4">
            <div v-for="group in groups" :key="group.day">
              <div
                class="font-outfit text-secondary-500/40 mb-1 px-3 text-[0.6875rem] font-bold tracking-[0.08em] uppercase dark:text-gray-500"
              >
                {{ group.label }}
              </div>
              <template v-for="n in group.items" :key="n.id">
                <!-- spotlight what's-new → gift card; announcement → letter card;
                     everything else (incl. orphan whats-new / announcement) → a row -->
                <WhatsNewGiftCard
                  v-if="isCelebratoryWhatsNew(n)"
                  :notification="n"
                  @select="store.openTo($event)"
                  @toggle-read="onToggleRead"
                />
                <AnnouncementCard
                  v-else-if="isAnnouncementCard(n)"
                  :notification="n"
                  @select="store.openTo($event)"
                  @toggle-read="onToggleRead"
                />
                <NotificationRow
                  v-else
                  :notification="n"
                  @select="store.openTo($event)"
                  @toggle-read="onToggleRead"
                />
              </template>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </BaseSidePanel>
</template>

<style scoped>
.nd-view {
  /* The detail breaks out of the panel's padding; keep that the slide unit. */
  will-change: transform, opacity;
}

/* Body: directional "push" (iOS-style). Enter is a touch longer + eases out so
   the arriving view feels like it settles; leave is quick + eases in. */
.nav-forward-enter-active,
.nav-back-enter-active {
  transition:
    transform 0.24s ease-out,
    opacity 0.22s ease-out;
}

.nav-forward-leave-active,
.nav-back-leave-active {
  transition:
    transform 0.16s ease-in,
    opacity 0.16s ease-in;
}

/* forward: detail arrives from the right, list departs to the left */
.nav-forward-enter-from {
  opacity: 0;
  transform: translateX(1.75rem);
}

.nav-forward-leave-to {
  opacity: 0;
  transform: translateX(-1.25rem);
}

/* back: list arrives from the left, detail departs to the right */
.nav-back-enter-from {
  opacity: 0;
  transform: translateX(-1.75rem);
}

.nav-back-leave-to {
  opacity: 0;
  transform: translateX(1.25rem);
}

/* Header: gentle cross-fade, in step with the body slide. */
.nd-fade-enter-active {
  transition: opacity 0.18s ease-out;
}

.nd-fade-leave-active {
  transition: opacity 0.12s ease-in;
}

.nd-fade-enter-from,
.nd-fade-leave-to {
  opacity: 0;
}

/* Respect reduced-motion: keep a quick fade, drop the slide. */
@media (prefers-reduced-motion: reduce) {
  .nav-forward-enter-active,
  .nav-back-enter-active,
  .nav-forward-leave-active,
  .nav-back-leave-active {
    transition: opacity 0.12s linear;
  }

  .nav-forward-enter-from,
  .nav-forward-leave-to,
  .nav-back-enter-from,
  .nav-back-leave-to {
    transform: none;
  }
}
</style>
