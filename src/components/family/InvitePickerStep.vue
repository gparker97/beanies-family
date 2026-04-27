<script setup lang="ts">
/**
 * InvitePickerStep — Step 0 of the invite wizard. Lists every human
 * family member as a tappable row so the user can pick who to invite
 * before landing on the email-confirm step. Already-joined members
 * (requiresPassword === false) and the pod owner are dimmed and
 * unselectable, with a status chip explaining why. The end-of-list
 * "+ add a new beanie" tile delegates to the parent (which closes
 * the wizard, opens FamilyMemberModal, then reopens with the new
 * member preselected).
 *
 * Pure presentational. No store calls; consumes pre-filtered members
 * via prop. Reuses BeanieAvatar + getMemberAvatarVariant +
 * getMemberAvatarUrl (the same trio QuickAddMemberPicker uses).
 *
 * Layout note: stacked list (not grid) — invite picker shows extra
 * per-row context (role, age, email status) that needs horizontal
 * room. QuickAddMemberPicker uses a 3-col grid because it shows only
 * avatar + name in a tighter sheet. Different shape, different SFC.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl } from '@/composables/useMemberInfo';
import { isUnshareableEmail } from '@/utils/email';
import type { FamilyMember } from '@/types/models';

interface Props {
  /** Sorted humans (pets pre-filtered). Owner is included; component dims it. */
  members: FamilyMember[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [memberId: string];
  'add-bean': [];
}>();

const { t } = useTranslation();

interface Tile {
  member: FamilyMember;
  /** 'owner' / 'joined' / null (selectable). */
  state: 'owner' | 'joined' | null;
  /** Public email shown inline; '' when missing or unshareable. */
  displayEmail: string;
}

const tiles = computed<Tile[]>(() =>
  props.members.map((m) => {
    const state: Tile['state'] =
      m.role === 'owner' ? 'owner' : m.requiresPassword === false ? 'joined' : null;
    const realEmail = m.email && !isUnshareableEmail(m.email) ? m.email : '';
    return { member: m, state, displayEmail: realEmail };
  })
);

const isEmpty = computed(() => tiles.value.every((t) => t.state !== null));

function ageOf(m: FamilyMember): number | null {
  const dob = m.dateOfBirth;
  if (!dob?.year) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.year;
  const before =
    now.getMonth() + 1 < dob.month || (now.getMonth() + 1 === dob.month && now.getDate() < dob.day);
  if (before) age -= 1;
  return age >= 0 ? age : null;
}

function roleLabel(m: FamilyMember): string {
  if (m.role === 'owner') return t('bean.hero.role.parent');
  return m.ageGroup === 'child' ? t('bean.hero.role.child') : t('bean.hero.role.parent');
}

function handleSelect(tile: Tile): void {
  if (tile.state !== null) return;
  emit('select', tile.member.id);
}
</script>

<template>
  <div data-testid="invite-wizard-step-0" class="space-y-3">
    <ul class="space-y-2.5" role="list">
      <li v-for="tile in tiles" :key="tile.member.id">
        <button
          type="button"
          :data-testid="`invite-picker-tile-${tile.member.id}`"
          :data-state="tile.state ?? 'selectable'"
          :disabled="tile.state !== null"
          class="member-tile group flex w-full items-center gap-3.5 rounded-2xl border-2 border-gray-200 bg-white px-3 py-3 text-left transition-all dark:border-slate-700 dark:bg-slate-800"
          :class="
            tile.state === 'owner'
              ? 'is-owner cursor-not-allowed opacity-80'
              : tile.state === 'joined'
                ? 'is-joined cursor-not-allowed opacity-65'
                : 'cursor-pointer hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--tint-orange-8)] hover:shadow-[var(--color-primary)]/15 hover:shadow-md'
          "
          @click="handleSelect(tile)"
        >
          <BeanieAvatar
            :variant="
              getMemberAvatarVariant({
                gender: tile.member.gender,
                ageGroup: tile.member.ageGroup,
                isPet: tile.member.isPet,
              })
            "
            :color="tile.member.color"
            size="md"
            :photo-url="getMemberAvatarUrl(tile.member) ?? undefined"
            :aria-label="tile.member.name"
            class="flex-shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div
              class="font-outfit text-secondary-500 truncate text-[15px] font-bold dark:text-gray-100"
            >
              {{ tile.member.name }}
            </div>
            <div
              class="font-inter text-secondary-500/60 mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs dark:text-gray-400"
            >
              <span>{{ roleLabel(tile.member) }}</span>
              <template v-if="ageOf(tile.member) !== null">
                <span aria-hidden="true">·</span>
                <span>age {{ ageOf(tile.member) }}</span>
              </template>
              <template v-if="tile.state === null">
                <span aria-hidden="true">·</span>
                <span class="truncate">
                  {{ tile.displayEmail || t('inviteWizard.picker.tileNoEmail') }}
                </span>
              </template>
            </div>
          </div>
          <span
            v-if="tile.state === 'owner'"
            class="font-outfit flex-shrink-0 rounded-full bg-[#E67E22]/15 px-2.5 py-1 text-[10.5px] font-semibold tracking-wide whitespace-nowrap text-[#B5591A]"
          >
            {{ t('inviteWizard.picker.statusOwner') }}
          </span>
          <span
            v-else-if="tile.state === 'joined'"
            class="font-outfit flex-shrink-0 rounded-full bg-[#AED6F1]/30 px-2.5 py-1 text-[10.5px] font-semibold tracking-wide whitespace-nowrap text-[#1E5A85]"
          >
            {{ t('inviteWizard.picker.statusJoined') }}
          </span>
          <span
            v-else
            class="font-outfit flex-shrink-0 text-xl text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
            aria-hidden="true"
          >
            <BeanieIcon name="chevron-right" size="sm" />
          </span>
        </button>
      </li>
    </ul>

    <button
      type="button"
      data-testid="invite-picker-add-bean"
      class="font-outfit flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-primary)]/40 bg-transparent px-4 py-3.5 text-sm font-semibold text-[var(--color-primary)] transition-all hover:-translate-y-0.5 hover:border-solid hover:bg-[var(--tint-orange-8)] hover:shadow-[var(--color-primary)]/15 hover:shadow-md"
      @click="emit('add-bean')"
    >
      <span class="text-lg leading-none font-normal" aria-hidden="true">+</span>
      <span>{{ t('inviteWizard.picker.addBean') }}</span>
    </button>

    <p
      v-if="isEmpty"
      class="font-inter text-center text-xs text-gray-400 italic dark:text-gray-500"
    >
      {{ t('inviteWizard.picker.empty') }}
    </p>
  </div>
</template>

<style scoped>
.member-tile:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.member-tile:not(:disabled):active {
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .member-tile {
    transition: none;
  }

  .member-tile:not(:disabled):hover {
    transform: none;
  }
}
</style>
