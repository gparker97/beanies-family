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
import { useFormValidation } from '@/composables/useFormValidation';
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

/** A placeholder address for a bean with no email. Impure (clock), so it is minted only at save
 *  time and never inside `buildPayload`, where it would be a permanent phantom diff. */
function mintTempEmail(): string {
  return `${Date.now()}@temp.beanies.family`;
}

// Every field is emitted so an edit can diff against the open-time snapshot. Pure: no clock.
// The email is the typed one, or (pets / a blank field) the STORED one, so an untouched edit
// leaves it alone; `handleSave` mints a temp address only when a create/clear needs one.
function buildPayload() {
  const storedEmail = props.member?.email ?? '';
  const typedEmail = email.value.trim();
  return {
    name: name.value.trim(),
    email: isPet.value
      ? storedEmail
      : typedEmail || (isTemporaryEmail(storedEmail) ? storedEmail : ''),
    gender: gender.value,
    ageGroup: ageGroup.value,
    color: color.value,
    requiresPassword: !isPet.value,
    // Pets never receive an invite, login, or permission flags.
    canViewFinances: isPet.value ? false : canViewFinances.value,
    canEditActivities: isPet.value ? false : canEditActivities.value,
    canManagePod: isPet.value ? false : canManagePod.value,
    isPet: isPet.value,
    dateOfBirth:
      dobMonth.value && dobDay.value
        ? {
            month: parseInt(dobMonth.value, 10),
            day: parseInt(dobDay.value, 10),
            ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
          }
        : undefined,
    // `undefined` clears a removed avatar (the repository treats it as "delete this key").
    avatarPhotoId: avatarPhotoId.value,
  };
}
type MemberPayload = ReturnType<typeof buildPayload>;

// Reset form when modal opens
const { isEditing, isSubmitting, formDiff } = useFormModal<FamilyMember, MemberPayload>(
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
    snapshot: { build: buildPayload, name: 'FamilyMemberModal' },
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
    void photoStore.markDeleted(photoId);
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
    void photoStore.markDeleted(id);
  }
  uploadedButNotSaved.value = [];
  initialSnapshot.value = '';
  emit('close');
}

/**
 * How long the previous avatar's tombstone waits for the member save to land. The modal
 * emits `save` and the PARENT persists it, so success is observed in the doc (the member no
 * longer references the old photo), not returned here. Past this the old avatar is left
 * alive — a stale file on Drive, never a member with a missing face.
 */
const AVATAR_RELEASE_WAIT_MS = 15_000;

const isOwnerMember = computed(() => props.member?.role === 'owner');

const v = useFormValidation('family-member', () => ({ name: () => name.value.trim().length > 0 }), {
  open: () => props.open,
});

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

/** Save doubles as Close in read-only mode; otherwise validate, then save. */
function onSaveClick() {
  if (props.readOnly) {
    emit('close');
    return;
  }
  return v.attemptSave(handleSave);
}

function handleSave() {
  isSubmitting.value = true;

  try {
    const payload = buildPayload();

    // Avatar photo: include the current selection (or explicit undefined to
    // clear a removed avatar — automergeRepository treats explicit
    // undefined as "delete this key"). The PREVIOUS avatar, if replaced or
    // removed, is released AFTER the save is emitted (below): the store
    // tombstones it only once the member no longer references it, i.e.
    // only once the parent's save has landed. A failed save keeps it.
    const previousId = initialAvatarPhotoId.value;
    const releasePrevious = !!previousId && previousId !== avatarPhotoId.value;
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
      void photoStore.markDeleted(id);
    }
    uploadedButNotSaved.value = [];

    if (isEditing.value && props.member) {
      const data: Record<string, unknown> = { ...formDiff.changes(payload) };
      // The permission flags default from `ageGroup`, so a role switch carries them as shown on
      // screen: otherwise adult -> child would silently drop a finances toggle the form showed
      // as on (and child -> adult would grant one it showed as off).
      if ('ageGroup' in data) {
        data.canViewFinances = payload.canViewFinances;
        data.canEditActivities = payload.canEditActivities;
        data.canManagePod = payload.canManagePod;
      }
      // Becoming a pet: it must not keep a person's address, so the diff carries a fresh temp one
      // (an already-temporary address is left alone, like an untouched edit).
      if (data.isPet === true && !isTemporaryEmail(props.member.email ?? '')) {
        data.email = mintTempEmail();
      }
      // A cleared real email (or a pet-to-person change with none stored) still needs an address.
      if ('email' in data && !data.email) data.email = mintTempEmail();
      // NEVER set role on UPDATE: this modal is not the role-management surface (that's
      // TransferOwnershipModal). Hardcoding role: 'member' on edit silently demoted the owner.
      emit('save', { id: props.member.id, data: data as UpdateFamilyMemberInput });
    } else {
      emit('save', {
        ...payload,
        email: payload.email || mintTempEmail(),
        // CREATE only: every new member starts as 'member'.
        role: 'member' as const,
      } as CreateFamilyMemberInput);
    }
    if (releasePrevious && previousId) {
      void photoStore.markDeleted(previousId, { awaitDetachMs: AVATAR_RELEASE_WAIT_MS });
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
    :save-ready="readOnly || v.canSave.value"
    :is-submitting="isSubmitting"
    :show-delete="isEditing && !readOnly"
    @close="readOnly ? emit('close') : handleClose()"
    @save="onSaveClick"
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
    <FormFieldGroup :label="t('modal.memberName')" v-bind="v.bind('name')">
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
