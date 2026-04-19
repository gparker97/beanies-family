<script setup lang="ts">
/**
 * Top banner for a single bean's detail page. Large avatar on the left,
 * name + role + birthday on the right, plus two action buttons on the
 * far right: ✏️ Edit (opens the admin drawer) and ＋ Add Something
 * (dropdown menu of all five per-bean content types).
 *
 * The Add menu navigates to `/pod/:memberId/<type>?add=1` — each tab
 * component reads the query param on mount and auto-opens its form
 * modal, keeping the add flow co-located with the tab that owns it.
 */
import { computed, ref, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import type { AgeGroup, FamilyMember, Gender } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
  /** Hide the edit + add affordances when the viewer can't manage the pod. */
  canManage?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
}>();

const router = useRouter();
const { t } = useTranslation();

const variant = computed(() =>
  getMemberAvatarVariant({
    gender: props.member.gender as Gender | undefined,
    ageGroup: props.member.ageGroup as AgeGroup | undefined,
    isPet: props.member.isPet,
  })
);

const { url: photoUrl, refresh: refreshAvatar } = useAvatarPhotoUrl(
  () => props.member.avatarPhotoId
);

const ageLabel = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob?.year) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.year;
  const beforeBirthday =
    today.getMonth() + 1 < dob.month ||
    (today.getMonth() + 1 === dob.month && today.getDate() < dob.day);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
});

const birthdayLabel = computed(() => {
  const dob = props.member.dateOfBirth;
  if (!dob) return null;
  const month = String(dob.month).padStart(2, '0');
  const day = String(dob.day).padStart(2, '0');
  return dob.year ? `${dob.year}-${month}-${day}` : `${month}-${day}`;
});

const roleLabel = computed(() =>
  props.member.ageGroup === 'child' ? t('bean.hero.role.child') : t('bean.hero.role.parent')
);

// --- Add Something dropdown -------------------------------------------

const addMenuOpen = ref(false);

type AddType = 'favorites' | 'sayings' | 'notes' | 'allergies' | 'medications';

const addOptions = computed(() => [
  { type: 'favorites' as AddType, label: t('bean.hero.add.favorite') },
  { type: 'sayings' as AddType, label: t('bean.hero.add.saying') },
  { type: 'notes' as AddType, label: t('bean.hero.add.note') },
  { type: 'allergies' as AddType, label: t('bean.hero.add.allergy') },
  { type: 'medications' as AddType, label: t('bean.hero.add.medication') },
]);

function toggleAddMenu(): void {
  addMenuOpen.value = !addMenuOpen.value;
}

function closeAddMenu(): void {
  addMenuOpen.value = false;
}

function addFor(type: AddType): void {
  closeAddMenu();
  router.push(`/pod/${props.member.id}/${type}?add=1`);
}

// Outside-click + Escape to close the menu. Listeners only attach while
// the menu is open, and we clean up on unmount so the component can be
// safely re-mounted (e.g. switching bean detail pages via the route).
function onDocClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('[data-add-menu-root]')) closeAddMenu();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeAddMenu();
}
function attachListeners(): void {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
}
function detachListeners(): void {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
}
onBeforeUnmount(detachListeners);

// Re-attach on every toggle-on; detach on toggle-off. Simpler than
// tracking state with a watcher.
function onAddButtonClick(): void {
  if (addMenuOpen.value) {
    closeAddMenu();
    detachListeners();
  } else {
    toggleAddMenu();
    // Defer so the click that opened the menu doesn't immediately
    // register as an outside-click on the same tick.
    setTimeout(attachListeners, 0);
  }
}
</script>

<template>
  <header
    class="mb-6 flex flex-wrap items-center gap-4 rounded-[var(--sq)] bg-gradient-to-br from-[rgba(174,214,241,0.35)] to-[rgba(241,93,34,0.08)] px-4 py-5 sm:gap-6 sm:px-8 sm:py-7"
  >
    <BeanieAvatar
      :variant="variant"
      :color="member.color"
      :photo-url="photoUrl"
      size="xl"
      class="flex-shrink-0"
      :aria-label="member.name"
      @photo-error="refreshAvatar"
    />
    <div class="min-w-0 flex-1">
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('bean.backToPod') }}</span>
      </button>
      <h1
        class="font-outfit text-secondary-500 text-2xl leading-tight font-bold break-words sm:text-3xl dark:text-gray-100"
      >
        {{ member.name }}
      </h1>
      <div class="text-secondary-500/70 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span>{{ roleLabel }}</span>
        <span v-if="birthdayLabel" aria-hidden="true" class="opacity-40">·</span>
        <span v-if="birthdayLabel">
          {{ t('bean.hero.birthday') }}: {{ birthdayLabel }}
          <span v-if="ageLabel !== null"> ({{ ageLabel }} {{ t('bean.stats.age') }})</span>
        </span>
      </div>
    </div>

    <div v-if="canManage" class="flex w-full flex-shrink-0 items-center gap-2 sm:w-auto">
      <button
        type="button"
        class="font-outfit text-secondary-500 inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/70 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-white/90 sm:flex-initial dark:bg-slate-800/80 dark:text-gray-100 dark:hover:bg-slate-800"
        @click="emit('edit')"
      >
        <BeanieIcon name="edit" size="xs" />
        <span>{{ t('bean.hero.edit') }}</span>
      </button>

      <div class="relative flex-1 sm:flex-initial" data-add-menu-root>
        <button
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
          :aria-expanded="addMenuOpen"
          aria-haspopup="menu"
          @click="onAddButtonClick"
        >
          <span aria-hidden="true">＋</span>
          <span>{{ t('bean.hero.addSomething') }}</span>
        </button>
        <div
          v-if="addMenuOpen"
          class="absolute top-full right-0 z-10 mt-2 w-48 overflow-hidden rounded-2xl bg-white shadow-[var(--soft-shadow)] dark:bg-slate-800"
          role="menu"
        >
          <button
            v-for="opt in addOptions"
            :key="opt.type"
            type="button"
            role="menuitem"
            class="font-outfit text-secondary-500 hover:text-primary-500 block w-full px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[var(--tint-orange-4)] dark:text-gray-100 dark:hover:bg-slate-700"
            @click="addFor(opt.type)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
