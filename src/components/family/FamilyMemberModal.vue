<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanAvatarPicker from '@/components/family/BeanAvatarPicker.vue';
import ColorCircleSelector from '@/components/ui/ColorCircleSelector.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { isTemporaryEmail } from '@/utils/email';
import { getAvatarVariant } from '@/composables/useMemberAvatar';
import { usePhotoStore } from '@/stores/photoStore';
import type {
  FamilyMember,
  Gender,
  AgeGroup,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
  UUID,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  member?: FamilyMember | null;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateFamilyMemberInput | { id: string; data: UpdateFamilyMemberInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const photoStore = usePhotoStore();

// Color options with gradients
const MEMBER_COLORS = [
  { value: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
  { value: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #f87171)' },
  { value: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #4ade80)' },
  { value: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
  { value: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
  { value: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #f472b6)' },
];

// Role chips — parent and child only (admin/permissions handled later)
const roleOptions = computed(() => [
  { value: 'parent', label: t('modal.parentBean'), icon: '🫘' },
  { value: 'child', label: t('modal.littleBean'), icon: '🌱' },
]);

const genderChipOptions = computed(() => [
  { value: 'male', label: t('family.gender.male'), icon: '♂️' },
  { value: 'female', label: t('family.gender.female'), icon: '♀️' },
  { value: 'other', label: t('family.gender.other'), icon: '⚧️' },
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
const beanRole = ref('parent'); // parent/child
const color = ref('#3b82f6');
const dobMonth = ref('1');
const dobDay = ref('1');
const dobYear = ref('');
const canViewFinances = ref(true);
const canEditActivities = ref(true);
const canManagePod = ref(false);
const showPermissions = ref(false);

// Avatar photo state. `avatarPhotoId` holds whichever photoId the form will
// eventually save — starts as the member's current avatar, updated by
// BeanAvatarPicker via v-model. `initialAvatarPhotoId` and
// `uploadedButNotSaved` track the original vs. newly-uploaded state so we
// can tombstone orphans correctly on close/save.
const avatarPhotoId = ref<UUID | undefined>(undefined);
const initialAvatarPhotoId = ref<UUID | undefined>(undefined);
const uploadedButNotSaved = ref<UUID[]>([]);

// Derived ageGroup from beanRole
const ageGroup = computed<AgeGroup>(() => (beanRole.value === 'child' ? 'child' : 'adult'));

// Avatar variant derived from gender + ageGroup
const avatarVariant = computed(() => getAvatarVariant(gender.value, ageGroup.value));

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.member,
  () => props.open,
  {
    onEdit: (member) => {
      name.value = member.name;
      email.value = isTemporaryEmail(member.email) ? '' : member.email;
      gender.value = member.gender || 'other';
      beanRole.value = member.ageGroup === 'child' ? 'child' : 'parent';
      color.value = member.color;
      dobMonth.value = member.dateOfBirth?.month?.toString() ?? '1';
      dobDay.value = member.dateOfBirth?.day?.toString() ?? '1';
      dobYear.value = member.dateOfBirth?.year?.toString() ?? '';
      canViewFinances.value = member.role === 'owner' ? true : (member.canViewFinances ?? true);
      canEditActivities.value = member.role === 'owner' ? true : (member.canEditActivities ?? true);
      canManagePod.value = member.role === 'owner' ? true : (member.canManagePod ?? false);
      avatarPhotoId.value = member.avatarPhotoId;
      initialAvatarPhotoId.value = member.avatarPhotoId;
      uploadedButNotSaved.value = [];
    },
    onNew: () => {
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
      showPermissions.value = false;
      avatarPhotoId.value = undefined;
      initialAvatarPhotoId.value = undefined;
      uploadedButNotSaved.value = [];
    },
  }
);

// When canManagePod is toggled ON, auto-enable finance + activities
watch(canManagePod, (val) => {
  if (val) {
    canViewFinances.value = true;
    canEditActivities.value = true;
  }
});

function onAvatarUploaded(photoId: UUID) {
  uploadedButNotSaved.value.push(photoId);
}

function onAvatarRemoved(photoId: UUID) {
  // If the removed photo was uploaded in THIS session (not yet saved to
  // the member), tombstone it immediately — it's an orphan. The
  // pre-existing avatar (if that's what was removed) is tombstoned on
  // save instead, since the user may still hit Cancel and revert.
  if (uploadedButNotSaved.value.includes(photoId)) {
    photoStore.markDeleted(photoId);
    uploadedButNotSaved.value = uploadedButNotSaved.value.filter((id) => id !== photoId);
  }
}

/**
 * Cleanup on modal close WITHOUT save:
 *   - Tombstone every photo uploaded in this session (they're orphans).
 *   - Leave the member's original avatarPhotoId untouched.
 */
function handleClose() {
  for (const id of uploadedButNotSaved.value) {
    photoStore.markDeleted(id);
  }
  uploadedButNotSaved.value = [];
  emit('close');
}

const isOwnerMember = computed(() => props.member?.role === 'owner');

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
      canViewFinances: canViewFinances.value,
      canEditActivities: canEditActivities.value,
      canManagePod: canManagePod.value,
    };

    // Attach date of birth
    if (dobMonth.value && dobDay.value) {
      data.dateOfBirth = {
        month: parseInt(dobMonth.value, 10),
        day: parseInt(dobDay.value, 10),
        ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
      };
    }

    // Avatar photo: include the current selection (or explicit undefined to
    // clear a removed avatar — automergeRepository treats explicit
    // undefined as "delete this key"). Tombstone the PREVIOUS avatar if it
    // was replaced or removed; the new one (if any) is now referenced by
    // this member so it stays.
    data.avatarPhotoId = avatarPhotoId.value;
    const previousId = initialAvatarPhotoId.value;
    if (previousId && previousId !== avatarPhotoId.value) {
      photoStore.markDeleted(previousId);
    }
    // The current avatar (if it's one we just uploaded) is about to be
    // saved as a reference on the member — it's no longer an orphan.
    uploadedButNotSaved.value = uploadedButNotSaved.value.filter(
      (id) => id !== avatarPhotoId.value
    );
    // Any other session-uploaded photos (e.g. user uploaded A, then B,
    // saved with B) are still orphans — cleanupUnsavedUploads handled
    // the old one on each new upload? No — re-upload doesn't auto-tombstone
    // the previous session upload. Clean those up here.
    for (const id of uploadedButNotSaved.value) {
      photoStore.markDeleted(id);
    }
    uploadedButNotSaved.value = [];

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
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="🫘"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="readOnly ? t('action.close') : saveLabel"
    :save-disabled="readOnly ? false : !canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing && !readOnly"
    @close="readOnly ? emit('close') : handleClose()"
    @save="readOnly ? emit('close') : handleSave()"
    @delete="handleDelete"
  >
    <!-- Bean avatar preview + upload/remove -->
    <BeanAvatarPicker
      v-model="avatarPhotoId"
      :variant="avatarVariant"
      :color="color"
      :disabled="readOnly"
      @uploaded="onAvatarUploaded"
      @removed="onAvatarRemoved"
    />

    <!-- 2. Color selector -->
    <div v-if="!readOnly" class="flex justify-center">
      <ColorCircleSelector v-model="color" :colors="MEMBER_COLORS" />
    </div>

    <!-- 3. Name -->
    <FormFieldGroup :label="t('modal.memberName')" required>
      <div
        class="focus-within:border-primary-500 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
      >
        <input
          v-model="name"
          type="text"
          :disabled="readOnly"
          class="font-outfit w-full border-none bg-transparent text-center text-xl font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-40 dark:text-gray-100"
          :placeholder="t('modal.memberName')"
        />
      </div>
    </FormFieldGroup>

    <!-- 4. Role chips (parent/child only) -->
    <FormFieldGroup :label="t('modal.role')">
      <FrequencyChips v-model="beanRole" :options="roleOptions" :disabled="readOnly" />
    </FormFieldGroup>

    <!-- 5. Gender chips -->
    <FormFieldGroup :label="t('family.gender')">
      <FrequencyChips v-model="gender" :options="genderChipOptions" :disabled="readOnly" />
    </FormFieldGroup>

    <!-- 6. Email -->
    <FormFieldGroup :label="t('family.email')" optional>
      <BaseInput v-model="email" type="email" placeholder="bean@example.com" :disabled="readOnly" />
    </FormFieldGroup>

    <!-- 7. Birthday -->
    <FormFieldGroup :label="t('modal.birthday')" optional>
      <div class="grid grid-cols-3 gap-2">
        <BaseSelect v-model="dobMonth" :options="monthOptions" :disabled="readOnly" />
        <BaseSelect v-model="dobDay" :options="dayOptions" :disabled="readOnly" />
        <BaseInput v-model="dobYear" type="number" placeholder="Year" :disabled="readOnly" />
      </div>
    </FormFieldGroup>

    <!-- 8. Permissions (collapsible, hidden in readOnly mode) -->
    <div v-if="!readOnly">
      <button
        type="button"
        class="font-outfit text-primary-500 text-sm font-semibold transition-colors hover:underline"
        @click="showPermissions = !showPermissions"
      >
        {{ t('modal.permissions') }}
        <span
          class="ml-1 inline-block transition-transform"
          :class="{ 'rotate-180': showPermissions }"
          >&#9662;</span
        >
      </button>

      <div v-if="showPermissions" class="mt-3 space-y-3">
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canViewFinances') }}
          </span>
          <ToggleSwitch v-model="canViewFinances" size="sm" :disabled="isOwnerMember" />
        </div>
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canEditActivities') }}
          </span>
          <ToggleSwitch v-model="canEditActivities" size="sm" :disabled="isOwnerMember" />
        </div>
        <div
          class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
        >
          <span
            class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200"
          >
            {{ t('modal.canManagePod') }}
          </span>
          <ToggleSwitch v-model="canManagePod" size="sm" :disabled="isOwnerMember" />
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
