<script setup lang="ts">
/**
 * ResponsibilityExportBody — one page of the Who Owns What fridge sheet (#109), slotted
 * into `ExportSheet`. Three columns of category blocks (pre-flowed by `paginateExport`);
 * each card is its emoji, name, done line and holder initial pills in the member's colour,
 * with a split part's label beside its pill. A card nobody holds gets a dashed line to
 * write a name on. A dumb renderer of a pre-built model: no store, no i18n.
 *
 * Static print artifact, light only; px-pinned type to match ExportSheet (the metrics
 * here are what `EXPORT_LAYOUT` estimates).
 */
import type { ExportPage } from '@/utils/responsibilityExportModel';

defineProps<{ page: ExportPage }>();
</script>

<template>
  <div class="cols">
    <div v-for="(col, i) in page.columns" :key="i" class="col">
      <section
        v-for="block in col"
        :key="block.key"
        class="block"
        :style="{ '--pc': block.color }"
        :data-testid="`export-block-${block.key}`"
      >
        <h4 class="block-head">
          <span aria-hidden="true">{{ block.emoji }}</span> {{ block.title }}
        </h4>
        <div v-for="card in block.cards" :key="card.id" class="row">
          <span class="emoji" aria-hidden="true">{{ card.emoji }}</span>
          <div class="text">
            <b>{{ card.name }}</b>
            <small v-if="card.done">{{ card.done }}</small>
          </div>
          <span v-if="card.writeIn" class="write-in" />
          <span v-else class="pills">
            <span v-for="(h, j) in card.holders" :key="j" class="holder">
              <span v-if="h.initial" class="pill" :style="{ background: h.color || '#2C3E50' }">{{
                h.initial
              }}</span>
              <span v-else class="write-in small" />
              <span v-if="h.label" class="label">{{ h.label }}</span>
            </span>
          </span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* stylelint-disable declaration-property-value-disallowed-list -- fixed-size print
   artifact: px is intentional (matches ExportSheet). */
.cols {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block {
  background: #fff;
  border: 1px solid rgb(44 62 80 / 8%);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.block-head {
  background: color-mix(in srgb, var(--pc) 16%, #fff);
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  padding: 8px 10px;
  text-transform: uppercase;
}

.row {
  align-items: start;
  border-top: 1px dashed rgb(44 62 80 / 10%);
  display: grid;
  gap: 6px;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  padding: 6px 10px;
}

.block-head + .row {
  border-top: 0;
}

.emoji {
  font-size: 13px;
  line-height: 1.3;
}

.text b {
  color: #2c3e50;
  display: block;
  font-family: Outfit, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}

.text small {
  color: rgb(44 62 80 / 62%);
  display: block;
  font-size: 10px;
  line-height: 1.3;
}

.pills {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 96px;
}

.holder {
  align-items: center;
  display: inline-flex;
  gap: 3px;
}

/* A pill, not a fixed circle: two-letter initials widen it (same as ExportPeopleLegend). */
.pill {
  border-radius: 999px;
  box-sizing: border-box;
  color: #fff;
  font-family: Outfit, sans-serif;
  font-size: 10px;
  font-weight: 700;
  height: 16px;
  line-height: 16px;
  min-width: 16px;
  padding: 0 4px;
  text-align: center;
}

.label {
  color: rgb(44 62 80 / 62%);
  font-family: Outfit, sans-serif;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.write-in {
  align-self: end;
  border-bottom: 1.5px dashed rgb(44 62 80 / 45%);
  display: inline-block;
  height: 14px;
  width: 64px;
}

.write-in.small {
  width: 28px;
}
</style>
