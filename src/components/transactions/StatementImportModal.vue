<script setup lang="ts">
/**
 * The statement import review (#107), mockup direction B: one drawer, every line the statement
 * held, what already exists shown beside what the statement says, and one confirm.
 *
 * The drawer holds NO list state and no list logic. Every control calls the store (`decide`,
 * `decideAll`, `editDraft`, `setAccount`, `readDroppedPage`) and renders from its computeds, so
 * the totals, the confirm label and the commit can never disagree with what is on screen.
 *
 * No extra confirm step, deliberately unlike the calendar import: every line is already on
 * screen with its decision, and the button states the exact effect ("Add 169, Merge 6").
 * The drawer body is the single scroll context, so the sticky day headers stick against it.
 */
import { computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TickButton from '@/components/ui/TickButton.vue';
import AccountSelect from '@/components/ui/AccountSelect.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import MagicMiscategorisedBanner from '@/components/ai/MagicMiscategorisedBanner.vue';
import StatementImportRow from '@/components/transactions/StatementImportRow.vue';
import StatementImportPairCard from '@/components/transactions/StatementImportPairCard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAccountOptionGroups } from '@/composables/useAccountOptionGroups';
import { showToast } from '@/composables/useToast';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useStatementImportStore } from '@/stores/statementImportStore';
import { REVIEW_CHIP_TONES } from '@/constants/reviewChipTones';
import { STATEMENT_MAX_UNITS } from '@/services/ai/statementExtraction';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort, formatDayLong } from '@/utils/date';
import { groupByDay } from '@/utils/groupByDay';
import type { CreateTransactionInput } from '@/types/models';

const { t } = useTranslation();
const store = useStatementImportStore();
const accountsStore = useAccountsStore();
const transactionsStore = useTransactionsStore();
const { groupsFor } = useAccountOptionGroups();

const open = computed(() => store.phase !== 'idle');
const result = computed(() => store.read?.result ?? null);
const accountGroups = computed(() => groupsFor(accountsStore.activeAccounts));
const account = computed(() => accountsStore.accounts.find((a) => a.id === store.accountId));

/** Candidates grouped by date, in statement order. */
/**
 * Candidates grouped by date. Sorted first (a stable sort keeps statement order within a day):
 * `groupByDay` groups CONSECUTIVE runs, and a statement ordered by posting date, a "read it
 * anyway" page appended at the end, or an edited date would otherwise draw one day twice.
 */
const days = computed(() =>
  groupByDay(
    [...store.candidates].sort((a, b) => a.draft.date.localeCompare(b.draft.date)),
    (c) => c.draft.date
  )
);

const lines = computed(() => result.value?.lines ?? []);

/** "SCB Visa ••0042 · 20 Aug to 18 Sep · 178 lines" */
const subtitle = computed(() => {
  const r = result.value;
  if (!r) return '';
  const parts: string[] = [];
  const who = [r.account.institution, r.account.last4 ? `••${r.account.last4}` : '']
    .filter(Boolean)
    .join(' ');
  if (who) parts.push(who);
  if (r.period.from && r.period.to) {
    parts.push(
      fillTemplate(t('statementImport.period'), {
        from: formatDateShort(r.period.from),
        to: formatDateShort(r.period.to),
      })
    );
  }
  parts.push(
    fillTemplate(
      t(r.lines.length === 1 ? 'statementImport.lines.one' : 'statementImport.lines.other'),
      {
        count: String(r.lines.length),
      }
    )
  );
  return parts.join(' · ');
});

/** An already-added line's first-added date, for its chip. */
const addedOn = computed(() => {
  const byFingerprint = new Map<string, string>();
  for (const tx of transactionsStore.transactions) {
    if (tx.importFingerprint) byFingerprint.set(tx.importFingerprint, tx.createdAt);
  }
  return byFingerprint;
});

/** The foreign amount each line printed, by fingerprint (candidates align with the read's lines). */
const originals = computed(
  () => new Map(store.candidates.map((c, i) => [c.fingerprint, lines.value[i]?.original]))
);

const failedUnits = computed(
  () => store.read?.units.filter((u) => u.status === 'failed').length ?? 0
);
const cappedUnits = computed(() => store.read?.units.some((u) => u.status === 'capped') ?? false);
const overlap = computed(() => store.notices?.overlapAlready ?? 0);
const hasNotices = computed(
  () =>
    Boolean(store.read?.droppedPages.length) ||
    Boolean(store.read?.unitsBeyondCap) ||
    failedUnits.value > 0 ||
    cappedUnits.value ||
    overlap.value > 0
);

const confirmLabel = computed(() => {
  const add = String(store.toAdd);
  const merge = String(store.toMerge);
  if (store.toAdd && store.toMerge)
    return fillTemplate(t('statementImport.confirm.both'), { add, merge });
  if (store.toMerge) return fillTemplate(t('statementImport.confirm.merge'), { merge });
  if (store.toAdd) return fillTemplate(t('statementImport.confirm.add'), { add });
  return t('statementImport.confirm.nothing');
});

const dayAllTicked = (ymd: string): boolean => {
  const inDay = store.actionable.filter((c) => c.draft.date === ymd);
  return inDay.length > 0 && inDay.every((c) => c.decision !== 'skip');
};

function close(): void {
  // Never abandon a running write: the person would not know whether their lines landed.
  if (store.phase === 'committing') return;
  store.reset();
}

/** Apply an edit; a refused one (no rate for a cross-currency move) is said, never silent. */
function onEdit(fingerprint: string, patch: Partial<CreateTransactionInput>): void {
  // Only a missing rate is the person's to fix; an invalid edit is logged by the store.
  if (store.editDraft(fingerprint, patch) === 'rate-missing') {
    showToast(
      'info',
      t('statementImport.rateMissing.title'),
      t('statementImport.rateMissing.body')
    );
  }
}

async function onReadAnyway(page: number): Promise<void> {
  if (!(await store.readDroppedPage(page))) {
    showToast('error', t('statementImport.readAnywayFailed'));
  }
}

async function onAccount(id: string): Promise<void> {
  const ok = await store.setAccount(id);
  if (!ok) {
    showToast('error', t('statementImport.planFailed.title'), t('statementImport.planFailed.body'));
  }
}

async function onCommit(): Promise<void> {
  const outcome = await store.commit();
  switch (outcome.kind) {
    case 'failed':
      // Nothing was written; the list stays so the person can simply try again.
      showToast('error', t('statementImport.failed.title'), t('statementImport.failed.body'));
      return;
    case 'unverified':
      // The write may well have landed: never phrased as a failure (it invites a re-import).
      showToast(
        'info',
        t('statementImport.unverified.title'),
        t('statementImport.unverified.body')
      );
      return;
    case 'partial':
      showToast(
        'info',
        t('statementImport.partial.title'),
        fillTemplate(t('statementImport.partial.body'), {
          added: String(outcome.added),
          merged: String(outcome.merged),
          failed: String(outcome.failed),
        })
      );
      return;
    case 'ok':
      showToast(
        'success',
        t('statementImport.done.title'),
        fillTemplate(t('statementImport.done.body'), {
          added: String(outcome.added),
          merged: String(outcome.merged),
        })
      );
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    variant="drawer"
    :title="t('statementImport.title')"
    icon="🪄"
    :save-label="confirmLabel"
    :save-disabled="
      !store.accountId || store.toAdd + store.toMerge === 0 || store.readingPage !== null
    "
    :is-submitting="store.phase === 'committing'"
    @close="close"
    @save="onCommit"
  >
    <p class="text-secondary-400 dark:text-ink-soft -mt-1 mb-4 text-xs">{{ subtitle }}</p>

    <!-- The account the statement is for. Pre-picked from the statement when it could be. -->
    <FormFieldGroup :label="t('statementImport.account.label')">
      <AccountSelect
        :model-value="store.accountId ?? undefined"
        :groups="accountGroups"
        :placeholder="t('statementImport.account.none')"
        :aria-label="t('statementImport.account.label')"
        @update:model-value="onAccount"
      />
    </FormFieldGroup>
    <p class="text-secondary-400 dark:text-ink-faint mt-1 text-xs">
      {{ store.accountId ? t('statementImport.account.note') : t('statementImport.account.none') }}
    </p>

    <template v-if="store.accountId && account">
      <!-- Totals -->
      <div class="mt-4 flex flex-wrap gap-1.5">
        <span
          class="font-outfit text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-semibold"
          >{{ fillTemplate(t('statementImport.totals.add'), { count: String(store.toAdd) }) }}</span
        >
        <span
          v-if="store.familiar"
          class="font-outfit rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="REVIEW_CHIP_TONES.accent"
          >{{
            fillTemplate(t('statementImport.totals.familiar'), { count: String(store.familiar) })
          }}</span
        >
        <span
          v-if="store.possible"
          class="font-outfit rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="REVIEW_CHIP_TONES.accent"
          >{{
            fillTemplate(
              t(
                store.possible === 1
                  ? 'statementImport.totals.possible.one'
                  : 'statementImport.totals.possible.other'
              ),
              { count: String(store.possible) }
            )
          }}</span
        >
        <span
          class="font-outfit text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-semibold"
          >{{
            fillTemplate(t('statementImport.totals.skipped'), { count: String(store.skipped) })
          }}</span
        >
      </div>

      <!-- Bulk bar. Hidden when every line is already added: nothing is left to bulk-decide. -->
      <div v-if="store.actionable.length" class="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          class="font-outfit rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="REVIEW_CHIP_TONES.accent"
          @click="store.decideAll(store.allTicked ? 'skip' : 'default')"
        >
          {{
            store.allTicked
              ? t('statementImport.bulk.untickAll')
              : t('statementImport.bulk.tickAll')
          }}
        </button>
        <template v-if="store.familiar">
          <span class="bg-secondary-100 dark:bg-line mx-1 h-4 w-px" aria-hidden="true" />
          <span class="font-outfit text-secondary-400 dark:text-ink-faint text-xs font-semibold">{{
            t('statementImport.bulk.familiar')
          }}</span>
          <button
            v-for="choice in ['merge', 'add', 'skip'] as const"
            :key="choice"
            type="button"
            class="font-outfit rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="REVIEW_CHIP_TONES.accent"
            @click="store.decideAll(choice, { matchedOnly: true })"
          >
            {{
              choice === 'merge'
                ? t('statementImport.bulk.mergeAll')
                : choice === 'add'
                  ? t('statementImport.bulk.keepAll')
                  : t('statementImport.bulk.skipAll')
            }}
          </button>
        </template>
      </div>

      <!-- What was and was not read. Never silent. -->
      <div v-if="hasNotices" class="mt-3 space-y-2">
        <div
          v-if="store.read?.droppedPages.length"
          class="bg-primary-50 dark:bg-surface-overlay rounded-[14px] px-3 py-2.5 text-xs"
        >
          <p class="text-secondary-500 dark:text-ink">
            {{
              store.read.droppedPages.length === 1
                ? t('statementImport.notice.dropped.one')
                : fillTemplate(t('statementImport.notice.dropped.other'), {
                    count: String(store.read.droppedPages.length),
                  })
            }}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-2">
            <button
              v-for="dropped in store.read.droppedPages"
              :key="dropped.page"
              type="button"
              class="font-outfit text-primary-700 dark:text-accent-lift font-semibold underline underline-offset-2 disabled:no-underline"
              :disabled="store.readingPage !== null"
              @click="onReadAnyway(dropped.page)"
            >
              {{
                fillTemplate(t('statementImport.notice.readAnyway'), { page: String(dropped.page) })
              }}
            </button>
          </div>
        </div>
        <p
          v-if="store.read?.unitsBeyondCap"
          class="bg-primary-50 text-secondary-500 dark:bg-surface-overlay dark:text-ink rounded-[14px] px-3 py-2.5 text-xs"
        >
          {{
            fillTemplate(t('statementImport.notice.beyondCap'), {
              count: String(STATEMENT_MAX_UNITS),
            })
          }}
        </p>
        <p
          v-if="failedUnits"
          class="bg-primary-50 text-secondary-500 dark:bg-surface-overlay dark:text-ink rounded-[14px] px-3 py-2.5 text-xs"
        >
          {{
            failedUnits === 1
              ? t('statementImport.notice.failed.one')
              : fillTemplate(t('statementImport.notice.failed.other'), {
                  count: String(failedUnits),
                })
          }}
        </p>
        <p
          v-if="cappedUnits"
          class="bg-primary-50 text-secondary-500 dark:bg-surface-overlay dark:text-ink rounded-[14px] px-3 py-2.5 text-xs"
        >
          {{ t('statementImport.notice.capped') }}
        </p>
        <p
          v-if="overlap"
          class="text-secondary-500 dark:bg-surface-overlay dark:text-ink rounded-[14px] bg-[var(--tint-slate-5)] px-3 py-2.5 text-xs"
        >
          {{
            overlap === 1
              ? t('statementImport.notice.overlap.one')
              : fillTemplate(t('statementImport.notice.overlap.other'), { count: String(overlap) })
          }}
        </p>
      </div>

      <!-- The list -->
      <div class="mt-2">
        <div v-for="day in days" :key="day.ymd">
          <div
            class="dark:bg-surface-raised sticky -top-6 z-10 flex items-center gap-2 bg-[#F8F9FA] px-1 pt-3 pb-1.5"
          >
            <TickButton
              :selected="dayAllTicked(day.ymd)"
              :label="fillTemplate(t('statementImport.day.tick'), { day: formatDayLong(day.ymd) })"
              @toggle="
                store.decideAll(dayAllTicked(day.ymd) ? 'skip' : 'default', { day: day.ymd })
              "
            />
            <span class="font-outfit text-secondary-400 dark:text-ink-faint text-xs font-bold">{{
              formatDayLong(day.ymd)
            }}</span>
          </div>
          <ul class="flex flex-col gap-2">
            <template v-for="row in day.rows" :key="row.fingerprint">
              <StatementImportPairCard
                v-if="row.match"
                :candidate="row"
                :import-account-id="account.id"
                @decide="(d) => store.decide(row.fingerprint, d)"
                @edit="(patch) => onEdit(row.fingerprint, patch)"
              />
              <StatementImportRow
                v-else
                :candidate="row"
                :import-account-id="account.id"
                :original="originals.get(row.fingerprint)"
                :already-on="addedOn.get(row.fingerprint)"
                @decide="(d) => store.decide(row.fingerprint, d)"
                @edit="(patch) => onEdit(row.fingerprint, patch)"
              />
            </template>
          </ul>
        </div>
      </div>
    </template>

    <MagicMiscategorisedBanner
      v-if="store.env"
      :env="store.env"
      from="transactions"
      @close="close"
    />
  </BeanieFormModal>
</template>
