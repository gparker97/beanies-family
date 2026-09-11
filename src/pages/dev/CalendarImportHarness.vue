<script setup lang="ts">
/**
 * DEV-ONLY browser harness for the calendar import review (#94).
 *
 * The real screen sits behind a Google OAuth connection, so it cannot be reached
 * from an automated browser run. This seeds the import store with fixture
 * candidates and opens the drawer, so the things that only a real browser can
 * answer are actually answerable: row height at 200 rows, sticky day headers and
 * action bar, truncation, dark mode, and phone width.
 *
 * Same pattern and same DEV gate as `/dev/worker-spike`. It is stripped from
 * production builds and is not reachable from any nav.
 */
import { onMounted, ref } from 'vue';

import CalendarImportModal from '@/components/settings/CalendarImportModal.vue';
import { useCalendarImportStore } from '@/stores/calendarImportStore';
import type { ImportCandidate } from '@/utils/calendar/planImport';
import type { CreateFamilyActivityInput } from '@/types/models';

const open = ref(false);

const TITLES = [
  'Joey swimming',
  'Parents evening, Year 4',
  'Ollie football',
  'Piano lesson',
  'School photos',
  'Dentist',
  'Standup',
  'Ollie orthodontist',
  'Swimming gala',
  'Cub scouts',
];

function draft(title: string, date: string, allDay: boolean): CreateFamilyActivityInput {
  return {
    title,
    date,
    isAllDay: allDay,
    ...(allDay ? {} : { startTime: '16:00', endTime: '16:45' }),
    recurrence: 'none',
    category: 'other_activity',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm1',
    assigneeIds: ['m1'],
  } as CreateFamilyActivityInput;
}

/** 60 candidates across ~20 days, so scrolling and sticky headers are exercised. */
function makeCandidates(): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  for (let i = 0; i < 60; i++) {
    const day = 15 + Math.floor(i / 3);
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    const title = TITLES[i % TITLES.length];
    const mode = i % 5;
    out.push({
      googleEventId: `g-${i}`,
      connectionId: 'c1',
      calendarId: 'dest',
      calendarLabel: 'Greg Parker',
      outcome: mode === 1 ? 'copy' : mode === 3 ? 'unsupported-recurrence' : 'adopt',
      origin: mode === 0 || mode === 2 || mode === 4 ? 'adopted' : 'external',
      alreadyImported: i === 9,
      draft: {
        ...draft(title, date, i % 7 === 0),
        ...(i % 4 === 0 ? { location: 'Katong Swimming Complex' } : {}),
        // A real `rule`, because the repeat chip now renders through the canonical
        // `useRecurrenceLabel` rather than a string the planner used to invent.
        ...(mode === 0
          ? {
              recurrence: 'weekly' as const,
              rule: {
                unit: 'week' as const,
                interval: 1,
                weekdays: [2],
                end: { kind: 'never' as const },
              },
            }
          : mode === 2
            ? {
                recurrence: 'biweekly' as const,
                rule: {
                  unit: 'week' as const,
                  interval: 2,
                  weekdays: [4],
                  end: { kind: 'never' as const },
                },
              }
            : {}),
      },
    });
  }
  return out;
}

onMounted(() => {
  const store = useCalendarImportStore();
  store.$patch({
    phase: 'reviewing',
    candidates: makeCandidates(),
    selectedIds: new Set(
      makeCandidates()
        .filter((c) => !c.alreadyImported)
        .map((c) => c.googleEventId)
    ),
    truncated: true,
    skippedCalendars: [{ id: 'hols', reason: 'forbidden' }],
  });
  open.value = true;
});
</script>

<template>
  <div class="p-6" data-testid="import-harness">
    <CalendarImportModal v-if="open" :open="true" connection-id="c1" @close="open = false" />
  </div>
</template>
