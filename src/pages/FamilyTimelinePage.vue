<script setup lang="ts">
/**
 * Family Milestones — `/pod/milestones`. Cross-family chronological
 * view rendered as a real timeline: vertical rail down the left,
 * milestone cards flowing right, year markers breaking the rail.
 * Order is ASCENDING (oldest first) — a family timeline is a memory
 * artifact, you read it forward through time.
 *
 * Filter chrome was removed in v2 (2026-05-07). If a future scoping
 * feature is needed, add a dedicated search surface rather than
 * restoring page-level chips.
 *
 * Photo-as-thumbnail rule: when a milestone has photos, the rail
 * thumbnail shows the first photo. Falls back to the category emoji
 * when no photo exists, so the timeline reads like a real family
 * photo album rather than a category index.
 *
 * Add button + FAB → milestone flow both arrive here. The page hosts
 * a `<MilestoneFormModal>` directly so the picker commit lands in an
 * open drawer in-place — no second navigation to a bean's pod tab.
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MilestoneFormModal from '@/components/pod/MilestoneFormModal.vue';
import MilestoneThumb from '@/components/pod/MilestoneThumb.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { usePermissions } from '@/composables/usePermissions';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyTimeline } from '@/composables/useFamilyTimeline';
import { formatDateShort } from '@/utils/date';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember, Milestone, UUID } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const familyStore = useFamilyStore();
const lightbox = useMilestoneLightbox();

const { yearBuckets, isEmpty } = useFamilyTimeline();

// --- Add-milestone form modal hosted on this page --------------------
//
// Modal stays mounted at all times. `useFormModal`'s watcher needs a
// false→true transition on `:open` to run `onNew`; mounting on demand
// (via v-if) skips that transition because the component is born with
// `:open=true` already. Always-mounted is the canonical pattern across
// other form modals in the codebase.
const formOpen = ref(false);
const formMemberId = ref<UUID | null>(null);

useQuickAddIntent((action, { memberId }) => {
  if (action !== 'add-milestone' || !canEditActivities.value) return;
  // Picker should always commit a memberId before navigating here. If
  // it didn't (e.g. single-member family path), pass null so the form
  // opens with no pre-selection rather than misleadingly pre-filling.
  formMemberId.value = memberId ?? null;
  formOpen.value = true;
});

function closeForm(): void {
  formOpen.value = false;
}

function openAdd(): void {
  // No bean pre-selected for in-page adds — the chip rail starts empty
  // and the user picks intentionally inside the form (matches the
  // pattern of category pickers in transactions / activities).
  if (!canEditActivities.value) return;
  formMemberId.value = null;
  formOpen.value = true;
}

// --- Card display helpers --------------------------------------------
//
// Photo thumbnail + emoji fallback + multi-photo badge live in the
// shared `<MilestoneThumb>` component. Lightbox state lives in the
// shared `useMilestoneLightbox()` composable. Both reused by
// BeanMilestonesTab.

// Track dangling-bean reports so we don't spam Slack on every reactive
// recompute. Cleared on store reset implicitly when the page unmounts.
const reportedDanglingBeans = new Set<string>();

function memberFor(id: UUID | null): FamilyMember | null {
  if (id === null) return null;
  const member = familyStore.members.find((m) => m.id === id) ?? null;
  if (!member && !reportedDanglingBeans.has(id)) {
    reportedDanglingBeans.add(id);
    console.warn('[FamilyTimelinePage] milestone references deleted bean:', id);
    reportError({
      surface: 'familyTimeline',
      message: 'milestone references deleted bean',
      context: { memberId: id },
    });
  }
  return member;
}

function memberLabel(m: Milestone): {
  kind: 'family' | 'bean' | 'unknown';
  member: FamilyMember | null;
} {
  if (m.memberId === null) return { kind: 'family', member: null };
  const member = memberFor(m.memberId);
  return member ? { kind: 'bean', member } : { kind: 'unknown', member: null };
}

function openMilestone(m: Milestone): void {
  // Family-wide stays on the timeline (no per-bean tab to edit on).
  // Per-bean milestones route to the owning bean's tab.
  if (m.memberId === null) return;
  router.push(`/pod/${m.memberId}/milestones`);
}
</script>

<template>
  <div class="space-y-6">
    <header
      class="relative mb-5 overflow-hidden rounded-[var(--sq)] px-5 py-5 sm:px-8 sm:py-7"
      style="background: linear-gradient(135deg, #fff7c8 0%, #ffe4d6 50%, #d4f1f4 100%)"
    >
      <span
        class="pointer-events-none absolute top-3 right-7 text-[8.125rem] opacity-10"
        style="transform: rotate(-8deg)"
        aria-hidden="true"
      >
        🌟
      </span>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <button
            type="button"
            class="font-outfit text-secondary-500/60 hover:text-primary-500 dark:text-ink-soft mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
            @click="router.push('/pod')"
          >
            <BeanieIcon name="chevron-left" size="xs" />
            <span>{{ t('bean.backToPod') }}</span>
          </button>
          <h1
            class="font-outfit text-secondary-500 dark:text-ink text-2xl leading-tight font-extrabold break-words sm:text-3xl sm:leading-none"
          >
            {{ t('milestones.pageTitle') }}
          </h1>
          <p class="font-caveat mt-1 text-xl text-[#E67E22]">
            {{ t('milestones.pageSubtitle') }}
          </p>
        </div>
        <button
          type="button"
          class="font-outfit bg-primary-500 hover:bg-primary-600 inline-flex flex-shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
          :aria-label="t('milestones.add')"
          @click="openAdd"
        >
          <BeanieIcon name="plus" size="xs" />
          <span class="hidden sm:inline">{{ t('milestones.add') }}</span>
        </button>
      </div>
    </header>

    <!-- Timeline rail -->
    <div v-if="!isEmpty" class="timeline-root relative pb-6 pl-2">
      <!-- The rail itself: a soft Heritage-Orange-tinted vertical thread
           running the full height of the timeline. Sits behind year
           markers + thumbnails (which "pin" onto it). -->
      <div
        class="timeline-rail pointer-events-none absolute top-0 bottom-0 left-[1.875rem] w-[3px] rounded-full sm:left-[2.625rem]"
        aria-hidden="true"
      />

      <ol class="relative space-y-10">
        <li
          v-for="(bucket, bucketIdx) in yearBuckets"
          :key="bucket.year"
          class="relative"
          :style="{ '--stagger': bucketIdx * 60 + 'ms' }"
        >
          <!-- Year tag — handwritten Caveat, slightly tilted, small
               shadow. "Hangs" on the rail with a small tape-edge feel. -->
          <div
            class="timeline-year dark:bg-surface-overlay relative mb-4 inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1 shadow-[0_2px_6px_rgba(241,93,34,0.12)]"
          >
            <span class="font-caveat text-3xl leading-none text-[#E67E22]">{{ bucket.year }}</span>
          </div>

          <ol class="relative space-y-5">
            <li
              v-for="(m, mIdx) in bucket.milestones"
              :key="m.id"
              class="timeline-card-row relative pl-[4.5rem] sm:pl-[6rem]"
              :style="{ '--row-stagger': bucketIdx * 60 + mIdx * 40 + 'ms' }"
            >
              <!-- Thumbnail "pinned" to the rail. Component handles
                   photo lookup, emoji fallback, multi-photo badge, and
                   the click-to-lightbox affordance. The wrapper class
                   here positions it absolutely on the rail and adds an
                   outline ring (the "pinned-to-thread" effect). -->
              <MilestoneThumb
                :milestone="m"
                size="sm"
                class="timeline-thumb absolute top-1 left-[0.625rem] sm:left-[1.375rem]"
                @open-lightbox="lightbox.openFor(m)"
              />

              <!-- Card -->
              <button
                type="button"
                :disabled="m.memberId === null"
                class="timeline-card dark:bg-surface-raised relative block w-full rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-transform"
                :class="m.memberId === null ? 'cursor-default' : 'hover:scale-[1.01]'"
                @click="openMilestone(m)"
              >
                <p
                  class="font-outfit text-primary-600 dark:text-accent-lift text-[0.625rem] font-semibold tracking-wide uppercase"
                >
                  {{ formatDateShort(m.occurredOn) }}
                </p>
                <h3
                  class="font-outfit text-secondary-500 dark:text-ink mt-0.5 text-sm leading-tight font-bold sm:text-base"
                >
                  {{ m.title }}
                </h3>
                <div class="mt-1.5 flex items-center gap-2">
                  <template v-if="memberLabel(m).kind === 'family'">
                    <span class="text-base leading-none" aria-hidden="true">🏡</span>
                    <span
                      class="font-outfit text-secondary-500/70 dark:text-ink-soft text-[0.6875rem] font-semibold"
                    >
                      {{ t('milestone.familyPill') }}
                    </span>
                  </template>
                  <template v-else-if="memberLabel(m).kind === 'bean'">
                    <span
                      class="inline-block h-3 w-3 flex-shrink-0 rounded-md"
                      :style="{ backgroundColor: memberLabel(m).member!.color }"
                      aria-hidden="true"
                    />
                    <span
                      class="font-outfit text-secondary-500/70 dark:text-ink-soft truncate text-[0.6875rem] font-semibold"
                    >
                      {{ memberLabel(m).member!.name }}
                    </span>
                  </template>
                  <template v-else>
                    <span
                      class="font-outfit text-secondary-500/60 dark:text-ink-faint text-[0.6875rem] font-semibold italic"
                    >
                      {{ t('milestone.unknownBean') }}
                    </span>
                  </template>
                </div>
                <p
                  v-if="m.description"
                  class="font-inter text-secondary-500/80 dark:text-ink-soft mt-2 line-clamp-2 text-xs leading-snug"
                >
                  {{ m.description }}
                </p>
              </button>
            </li>
          </ol>
        </li>
      </ol>
    </div>

    <!-- Empty -->
    <div
      v-else
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)]"
    >
      <EmptyState
        emoji="🌟"
        :message="t('milestones.empty')"
        :action-label="t('milestones.emptyHint')"
        @action="openAdd"
      />
    </div>

    <!-- In-place add/edit form — always mounted (see comments in
         the script block on why v-if would break onNew). -->
    <MilestoneFormModal
      :open="formOpen"
      :member-id="formMemberId"
      :milestone="null"
      @close="closeForm"
    />

    <!-- Read-only lightbox for milestone photos. Shared
         `useMilestoneLightbox` composable owns the state. -->
    <PhotoViewer
      :open="lightbox.isOpen.value"
      :photo-ids="lightbox.photoIds.value"
      :initial-index="0"
      read-only
      @close="lightbox.close"
    />
  </div>
</template>

<style scoped>
/* The vertical rail — a soft warm gradient on the brand orange so it
   reads as a "thread" rather than a corporate divider line. Subtle
   alpha at the top + bottom feathers it into the page edges. */
.timeline-rail {
  background: linear-gradient(
    to bottom,
    rgb(241 93 34 / 0%) 0%,
    rgb(241 93 34 / 18%) 8%,
    rgb(241 93 34 / 32%) 50%,
    rgb(241 93 34 / 18%) 92%,
    rgb(241 93 34 / 0%) 100%
  );
}

/* Year tag — a touch of paper feel, slight tilt. The before pseudo
   gives a small "tape" knot peeking from the top-left. */
.timeline-year {
  transform: rotate(-1.5deg);
  transform-origin: left center;
}

.timeline-year::before {
  background: rgb(241 93 34 / 18%);
  border-radius: 2px;
  content: '';
  height: 8px;
  left: 8px;
  position: absolute;
  top: -4px;
  transform: rotate(-8deg);
  width: 14px;
}

/* Thumbnail "pin" effect — the photo sits on the rail with a tiny
   ring around it that suggests it's stuck to the thread. */
.timeline-thumb {
  outline: 3px solid var(--color-background);
}

html.dark .timeline-thumb {
  outline-color: var(--color-background, #151e27);
}

/* Connecting nub between thumbnail and card — short horizontal line
   that visually links the two. Mobile width is tighter so the nub is
   shorter on small screens. */
.timeline-card-row::before {
  background: rgb(241 93 34 / 32%);
  border-radius: 1px;
  content: '';
  height: 2px;
  left: 3.5rem;
  position: absolute;
  top: 1.875rem;
  width: 1rem;
}

@media (width >= 640px) {
  .timeline-card-row::before {
    left: 4.875rem;
    width: 1.125rem;
  }
}

/* Page-load stagger — each row fades + slides in slightly behind its
   year header. Single animation, no IntersectionObserver: the list is
   short enough that animating it once is fine. */
@keyframes timeline-row-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.timeline-card-row {
  animation: timeline-row-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: var(--row-stagger, 0ms);
}

@media (prefers-reduced-motion: reduce) {
  .timeline-card-row {
    animation: none;
  }
}
</style>
