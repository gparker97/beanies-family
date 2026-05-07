<script setup lang="ts">
/**
 * Per-bean spread — magazine-style page for one family member.
 *
 * Sections are driven by a single config array (`SECTIONS` below),
 * so adding/retuning a section is one edit. Each section renders only
 * when ≥1 entry of that type exists for this bean, capped by `cap`,
 * with a "see all →" link deep-linking to the bean's pod tab.
 *
 * Optional polaroid hero from `avatarPhotoId` (degrades cleanly to
 * "no hero" when the photo can't be resolved).
 *
 * Shared lightbox singleton is wired at the page level — milestone
 * cards inside `<ScrapbookEntryCard>` open it directly.
 */
import { computed, ref, watch } from 'vue';
import ScrapbookEntryCard from '@/components/scrapbook/ScrapbookEntryCard.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import PolaroidImage from '@/components/pod/shared/PolaroidImage.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useScrapbookFeed } from '@/composables/useScrapbookFeed';
import { useFamilyStore } from '@/stores/familyStore';
import { usePhotoStore } from '@/stores/photoStore';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { FamilyMember, UUID } from '@/types/models';

interface SectionConfig {
  type: ScrapType;
  cap: number;
  kicker:
    | 'scrapbook.section.sayings'
    | 'scrapbook.section.favorites'
    | 'scrapbook.section.milestones'
    | 'scrapbook.section.notes';
  tab: 'sayings' | 'favorites' | 'milestones' | 'notes';
  /** Washi divider color cycled per section. */
  washiColor: string;
}

const SECTIONS: readonly SectionConfig[] = [
  {
    type: 'saying',
    cap: 4,
    kicker: 'scrapbook.section.sayings',
    tab: 'sayings',
    washiColor: 'rgb(255 247 200 / 70%)', // yellow
  },
  {
    type: 'favorite',
    cap: 6,
    kicker: 'scrapbook.section.favorites',
    tab: 'favorites',
    washiColor: 'rgb(255 228 214 / 70%)', // peach
  },
  {
    type: 'milestone',
    cap: 4,
    kicker: 'scrapbook.section.milestones',
    tab: 'milestones',
    washiColor: 'rgb(174 214 241 / 70%)', // sky silk
  },
  {
    type: 'note',
    cap: 3,
    kicker: 'scrapbook.section.notes',
    tab: 'notes',
    washiColor: 'rgb(232 245 232 / 70%)', // mint
  },
];

const props = defineProps<{
  memberId: UUID;
}>();

const emit = defineEmits<{
  'entry-click': [entry: ScrapbookEntry];
  'open-add': [];
}>();

const { t, isBeanieMode } = useTranslation();
const familyStore = useFamilyStore();
const photoStore = usePhotoStore();

const member = computed<FamilyMember | undefined>(() =>
  familyStore.members.find((m) => m.id === props.memberId)
);

// Hero polaroid URL — null if the bean has no avatar photo or the
// photo's public URL can't be resolved. The template `v-if`-gates on
// non-null so a missing hero cleanly hides instead of showing broken.
const heroPhotoUrl = computed<string | null>(() => {
  const m = member.value;
  if (!m?.avatarPhotoId) return null;
  return photoStore.getPublicUrl(m.avatarPhotoId, 'full');
});

// Bean-scoped feed. We pass this single member's id so the composable
// returns only their entries; we still want all four content types so
// pass an empty Set (treated as "all types" by the composable).
const memberIdsRef = ref<UUID[]>([props.memberId]);
const contentTypesRef = ref<Set<ScrapType>>(new Set());

watch(
  () => props.memberId,
  (id) => {
    memberIdsRef.value = [id];
  }
);

const { entries } = useScrapbookFeed({
  memberIds: memberIdsRef,
  contentTypes: contentTypesRef,
});

// Per-section sliced lists with caps applied. Computed once per
// `entries` change.
const sections = computed(() =>
  SECTIONS.map((section) => ({
    config: section,
    items: entries.value.filter((e) => e.type === section.type).slice(0, section.cap),
  }))
);

const isCompletelyEmpty = computed(() => sections.value.every((s) => s.items.length === 0));

/**
 * Bean's age in years from `dateOfBirth`. Returns null when:
 *  - DOB is missing entirely
 *  - DOB has no year (the {month, day, year?} model allows year omission)
 *  - The computed age would be negative (future-dated DOB)
 *
 * The pure helper makes the failure modes explicit; downstream
 * `formatBeanSubtitle` decides what fragments to show.
 */
function ageOf(m: FamilyMember | undefined): number | null {
  if (!m?.dateOfBirth) return null;
  const dob = m.dateOfBirth as { month: number; day: number; year?: number };
  if (typeof dob.year !== 'number') return null;
  const today = new Date();
  let age = today.getFullYear() - dob.year;
  const beforeBirthday =
    today.getMonth() + 1 < dob.month ||
    (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

function joinedYearOf(m: FamilyMember | undefined): number | null {
  if (!m?.createdAt) return null;
  const parsed = Date.parse(m.createdAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).getFullYear();
}

/**
 * Returns the subtitle for the bean header, defensive against partial
 * DOB / missing createdAt. Never throws; returns '' when nothing is
 * resolvable rather than a misleading "age undefined" string.
 */
function formatBeanSubtitle(m: FamilyMember | undefined): string {
  const age = ageOf(m);
  const joined = joinedYearOf(m);
  if (age !== null && joined !== null) {
    return t('scrapbook.bean.subtitle.both')
      .replace('{age}', String(age))
      .replace('{year}', String(joined));
  }
  if (age !== null) {
    return t('scrapbook.bean.subtitle.age').replace('{age}', String(age));
  }
  if (joined !== null) {
    return t('scrapbook.bean.subtitle.joined').replace('{year}', String(joined));
  }
  return '';
}

const subtitle = computed(() => formatBeanSubtitle(member.value));

const emptyMessage = computed(() =>
  t('scrapbook.bean.empty').replace('{name}', member.value?.name ?? '')
);

function onEntryClick(entry: ScrapbookEntry): void {
  emit('entry-click', entry);
}

function onOpenAdd(): void {
  emit('open-add');
}
</script>

<template>
  <section v-if="member" class="space-y-6">
    <!-- Header band — name in Caveat + color dot + optional subtitle +
         optional polaroid hero -->
    <header class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-3">
          <span
            class="inline-block h-5 w-5 flex-shrink-0 rounded-md"
            :style="{ backgroundColor: member.color }"
            aria-hidden="true"
          />
          <h2
            class="font-caveat text-secondary-500 text-4xl leading-tight font-bold sm:text-5xl dark:text-gray-100"
          >
            {{ isBeanieMode ? member.name.toLowerCase() : member.name }}
          </h2>
        </div>
        <p v-if="subtitle" class="font-caveat mt-1 text-xl text-[#E67E22]">
          {{ subtitle }}
        </p>
      </div>
      <div
        v-if="heroPhotoUrl"
        class="hidden flex-shrink-0 sm:block"
        style="transform: rotate(-3deg)"
      >
        <div class="w-32">
          <PolaroidImage :src="heroPhotoUrl" :caption="member.name" />
        </div>
      </div>
    </header>

    <div v-if="!isCompletelyEmpty" class="space-y-8">
      <template v-for="section in sections" :key="section.config.type">
        <div v-if="section.items.length > 0">
          <!-- Section header — kicker + see-all link -->
          <div class="mb-3 flex items-end justify-between">
            <h3
              class="font-outfit text-secondary-500 text-[11px] font-semibold tracking-[0.12em] uppercase dark:text-gray-300"
              style="
                border-bottom: 2px dashed var(--color-primary);
                display: inline-block;
                padding-bottom: 0.25rem;
              "
            >
              {{ t(section.config.kicker) }}
            </h3>
            <RouterLink
              :to="`/pod/${memberId}/${section.config.tab}`"
              class="font-caveat text-primary-500 hover:text-primary-600 text-lg dark:text-orange-300"
            >
              {{ t('scrapbook.seeAll') }}
            </RouterLink>
          </div>

          <!-- Section grid — 2 cols on mobile, 3 on desktop -->
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ScrapbookEntryCard
              v-for="(entry, idx) in section.items"
              :key="`${entry.type}-${entry.id}`"
              :entry="entry"
              :note-index="idx"
              @click="onEntryClick"
            />
          </div>

          <!-- Decorative washi divider between sections -->
          <div class="mt-6 flex justify-center">
            <span
              class="scrap-washi"
              :style="{ '--washi-color': section.config.washiColor }"
              aria-hidden="true"
            />
          </div>
        </div>
      </template>
    </div>

    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState emoji="📖" :message="emptyMessage" @action="onOpenAdd" />
    </div>
  </section>
</template>
