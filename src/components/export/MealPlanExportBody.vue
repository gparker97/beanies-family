<script setup lang="ts">
/**
 * MealPlanExportBody — the meal grid slotted into `ExportSheet` (days across,
 * four slot rows down). A dumb renderer of a pre-built `MealExportRows`
 * view-model (`buildMealExportRows`): every label is already resolved and cell
 * chrome is emoji/colour only, so it holds no store or i18n coupling. #66 will
 * add its own `AgendaExportBody` against the same slot contract.
 *
 * Static print artifact: no "today" highlight, no cooked ticks. Rows are
 * content-sized (never clip); px-pinned type (matches ExportSheet).
 */
import type { MealExportRows } from '@/utils/mealExportModel';
import type { MealSlot } from '@/types/models';

const props = defineProps<{ rows: MealExportRows }>();

/** Grid columns: a slot-label rail + one equal column per day. */
const columns = `74px repeat(${props.rows.dayColumns.length}, minmax(0, 1fr))`;

/** Fixed per-slot glyph for the rail (presentation, not translated). */
/**
 * Print counterparts of `MealWeekBoard`'s `SLOT_META.band`, at print alphas.
 *
 * Deliberately a touch stronger than the screen values: a laser printer loses the bottom
 * few percent of a tint entirely, so the screen's 4-7% would come out as plain white paper.
 */
const SLOT_BAND: Record<MealSlot, string> = {
  breakfast: 'rgb(230 166 74 / 14%)',
  lunch: 'rgb(174 214 241 / 22%)',
  dinner: 'rgb(241 93 34 / 10%)',
  snack: 'rgb(39 174 96 / 12%)',
};

const SLOT_ICON: Record<MealSlot, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: columns }">
    <!-- Day-header row: empty corner + one heading per day. -->
    <div class="corner" />
    <div v-for="col in rows.dayColumns" :key="col.dateISO" class="day-head">
      {{ col.weekday }}<span class="day-num">{{ col.dayNum }}</span>
    </div>

    <!-- One row per slot. -->
    <template v-for="row in rows.rows" :key="row.slot">
      <div class="slot-head" :style="{ '--slot-band': SLOT_BAND[row.slot] }">
        <span class="slot-ic" aria-hidden="true">{{ SLOT_ICON[row.slot] }}</span
        >{{ row.slotLabel }}
      </div>
      <div
        v-for="(cell, i) in row.cells"
        :key="`${row.slot}-${i}`"
        class="cell"
        :class="{ empty: cell.length === 0 }"
      >
        <div
          v-for="(meal, j) in cell"
          :key="meal.id"
          class="dish"
          :class="{ divided: j > 0, type: meal.isType }"
        >
          <div class="dish-name">{{ meal.name }}</div>
          <!--
            The cook is a chip, not a chip plus their name — the same convention the app's
            cards use, and print space is tighter still. The legend at the foot of the sheet
            is what maps a colour to a person, so the name here was the third time the page
            said it.
          -->
          <div v-if="meal.cook" class="dish-who">
            <span class="cook-dot" :style="{ background: meal.cook.color || '#2C3E50' }">{{
              meal.cook.initial
            }}</span>
          </div>
          <div v-if="meal.serveTime || meal.guestCount" class="dish-meta">
            <span v-if="meal.serveTime">⏰ {{ meal.serveTime }}</span>
            <span v-if="meal.guestCount">👥 +{{ meal.guestCount }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* stylelint-disable declaration-property-value-disallowed-list -- fixed-size print
   artifact: px is intentional (matches ExportSheet; must not rescale). */
.grid {
  display: grid;
  flex: 1;
  font-family: Inter, system-ui, sans-serif;
  gap: 5px;
  grid-template-rows: auto repeat(4, minmax(116px, auto));
}

.corner {
  grid-column: 1;
}

.day-head {
  align-self: end;
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 15px;
  font-weight: 700;
  padding-bottom: 3px;
  text-align: center;
}

.day-num {
  color: rgb(44 62 80 / 45%);
  display: block;
  font-size: 12px;
  font-weight: 500;
}

.slot-head {
  align-items: center;

  /* Matches the screen's row band so the printed sheet and the app read as one system. */
  background: var(--slot-band, rgb(44 62 80 / 5%));
  border-radius: 10px;
  color: rgb(44 62 80 / 55%);
  display: flex;
  flex-direction: column;
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 700;
  gap: 4px;
  justify-content: center;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.slot-ic {
  font-size: 17px;
}

.cell {
  background: #fff;
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 8px;
}

.cell.empty {
  align-items: center;
  border-color: rgb(44 62 80 / 12%);
  border-style: dashed;
  justify-content: center;
}

/*
 * An empty slot on a sheet pinned to the fridge is an INVITATION, so it gets a line to
 * write on rather than a middot standing in for "nothing here". The dot said the cell was
 * empty, which the reader could already see.
 */
.cell.empty::before {
  border-bottom: 1px solid rgb(44 62 80 / 16%);
  content: '';
  width: 74%;
}

.dish.divided {
  border-top: 1px dashed rgb(44 62 80 / 14%);
  padding-top: 5px;
}

.dish-name {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.18;
}

.dish.type .dish-name {
  color: rgb(44 62 80 / 62%);
  font-style: italic;
  font-weight: 600;
}

.dish-who {
  align-items: center;
  color: rgb(44 62 80 / 60%);
  display: flex;
  font-size: 12px;
  gap: 4px;
  margin-top: 3px;
}

.cook-dot {
  align-items: center;
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  flex: none;
  font-family: Outfit, sans-serif;
  font-size: 10px;
  font-weight: 700;
  height: 16px;
  justify-content: center;
  width: 16px;
}

.dish-meta {
  color: rgb(44 62 80 / 50%);
  display: flex;
  flex-wrap: wrap;
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 600;
  gap: 4px 8px;
  margin-top: 3px;
}
</style>
