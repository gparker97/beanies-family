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
import { confirm } from '@/composables/useConfirm';
import { isTemporaryEmail } from '@/utils/email';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { nextFreeMemberColor, takenColors } from '@/constants/memberColors';
import { useFamilyStore } from '@/stores/familyStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { useCalendarSelectOptions } from '@/composables/useCalendarSelectOptions';
import { MEMBER_COLORS } from '@/constants/memberColors';
import { usePhotoStore } from '@/stores/photoStore';
import type {
  FamilyMember,
  Gender,
  AgeGroup,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
  UUID,
} from '@/types/models';

const familyStore = useFamilyStore();

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

// Role chips — parent / child / pet. Pets are part of the pod but never
// invited, signed in, or granted permissions (see handleSave).
const roleOptions = computed(() => [
  { value: 'parent', label: t('modal.parentBean'), icon: '🫘' },
  { value: 'child', label: t('modal.littleBean'), icon: '🌱' },
  { value: 'pet', label: t('modal.petBean'), icon: '🐾' },
]);

const genderChipOptions = computed(() => [
  { value: 'male', label: t('family.gender.male'), icon: '♂️' },
  { value: 'female', label: t('family.gender.female'), icon: '♀️' },
  { value: 'other', label: t('family.gender.other'), icon: '⚧️' },
]);

const { monthOptions, dayOptions } = useCalendarSelectOptions(31);

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

/**
 * Snapshot of form values at open time — compared against current values
 * to detect "dirty" state, so closing an edited drawer prompts for
 * confirmation. JSON-stringified for cheap structural equality.
 */
const initialSnapshot = ref<string>('');

function takeSnapshot(): string {
  return JSON.stringify({
    name: name.value,
    email: email.value,
    gender: gender.value,
    beanRole: beanRole.value,
    color: color.value,
    dobMonth: dobMonth.value,
    dobDay: dobDay.value,
    dobYear: dobYear.value,
    canViewFinances: canViewFinances.value,
    canEditActivities: canEditActivities.value,
    canManagePod: canManagePod.value,
    avatarPhotoId: avatarPhotoId.value ?? null,
  });
}

const isDirty = computed(
  () => initialSnapshot.value !== '' && takeSnapshot() !== initialSnapshot.value
);

// True when the active role is pet — toggles pet-specific UI + data path.
const isPet = computed(() => beanRole.value === 'pet');

// Derived ageGroup from beanRole. Pets pin to 'adult' as a harmless default —
// the avatar + roster UI always branch on isPet, so age buckets don't leak.
const ageGroup = computed<AgeGroup>(() => (beanRole.value === 'child' ? 'child' : 'adult'));

// Avatar variant: pets always show the pet-dog icon; everyone else uses
// gender + age group.
const avatarVariant = computed(() =>
  getMemberAvatarVariant({ gender: gender.value, ageGroup: ageGroup.value, isPet: isPet.value })
);

/** Someone else already holds this bean's colour (only possible once all six are taken). */
const colorSharedWith = ref<string | null>(null);

/**
 * Colours held by OTHER beans. `props.member?.id` is excluded so a bean created
 * before uniqueness was enforced — when colours were assigned at random — can still
 * be opened and saved with the colour it already has.
 */
const takenSwatches = computed(() => takenColors(familyStore.members, props.member?.id));

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.member,
  () => props.open,
  {
    onEdit: (member) => {
      name.value = member.name;
      email.value = isTemporaryEmail(member.email) ? '' : member.email;
      gender.value = member.gender || 'other';
      beanRole.value = member.isPet ? 'pet' : member.ageGroup === 'child' ? 'child' : 'parent';
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
      initialSnapshot.value = takeSnapshot();
    },
    onNew: () => {
      // Was `Math.random()`, which could collide with an existing bean on the very
      // first try — and a colour identifies a person now, so a collision makes the
      // whole system ambiguous. `reused` is non-null only when all six are held.
      const next = nextFreeMemberColor(familyStore.members);
      name.value = '';
      email.value = '';
      gender.value = 'male';
      beanRole.value = 'parent';
      color.value = next.color;
      colorSharedWith.value = next.reused?.name ?? null;
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
      initialSnapshot.value = takeSnapshot();
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

/**
 * Switching a NEW bean to "child" drops the finance toggle, matching the same default
 * `applyDefaults` applies to wizard-created children (#79 review). Only while creating:
 * editing an existing bean must never silently rewrite a permission a grown-up chose.
 * The toggle stays visible and can be turned straight back on.
 */
watch(beanRole, (role, prev) => {
  if (props.member || role === prev) return;
  if (role === 'child') canViewFinances.value = false;
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
async function handleClose(): Promise<void> {
  // Unlike the Family Nook / activity / todo surfaces (which auto-save
  // on each change), this drawer uses explicit save — it carries admin
  // toggles (permissions, role) plus a Delete action where silent save
  // would be risky. To bridge the UX gap we guard close-while-dirty
  // with a confirm prompt so edits aren't lost by accident.
  if (isDirty.value && !props.readOnly) {
    const ok = await confirm({
      title: 'family.discardChanges.title',
      message: 'family.discardChanges.body',
      variant: 'danger',
    });
    if (!ok) return;
  }
  for (const id of uploadedButNotSaved.value) {
    photoStore.markDeleted(id);
  }
  uploadedButNotSaved.value = [];
  initialSnapshot.value = '';
  emit('close');
}

const isOwnerMember = computed(() => props.member?.role === 'owner');

const canSave = computed(() => name.value.trim().length > 0);

const modalTitle = computed(() => {
  if (isPet.value) {
    return isEditing.value ? t('modal.editPet') : t('modal.addPet');
  }
  return isEditing.value ? t('family.editMember') : t('modal.addMember');
});

const modalIcon = computed(() => (isPet.value ? '🐾' : '🫘'));

const saveLabel = computed(() => {
  if (isPet.value) {
    return isEditing.value ? t('modal.savePet') : t('modal.addPetToPod');
  }
  return isEditing.value ? t('modal.saveMember') : t('modal.addToPod');
});

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    // Pets never receive an invite, login, or permission flags — force
    // everything off on the data path regardless of any stale form state.
    const data: Record<string, unknown> = {
      name: name.value.trim(),
      email: isPet.value
        ? `${Date.now()}@temp.beanies.family`
        : email.value.trim() || `${Date.now()}@temp.beanies.family`,
      gender: gender.value,
      ageGroup: ageGroup.value,
      // CREATE only — every new member starts as 'member'. NEVER set role
      // on UPDATE: this modal is not the role-management surface (that's
      // TransferOwnershipModal). Hardcoding role: 'member' on edit silently
      // demoted the owner every time anyone fixed a typo on their profile;
      // normalizeRoles() then re-promoted on next load, masking the issue
      // until you noticed the chip flipping mid-session.
      ...(isEditing.value ? {} : { role: 'member' as const }),
      color: color.value,
      requiresPassword: !isPet.value,
      canViewFinances: isPet.value ? false : canViewFinances.value,
      canEditActivities: isPet.value ? false : canEditActivities.value,
      canManagePod: isPet.value ? false : canManagePod.value,
      isPet: isPet.value,
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
    :icon="modalIcon"
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
      <div class="flex flex-col items-center gap-2">
        <ColorCircleSelector v-model="color" :colors="MEMBER_COLORS" :taken="takenSwatches" />
        <!--
          Exhaustion is said out loud rather than silently reusing a colour: with six
          hues and a seventh bean there is nothing left to give, and a family that
          cannot see that would just think the app got it wrong.
        -->
        <p
          v-if="colorSharedWith"
          class="font-inter text-center text-xs text-[var(--color-text-muted)]"
        >
          {{
            fillTemplate(t('family.colorAllTaken'), {
              name: name || t('modal.memberName'),
              other: colorSharedWith,
            })
          }}
        </p>
      </div>
    </div>

    <!-- 3. Name -->
    <FormFieldGroup :label="t('modal.memberName')" required>
      <div
        class="focus-within:border-primary-500 dark:bg-surface-overlay rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)]"
      >
        <input
          v-model="name"
          type="text"
          :disabled="readOnly"
          class="font-outfit dark:text-ink w-full border-none bg-transparent text-center text-xl font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-40"
          :placeholder="t('modal.memberName')"
        />
      </div>
    </FormFieldGroup>

    <!-- 4. Role chips (parent / child / pet) -->
    <FormFieldGroup :label="t('modal.role')">
      <FrequencyChips v-model="beanRole" :options="roleOptions" :disabled="readOnly" />
      <p
        v-if="isPet"
        class="font-inter dark:text-ink-soft mt-2 text-xs text-[var(--color-text-muted)]"
      >
        {{ t('modal.petHint') }}
      </p>
    </FormFieldGroup>

    <!-- 5. Gender chips -->
    <FormFieldGroup :label="t('family.gender')">
      <FrequencyChips v-model="gender" :options="genderChipOptions" :disabled="readOnly" />
    </FormFieldGroup>

    <!-- 6. Email — humans only (pets never receive an invite) -->
    <FormFieldGroup v-if="!isPet" :label="t('family.email')" optional>
      <BaseInput v-model="email" type="email" placeholder="bean@example.com" :disabled="readOnly" />
    </FormFieldGroup>

    <!-- 7. Birthday — month gets double width for full month names -->
    <FormFieldGroup :label="t('modal.birthday')" optional>
      <div class="grid grid-cols-[2fr_1fr_1.2fr] gap-2">
        <BaseSelect v-model="dobMonth" :options="monthOptions" :disabled="readOnly" />
        <BaseSelect v-model="dobDay" :options="dayOptions" :disabled="readOnly" />
        <BaseInput v-model="dobYear" type="number" placeholder="Year" :disabled="readOnly" />
      </div>
    </FormFieldGroup>

    <!-- 8. Permissions (collapsible) — humans only, hidden in readOnly mode -->
    <div v-if="!readOnly && !isPet">
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
          class="dark:bg-surface-overlay flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5"
        >
          <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
            {{ t('modal.canViewFinances') }}
          </span>
          <ToggleSwitch v-model="canViewFinances" size="sm" :disabled="isOwnerMember" />
        </div>
        <div
          class="dark:bg-surface-overlay flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5"
        >
          <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
            {{ t('modal.canEditActivities') }}
          </span>
          <ToggleSwitch v-model="canEditActivities" size="sm" :disabled="isOwnerMember" />
        </div>
        <div
          class="dark:bg-surface-overlay flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5"
        >
          <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
            {{ t('modal.canManagePod') }}
          </span>
          <ToggleSwitch v-model="canManagePod" size="sm" :disabled="isOwnerMember" />
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
