<script setup lang="ts">
/**
 * Add-family-members step for the create-a-family finish surface.
 *
 * Extracted verbatim from `CreatePodView`'s old step 3 so the members UI lives
 * in exactly ONE place. Rendered by `ResumePodSetup` (the single post-connect
 * finish surface) AFTER the pod is written, so every user — iPhone included —
 * gets the add-members step before landing in the app. A fully self-contained
 * leaf: it owns its member-form state and its own add-member error display +
 * `reportError`, and emits only `finish` when the user is done. No member-form
 * state leaks to the host.
 *
 * The owner card + added members read from `familyStore`; new members are
 * written straight into the in-memory Automerge doc via `familyStore.createMember`
 * (the pod already exists at this point), and persisted by the host's
 * `SetupProgressModal` sync after `finish`.
 */
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useCalendarSelectOptions } from '@/composables/useCalendarSelectOptions';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useFamilyStore } from '@/stores/familyStore';
import { MEMBER_COLOR_VALUES } from '@/constants/memberColors';
import { reportError } from '@/utils/errorReporter';
import { formatBirthdayShort } from '@/utils/date';
import type { FamilyMember, Gender, AgeGroup, DateOfBirth } from '@/types/models';

const emit = defineEmits<{ finish: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const addedMembers = ref<FamilyMember[]>([]);
const isAddingMember = ref(false);
const newMemberName = ref('');
const newMemberRole = ref<'parent' | 'child'>('parent');
const dobMonth = ref('');
const dobDay = ref('');
const dobYear = ref('');
const showMemberForm = ref(false);
const formError = ref<string | null>(null);

const { monthOptions, dayOptions } = useCalendarSelectOptions(31);

async function handleAddMember() {
  formError.value = null;

  if (!newMemberName.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  isAddingMember.value = true;

  const dateOfBirth: DateOfBirth | undefined =
    dobMonth.value && dobDay.value
      ? {
          month: parseInt(dobMonth.value, 10),
          day: parseInt(dobDay.value, 10),
          ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
        }
      : undefined;

  const memberInput = {
    name: newMemberName.value,
    email: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@setup.local`,
    gender: 'other' as Gender,
    ageGroup: (newMemberRole.value === 'child' ? 'child' : 'adult') as AgeGroup,
    role: 'member' as const,
    color: getNextColor(),
    requiresPassword: true,
    ...(dateOfBirth ? { dateOfBirth } : {}),
  };

  const member = await familyStore.createMember(memberInput);
  if (member) {
    addedMembers.value.push(member);
    newMemberName.value = '';
    newMemberRole.value = 'parent';
    dobMonth.value = '';
    dobDay.value = '';
    dobYear.value = '';
    showMemberForm.value = false; // Collapse after adding — user must explicitly add another
  } else {
    // No-silent-failures: CreatePodView's old path only toasted. Report it too
    // so a member-add that silently fails during onboarding is visible.
    formError.value = t('loginV6.addMemberFailed');
    reportError({
      surface: 'createMembers.addMember',
      message:
        'createMember returned null while adding a family member on the create-finish surface',
      severity: 'warning',
    });
  }
  isAddingMember.value = false;
}

async function handleRemoveMember(memberId: string) {
  formError.value = null;
  const ok = await familyStore.deleteMember(memberId);
  if (!ok) {
    // No-silent-failures: deleteMember returns false on failure. Keep the row so
    // the UI matches the pod, and report it (same discipline as the add path).
    formError.value = t('loginV6.removeMemberFailed');
    reportError({
      surface: 'createMembers.removeMember',
      message: `deleteMember returned false for member ${memberId} on the create-finish surface`,
      severity: 'warning',
    });
    return;
  }
  addedMembers.value = addedMembers.value.filter((m) => m.id !== memberId);
  // If all members removed, re-show the form
  if (addedMembers.value.length === 0) showMemberForm.value = true;
}

function openAddMemberForm(role: 'parent' | 'child') {
  newMemberRole.value = role;
  newMemberName.value = '';
  dobMonth.value = '';
  dobDay.value = '';
  dobYear.value = '';
  showMemberForm.value = true;
}

function getNextColor(): string {
  const usedCount = addedMembers.value.length;
  return MEMBER_COLOR_VALUES[usedCount % MEMBER_COLOR_VALUES.length] ?? MEMBER_COLOR_VALUES[0]!;
}
</script>

<template>
  <div>
    <h2 class="font-outfit mb-6 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
      {{ t('loginV6.addBeansTitle') }}
    </h2>

    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Owner + added members list -->
    <div class="mb-4 space-y-2">
      <!-- Owner (always shown, non-removable) -->
      <div
        v-if="familyStore.owner"
        class="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50"
      >
        <BeanieAvatar
          :variant="getMemberAvatarVariant(familyStore.owner)"
          :color="familyStore.owner.color"
          size="sm"
        />
        <div class="flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ familyStore.owner.name }}
            <span
              class="bg-primary-500/15 text-primary-500 ml-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
              >{{ t('loginV6.you') }}</span
            >
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{
              familyStore.owner.ageGroup === 'child'
                ? '🌱 ' + t('loginV6.littleBean')
                : '🫘 ' + t('loginV6.parentBean')
            }}
          </p>
        </div>
      </div>

      <!-- Additional members -->
      <div
        v-for="member in addedMembers"
        :key="member.id"
        class="flex items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50"
      >
        <BeanieAvatar :variant="getMemberAvatarVariant(member)" :color="member.color" size="sm" />
        <div class="flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ member.name }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{
              member.ageGroup === 'child'
                ? '🌱 ' + t('loginV6.littleBean')
                : '🫘 ' + t('loginV6.parentBean')
            }}<template v-if="formatBirthdayShort(member.dateOfBirth)">
              · {{ formatBirthdayShort(member.dateOfBirth) }}</template
            >
          </p>
        </div>
        <button
          type="button"
          class="ml-1 rounded-lg p-1 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          :title="t('loginV6.removeMember')"
          @click="handleRemoveMember(member.id)"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Add-a-beanie prompt — the single source for opening the member form.
         Shown whenever the form is closed (empty state OR after at least
         one member has been added and the form collapsed). -->
    <div
      v-if="!showMemberForm"
      class="rounded-2xl border-2 border-dashed border-gray-200 p-4 text-center dark:border-slate-600"
    >
      <p
        v-if="addedMembers.length > 0"
        class="font-outfit mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400"
      >
        {{ t('loginV6.addAnotherBeanie') }}
      </p>
      <div class="flex justify-center gap-2">
        <button
          type="button"
          class="font-outfit flex items-center gap-1.5 rounded-full border-2 border-transparent bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:border-[var(--color-secondary-500)] hover:bg-gray-50 dark:bg-slate-700 dark:text-gray-300 dark:hover:border-slate-400 dark:hover:bg-slate-600"
          @click="openAddMemberForm('parent')"
        >
          🫘 {{ t('loginV6.addAnAdult') }}
        </button>
        <button
          type="button"
          class="font-outfit flex items-center gap-1.5 rounded-full border-2 border-transparent bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:border-[var(--color-secondary-500)] hover:bg-gray-50 dark:bg-slate-700 dark:text-gray-300 dark:hover:border-slate-400 dark:hover:bg-slate-600"
          @click="openAddMemberForm('child')"
        >
          🌱 {{ t('loginV6.addALittleBean') }}
        </button>
      </div>
    </div>

    <!-- Add member form. Field order: Role → Name → Birthday. -->
    <div
      v-if="showMemberForm"
      class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-600"
    >
      <!-- Role chips — pre-selected from the opening chip click; user can flip. -->
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-full px-3 py-1 text-sm transition-colors"
          :class="
            newMemberRole === 'parent'
              ? 'bg-secondary-500 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
          "
          @click="newMemberRole = 'parent'"
        >
          🫘 {{ t('loginV6.parentBean') }}
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-1 text-sm transition-colors"
          :class="
            newMemberRole === 'child'
              ? 'bg-secondary-500 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-gray-400'
          "
          @click="newMemberRole = 'child'"
        >
          🌱 {{ t('loginV6.littleBean') }}
        </button>
      </div>

      <BaseInput
        v-model="newMemberName"
        :label="'👤 ' + t('form.name')"
        :placeholder="t('family.enterName')"
      />

      <!-- Birthday (month & day required, year optional) -->
      <div>
        <span
          class="font-outfit text-xs font-semibold tracking-[0.1em] text-gray-700 uppercase dark:text-gray-300"
          >🎂 {{ t('modal.birthday') }}</span
        >
        <div class="mt-1 grid grid-cols-[1fr_0.6fr_0.7fr] gap-1.5">
          <BaseSelect
            v-model="dobMonth"
            :options="monthOptions"
            :placeholder="t('family.dateOfBirth.month')"
          />
          <BaseSelect
            v-model="dobDay"
            :options="dayOptions"
            :placeholder="t('family.dateOfBirth.day')"
          />
          <BaseInput v-model="dobYear" type="number" :placeholder="t('family.dateOfBirth.year')" />
        </div>
      </div>

      <div class="flex gap-2">
        <BaseButton class="flex-1" variant="outline" @click="showMemberForm = false">
          {{ t('action.cancel') }}
        </BaseButton>
        <BaseButton
          class="flex-1"
          variant="secondary"
          :disabled="!newMemberName || !dobMonth || !dobDay || isAddingMember"
          :loading="isAddingMember"
          @click="handleAddMember"
        >
          🫘 {{ t('loginV6.addMember') }}
        </BaseButton>
      </div>
    </div>

    <!-- Finish CTA — only visible while the form is closed. Finish IS the skip
         path when no members have been added. -->
    <BaseButton v-if="!showMemberForm" class="mt-6 w-full" @click="emit('finish')">
      {{ t('loginV6.finish') }}
    </BaseButton>
  </div>
</template>
