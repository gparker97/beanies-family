<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import type {
  VacationTransportation,
  VacationTransportationType,
  VacationSegmentStatus,
} from '@/types/models';
import { generateUUID } from '@/utils/id';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';

const props = defineProps<{
  transportation: VacationTransportation[];
}>();

const emit = defineEmits<{
  'update:transportation': [value: VacationTransportation[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});

const transportTypes: { type: VacationTransportationType; emoji: string; key: string }[] = [
  { type: 'airport_shuttle', emoji: '🚐', key: 'airport_shuttle' },
  { type: 'rental_car', emoji: '🚗', key: 'rental_car' },
  { type: 'taxi_rideshare', emoji: '🚕', key: 'taxi_rideshare' },
  { type: 'train', emoji: '🚂', key: 'train' },
  { type: 'bus', emoji: '🚌', key: 'bus' },
];

const statusOptions: { value: VacationSegmentStatus; key: string }[] = [
  { value: 'not_booked', key: 'vacation.status.not_booked' },
  { value: 'researching', key: 'vacation.status.researching' },
  { value: 'pending', key: 'vacation.status.pending' },
  { value: 'booked', key: 'vacation.status.booked' },
];

const emojiMap: Record<VacationTransportationType, string> = {
  airport_shuttle: '🚐',
  rental_car: '🚗',
  taxi_rideshare: '🚕',
  train: '🚂',
  bus: '🚌',
};

function hasType(type: VacationTransportationType): boolean {
  return props.transportation.some((t) => t.type === type);
}

function addItem(type: VacationTransportationType) {
  const item: VacationTransportation = {
    id: generateUUID(),
    type,
    title: t(`vacation.transport.${type}` as any),
    status: 'not_booked',
  };
  emit('update:transportation', [...props.transportation, item]);
}

function togglePill(type: VacationTransportationType) {
  if (hasType(type)) {
    const items = props.transportation.filter((tr) => tr.type === type);
    const allEmpty = items.every(
      (tr) => !tr.bookingReference && !tr.pickupDate && !tr.pickupTime && !tr.returnDate
    );
    if (allEmpty) {
      emit(
        'update:transportation',
        props.transportation.filter((tr) => tr.type !== type)
      );
    }
  } else {
    addItem(type);
  }
}

function updateItem(index: number, field: keyof VacationTransportation, value: string) {
  const updated = [...props.transportation];
  updated[index] = { ...updated[index]!, [field]: value };
  emit('update:transportation', updated);
}

function updateStatus(index: number, value: string) {
  const current = props.transportation[index]!;
  if (current.status === value) {
    updateItem(index, 'status', 'not_booked');
  } else {
    updateItem(index, 'status', value);
  }
}

function removeItem(index: number) {
  const updated = props.transportation.filter((_, i) => i !== index);
  emit('update:transportation', updated);
}

function isTrainOrBus(type: VacationTransportationType): boolean {
  return type === 'train' || type === 'bus';
}
</script>

<template>
  <!-- Step header -->
  <div class="mb-5 text-center">
    <div class="text-3xl">🚕</div>
    <h2 class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
      {{ t('vacation.step4.title') }}
    </h2>
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('vacation.step4.subtitle') }}
    </p>
  </div>

  <div class="space-y-4">
    <!-- Add-on pills -->
    <div class="flex flex-wrap justify-center gap-2">
      <button
        v-for="tt in transportTypes"
        :key="tt.type"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-all"
        :class="
          hasType(tt.type)
            ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-tint)] dark:bg-[var(--vacation-teal-15)]'
            : 'border-[var(--tint-slate-10)] bg-white hover:border-[var(--vacation-teal-15)] dark:border-slate-700 dark:bg-slate-800'
        "
        @click="togglePill(tt.type)"
      >
        <span
          v-if="hasType(tt.type)"
          class="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--vacation-teal)] text-[10px] text-white"
        >
          ✓
        </span>
        <span>{{ tt.emoji }}</span>
        <span class="font-outfit font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t(`vacation.transport.${tt.key}` as any) }}
        </span>
      </button>
    </div>

    <!-- Segment cards -->
    <VacationSegmentCard
      v-for="(item, index) in transportation"
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

        <!-- Train/Bus fields -->
        <template v-if="isTrainOrBus(item.type)">
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.operator')">
              <BaseInput
                :model-value="item.operator ?? ''"
                :placeholder="t('vacation.field.operator')"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'operator', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.route')">
              <BaseInput
                :model-value="item.route ?? ''"
                :placeholder="t('vacation.field.route')"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'route', String($event))"
              />
            </FormFieldGroup>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.departureStation')">
              <BaseInput
                :model-value="item.departureStation ?? ''"
                :placeholder="t('vacation.field.departureStation')"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'departureStation', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.arrivalStation')">
              <BaseInput
                :model-value="item.arrivalStation ?? ''"
                :placeholder="t('vacation.field.arrivalStation')"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'arrivalStation', String($event))"
              />
            </FormFieldGroup>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.departureDate')">
              <BaseInput
                type="date"
                :model-value="item.departureDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'departureDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.departureTime')">
              <BaseInput
                type="time"
                :model-value="item.departureTime ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'departureTime', String($event))"
              />
            </FormFieldGroup>
          </div>
          <FormFieldGroup :label="t('vacation.field.bookingReference')">
            <BaseInput
              :model-value="item.bookingReference ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'bookingReference', String($event))"
            />
          </FormFieldGroup>
        </template>

        <!-- Rental Car fields -->
        <template v-else-if="item.type === 'rental_car'">
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.agencyName')">
              <BaseInput
                :model-value="item.agencyName ?? ''"
                :placeholder="t('vacation.field.agencyName')"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'agencyName', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.agencyAddress')">
              <div class="relative">
                <BaseInput
                  :model-value="item.agencyAddress ?? ''"
                  :placeholder="t('vacation.field.agencyAddress')"
                  class="vacation-teal-input"
                  @update:model-value="updateItem(index, 'agencyAddress', String($event))"
                />
                <a
                  v-if="item.agencyAddress"
                  :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.agencyAddress)}`"
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
          </div>
          <FormFieldGroup :label="t('vacation.field.bookingReference')">
            <BaseInput
              :model-value="item.bookingReference ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'bookingReference', String($event))"
            />
          </FormFieldGroup>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.pickupDate')">
              <BaseInput
                type="date"
                :model-value="item.pickupDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.pickupTime')">
              <BaseInput
                type="time"
                :model-value="item.pickupTime ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupTime', String($event))"
              />
            </FormFieldGroup>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.returnDate')">
              <BaseInput
                type="date"
                :model-value="item.returnDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'returnDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.returnTime')">
              <BaseInput
                type="time"
                :model-value="item.returnTime ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'returnTime', String($event))"
              />
            </FormFieldGroup>
          </div>
        </template>

        <!-- Airport Shuttle fields -->
        <template v-else-if="item.type === 'airport_shuttle'">
          <FormFieldGroup :label="t('vacation.field.bookingReference')">
            <BaseInput
              :model-value="item.bookingReference ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'bookingReference', String($event))"
            />
          </FormFieldGroup>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.pickupDate')">
              <BaseInput
                type="date"
                :model-value="item.pickupDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.pickupTime')">
              <BaseInput
                type="time"
                :model-value="item.pickupTime ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupTime', String($event))"
              />
            </FormFieldGroup>
          </div>
          <FormFieldGroup :label="t('vacation.field.returnDate')">
            <BaseInput
              type="date"
              :model-value="item.returnDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateItem(index, 'returnDate', String($event))"
            />
          </FormFieldGroup>
        </template>

        <!-- Taxi/Rideshare fields -->
        <template v-else-if="item.type === 'taxi_rideshare'">
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('vacation.field.pickupDate')">
              <BaseInput
                type="date"
                :model-value="item.pickupDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.pickupTime')">
              <BaseInput
                type="time"
                :model-value="item.pickupTime ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateItem(index, 'pickupTime', String($event))"
              />
            </FormFieldGroup>
          </div>
        </template>

        <!-- Notes (all types) -->
        <FormFieldGroup :label="t('vacation.field.notes')">
          <BaseInput
            :model-value="item.notes ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateItem(index, 'notes', String($event))"
          />
        </FormFieldGroup>
      </div>
    </VacationSegmentCard>

    <!-- Add Another Transport button -->
    <button
      v-if="transportation.length > 0"
      type="button"
      class="w-full rounded-xl border border-dashed border-[var(--vacation-teal-15)] py-2.5 text-sm font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-tint)] dark:hover:bg-[var(--vacation-teal-15)]"
      @click="addItem(transportation[transportation.length - 1]!.type)"
    >
      + {{ t('vacation.addAnotherTransport') }}
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
