<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort, extractDatePart } from '@/utils/date';
import type {
  VacationAccommodation,
  VacationAccommodationType,
  VacationSegmentStatus,
  VacationTravelSegment,
} from '@/types/models';
import { generateUUID } from '@/utils/id';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';

const props = defineProps<{
  accommodations: VacationAccommodation[];
  travelSegments?: VacationTravelSegment[];
}>();

const emit = defineEmits<{
  'update:accommodations': [value: VacationAccommodation[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});
const showAddPicker = ref(false);

const accommodationTypes: { type: VacationAccommodationType; emoji: string; key: string }[] = [
  { type: 'hotel', emoji: '🏨', key: 'hotel' },
  { type: 'airbnb', emoji: '🏠', key: 'airbnb' },
  { type: 'campground', emoji: '🏕️', key: 'campground' },
  { type: 'family_friends', emoji: '👨‍👩‍👧', key: 'family_friends' },
];

const statusOptions: { value: VacationSegmentStatus; key: string }[] = [
  { value: 'pending', key: 'vacation.status.pending' },
  { value: 'booked', key: 'vacation.status.booked' },
];

const emojiMap: Record<VacationAccommodationType, string> = {
  hotel: '🏨',
  airbnb: '🏠',
  campground: '🏕️',
  family_friends: '👨‍👩‍👧',
};

const nameFieldKey: Record<VacationAccommodationType, string> = {
  hotel: 'vacation.field.hotelName',
  airbnb: 'vacation.field.propertyName',
  campground: 'vacation.field.campgroundName',
  family_friends: 'vacation.field.hostName',
};

/** Derive check-in/out from outbound arrival and return departure dates */
const flightDates = computed(() => {
  const segs = props.travelSegments ?? [];
  const outbound = segs.find((s) => s.type === 'flight_outbound');
  const ret = segs.find((s) => s.type === 'flight_return');
  return {
    checkIn: outbound?.arrivalDate ? extractDatePart(outbound.arrivalDate) : undefined,
    checkOut: ret?.departureDate ? extractDatePart(ret.departureDate) : undefined,
  };
});

function hasType(type: VacationAccommodationType): boolean {
  return props.accommodations.some((a) => a.type === type);
}

function addItem(type: VacationAccommodationType) {
  const item: VacationAccommodation = {
    id: generateUUID(),
    type,
    title: t(`vacation.accommodation.${type}` as any),
    status: 'pending',
    checkInDate: flightDates.value.checkIn,
    checkOutDate: flightDates.value.checkOut,
  };
  showAddPicker.value = false;
  emit('update:accommodations', [...props.accommodations, item]);
}

function togglePill(type: VacationAccommodationType) {
  if (hasType(type)) {
    // Deselect: remove only if all items of this type are empty
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
    // Single-select: replace with the new type
    const item: VacationAccommodation = {
      id: generateUUID(),
      type,
      title: t(`vacation.accommodation.${type}` as any),
      status: 'pending',
      checkInDate: flightDates.value.checkIn,
      checkOutDate: flightDates.value.checkOut,
    };
    emit('update:accommodations', [item]);
  }
}

function updateItem(index: number, field: keyof VacationAccommodation, value: string | boolean) {
  const updated = [...props.accommodations];
  updated[index] = { ...updated[index]!, [field]: value };
  emit('update:accommodations', updated);
}

function updateStatus(index: number, value: string) {
  const current = props.accommodations[index]!;
  // Single-select: clicking current status resets to 'pending'
  if (current.status === value) {
    updateItem(index, 'status', 'pending');
  } else {
    updateItem(index, 'status', value);
  }
}

function removeItem(index: number) {
  const updated = props.accommodations.filter((_, i) => i !== index);
  emit('update:accommodations', updated);
}

function buildAccomKeyValue(item: VacationAccommodation): string {
  const parts: string[] = [];
  if (item.name) parts.push(item.name);
  if (item.checkInDate && item.checkOutDate) {
    parts.push(
      `${formatDateShort(item.checkInDate).toLowerCase()} – ${formatDateShort(item.checkOutDate).toLowerCase()}`
    );
  } else if (item.checkInDate) {
    parts.push(formatDateShort(item.checkInDate).toLowerCase());
  }
  if (item.confirmationNumber) parts.push(item.confirmationNumber);
  return parts.join(' · ');
}

function showsConfirmationNumber(type: VacationAccommodationType): boolean {
  return type !== 'family_friends';
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
      :key-value="buildAccomKeyValue(item)"
      :collapsed="collapsedMap[item.id] ?? false"
      deletable
      @update:title="updateItem(index, 'title', $event)"
      @update:collapsed="collapsedMap[item.id] = $event"
      @delete="removeItem(index)"
    >
      <div class="space-y-3">
        <!-- Status selector (top of card) -->
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
            @click="updateStatus(index, s.value)"
          >
            {{ t(s.key as any) }}
          </button>
        </div>

        <!-- Name field (label changes by type) -->
        <FormFieldGroup :label="t(nameFieldKey[item.type] as any)">
          <BaseInput
            :model-value="item.name ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'name', String($event))"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('vacation.field.address')">
          <div class="relative">
            <BaseInput
              :model-value="item.address ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'address', String($event))"
            />
            <a
              v-if="item.address"
              :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`"
              target="_blank"
              rel="noopener noreferrer"
              class="absolute top-1/2 right-2 -translate-y-1/2 text-sm opacity-40 transition-opacity hover:opacity-80"
              :title="t('vacation.field.openInMaps')"
              @click.stop
            >
              📍
            </a>
          </div>
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

        <FormFieldGroup
          v-if="showsConfirmationNumber(item.type)"
          :label="t('vacation.field.confirmationNumber')"
        >
          <BaseInput
            :model-value="item.confirmationNumber ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'confirmationNumber', String($event))"
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
      </div>
    </VacationSegmentCard>

    <!-- Add Another Stay button with mini picker -->
    <div v-if="accommodations.length > 0">
      <button
        type="button"
        class="w-full rounded-xl border border-dashed border-[var(--vacation-teal-15)] py-2.5 text-sm font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-tint)] dark:hover:bg-[var(--vacation-teal-15)]"
        @click="showAddPicker = !showAddPicker"
      >
        + {{ t('vacation.addAnotherStay') }}
      </button>
      <!-- Mini type picker -->
      <div v-if="showAddPicker" class="mt-2 flex flex-wrap justify-center gap-2">
        <button
          v-for="at in accommodationTypes"
          :key="at.type"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--tint-slate-10)] bg-white px-3 py-1.5 text-sm transition-all hover:border-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-tint)] dark:border-slate-700 dark:bg-slate-800 dark:hover:border-[var(--vacation-teal)]"
          @click="addItem(at.type)"
        >
          <span>{{ at.emoji }}</span>
          <span class="font-outfit font-semibold text-[var(--color-text)] dark:text-gray-100">
            {{ t(`vacation.accommodation.${at.key}` as any) }}
          </span>
        </button>
      </div>
    </div>
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
