<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort } from '@/utils/date';
import type {
  VacationTransportation,
  VacationTransportationType,
  VacationSegmentStatus,
} from '@/types/models';
import { generateUUID } from '@/utils/id';
import { prefillTransportationDates } from '@/utils/vacation';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';

const props = withDefaults(
  defineProps<{
    transportation: VacationTransportation[];
    tripStartDate?: string;
    tripEndDate?: string;
  }>(),
  {
    tripStartDate: '',
    tripEndDate: '',
  }
);

const emit = defineEmits<{
  'update:transportation': [value: VacationTransportation[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});

const transportTypes: { type: VacationTransportationType; emoji: string; key: string }[] = [
  { type: 'airport_shuttle', emoji: '🚐', key: 'airport_shuttle' },
  { type: 'rental_car', emoji: '🚗', key: 'rental_car' },
  { type: 'taxi_rideshare', emoji: '🚕', key: 'taxi_rideshare' },
  { type: 'bus', emoji: '🚌', key: 'bus' },
];

const statusOptions: { value: VacationSegmentStatus; key: string }[] = [
  { value: 'pending', key: 'vacation.status.pending' },
  { value: 'booked', key: 'vacation.status.booked' },
];

const emojiMap: Record<VacationTransportationType, string> = {
  airport_shuttle: '🚐',
  rental_car: '🚗',
  taxi_rideshare: '🚕',
  bus: '🚌',
};

function addItem(type: VacationTransportationType) {
  const base: VacationTransportation = {
    id: generateUUID(),
    type,
    title: t(`vacation.transport.${type}` as any),
    status: 'pending',
  };
  const item =
    props.tripStartDate || props.tripEndDate
      ? prefillTransportationDates(
          base,
          props.tripStartDate || undefined,
          props.tripEndDate || undefined
        )
      : base;
  collapsedMap.value[item.id] = false;
  emit('update:transportation', [...props.transportation, item]);
}

function updateItem(index: number, field: keyof VacationTransportation, value: string) {
  const updated = [...props.transportation];
  updated[index] = { ...updated[index]!, [field]: value };
  emit('update:transportation', updated);
}

function updateStatus(index: number, value: string) {
  const current = props.transportation[index]!;
  if (current.status === value) {
    updateItem(index, 'status', 'pending');
  } else {
    updateItem(index, 'status', value);
  }
}

function removeItem(index: number) {
  const updated = props.transportation.filter((_, i) => i !== index);
  emit('update:transportation', updated);
}

function buildTransportKeyValue(item: VacationTransportation): string {
  const parts: string[] = [];
  if (item.agencyName) parts.push(item.agencyName);
  else if (item.operator) parts.push(item.operator);
  if (item.pickupDate) parts.push(formatDateShort(item.pickupDate).toLowerCase());
  if (item.pickupTime) parts.push(item.pickupTime);
  if (item.bookingReference) parts.push(item.bookingReference);
  return parts.join(' · ');
}

function isBus(type: VacationTransportationType): boolean {
  return type === 'bus';
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

  <div class="space-y-3">
    <!-- Segment cards -->
    <VacationSegmentCard
      v-for="(item, index) in transportation"
      :key="item.id"
      :icon="emojiMap[item.type]"
      :title="item.title"
      :status="item.status"
      :key-value="buildTransportKeyValue(item)"
      :collapsed="collapsedMap[item.id] ?? true"
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
        <template v-if="isBus(item.type)">
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

    <!-- ═══ Initial selector — large cards (shown when no transportation yet) ═══ -->
    <div v-if="transportation.length === 0" class="grid grid-cols-2 gap-2">
      <button
        v-for="tt in transportTypes"
        :key="tt.type"
        type="button"
        class="relative flex flex-col items-center rounded-xl border border-transparent bg-white p-3 transition-all duration-150 hover:-translate-y-[1px] hover:border-[var(--vacation-teal-15)] dark:bg-slate-800"
        @click="addItem(tt.type)"
      >
        <span class="text-2xl">{{ tt.emoji }}</span>
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t(`vacation.transport.${tt.key}` as any) }}
        </span>
      </button>
    </div>

    <!-- ═══ Add-more pills (shown after at least one transportation exists) ═══ -->
    <div v-else class="mt-4 flex flex-wrap gap-2">
      <button
        v-for="tt in transportTypes"
        :key="tt.type"
        type="button"
        class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
        @click="addItem(tt.type)"
      >
        + {{ tt.emoji }} {{ t(`vacation.transport.${tt.key}` as any) }}
      </button>
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
