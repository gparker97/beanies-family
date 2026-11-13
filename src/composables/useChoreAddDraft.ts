import { reactive } from 'vue';
import {
  choreStarterSet,
  starterSetPreview,
  type ChoreStarterSetKey,
  type StarterChoreDraft,
} from '@/constants/choreStarterSets';
import { DEFAULT_CHORE_EMOJI, pictureForTitle } from '@/constants/choreBlocks';
import { choreDupKey, normalizeChoreDays } from '@/utils/chores';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreBlock } from '@/types/models';

/**
 * The Add Chores sheet's ONE list (#146, owner decisions 2026-11-13): the chores a grown-up is
 * about to add, from suggestion sets and of their own, and which sets are on the list.
 *
 * Module-level and memory only, for the app session: closing and reopening the sheet keeps it,
 * and it is NEVER written to the family file. Because it holds a family's chore names, it is
 * cleared with the stores on sign-out and family switch (`resetAllAppStores` calls
 * `clearChoreAddDraft`), so one family's list cannot follow the session into another pod. The
 * sheet clears it after a successful Add.
 *
 * The set definitions are never touched: rows are fresh copies (`starterSetDrafts`), and each
 * suggested row remembers how it arrived (`origin`), so "edited" can be told from untouched,
 * which is what decides whether taking a set off the list keeps a row.
 */

/** One row of the list. */
export interface ChoreAddRow {
  /** Stable within the session, for list keys and focus. */
  id: number;
  draft: StarterChoreDraft;
  /** The suggested row as it arrived (a fingerprint); absent for a row the grown-up added. */
  origin?: string;
  /** Added under a heading and not yet named: an empty commit drops it silently. */
  fresh?: boolean;
  /** The grown-up picked this row's picture by hand: its title no longer suggests one. */
  pictureByHand?: boolean;
}

type Resolve = (key: UIStringKey) => string;

const state = reactive({
  rows: [] as ChoreAddRow[],
  /** Sets put on the list, in the order they were added. */
  sets: [] as ChoreStarterSetKey[],
  /** Suggested rows the grown-up removed by hand (an edit, for `chores-add-edited`). */
  removed: 0,
});
let nextRowId = 1;

/** The list, reactive. Rows are edited in place; add and remove go through the functions here. */
export function useChoreAddDraft() {
  return state;
}

/** What makes a row "the same chore", to tell an edit from how it arrived. */
export function rowFingerprint(d: StarterChoreDraft): string {
  return JSON.stringify([
    d.title.trim(),
    d.emoji,
    d.illustration ?? '',
    d.block,
    (normalizeChoreDays(d.days) ?? []).join(','),
  ]);
}

/** A row the grown-up changed (renamed, re-timed, re-pictured, re-dayed) or added themselves. */
export function isEditedRow(row: ChoreAddRow): boolean {
  return row.origin === undefined || rowFingerprint(row.draft) !== row.origin;
}

/** The duplicate rule (`choreDupKey`, shared with the store): same title, same block. */
const dupKey = (d: Pick<StarterChoreDraft, 'title' | 'block'>) => choreDupKey(d.title, d.block);

function listKeys(): Set<string> {
  return new Set(state.rows.filter((r) => r.draft.title.trim()).map((r) => dupKey(r.draft)));
}

/** A set's rows as a preview: each with whether the list already has it (it would be skipped). */
export function previewSet(
  key: ChoreStarterSetKey,
  resolve: Resolve
): { draft: StarterChoreDraft; dup: boolean }[] {
  return starterSetPreview(key, resolve, listKeys());
}

/** Is `key` on the list? */
export function isSetOn(key: ChoreStarterSetKey): boolean {
  return state.sets.includes(key);
}

/**
 * Append `key`'s chores, skipping any the list already has (same title, same block), and mark
 * the set on. Answers how many rows were appended.
 */
export function addSet(key: ChoreStarterSetKey, resolve: Resolve): number {
  if (!choreStarterSet(key)) return 0;
  const fresh = previewSet(key, resolve).filter((p) => !p.dup);
  for (const { draft } of fresh) {
    state.rows.push({ id: nextRowId++, draft, origin: rowFingerprint(draft) });
  }
  if (!isSetOn(key)) state.sets.push(key);
  return fresh.length;
}

/** Take `key` off the list: its UNEDITED rows go; edited ones stay, as the grown-up's own. */
export function removeSet(key: ChoreStarterSetKey): void {
  state.rows = state.rows.filter((r) => r.draft.setKey !== key || isEditedRow(r));
  state.sets = state.sets.filter((k) => k !== key);
}

/** A blank row at the end of `block`, every day (a grown-up's own chore). */
export function addBlankRow(block: ChoreBlock): ChoreAddRow {
  const row: ChoreAddRow = {
    id: nextRowId++,
    draft: { title: '', emoji: DEFAULT_CHORE_EMOJI, block },
    fresh: true,
  };
  state.rows.push(row);
  return state.rows[state.rows.length - 1]!;
}

/**
 * A row of the grown-up's own takes its picture from its title (`suggestChoreEmoji`, else the
 * default) each time the title is committed, until they pick a picture by hand. A suggested
 * row keeps the set's picture: it is never overridden.
 */
export function followTitlePicture(row: ChoreAddRow): void {
  if (row.origin !== undefined || row.pictureByHand) return;
  row.draft.emoji = pictureForTitle(row.draft.title);
}

/** The grown-up picked `row`'s picture: from now on its title leaves the picture alone. */
export function markPictureByHand(row: ChoreAddRow): void {
  row.pictureByHand = true;
}

/** Remove one row. A suggested row removed by hand counts as an edit. */
export function removeRow(id: number): void {
  const at = state.rows.findIndex((r) => r.id === id);
  if (at < 0) return;
  if (state.rows[at]!.origin !== undefined) state.removed++;
  state.rows.splice(at, 1);
}

/**
 * Rows renamed, re-timed, re-pictured, re-dayed, added (with a name) or removed:
 * `chores-add-edited`.
 */
export function editCount(): number {
  const changed = state.rows.filter((r) => r.draft.title.trim() && isEditedRow(r)).length;
  return changed + state.removed;
}

/** Empty the list ("Clear List", a successful Add, sign-out). */
export function clearChoreAddDraft(): void {
  state.rows = [];
  state.sets = [];
  state.removed = 0;
}
