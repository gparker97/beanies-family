<script setup lang="ts">
/**
 * The Lists section of the Activity Details drawer (#114). Shows the lists that belong to the
 * session being viewed (`listStore.listsForActivitySession`), tags the ones linked to the whole of
 * a repeating activity "Every Session", and lets a member who can edit activities start a list
 * that is linked to this session straight away: "+ New List" (blank) or "From a Template" (the
 * shared `NewListSheet`, with the template suggested for the activity's category first). The new
 * list opens in a stacked `ListDetailModal`, which this section hosts so the drawer holds no list
 * state. Flag-guarded (`familyLists`).
 *
 * The drawer keys this component by activity + session, so moving to another session resets any
 * open sheet or list.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { isFlagEnabled } from '@/config/flags';
import { suggestedListTemplateFor } from '@/constants/listTemplates';
import { linkForSession, listLinkPatch } from '@/utils/activityLinks';
import { logEvent } from '@/services/telemetry/logEvent';
import SectionEyebrow from '@/components/ui/SectionEyebrow.vue';
import LinkedListCard from '@/components/lists/LinkedListCard.vue';
import NewListSheet from '@/components/lists/NewListSheet.vue';
import ListDetailModal from '@/components/lists/ListDetailModal.vue';
import type { FamilyActivity } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  activity: FamilyActivity;
  /** `YYYY-MM-DD` of the session being viewed (the drawer's `sessionYmd`). */
  sessionYmd: string;
}>();

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const listStore = useListStore();
const familyStore = useFamilyStore();

const enabled = computed(() => isFlagEnabled('familyLists'));
const sessionLists = computed(() =>
  listStore.listsForActivitySession(props.activity, props.sessionYmd)
);
// Nothing to show a member who cannot add one.
const showSection = computed(() => sessionLists.value.length > 0 || canEditActivities.value);

/** The link fields every list created here carries (series + session for a repeating one). */
const linkOverrides = computed(() =>
  listLinkPatch(linkForSession(props.activity, props.sessionYmd))
);
const suggestedTemplateKey = computed(() => suggestedListTemplateFor(props.activity.category)?.key);

const showTemplates = ref(false);
const openListId = ref<string | null>(null);
/**
 * The list "+ New List" just made. It is created up front so it can open straight away, so
 * one closed untouched is discarded again: a curious tap must not leave an empty list linked
 * to the activity (greg, 2026-09-29). Template lists come with items and are never discarded.
 */
const blankToDiscardId = ref<string | null>(null);

async function discardBlankIfUntouched(): Promise<void> {
  const id = blankToDiscardId.value;
  if (!id) return;
  blankToDiscardId.value = null;
  const outcome = await listStore.discardIfUntouched(id);
  // Every outcome is counted, so the discard rate is measurable against `list_created`.
  logEvent({
    level: outcome === 'failed' ? 'warn' : 'info',
    surface: 'activity-links',
    message: 'blank_list_closed',
    context: { action: 'blank_list_closed', activity_id: props.activity.id, detail: outcome },
  });
}

function onListClosed(): void {
  openListId.value = null;
  void discardBlankIfUntouched();
}

// Closing the whole activity drawer (or moving to another session, which re-keys this
// section) unmounts it with the new list still open: treat that as closing the list too.
onBeforeUnmount(() => void discardBlankIfUntouched());
const isCreating = ref(false);

interface SectionAction {
  key: string;
  labelKey: UIStringKey;
  primary: boolean;
  run: () => void;
}
const actions: SectionAction[] = [
  { key: 'blank', labelKey: 'activityLists.newList', primary: true, run: () => void newBlank() },
  {
    key: 'template',
    labelKey: 'activityLists.fromTemplate',
    primary: false,
    run: () => (showTemplates.value = true),
  },
];

// The mockup's mini pills: "+ New List" in Heritage Orange tint, "From a Template" quiet. Both
// tints carry their own dark values; text pairs with its dark ink / `-lift` partner.
function actionClass(action: SectionAction): string {
  return action.primary
    ? 'text-primary-600 dark:text-accent-lift bg-[var(--tint-orange-8)] hover:bg-[var(--tint-orange-15)]'
    : 'dark:text-ink-soft bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-orange-8)]';
}

async function newBlank(): Promise<void> {
  if (isCreating.value) return;
  isCreating.value = true;
  try {
    const created = await listStore.createBlankList(
      familyStore.currentMember?.id ?? '',
      linkOverrides.value
    );
    if (!created) {
      onCreateFailed();
      return;
    }
    blankToDiscardId.value = created.id;
    onCreated(created.id);
  } finally {
    isCreating.value = false;
  }
}

/**
 * A create from here failed (blank, or from the sheet). The store has already toasted and
 * reported it; this counts the failure rate for this entry point against `list_created`.
 */
function onCreateFailed(templateKey?: string): void {
  logListCreate('warn', 'list_create_failed', templateKey);
}

/** One shape for both list-create events, so success and failure rates line up. */
function logListCreate(
  level: 'info' | 'warn',
  action: 'list_created' | 'list_create_failed',
  templateKey?: string
): void {
  logEvent({
    level,
    surface: 'activity-links',
    message: action,
    context: {
      action,
      activity_id: props.activity.id,
      detail: templateKey ? 'template' : 'blank',
      kind: templateKey ?? 'blank',
    },
  });
}

/** A list was created here (blank, or from the sheet): open it and count it. */
function onCreated(id: string, templateKey?: string): void {
  openListId.value = id;
  logListCreate('info', 'list_created', templateKey);
}
</script>

<template>
  <template v-if="enabled">
    <section v-if="showSection" class="mt-5" data-testid="activity-lists">
      <SectionEyebrow icon="📋" :label="t('activityLists.section')">
        <template v-if="canEditActivities && sessionLists.length" #end>
          <button
            v-for="action in actions"
            :key="action.key"
            type="button"
            class="activity-lists-action"
            :class="actionClass(action)"
            :disabled="action.primary && isCreating"
            :data-testid="`activity-lists-${action.key}`"
            @click="action.run"
          >
            {{ t(action.labelKey) }}
          </button>
        </template>
      </SectionEyebrow>

      <div v-if="sessionLists.length" class="space-y-3.5">
        <LinkedListCard
          v-for="{ item, scope } in sessionLists"
          :key="item.id"
          :list="item"
          :every-session="scope === 'every-session'"
          @open="(id: string) => (openListId = id)"
        />
      </div>

      <!-- Nothing linked yet: the actions ride in the dashed row instead of the eyebrow. -->
      <div
        v-else
        class="dark:border-line-strong dark:text-ink-faint flex flex-wrap items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[rgba(44,62,80,0.22)] px-3.5 py-3 text-sm text-[var(--color-text-muted)]"
        data-testid="activity-lists-empty"
      >
        <span>{{ t('activityLists.empty') }}</span>
        <span class="ms-auto flex flex-wrap gap-1.5">
          <button
            v-for="action in actions"
            :key="action.key"
            type="button"
            class="activity-lists-action"
            :class="actionClass(action)"
            :disabled="action.primary && isCreating"
            :data-testid="`activity-lists-${action.key}`"
            @click="action.run"
          >
            {{ t(action.labelKey) }}
          </button>
        </span>
      </div>
    </section>

    <NewListSheet
      :open="showTemplates"
      :overrides="linkOverrides"
      :suggested-template-key="suggestedTemplateKey"
      stacked
      @close="showTemplates = false"
      @created="onCreated"
      @failed="onCreateFailed"
    />
    <ListDetailModal :list-id="openListId" stacked @close="onListClosed" />
  </template>
</template>

<style scoped>
/* The mini pill buttons (mockup `.mini-btn`); colors come from the utilities on each button so the
   light/dark pairs sit together. */
.activity-lists-action {
  align-items: center;
  border-radius: 9999px;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.25rem;
  line-height: 1rem;
  padding: 0.3125rem 0.625rem;
  transition: background-color 0.15s;
}

.activity-lists-action:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}

.activity-lists-action:disabled {
  cursor: default;
}
</style>
