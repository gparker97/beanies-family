<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type {
  VacationAccommodation,
  VacationAccommodationType,
  VacationSegmentStatus,
} from '@/types/models';
import { generateUUID } from '@/utils/id';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';

const props = defineProps<{
  accommodations: VacationAccommodation[];
}>();

const emit = defineEmits<{
  'update:accommodations': [value: VacationAccommodation[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});

const accommodationTypes: { type: VacationAccommodationType; emoji: string; key: string }[] = [
  { type: 'hotel', emoji: '🏨', key: 'hotel' },
  { type: 'airbnb', emoji: '🏠', key: 'airbnb' },
  { type: 'campground', emoji: '🏕️', key: 'campground' },
  { type: 'family_friends', emoji: '👨‍👩‍👧', key: 'family_friends' },
];

const statusOptions: { value: VacationSegmentStatus; key: string }[] = [
  { value: 'not_booked', key: 'vacation.status.not_booked' },
  { value: 'researching', key: 'vacation.status.researching' },
  { value: 'pending', key: 'vacation.status.pending' },
  { value: 'booked', key: 'vacation.status.booked' },
];

const emojiMap: Record<VacationAccommodationType, string> = {
  hotel: '🏨',
  airbnb: '🏠',
  campground: '🏕️',
  family_friends: '👨‍👩‍👧',
};

function hasType(type: VacationAccommodationType): boolean {
  return props.accommodations.some((a) => a.type === type);
}

function addItem(type: VacationAccommodationType) {
  const item: VacationAccommodation = {
    id: generateUUID(),
    type,
    title: t(`vacation.accommodation.${type}` as any),
    status: 'not_booked',
  };
  emit('update:accommodations', [...props.accommodations, item]);
}

function togglePill(type: VacationAccommodationType) {
  if (hasType(type)) {
    const items = props.accommodations.filter((a) => a.type === type);
    const allEmpty = items.every(
      (a) => !a.name && !a.address && !a.checkInDate && !a.checkOutDate && !a.confirmationNumber
    );
    if (allEmpty) {
      emit(
        'update:accommodations',
        props.accommodations.filter((a) => a.type !== type)
      );
    }
  } else {
    addItem(type);
  }
}

function updateItem(index: number, field: keyof VacationAccommodation, value: string) {
  const updated = [...props.accommodations];
  updated[index] = { ...updated[index]!, [field]: value };
  emit('update:accommodations', updated);
}

function removeItem(index: number) {
  const updated = props.accommodations.filter((_, i) => i !== index);
  emit('update:accommodations', updated);
}
</script>

<template>
  <!-- Step header -->
  <div class="mb-5 text-center">
    <div class="text-3xl">🏨</div>
    <h2 class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
      {{ t('vacation.step3.title') }}
    </h2>
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('vacation.step3.subtitle') }}
    </p>
  </div>

  <div class="space-y-4">
    <!-- Add-on pills -->
    <div class="flex flex-wrap justify-center gap-2">
      <button
        v-for="at in accommodationTypes"
        :key="at.type"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-all"
        :class="
          hasType(at.type)
            ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-tint)] dark:bg-[var(--vacation-teal-15)]'
            : 'border-[var(--tint-slate-10)] bg-white hover:border-[var(--vacation-teal-15)] dark:border-slate-700 dark:bg-slate-800'
        "
        @click="togglePill(at.type)"
      >
        <span
          v-if="hasType(at.type)"
          class="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--vacation-teal)] text-[10px] text-white"
        >
          ✓
        </span>
        <span>{{ at.emoji }}</span>
        <span class="font-outfit font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t(`vacation.accommodation.${at.key}` as any) }}
        </span>
      </button>
    </div>

    <!-- Segment cards -->
    <VacationSegmentCard
      v-for="(item, index) in accommodations"
      :key="item.id"
      :icon="emojiMap[item.type]"
      :title="item.title"
      :status="item.status"
      :collapsed="collapsedMap[item.id] ?? false"
      deletable
      @update:title="updateItem(index, 'title', $event)"
      @update:collapsed="collapsedMap[item.id] = $event"
      @delete="removeItem(index)"
    >
      <div class="space-y-3">
        <FormFieldGroup :label="t('vacation.field.hotelName')">
          <BaseInput
            :model-value="item.name ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'name', String($event))"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('vacation.field.address')">
          <BaseInput
            :model-value="item.address ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'address', String($event))"
          />
        </FormFieldGroup>

        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.checkIn')">
            <BaseInput
              type="date"
              :model-value="item.checkInDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'checkInDate', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.checkOut')">
            <BaseInput
              type="date"
              :model-value="item.checkOutDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'checkOutDate', String($event))"
            />
          </FormFieldGroup>
        </div>

        <FormFieldGroup :label="t('vacation.field.confirmationNumber')">
          <BaseInput
            :model-value="item.confirmationNumber ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'confirmationNumber', String($event))"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('vacation.field.roomType')">
          <BaseInput
            :model-value="item.roomType ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'roomType', String($event))"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('vacation.field.contactPhone')">
          <BaseInput
            type="tel"
            :model-value="item.contactPhone ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'contactPhone', String($event))"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('vacation.field.notes')">
          <BaseInput
            :model-value="item.notes ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'notes', String($event))"
          />
        </FormFieldGroup>

        <!-- Status selector -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="s in statusOptions"
            :key="s.value"
            type="button"
            class="rounded-lg px-2.5 py-1 text-xs font-semibold transition-all"
            :class="
              item.status === s.value
                ? 'bg-[var(--vacation-teal)] text-white'
                : 'bg-[var(--tint-slate-5)] text-gray-500 hover:bg-[var(--tint-slate-10)] dark:bg-slate-700 dark:text-gray-400'
            "
            @click="updateItem(index, 'status', s.value)"
          >
            {{ t(s.key as any) }}
          </button>
        </div>
      </div>
    </VacationSegmentCard>

    <!-- Add Another Stay button -->
    <button
      v-if="accommodations.length > 0"
      type="button"
      class="w-full rounded-xl border border-dashed border-[var(--vacation-teal-15)] py-2.5 text-sm font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-tint)] dark:hover:bg-[var(--vacation-teal-15)]"
      @click="addItem(accommodations[accommodations.length - 1]!.type)"
    >
      + {{ t('vacation.addAnotherStay') }}
    </button>
  </div>
</template>

<style scoped>
.vacation-teal-input :deep(input) {
  --tw-ring-color: var(--vacation-teal);
}

.vacation-teal-input :deep(input:focus) {
  border-color: var(--vacation-teal);
  box-shadow: 0 0 0 3px var(--vacation-teal-tint);
}
</style>
