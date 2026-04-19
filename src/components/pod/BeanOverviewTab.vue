<script setup lang="ts">
/**
 * Bean Overview tab — redesigned to match the mockup:
 *
 *   [  About stats strip: Role · Birthday+age · Joined  ]
 *   [ Allergies (safety) ] [ Favorites ] [ Recent sayings ]
 *   [ Medications         ] [ Notes      ] [ (future: photos) ]
 *
 * Allergies leads the grid with a safety-tinted tone so the most
 * time-sensitive surface is where eyes land first. The About info
 * that used to live in a grid tile moved up into the stat strip —
 * the grid itself is reserved for action-oriented content.
 *
 * Per the page-composition rule, this tab imports the five content
 * stores directly; when any one module grows complex enough we
 * extract it to its own `Overview{Type}Module.vue`.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import OverviewModule from '@/components/pod/shared/OverviewModule.vue';
import BeanAboutStats, { type AboutStat } from '@/components/pod/BeanAboutStats.vue';
import DashItem from '@/components/pod/shared/DashItem.vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import type { DashItemTone } from '@/components/pod/shared/DashItem.vue';
import type { AllergySeverity, FamilyMember, FavoriteCategory } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
}>();

const router = useRouter();
const { t } = useTranslation();
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const memberNotesStore = useMemberNotesStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();

// --- About stats ------------------------------------------------------

const ageValue = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob?.year) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.year;
  const before =
    today.getMonth() + 1 < dob.month ||
    (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (before) age -= 1;
  return age >= 0 ? age : null;
});

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const birthdayLabel = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob) return null;
  const month = MONTH_NAMES[dob.month] ?? '';
  return `${month} ${dob.day}`;
});

const birthdaySub = computed(() => {
  if (ageValue.value === null) return undefined;
  return t('bean.about.ageOnly').replace('{age}', String(ageValue.value));
});

/** Relative "N days/weeks/months/years ago" from an ISO timestamp. */
function relativeFrom(iso?: string): string | undefined {
  if (!iso) return undefined;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return undefined;
  const days = Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)));
  if (days < 7) {
    return t(days === 1 ? 'bean.about.joinedAgo.day' : 'bean.about.joinedAgo.days').replace(
      '{n}',
      String(Math.max(days, 1))
    );
  }
  if (days < 35) {
    const weeks = Math.round(days / 7);
    return t(weeks === 1 ? 'bean.about.joinedAgo.week' : 'bean.about.joinedAgo.weeks').replace(
      '{n}',
      String(weeks)
    );
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return t(months === 1 ? 'bean.about.joinedAgo.month' : 'bean.about.joinedAgo.months').replace(
      '{n}',
      String(months)
    );
  }
  const years = Math.round(days / 365);
  return t(years === 1 ? 'bean.about.joinedAgo.year' : 'bean.about.joinedAgo.years').replace(
    '{n}',
    String(years)
  );
}

const joinedLabel = computed(() => {
  const iso = props.member.createdAt;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = MONTH_NAMES[d.getMonth() + 1] ?? '';
  return `${m} ${d.getFullYear()}`;
});

const aboutStats = computed<AboutStat[]>(() => {
  const out: AboutStat[] = [];
  out.push({
    label: t('bean.about.role'),
    value:
      props.member.ageGroup === 'child' ? t('bean.hero.role.child') : t('bean.hero.role.parent'),
  });
  if (birthdayLabel.value) {
    out.push({
      label: t('bean.about.birthday'),
      value: birthdayLabel.value,
      sub: birthdaySub.value,
    });
  }
  if (joinedLabel.value) {
    out.push({
      label: t('bean.about.joined'),
      value: joinedLabel.value,
      sub: relativeFrom(props.member.createdAt),
    });
  }
  return out;
});

// --- Dash modules data -------------------------------------------------

const favorites = computed(() => favoritesStore.byMember(props.member.id).value);
const sayings = computed(() => sayingsStore.byMember(props.member.id).value);
const notes = computed(() => memberNotesStore.byMember(props.member.id).value);
const allergies = computed(() => allergiesStore.byMember(props.member.id).value);
const medications = computed(() => medicationsStore.byMember(props.member.id).value);

const SEVERITY_ORDER: Record<AllergySeverity, number> = { severe: 0, moderate: 1, mild: 2 };

const sortedAllergies = computed(() =>
  [...allergies.value].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
);
const severeAllergyCount = computed(
  () => allergies.value.filter((a) => a.severity === 'severe').length
);
const allergyChip = computed(() =>
  severeAllergyCount.value > 0
    ? { label: `${severeAllergyCount.value} severe`, variant: 'danger' as const }
    : null
);

const activeMedicationCount = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return medications.value.filter((m) => {
    if (m.ongoing) return true;
    if (m.endDate && m.endDate < today) return false;
    if (m.startDate && m.startDate > today) return false;
    return true;
  }).length;
});
const medicationChip = computed(() =>
  activeMedicationCount.value > 0
    ? { label: `${activeMedicationCount.value} active`, variant: 'success' as const }
    : null
);

const FAVORITE_TONE: Record<FavoriteCategory, DashItemTone> = {
  food: 'fav',
  place: 'place',
  book: 'book',
  toy: 'toy',
  song: 'fav',
  other: 'note',
};
const FAVORITE_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}',
  place: '\u{1F4CD}',
  book: '\u{1F4DA}',
  song: '\u{1F3B5}',
  toy: '\u{1F9F8}',
  other: '\u2728',
};

function go(tab: string): void {
  router.push(`/pod/${props.member.id}/${tab}`);
}

const viewAllLabel = computed(() => t('bean.overview.viewAll'));
</script>

<template>
  <div>
    <BeanAboutStats :stats="aboutStats" />

    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <!-- Allergies — safety tile first -->
      <OverviewModule
        :title="t('bean.tab.allergies')"
        emoji="⚠️"
        tone="safety"
        :count="allergies.length"
        :header-chip="allergyChip"
        :view-all-label="allergies.length ? viewAllLabel : ''"
        @view-all="go('allergies')"
        @activate="go('allergies')"
      >
        <div v-if="sortedAllergies.length" class="flex flex-col gap-2">
          <DashItem
            v-for="a in sortedAllergies.slice(0, 3)"
            :key="a.id"
            emoji="⚠"
            :tone="a.severity === 'mild' ? 'allergy-mild' : 'allergy'"
            :title="a.name"
            :sub="a.reaction ?? a.avoidList ?? t(`allergies.severity.${a.severity}`)"
            @click="go('allergies')"
          />
        </div>
        <EmptyState v-else emoji="⚠️" :message="t('bean.overview.allergies.empty')" />
      </OverviewModule>

      <!-- Favorites -->
      <OverviewModule
        :title="t('bean.tab.favorites')"
        emoji="💝"
        :count="favorites.length"
        :view-all-label="favorites.length ? viewAllLabel : ''"
        @view-all="go('favorites')"
        @activate="go('favorites')"
      >
        <div v-if="favorites.length" class="flex flex-col gap-2">
          <DashItem
            v-for="f in favorites.slice(0, 3)"
            :key="f.id"
            :emoji="FAVORITE_EMOJI[f.category]"
            :tone="FAVORITE_TONE[f.category]"
            :title="f.name"
            :sub="f.description ?? t(`favorites.category.${f.category}`)"
            @click="go('favorites')"
          />
        </div>
        <EmptyState v-else emoji="💝" :message="t('bean.overview.favorites.empty')" />
      </OverviewModule>

      <!-- Recent sayings -->
      <OverviewModule
        :title="t('bean.tab.sayings')"
        emoji="💬"
        :count="sayings.length"
        :view-all-label="sayings.length ? viewAllLabel : ''"
        @view-all="go('sayings')"
        @activate="go('sayings')"
      >
        <div v-if="sayings.length" class="flex flex-col gap-2">
          <StickyNote
            v-for="(s, i) in sayings.slice(-2).reverse()"
            :key="s.id"
            :text="s.words"
            :index="i"
            :footer-text="s.saidOn ?? ''"
            size="sm"
          />
        </div>
        <EmptyState v-else emoji="💬" :message="t('bean.overview.sayings.empty')" />
      </OverviewModule>

      <!-- Medications -->
      <OverviewModule
        :title="t('bean.tab.medications')"
        emoji="💊"
        :count="medications.length"
        :header-chip="medicationChip"
        :view-all-label="medications.length ? viewAllLabel : ''"
        @view-all="go('medications')"
        @activate="go('medications')"
      >
        <div v-if="medications.length" class="flex flex-col gap-2">
          <DashItem
            v-for="m in medications.slice(0, 3)"
            :key="m.id"
            emoji="💊"
            tone="med"
            :title="m.name"
            :sub="`${m.dose} · ${m.frequency}`"
            @click="go('medications')"
          />
        </div>
        <EmptyState v-else emoji="💊" :message="t('bean.overview.medications.empty')" />
      </OverviewModule>

      <!-- Notes -->
      <OverviewModule
        :title="t('bean.tab.notes')"
        emoji="📝"
        :count="notes.length"
        :view-all-label="notes.length ? viewAllLabel : ''"
        @view-all="go('notes')"
        @activate="go('notes')"
      >
        <div v-if="notes.length" class="flex flex-col gap-2">
          <DashItem
            v-for="n in notes.slice(0, 3)"
            :key="n.id"
            emoji="📝"
            tone="note"
            :title="n.title"
            :sub="n.body"
            @click="go('notes')"
          />
        </div>
        <EmptyState v-else emoji="📝" :message="t('bean.overview.notes.empty')" />
      </OverviewModule>
    </div>
  </div>
</template>
