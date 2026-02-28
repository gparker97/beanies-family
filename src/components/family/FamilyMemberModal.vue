<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import ColorCircleSelector from '@/components/ui/ColorCircleSelector.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useTranslation } from '@/composables/useTranslation';
import { isTemporaryEmail } from '@/utils/email';
import type {
  FamilyMember,
  Gender,
  AgeGroup,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  member?: FamilyMember | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateFamilyMemberInput | { id: string; data: UpdateFamilyMemberInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();

const isEditing = computed(() => !!props.member);
const isSubmitting = ref(false);
const showMoreDetails = ref(false);

// Color options with gradients
const MEMBER_COLORS = [
  { value: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  { value: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #f87171)' },
  { value: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #4ade80)' },
  { value: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
  { value: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { value: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #f472b6)' },
];

// Role chips
const roleOptions = computed(() => [
  { value: 'parent', label: t('modal.parentBean'), icon: '🫘' },
  { value: 'child', label: t('modal.littleBean'), icon: '🌱' },
  { value: 'teen', label: t('modal.bigBean'), icon: '🫛' },
]);

const genderOptions = computed(() => [
  { value: 'male', label: t('family.gender.male') },
  { value: 'female', label: t('family.gender.female') },
  { value: 'other', label: t('family.gender.other') },
]);

const MONTH_KEYS = [
  'month.january',
  'month.february',
  'month.march',
  'month.april',
  'month.may',
  'month.june',
  'month.july',
  'month.august',
  'month.september',
  'month.october',
  'month.november',
  'month.december',
] as const;

const monthOptions = computed(() =>
  MONTH_KEYS.map((key, i) => ({
    value: String(i + 1),
    label: t(key),
  }))
);

const dayOptions = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

// Form state
const name = ref('');
const email = ref('');
const gender = ref<Gender>('male');
const beanRole = ref('parent'); // parent/child/teen
const color = ref('#3b82f6');
const dobMonth = ref('1');
const dobDay = ref('1');
const dobYear = ref('');
const canViewFinances = ref(true);
const canEditActivities = ref(true);
const canManagePod = ref(false);

// Derived ageGroup from beanRole
const ageGroup = computed<AgeGroup>(() => (beanRole.value === 'child' ? 'child' : 'adult'));

// Reset form
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.member) {
      const m = props.member;
      name.value = m.name;
      email.value = isTemporaryEmail(m.email) ? '' : m.email;
      gender.value = m.gender || 'other';
      beanRole.value = m.ageGroup === 'child' ? 'child' : m.role === 'owner' ? 'parent' : 'parent';
      color.value = m.color;
      dobMonth.value = m.dateOfBirth?.month?.toString() ?? '1';
      dobDay.value = m.dateOfBirth?.day?.toString() ?? '1';
      dobYear.value = m.dateOfBirth?.year?.toString() ?? '';
      showMoreDetails.value = !!(m.email && !isTemporaryEmail(m.email)) || !!m.gender;
    } else {
      const randomColor =
        MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)]?.value ?? '#3b82f6';
      name.value = '';
      email.value = '';
      gender.value = 'male';
      beanRole.value = 'parent';
      color.value = randomColor;
      dobMonth.value = '1';
      dobDay.value = '1';
      dobYear.value = '';
      canViewFinances.value = true;
      canEditActivities.value = true;
      canManagePod.value = false;
      showMoreDetails.value = false;
    }
  }
);

const avatarInitial = computed(() => (name.value ? name.value.charAt(0).toUpperCase() : '?'));

const canSave = computed(() => name.value.trim().length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('family.editMember') : t('modal.addMember')
);

const saveLabel = computed(() => (isEditing.value ? t('modal.saveMember') : t('modal.addToPod')));

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    const data: Record<string, unknown> = {
      name: name.value.trim(),
      email: email.value.trim() || `${Date.now()}@temp.beanies.family`,
      gender: gender.value,
      ageGroup: ageGroup.value,
      role: 'member' as const,
      color: color.value,
      requiresPassword: true,
    };

    // Attach date of birth
    if (dobMonth.value && dobDay.value) {
      data.dateOfBirth = {
        month: parseInt(dobMonth.value, 10),
        day: parseInt(dobDay.value, 10),
        ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
      };
    }

    if (isEditing.value && props.member) {
      emit('save', { id: props.member.id, data: data as UpdateFamilyMemberInput });
    } else {
      emit('save', data as CreateFamilyMemberInput);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.member) {
    emit('delete', props.member.id);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    icon="🫘"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. Avatar preview -->
    <div class="flex justify-center">
      <div
        class="font-outfit flex h-[88px] w-[88px] items-center justify-center rounded-full text-3xl font-bold text-white"
        :style="{ background: `linear-gradient(135deg, ${color}, ${color}dd)` }"
      >
        {{ avatarInitial }}
      </div>
    </div>

    <!-- 2. Color selector -->
    <div class="flex justify-center">
      <ColorCircleSelector v-model="color" :colors="MEMBER_COLORS" />
    </div>

    <!-- 3. Name -->
    <div>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-center text-[1.2rem] font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.memberName')"
      />
    </div>

    <!-- 4. Role chips -->
    <FormFieldGroup :label="t('modal.role')">
      <FrequencyChips v-model="beanRole" :options="roleOptions" />
    </FormFieldGroup>

    <!-- 5. Birthday -->
    <FormFieldGroup :label="t('modal.birthday')" optional>
      <div class="grid grid-cols-3 gap-2">
        <BaseSelect v-model="dobMonth" :options="monthOptions" />
        <BaseSelect v-model="dobDay" :options="dayOptions" />
        <BaseInput v-model="dobYear" type="number" placeholder="Year" />
      </div>
    </FormFieldGroup>

    <!-- 6. Permission toggles (display-only MVP) -->
    <FormFieldGroup :label="t('modal.permissions')">
      <div class="space-y-3">
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-[0.75rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canViewFinances') }}
          </span>
          <ToggleSwitch v-model="canViewFinances" size="sm" />
        </div>
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-[0.75rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canEditActivities') }}
          </span>
          <ToggleSwitch v-model="canEditActivities" size="sm" />
        </div>
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-[0.75rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canManagePod') }}
          </span>
          <ToggleSwitch v-model="canManagePod" size="sm" />
        </div>
      </div>
    </FormFieldGroup>

    <!-- More details toggle -->
    <button
      type="button"
      class="font-outfit text-primary-500 hover:text-terracotta-400 flex w-full cursor-pointer items-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors"
      @click="showMoreDetails = !showMoreDetails"
    >
      <svg
        class="h-4 w-4 transition-transform"
        :class="{ 'rotate-180': showMoreDetails }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
      {{ t('modal.moreDetails') }}
    </button>

    <ConditionalSection :show="showMoreDetails">
      <div class="space-y-4">
        <BaseInput
          v-model="email"
          :label="t('family.email')"
          type="email"
          placeholder="bean@example.com"
        />
        <BaseSelect v-model="gender" :options="genderOptions" :label="t('family.gender')" />
      </div>
    </ConditionalSection>
  </BeanieFormModal>
</template>
