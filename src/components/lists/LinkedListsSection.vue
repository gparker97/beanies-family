<script setup lang="ts">
/**
 * The Lists section a trip or an activity shows (#114, then trips): the lists linked to it, and
 * for a member who can edit, three ways to add one that is linked straight away:
 *   - "+ New List": a blank list, created up front so it opens at once, and discarded again if
 *     it is closed untouched (a curious tap must not leave an empty list behind, greg 2026-09-29);
 *   - "From a Template": the shared `NewListSheet`, with the host's suggested template first;
 *   - "Attach a List": `AttachListsSheet`, to link lists the family already has.
 * The opened list shows in a `ListDetailModal` this section hosts, so its host holds no list
 * state. Flag-guarded (`familyLists`).
 *
 * Hosts are thin wrappers that say which lists to show and where new ones go (`target`):
 * `ActivityLists` (the activity drawer, keyed by activity + session) and `TripLists` (the trip
 * page, keyed by trip). Re-keying unmounts this section, which counts as closing an open list.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { isFlagEnabled } from '@/config/flags';
import { listTargetPatch, type ListLinkTarget } from '@/utils/activityLinks';
import { logEvent } from '@/services/telemetry/logEvent';
import SectionEyebrow from '@/components/ui/SectionEyebrow.vue';
import LinkedListCard from '@/components/lists/LinkedListCard.vue';
import NewListSheet from '@/components/lists/NewListSheet.vue';
import AttachListsSheet from '@/components/lists/AttachListsSheet.vue';
import ListDetailModal from '@/components/lists/ListDetailModal.vue';
import LinkedListsActions, {
  type LinkedListsAction,
} from '@/components/lists/LinkedListsActions.vue';
import type { FamilyList, ListCategory } from '@/types/models';

const props = defineProps<{
  /** The lists to show; `everySession` tags one linked to the whole of a repeating activity. */
  lists: { item: FamilyList; everySession?: boolean }[];
  /** Where a list made or attached here goes. */
  target: ListLinkTarget;
  /** A template to offer first, with a "Suggested" badge. */
  suggestedTemplateKey?: string;
  /** The category a blank list starts in. Unset = the store's default (Home). */
  blankCategory?: ListCategory;
  /** Open the sheets and the list above another open drawer (the activity drawer). */
  stacked?: boolean;
  /** Extra telemetry context, allowlisted keys only. */
  logContext?: { activity_id: string };
}>();

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const listStore = useListStore();
const familyStore = useFamilyStore();

const enabled = computed(() => isFlagEnabled('familyLists'));
// Nothing to show a member who cannot add one.
const showSection = computed(() => props.lists.length > 0 || canEditActivities.value);
/** The link fields every list created here carries (link fields only, by type). */
const overrides = computed(() => listTargetPatch(props.target));
const surface = computed(() => (props.target.kind === 'trip' ? 'trip-lists' : 'activity-links'));

/** One shape for every event here, so create, discard and attach rates line up. */
function log(level: 'info' | 'warn', action: string, extra: Record<string, unknown> = {}): void {
  logEvent({
    level,
    surface: surface.value,
    message: action,
    context: { action, ...props.logContext, ...extra },
  });
}

const showTemplates = ref(false);
const showAttach = ref(false);
const openListId = ref<string | null>(null);
/**
 * A blank list made here (by "+ New List" or the sheet's "Start Blank List"). It is created up
 * front so it can open straight away, so one closed untouched is discarded again. Template
 * lists come with items and are never discarded.
 */
const blankToDiscardId = ref<string | null>(null);

async function discardBlankIfUntouched(): Promise<void> {
  const id = blankToDiscardId.value;
  if (!id) return;
  blankToDiscardId.value = null;
  const outcome = await listStore.discardIfUntouched(id);
  // Every outcome is counted, so the discard rate is measurable against `list_created`.
  log(outcome === 'failed' ? 'warn' : 'info', 'blank_list_closed', { detail: outcome });
}

function onListClosed(): void {
  openListId.value = null;
  void discardBlankIfUntouched();
}

// Closing the host (or re-keying it) unmounts this with the new list still open: treat that as
// closing the list too. A create still in flight then resolves on an unmounted section, and
// `onCreated` discards that blank straight away rather than leaving it linked and empty.
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
  void discardBlankIfUntouched();
});
const isCreating = ref(false);

const actions: LinkedListsAction[] = [
  { key: 'blank', labelKey: 'linkedLists.newList', primary: true, run: () => void newBlank() },
  {
    key: 'template',
    labelKey: 'linkedLists.fromTemplate',
    primary: false,
    run: () => (showTemplates.value = true),
  },
  {
    key: 'attach',
    labelKey: 'linkedLists.attach',
    primary: false,
    run: () => (showAttach.value = true),
  },
];

async function newBlank(): Promise<void> {
  if (isCreating.value) return;
  isCreating.value = true;
  try {
    const created = await listStore.createBlankList(familyStore.currentMember?.id ?? '', {
      category: props.blankCategory,
      ...overrides.value,
    });
    if (!created) {
      onCreateFailed();
      return;
    }
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
  log('warn', 'list_create_failed', {
    detail: templateKey ? 'template' : 'blank',
    kind: templateKey ?? 'blank',
  });
}

/** A list was created here (blank, or from the sheet): open it, count it, track a blank. */
function onCreated(id: string, templateKey?: string): void {
  log('info', 'list_created', {
    detail: templateKey ? 'template' : 'blank',
    kind: templateKey ?? 'blank',
  });
  blankToDiscardId.value = templateKey ? null : id;
  // The person left (re-keyed, closed the drawer) while the create was in flight: nothing will
  // open this list, so an untouched blank is discarded now.
  if (unmounted) {
    void discardBlankIfUntouched();
    return;
  }
  openListId.value = id;
}

/**
 * The sheet's attach finished. `count` lists were linked; `partial` when fewer than picked were
 * (a picked list deleted on another device during the write). `count` 0 is logged as `none`,
 * not as a success.
 */
function onAttached(count: number, partial: boolean): void {
  log(count ? 'info' : 'warn', 'lists_attached', {
    count,
    detail: count === 0 ? 'none' : partial ? 'partial' : 'all',
  });
}

/** The attach write failed. The store has already toasted and reported it. */
function onAttachFailed(count: number): void {
  log('warn', 'lists_attach_failed', { count });
}

/**
 * Open the new-list sheet from outside the section (the trip's "+ Add a Plan" menu). Ignored
 * while a create is in flight, like the pills, so the sheet never opens under the list that
 * create is about to open.
 */
defineExpose({
  openNewList: () => {
    if (!isCreating.value) showTemplates.value = true;
  },
});
</script>

<template>
  <template v-if="enabled">
    <section v-if="showSection" class="mt-5" data-testid="linked-lists">
      <SectionEyebrow icon="📋" :label="t('linkedLists.section')">
        <template v-if="canEditActivities && lists.length" #end>
          <LinkedListsActions :actions="actions" :disabled="isCreating" />
        </template>
      </SectionEyebrow>

      <div v-if="lists.length" class="space-y-3.5">
        <LinkedListCard
          v-for="{ item, everySession } in lists"
          :key="item.id"
          :list="item"
          :every-session="everySession"
          @open="(id: string) => (openListId = id)"
        />
      </div>

      <!-- Nothing linked yet: the actions ride in the dashed row instead of the eyebrow. -->
      <div
        v-else
        class="dark:border-line-strong dark:text-ink-faint flex flex-wrap items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[rgba(44,62,80,0.22)] px-3.5 py-3 text-sm text-[var(--color-text-muted)]"
        data-testid="linked-lists-empty"
      >
        <span>{{ t('linkedLists.empty') }}</span>
        <span class="ms-auto flex flex-wrap gap-1.5">
          <LinkedListsActions :actions="actions" :disabled="isCreating" />
        </span>
      </div>
    </section>

    <!-- `hide-chores`: the choreboard redirect would drop this list's link (#146) -->
    <NewListSheet
      :open="showTemplates"
      hide-chores
      :overrides="overrides"
      :suggested-template-key="suggestedTemplateKey"
      :blank-category="blankCategory"
      :stacked="stacked"
      @close="showTemplates = false"
      @created="onCreated"
      @failed="onCreateFailed"
    />
    <AttachListsSheet
      :open="showAttach"
      :target="target"
      :stacked="stacked"
      @close="showAttach = false"
      @attached="onAttached"
      @failed="onAttachFailed"
    />
    <ListDetailModal :list-id="openListId" :stacked="stacked" @close="onListClosed" />
  </template>
</template>
