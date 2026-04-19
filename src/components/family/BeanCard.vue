<script setup lang="ts">
/**
 * Bean card — the member tile on the Meet the Beans grid, redesigned
 * to the Pod overview mockup. Pulls highlights directly from the
 * content stores so the card always reflects live data:
 *   - ⭐ Fave       → most recent favorite (name + category chip)
 *   - 💬 Latest    → most recent saying (Caveat quote)
 *   - ⚠️/💊/📝     → highest-priority heads-up item (severe allergy
 *                    → active med → latest note)
 *
 * Top edge has a thin brand-gradient stripe. Footer carries count
 * chips (faves / sayings / allergies / meds / notes) + a "View {name} →"
 * link-arrow. Click anywhere on the card to open the Bean Detail page.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import type {
  AgeGroup,
  AllergySeverity,
  FamilyMember,
  FavoriteCategory,
  Gender,
} from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
  canManage: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
  'share-invite': [];
  'role-change': [role: 'admin' | 'member'];
}>();

const { t } = useTranslation();
const router = useRouter();

const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();
const memberNotesStore = useMemberNotesStore();

function openDetail(): void {
  router.push(`/pod/${props.member.id}`);
}

const variant = computed(() =>
  getMemberAvatarVariant({
    gender: props.member.gender as Gender | undefined,
    ageGroup: props.member.ageGroup as AgeGroup | undefined,
  })
);

const { url: avatarPhotoUrl, refresh: refreshAvatar } = useAvatarPhotoUrl(
  () => props.member.avatarPhotoId
);

// --- Per-member data slices -------------------------------------------

const favorites = computed(() => favoritesStore.byMember(props.member.id).value);
const sayings = computed(() => sayingsStore.byMember(props.member.id).value);
const allergies = computed(() => allergiesStore.byMember(props.member.id).value);
const medications = computed(() => medicationsStore.byMember(props.member.id).value);
const notes = computed(() => memberNotesStore.byMember(props.member.id).value);

// Active-only medications (mirrors medicationsStore.active's logic).
const activeMedications = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return medications.value.filter((m) => {
    if (m.ongoing) return true;
    if (m.endDate && m.endDate < today) return false;
    if (m.startDate && m.startDate > today) return false;
    return true;
  });
});

// --- Highlight computation --------------------------------------------

const SEVERITY_RANK: Record<AllergySeverity, number> = { severe: 0, moderate: 1, mild: 2 };

const topFavorite = computed(() => {
  // Most recent favorite by createdAt. Cards lean toward "what they
  // love right now" over "what they loved first."
  return [...favorites.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
});

const topSaying = computed(() => {
  return [...sayings.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
});

const topAllergy = computed(() => {
  if (!allergies.value.length) return null;
  return [...allergies.value].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  )[0];
});

const topMedication = computed(() => activeMedications.value[0] ?? null);

const topNote = computed(() => {
  return [...notes.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
});

/**
 * Heads-up row: severe/moderate allergy → any allergy → active med →
 * latest note. Only one slot, picked by urgency. Mild allergies lose
 * to active meds since meds are something you DO today; allergies are
 * background safety info unless severe.
 */
interface HeadsUp {
  emoji: string;
  label: string;
  body: string;
  tone: 'danger' | 'success' | 'neutral';
}

const headsUp = computed<HeadsUp | null>(() => {
  const a = topAllergy.value;
  if (a && (a.severity === 'severe' || a.severity === 'moderate')) {
    const tail = a.emergencyResponse ?? a.reaction ?? '';
    return {
      emoji: '\u26A0\uFE0F',
      label: t('family.card.headsUp'),
      body: tail ? `${a.name} · ${tail}` : a.name,
      tone: 'danger',
    };
  }
  const m = topMedication.value;
  if (m) {
    return {
      emoji: '\u{1F48A}',
      label: t('family.card.care'),
      body: `${m.name} · ${m.dose} · ${m.frequency}`,
      tone: 'success',
    };
  }
  if (a) {
    return {
      emoji: '\u26A0\uFE0F',
      label: t('family.card.headsUp'),
      body: `${a.name} · ${t(`allergies.severity.${a.severity}`)}`,
      tone: 'neutral',
    };
  }
  const n = topNote.value;
  if (n) {
    return {
      emoji: '\u{1F4DD}',
      label: t('family.card.noteLabel'),
      body: n.title,
      tone: 'neutral',
    };
  }
  return null;
});

const FAV_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}',
  place: '\u{1F4CD}',
  book: '\u{1F4DA}',
  song: '\u{1F3B5}',
  toy: '\u{1F9F8}',
  other: '\u2728',
};

// --- Age + status copy -------------------------------------------------

const ageLabel = computed(() => {
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

const roleLabel = computed(() => {
  if (props.member.isPet) return t('family.role.pet');
  if (props.member.role === 'owner') return t('family.role.owner');
  return props.member.ageGroup === 'child' ? t('bean.hero.role.child') : t('bean.hero.role.parent');
});

// Severe-allergy count drives the danger chip tone in the footer.
const severeAllergyCount = computed(
  () => allergies.value.filter((a) => a.severity === 'severe').length
);
</script>

<template>
  <article
    class="group relative cursor-pointer overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    @click="openDetail"
  >
    <!-- Thin brand-gradient top stripe -->
    <span
      class="absolute top-0 right-0 left-0 h-1 opacity-60"
      style="
        background: linear-gradient(
          90deg,
          var(--color-secondary),
          #e67e22,
          var(--color-primary),
          #aed6f1
        );
      "
      aria-hidden="true"
    />

    <div class="flex flex-col gap-4 p-6">
      <!-- Top row: avatar + name/role + actions -->
      <div class="flex items-start gap-4">
        <BeanieAvatar
          :variant="variant"
          :color="member.color"
          :photo-url="avatarPhotoUrl"
          size="xl"
          class="flex-shrink-0"
          :aria-label="member.name"
          @photo-error="refreshAvatar"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <h3
                class="font-outfit text-secondary-500 truncate text-lg font-bold dark:text-gray-100"
              >
                {{ member.name }}
              </h3>
              <span @click.stop>
                <MemberRoleManager
                  :current-role="member.role"
                  :member-id="member.id"
                  :disabled="!canManage"
                  @change="emit('role-change', $event)"
                />
              </span>
            </div>
            <div class="flex flex-shrink-0 gap-1">
              <button
                v-if="canManage"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
                :title="t('action.edit')"
                @click.stop="emit('edit')"
              >
                <BeanieIcon name="edit" size="sm" />
              </button>
              <button
                v-if="member.requiresPassword && !member.isPet && canManage"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
                :title="t('family.copyInviteLinkHint')"
                @click.stop="emit('share-invite')"
              >
                <BeanieIcon name="share" size="sm" />
              </button>
              <button
                v-if="member.role !== 'owner' && canManage"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
                @click.stop="emit('delete')"
              >
                <BeanieIcon name="trash" size="sm" />
              </button>
            </div>
          </div>
          <div
            class="font-inter text-secondary-500/60 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs dark:text-gray-400"
          >
            <span
              class="font-outfit inline-flex items-center rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-secondary)] uppercase dark:bg-slate-700 dark:text-gray-300"
            >
              {{ roleLabel }}
            </span>
            <span v-if="ageLabel !== null">· age {{ ageLabel }}</span>
            <span
              v-if="member.requiresPassword && !member.isPet"
              class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              {{ t('family.status.waitingToJoin') }}
            </span>
          </div>
        </div>
      </div>

      <!-- Highlights — 3 structured rows -->
      <div
        v-if="topFavorite || topSaying || headsUp"
        class="flex flex-col gap-2.5 border-t border-[var(--tint-slate-5)] pt-3.5"
      >
        <!-- Fave -->
        <div
          v-if="topFavorite"
          class="grid items-baseline gap-2.5"
          style="grid-template-columns: 22px 1fr"
        >
          <span class="text-lg leading-none" aria-hidden="true">⭐</span>
          <div
            class="font-inter text-secondary-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug dark:text-gray-200"
          >
            <span
              class="font-outfit text-secondary-500/60 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80 dark:text-gray-400"
            >
              {{ t('family.card.fave') }}
            </span>
            <span class="truncate">{{ topFavorite.name }}</span>
            <span
              class="font-outfit inline-flex items-center gap-1 rounded-full bg-[rgb(230_126_34_/_12%)] px-2 py-0.5 text-[10px] font-semibold text-[#E67E22]"
            >
              {{ FAV_EMOJI[topFavorite.category] }}
              {{ t(`favorites.category.${topFavorite.category}`) }}
            </span>
          </div>
        </div>

        <!-- Latest saying -->
        <div
          v-if="topSaying"
          class="grid items-baseline gap-2.5"
          style="grid-template-columns: 22px 1fr"
        >
          <span class="text-lg leading-none" aria-hidden="true">💬</span>
          <div>
            <div
              class="font-outfit text-secondary-500/60 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80 dark:text-gray-400"
            >
              {{ t('family.card.latestSaying') }}
            </div>
            <p
              class="font-caveat text-secondary-500 mt-0.5 line-clamp-2 text-lg leading-tight dark:text-gray-200"
            >
              "{{ topSaying.words }}"
            </p>
          </div>
        </div>

        <!-- Heads-up / care / note -->
        <div
          v-if="headsUp"
          class="grid items-baseline gap-2.5"
          style="grid-template-columns: 22px 1fr"
        >
          <span class="text-lg leading-none" aria-hidden="true">{{ headsUp.emoji }}</span>
          <div
            class="font-inter text-sm leading-snug"
            :class="
              headsUp.tone === 'danger'
                ? 'text-[#c24a24] dark:text-orange-300'
                : headsUp.tone === 'success'
                  ? 'text-secondary-500 dark:text-gray-200'
                  : 'text-secondary-500/80 dark:text-gray-300'
            "
          >
            <span
              class="font-outfit mr-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80"
            >
              {{ headsUp.label }}
            </span>
            <span class="line-clamp-2">{{ headsUp.body }}</span>
          </div>
        </div>
      </div>

      <!-- Footer: count chips + "View {name} →" -->
      <footer
        class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--tint-slate-5)] pt-3.5"
      >
        <div class="flex flex-wrap gap-1.5">
          <span
            v-if="favorites.length"
            class="font-outfit inline-flex items-center rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-secondary)] dark:bg-slate-700 dark:text-gray-300"
          >
            {{ favorites.length }} {{ favorites.length === 1 ? 'fave' : 'faves' }}
          </span>
          <span
            v-if="sayings.length"
            class="font-outfit inline-flex items-center rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-secondary)] dark:bg-slate-700 dark:text-gray-300"
          >
            {{ sayings.length }} {{ sayings.length === 1 ? 'saying' : 'sayings' }}
          </span>
          <span
            v-if="allergies.length"
            class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            :class="
              severeAllergyCount > 0
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                : 'text-secondary-500 bg-[var(--tint-slate-5)] dark:bg-slate-700 dark:text-gray-300'
            "
          >
            {{ allergies.length }}
            {{ allergies.length === 1 ? t('family.card.allergy') : t('family.card.allergies') }}
          </span>
          <span
            v-if="activeMedications.length"
            class="font-outfit inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          >
            {{ activeMedications.length }}
            {{ activeMedications.length === 1 ? t('family.card.med') : t('family.card.meds') }}
          </span>
          <span
            v-if="notes.length"
            class="font-outfit inline-flex items-center rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-secondary)] dark:bg-slate-700 dark:text-gray-300"
          >
            {{ notes.length }} {{ notes.length === 1 ? 'note' : 'notes' }}
          </span>
        </div>
        <span
          class="font-outfit text-primary-500 group-hover:text-primary-700 inline-flex items-center gap-1 text-xs font-semibold"
        >
          {{ t('family.card.view').replace('{name}', member.name) }}
        </span>
      </footer>
    </div>
  </article>
</template>
