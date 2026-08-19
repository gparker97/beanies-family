<script setup lang="ts">
/**
 * MealPlanExportBody — the meal grid slotted into `ExportSheet` (days across,
 * four slot rows down). A dumb renderer of a pre-built `MealExportRows`
 * view-model (`buildMealExportRows`), so it holds no store or i18n coupling —
 * every label is already resolved, and cell chrome is emoji/colour only. #66
 * will add its own `AgendaExportBody` against the same slot contract.
 *
 * Static print artifact: no "today" highlight, no cooked ticks. Px-pinned type
 * for the same reason as `ExportSheet` (fixed-size export, must not rescale).
 */
import type { MealExportRows } from '@/utils/mealExportModel';

const props = defineProps<{ rows: MealExportRows }>();

/** Grid columns: a slot-label gutter + one equal column per day. */
const columns = `104px repeat(${props.rows.dayColumns.length}, minmax(0, 1fr))`;
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: columns }">
    <!-- Day-header row: empty corner + one heading per day. -->
    <div class="corner" />
    <div v-for="col in rows.dayColumns" :key="col.dateISO" class="day-head">{{ col.label }}</div>

    <!-- One row per slot. -->
    <template v-for="row in rows.rows" :key="row.slot">
      <div class="slot-head">{{ row.slotLabel }}</div>
      <div v-for="(cell, i) in row.cells" :key="`${row.slot}-${i}`" class="cell">
        <template v-if="cell.length">
          <div
            v-for="(meal, j) in cell"
            :key="meal.id"
            class="meal"
            :class="{ 'meal-divided': j > 0 }"
          >
            <p class="meal-name">{{ meal.name }}</p>
            <div class="meal-meta">
              <span v-if="meal.cook" class="cook">
                <span class="cook-dot" :style="{ background: meal.cook.color || '#2C3E50' }">{{
                  meal.cook.initial
                }}</span>
                <span class="cook-name">{{ meal.cook.name }}</span>
              </span>
              <span v-if="meal.serveTime" class="meta-chip">🕐 {{ meal.serveTime }}</span>
              <span v-if="meal.guests" class="meta-chip">👥 {{ meal.guests.join(', ') }}</span>
            </div>
          </div>
        </template>
        <span v-else class="empty" aria-hidden="true">–</span>
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
  gap: 6px;
  grid-auto-rows: minmax(0, 1fr);
  min-height: 0;
}

/* corner + day-heads are the first N+1 grid items, so auto-placement fills
   row 1 with them (columns = 1 gutter + N days) — no explicit grid-row needed. */
.day-head {
  align-items: center;
  background: rgb(174 214 241 / 30%);
  border-radius: 12px;
  color: #2c3e50;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 15px;
  font-weight: 700;
  justify-content: center;
  padding: 6px 4px;
  text-align: center;
}

.slot-head {
  align-items: center;
  color: rgb(44 62 80 / 55%);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 0 10px;
  text-transform: uppercase;
}

.cell {
  background: rgb(44 62 80 / 4%);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
  padding: 8px 9px;
}

.meal-divided {
  border-top: 1px solid rgb(44 62 80 / 10%);
  padding-top: 5px;
}

.meal-name {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  margin: 0;
}

.meal-meta {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 8px;
  margin-top: 3px;
}

.cook {
  align-items: center;
  display: inline-flex;
  gap: 5px;
}

.cook-dot {
  align-items: center;
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 700;
  height: 18px;
  justify-content: center;
  width: 18px;
}

.cook-name,
.meta-chip {
  color: rgb(44 62 80 / 70%);
  font-size: 12px;
}

.empty {
  align-items: center;
  color: rgb(44 62 80 / 20%);
  display: flex;
  flex: 1;
  font-size: 18px;
  justify-content: center;
}
</style>
