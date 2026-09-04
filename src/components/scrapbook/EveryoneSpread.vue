<script setup lang="ts">
/**
 * "Everyone" spread — the scrapbook's cover-and-first-spread.
 *
 * Designed to feel like the way a creative parent actually arranges a
 * family scrapbook page rather than a feed:
 *
 *   1. **Inscription header** — family name in Caveat with a small
 *      month/year stamp, like writing inside a journal. Hidden when
 *      no family name is set so we never lead with a vague header.
 *   2. **Hero block** — the single most recent moment is the focal
 *      point, rendered prominent. A few supporting items cluster
 *      beside it like the rest of a scrapbook page.
 *   3. **Per-bean corners** — each bean who has items gets a small
 *      cluster: their avatar polaroid + their 3 most recent items.
 *      Tapping the bean's name or polaroid pages into their full
 *      spread. Empty beans are skipped (a blank corner looks sad).
 *   4. **Family moments** — family-wide milestones (`memberId: null`)
 *      get their own footer block — they're not "anyone's corner."
 *
 * Decoration is restrained but present: per-id stable rotations on
 * cards, washi-tape dividers between sections, kraft-paper page
 * background (page-level), Caveat handwriting for headers and labels.
 */
import { computed, ref, watch } from 'vue';
import { stableFraction } from '@/utils/stableVariant';
import ScrapbookEntryCard from '@/components/scrapbook/ScrapbookEntryCard.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useScrapbookFeed } from '@/composables/useScrapbookFeed';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember, UUID } from '@/types/models';

const PER_BEAN_LIMIT = 4;
const FAMILY_WIDE_LIMIT = 4;
const SUPPORTING_HERO_LIMIT = 4;

const emit = defineEmits<{
  'entry-click': [entry: ScrapbookEntry];
  'open-add': [];
  /** Page-flip into a bean's full spread — used by the avatar polaroid + name link. */
  'select-bean': [id: UUID];
}>();

const { t, isBeanieMode } = useTranslation();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();

// Pull the entire family's feed — slicing happens locally per section.
const memberIdsRef = ref<UUID[]>([]);
const contentTypesRef = ref<Set<ScrapType>>(new Set());

watch(
  () => familyStore.members,
  (members) => {
    memberIdsRef.value = members.map((m) => m.id);
  },
  { immediate: true }
);

const { entries } = useScrapbookFeed({
  memberIds: memberIdsRef,
  contentTypes: contentTypesRef,
});

// --- Section computeds ------------------------------------------------

/**
 * Pick the front-cover focal point. Prefer a recent milestone WITH
 * photos so the cover leads with a visual moment (a photo dominates
 * any scrapbook front page). Falls back to the most recent entry of
 * any type when no recent item has photos.
 */
const heroEntry = computed<ScrapbookEntry | null>(() => {
  const photoMilestone = entries.value.find(
    (e) =>
      e.type === 'milestone' && ((e.payload as { photoIds?: unknown[] }).photoIds?.length ?? 0) > 0
  );
  return photoMilestone ?? entries.value[0] ?? null;
});

const heroHasPhoto = computed(() => {
  const h = heroEntry.value;
  if (!h || h.type !== 'milestone') return false;
  return ((h.payload as { photoIds?: unknown[] }).photoIds?.length ?? 0) > 0;
});

/**
 * Supporting items clustered around the hero. Excludes the hero
 * itself. Items can also appear later in their bean's per-bean
 * section — front-cover and personal-page roles serve different
 * scrapbook purposes.
 */
const supportingEntries = computed<ScrapbookEntry[]>(() => {
  const heroId = heroEntry.value?.id;
  return entries.value.filter((e) => e.id !== heroId).slice(0, SUPPORTING_HERO_LIMIT);
});

/**
 * Whether an entry has photos to emphasise. Used by the per-bean grid
 * to give photo-bearing milestones a 2-cell span (densely packed).
 */
function entryHasPhoto(entry: ScrapbookEntry): boolean {
  if (entry.type !== 'milestone') return false;
  const m = entry.payload as { photoIds?: unknown[] };
  return (m.photoIds?.length ?? 0) > 0;
}

interface BeanSection {
  bean: FamilyMember;
  items: ScrapbookEntry[];
}

// Includes pets — pets count as family members (per CLAUDE.md: "Pets
// count in the family roster and can have favorites, allergies, and
// medications") and their moments belong on the family scrapbook.
const beanSections = computed<BeanSection[]>(() =>
  familyStore.sortedMembers
    .map((bean) => ({
      bean,
      items: entries.value.filter((e) => e.memberId === bean.id).slice(0, PER_BEAN_LIMIT),
    }))
    .filter((section) => section.items.length > 0)
);

const familyWideEntries = computed<ScrapbookEntry[]>(() =>
  entries.value.filter((e) => e.memberId === null).slice(0, FAMILY_WIDE_LIMIT)
);

const isCompletelyEmpty = computed(() => entries.value.length === 0);

// --- Header inscription ------------------------------------------------
//
// Title is static ("Our family scrapbook") so it always reads as the
// book's title. The personalisation lives in the subtitle — the
// family's actual name (e.g. "Parker Meng Beanies"), shown below the
// title in smaller italic Caveat, lowercased in beanie mode.

const familyName = computed(() => familyContextStore.activeFamilyName);

const familyNameDisplay = computed(() => {
  const n = familyName.value;
  if (!n) return null;
  return isBeanieMode.value ? n.toLowerCase() : n;
});

// --- Stable rotations + bean polaroid helpers --------------------------

/**
 * Stable per-id rotation (–2.5° to +2.5°). Hash means rotations are
 * identical across re-renders and never reshuffle when new entries
 * arrive at the top of the feed.
 *
 * The hash itself lives in `stableVariant` (#86) — this file and
 * `ScrapbookSpine` had written the same loop byte-for-byte.
 */
function rotationFor(id: string, scale = 5): number {
  return stableFraction(id) * scale - scale / 2;
}

function nameFor(name: string): string {
  return isBeanieMode.value ? name.toLowerCase() : name;
}

function avatarVariantFor(bean: FamilyMember): AvatarVariant {
  return (bean.avatar as AvatarVariant | undefined) ?? 'adult-other';
}

function onEntryClick(entry: ScrapbookEntry): void {
  emit('entry-click', entry);
}

function onSelectBean(id: UUID): void {
  emit('select-bean', id);
}

function onOpenAdd(): void {
  emit('open-add');
}
</script>

<template>
  <section v-if="!isCompletelyEmpty" class="space-y-8">
    <!-- 1. Inscription header. Title is a static "Our family
         scrapbook" — the cover line. The personalisation lives below
         in the family-name subtitle (when set) — the cover plate.
         Italic, regular Caveat weight + a delicate Heritage-Orange
         flourish so it reads as the book's title without competing
         with section labels for visual weight. -->
    <header class="scrapbook-title">
      <h2
        class="font-caveat text-secondary-500 dark:text-ink inline-block text-3xl leading-tight font-medium sm:text-4xl"
        style="transform: rotate(-1deg)"
      >
        {{ t('scrapbook.everyone.title') }}
      </h2>
      <span class="title-flourish" aria-hidden="true" />
      <p
        v-if="familyNameDisplay"
        class="font-caveat mt-2 text-xl font-medium text-[#E67E22] italic sm:text-2xl"
      >
        {{ familyNameDisplay }}
      </p>
    </header>

    <!-- 2. Hero block — "Lately" cover spread. Hero is the most recent
         milestone-with-photos when one exists, otherwise the most
         recent item period. Photo-bearing hero gets the polaroid
         treatment via :emphasize-photo. Supporting cluster shows the
         next 4 most recent items, packed densely. -->
    <section v-if="heroEntry" class="lately-block">
      <h3 class="font-caveat text-secondary-500 dark:text-ink mb-3 text-3xl font-bold">
        {{ t('scrapbook.everyone.lately') }}
      </h3>
      <div class="lately-grid" :class="{ 'has-hero-photo': heroHasPhoto }">
        <div
          class="hero-card-wrapper"
          :style="{ transform: `rotate(${rotationFor(heroEntry.id, 3)}deg)` }"
        >
          <ScrapbookEntryCard
            :entry="heroEntry"
            :emphasize-photo="heroHasPhoto"
            @click="onEntryClick"
          />
        </div>
        <div
          v-for="entry in supportingEntries"
          :key="`hero-${entry.id}`"
          class="supporting-card"
          :class="{ 'span-photo': entryHasPhoto(entry) }"
          :style="{ transform: `rotate(${rotationFor(entry.id)}deg)` }"
        >
          <ScrapbookEntryCard
            :entry="entry"
            :emphasize-photo="entryHasPhoto(entry)"
            @click="onEntryClick"
          />
        </div>
      </div>
    </section>

    <div v-if="beanSections.length" class="flex justify-center">
      <span class="scrap-washi" aria-hidden="true" />
    </div>

    <!-- 3. Per-bean corners — each bean's avatar polaroid + their
         most recent items. The polaroid + name are tappable as a
         shortcut into their full spread. -->
    <div v-if="beanSections.length" class="space-y-7">
      <div v-for="section in beanSections" :key="section.bean.id" class="bean-section">
        <button
          type="button"
          class="bean-section-header"
          :aria-label="`Open ${section.bean.name}'s scrapbook page`"
          @click="onSelectBean(section.bean.id)"
        >
          <span
            class="inline-block h-3 w-3 flex-shrink-0 rounded-md"
            :style="{ backgroundColor: section.bean.color }"
            aria-hidden="true"
          />
          <span class="font-caveat text-secondary-500 dark:text-ink text-3xl font-bold">
            {{ nameFor(section.bean.name) }}
          </span>
          <span
            class="font-caveat text-primary-500 dark:text-accent-lift ml-auto text-sm hover:underline"
          >
            {{ t('scrapbook.seeAll') }}
          </span>
        </button>

        <div class="bean-strip-grid">
          <!-- Bean's avatar as the lead "polaroid" — tap also pages
               into their spread; same target as the section header. -->
          <button
            type="button"
            class="bean-polaroid"
            :aria-label="`Open ${section.bean.name}'s scrapbook page`"
            :style="{ transform: `rotate(${rotationFor(section.bean.id, 6)}deg)` }"
            @click="onSelectBean(section.bean.id)"
          >
            <BeanieAvatar
              :variant="avatarVariantFor(section.bean)"
              :color="section.bean.color"
              :photo-url="getMemberAvatarUrl(section.bean)"
              size="xl"
              :aria-label="section.bean.name"
              @photo-error="markMemberAvatarError(section.bean)"
            />
            <span class="font-caveat text-secondary-500 dark:text-ink mt-2 text-xl font-medium">
              {{ nameFor(section.bean.name) }}
            </span>
          </button>

          <div
            v-for="(entry, idx) in section.items"
            :key="`${section.bean.id}-${entry.id}`"
            class="bean-section-card"
            :class="{ 'span-photo': entryHasPhoto(entry) }"
            :style="{ transform: `rotate(${rotationFor(entry.id)}deg)` }"
          >
            <ScrapbookEntryCard
              :entry="entry"
              :note-index="idx"
              :emphasize-photo="entryHasPhoto(entry)"
              @click="onEntryClick"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-if="familyWideEntries.length" class="flex justify-center">
      <span class="scrap-washi" aria-hidden="true" />
    </div>

    <!-- 4. Family moments — family-wide milestones in their own footer
         block. Not "anyone's corner" — these belong to all the beans. -->
    <div v-if="familyWideEntries.length" class="family-moments">
      <h3
        class="font-caveat text-secondary-500 dark:text-ink mb-3 flex items-center gap-2 text-3xl font-bold"
      >
        <span aria-hidden="true">🏡</span>
        <span>{{ t('scrapbook.everyone.familyMoments') }}</span>
      </h3>
      <div class="bean-strip-grid">
        <div
          v-for="entry in familyWideEntries"
          :key="`fam-${entry.id}`"
          class="bean-section-card"
          :class="{ 'span-photo': entryHasPhoto(entry) }"
          :style="{ transform: `rotate(${rotationFor(entry.id)}deg)` }"
        >
          <ScrapbookEntryCard
            :entry="entry"
            :emphasize-photo="entryHasPhoto(entry)"
            @click="onEntryClick"
          />
        </div>
      </div>
    </div>
  </section>

  <!-- Truly empty — no items anywhere across the family. -->
  <div
    v-else
    class="dark:bg-surface-raised rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)]"
  >
    <EmptyState emoji="📖" :message="t('scrapbook.everyone.empty')" @action="onOpenAdd" />
  </div>
</template>

<style scoped>
/* ── Title inscription ─────────────────────────────────────────────── */
.scrapbook-title {
  position: relative;
  text-align: center;
}

/* Tiny decorative flourish underneath the title — three dotted-line
   strokes that read as a hand-drawn underline ornament. */
.title-flourish {
  background-image:
    radial-gradient(circle, var(--color-primary) 1px, transparent 1.5px),
    radial-gradient(circle, var(--color-primary) 1px, transparent 1.5px),
    radial-gradient(circle, var(--color-primary) 1px, transparent 1.5px);
  background-position:
    0 50%,
    50% 50%,
    100% 50%;
  background-repeat: no-repeat;
  background-size: 8px 4px;
  display: block;
  height: 4px;
  margin: 0.375rem auto 0;
  opacity: 0.55;
  width: 56px;
}

/* ── Lately block — front-cover focal point with dense packing ─────
 *
 * CSS Grid with `grid-auto-flow: dense` lets photo-bearing items
 * take 2-cell spans while text items take 1, packing efficiently so
 * more memories surface above the fold. The hero card always takes
 * its full row on mobile; on tablet+ it spans 2 cols when it has a
 * photo (visually anchoring the cover) and 1 otherwise. */
.lately-block {
  display: flex;
  flex-direction: column;
}

.lately-grid {
  display: grid;
  gap: 0.875rem;
  grid-auto-flow: dense;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (width >= 640px) {
  .lately-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width >= 1024px) {
  .lately-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.hero-card-wrapper {
  /* Hero with a photo gets a 2-cell span — the photo dominates the
     cover. Text-only hero stays at 1 cell so it doesn't feel padded. */
  grid-column: span 2;
  grid-row: span 2;
  position: relative;
  z-index: 1;
}

.lately-grid:not(.has-hero-photo) .hero-card-wrapper {
  /* Text-only hero — keep prominence via column span but drop the
     row span so it doesn't leave a giant whitespace below. */
  grid-row: auto;
}

@media (width < 640px) {
  /* Mobile: hero takes full width regardless of photo. */
  .hero-card-wrapper {
    grid-column: 1 / -1;
    grid-row: auto;
  }
}

/* Photo-bearing supporting cards span 2 cells and sit dense among the
   text items. */
.span-photo {
  grid-column: span 2;
  grid-row: span 2;
}

@media (width < 640px) {
  .span-photo {
    grid-column: 1 / -1;
    grid-row: auto;
  }
}

/* ── Per-bean section ──────────────────────────────────────────────── */
.bean-section {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.bean-section-header {
  align-items: baseline;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: flex;
  gap: 0.625rem;
  padding: 0.25rem 0;
  text-align: left;
  width: 100%;
}

.bean-section-header:focus-visible {
  border-radius: 0.5rem;
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
}

.bean-strip-grid {
  display: grid;
  gap: 0.875rem;
  grid-auto-flow: dense;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (width >= 640px) {
  .bean-strip-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width >= 1024px) {
  .bean-strip-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

/* Bean's avatar polaroid — white frame with the avatar inside, name
   handwritten below. Click takes you to their full spread. */
.bean-polaroid {
  align-items: center;
  background: #fffaf0;
  border: 0;
  border-radius: 0.75rem;
  box-shadow: 0 6px 18px rgb(44 62 80 / 14%);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.875rem 0.875rem 1.125rem;
  transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bean-polaroid:hover {
  transform: scale(1.04) !important;
  z-index: 2;
}

.bean-polaroid:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

:root.dark .bean-polaroid {
  background: rgb(255 250 240 / 8%);
  box-shadow: 0 6px 18px rgb(0 0 0 / 30%);
}

.bean-section-card {
  /* Each non-polaroid card sits at its hashed rotation — already
     applied via inline style. The wrapper exists so the rotation
     doesn't fight ScrapbookEntryCard's internal classes. */
}

@media (prefers-reduced-motion: reduce) {
  .hero-card-wrapper,
  .supporting-card,
  .bean-polaroid,
  .bean-section-card {
    transform: none !important;
    transition: none;
  }
}
</style>
