/**
 * The week shopping drawer's duplicates, as a pure reducer (#116, plan § B / § G).
 *
 * The drawer holds ONE `WeekShoppingState` and replaces it through these functions:
 *
 *  - `mergeExactDuplicates` at open: lines whose text is identical (after trim, whitespace
 *    collapse and case-fold) in two or more recipes become ONE merged line with the batches
 *    summed. No AI; the lines are literally the same.
 *  - `dedupeCandidates` → the payload for ✨ Find Duplicates, and `applyDuplicateGroups`
 *    with what magic beans answered. The AI only GROUPS existing line ids and names the
 *    item; the merged text is written here from the source lines, so no amount is ever
 *    invented. Every answer is re-validated against the CURRENT state.
 *  - `splitMergedLine` puts a merged line's parts back into their recipe sections.
 *
 * Merged parts are hidden IN PLACE (`mergedInto`), never moved, so a Split is two field
 * changes and a section's order never shifts.
 */
import { generateUUID } from './id';
import {
  isUneditedLine,
  withBatchSuffix,
  type ChecklistLine,
  type ShoppingSection,
} from './mealShoppingList';
import {
  dedupePayloadBuilder,
  sanitizeDedupeName,
  type DedupeGroup,
  type DedupeLine,
} from './dedupePayload';

export interface WeekShoppingState {
  sections: ShoppingSection[];
  /** The "In More Than One Meal" section, in the order the merges were made. */
  merged: ChecklistLine[];
}

function allLines(state: WeekShoppingState): ChecklistLine[] {
  return state.sections.flatMap((s) => s.lines);
}

/** Replace some section lines by id, keeping every other object identical. */
function patchSectionLines(
  sections: readonly ShoppingSection[],
  patchOf: (line: ChecklistLine) => ChecklistLine
): ShoppingSection[] {
  return sections.map((s) => {
    let changed = false;
    const lines = s.lines.map((l) => {
      const next = patchOf(l);
      if (next !== l) changed = true;
      return next;
    });
    return changed ? { ...s, lines } : s;
  });
}

/**
 * May this line be merged? A generated recipe line, still as generated, not already merged
 * and not put back by a Split. (`checked` is checked separately: the exact merge at open
 * runs before anything could be unticked, the AI path respects unticks.)
 */
function isMergeable(line: ChecklistLine): boolean {
  return (
    line.recipeId !== undefined &&
    line.merged === undefined &&
    line.mergedInto === undefined &&
    line.split === undefined &&
    isUneditedLine(line)
  );
}

/** The identity used for "identical": trim, collapse whitespace, ignore case. */
export function exactKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function distinctRecipeIds(parts: readonly ChecklistLine[]): string[] {
  return [...new Set(parts.map((p) => p.recipeId!))];
}

function mergedLine(
  parts: readonly ChecklistLine[],
  source: string,
  batches: number,
  merged: 'exact' | 'ai'
): ChecklistLine {
  return {
    id: generateUUID(),
    source,
    text: withBatchSuffix(source, batches),
    checked: parts.every((p) => p.checked),
    batches,
    merged,
    partIds: parts.map((p) => p.id),
    recipeIds: distinctRecipeIds(parts),
  };
}

function withMerges(state: WeekShoppingState, added: readonly ChecklistLine[]): WeekShoppingState {
  if (added.length === 0) return state;
  const owner = new Map<string, string>();
  for (const m of added) for (const id of m.partIds!) owner.set(id, m.id);
  return {
    sections: patchSectionLines(state.sections, (l) =>
      owner.has(l.id) ? { ...l, mergedInto: owner.get(l.id) } : l
    ),
    merged: [...state.merged, ...added],
  };
}

/**
 * Identical lines in two or more DIFFERENT recipes → one merged line whose batches are the
 * sum over ALL matching lines (a recipe that lists the line twice counts twice), so
 * `1 cup basmati rice` ×1 + ×2 → `1 cup basmati rice (×3)`. The total is always ≥ 2, so a
 * merged exact line always carries a suffix. The first part's trimmed source is the text.
 */
export function mergeExactDuplicates(state: WeekShoppingState): WeekShoppingState {
  const groups = new Map<string, ChecklistLine[]>();
  for (const line of allLines(state)) {
    if (!isMergeable(line)) continue;
    const key = exactKey(line.source!);
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  const added: ChecklistLine[] = [];
  for (const parts of groups.values()) {
    if (distinctRecipeIds(parts).length < 2) continue;
    const batches = parts.reduce((n, p) => n + p.batches, 0);
    added.push(mergedLine(parts, parts[0]!.source!.trim(), batches, 'exact'));
  }
  return withMerges(state, added);
}

/** A line ✨ Find Duplicates may offer: ticked, unedited, unmerged and never split. */
function isDedupeEligible(line: ChecklistLine): boolean {
  return line.checked && isMergeable(line);
}

/**
 * How many DIFFERENT recipes have a line ✨ Find Duplicates could offer: what the card needs to
 * decide whether to show (a group merges across 2+ recipes). Cheap on purpose, so the drawer can
 * keep it reactive on every tick and edit; the payload itself is built at tap time
 * ({@link dedupeCandidates}). It ignores the byte bound, so it never hides the card when a later
 * recipe's lines would fit behind an early long one.
 */
export function dedupeRecipeCount(state: WeekShoppingState): number {
  const recipes = new Set<string>();
  for (const line of allLines(state)) if (isDedupeEligible(line)) recipes.add(line.recipeId!);
  return recipes.size;
}

/**
 * What ✨ Find Duplicates may send: ticked, unedited, unmerged, never-split recipe lines,
 * as their SOURCE text (no suffix), under opaque ids `L1…LN`, so a line can never fake an
 * id. Lines are offered in section order while the serialized payload stays within
 * `maxBytes` (the free bound on the server counts the same bytes, `dedupePayload.ts`). A line
 * that would cross it is skipped and the walk goes on, so one long line early in the week
 * never hides the shorter lines of every later recipe. `skipped` counts those lines, so a run
 * that "missed" a duplicate can be told apart from one whose line was never sent.
 */
export function dedupeCandidates(
  state: WeekShoppingState,
  maxBytes: number
): { payload: DedupeLine[]; idMap: Map<string, string>; recipeCount: number; skipped: number } {
  const builder = dedupePayloadBuilder(maxBytes);
  const idMap = new Map<string, string>();
  const recipes = new Set<string>();
  let skipped = 0;
  for (const line of allLines(state)) {
    if (!isDedupeEligible(line)) continue;
    const id = `L${builder.lines.length + 1}`;
    if (!builder.tryAdd({ id, text: line.source! })) {
      skipped++;
      continue;
    }
    idMap.set(id, line.id);
    recipes.add(line.recipeId!);
  }
  return { payload: builder.lines, idMap, recipeCount: recipes.size, skipped };
}

/**
 * A model that answers `1` for `"L1"` comes back as `"1"` (`parseDedupeResult` stringifies
 * whole numbers), so a bare number is read as its `L` id. Anything else is looked up as is,
 * and an id that maps to nothing is dropped.
 */
function normalizeAnswerId(id: string): string {
  return /^\d+$/.test(id) ? `L${id}` : id;
}

/**
 * Apply magic beans' groups to the CURRENT state (lines edited or unticked while it ran
 * are simply skipped). A group is applied only when, after dropping unknown, repeated and
 * already-claimed ids (first claim wins), it still has ≥ 2 mergeable ticked lines from ≥ 2
 * recipes and a non-empty name. Text: `Name: part1 + part2`, the parts' own text (which
 * already carries its suffix), in section order.
 */
export function applyDuplicateGroups(
  state: WeekShoppingState,
  groups: readonly DedupeGroup[],
  idMap: ReadonlyMap<string, string>
): { state: WeekShoppingState; applied: number; dropped: number } {
  const order = new Map<string, number>();
  const byId = new Map<string, ChecklistLine>();
  allLines(state).forEach((l, i) => {
    order.set(l.id, i);
    byId.set(l.id, l);
  });

  const claimed = new Set<string>();
  const added: ChecklistLine[] = [];
  let dropped = 0;
  for (const group of groups) {
    const name = sanitizeDedupeName(typeof group.name === 'string' ? group.name : '');
    const parts: ChecklistLine[] = [];
    for (const answerId of new Set(group.lineIds.map(normalizeAnswerId))) {
      const lineId = idMap.get(answerId);
      const line = lineId === undefined ? undefined : byId.get(lineId);
      if (!line || claimed.has(line.id) || !line.checked || !isMergeable(line)) continue;
      parts.push(line);
    }
    if (!name || parts.length < 2 || distinctRecipeIds(parts).length < 2) {
      dropped += 1;
      continue;
    }
    parts.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    for (const p of parts) claimed.add(p.id);
    added.push(mergedLine(parts, `${name}: ${parts.map((p) => p.text).join(' + ')}`, 1, 'ai'));
  }
  return { state: withMerges(state, added), applied: added.length, dropped };
}

/**
 * Split a merged line: it goes, and its parts come back into their sections exactly as
 * they were (any edit made to the merged line is discarded), marked `split` so neither the
 * exact merge nor Find Duplicates offers them again this open.
 */
export function splitMergedLine(state: WeekShoppingState, id: string): WeekShoppingState {
  if (!state.merged.some((m) => m.id === id)) return state;
  return {
    sections: patchSectionLines(state.sections, (l) => {
      if (l.mergedInto !== id) return l;
      const { mergedInto: _gone, ...rest } = l;
      return { ...rest, split: true };
    }),
    merged: state.merged.filter((m) => m.id !== id),
  };
}

/** What `restoreMergedLine` needs to undo a Split: the merged line, its parts, its place. */
export interface SplitSnapshot {
  /** The merged line exactly as it was (any edit to it included). */
  merged: ChecklistLine;
  /** Its parts exactly as they were while merged. */
  parts: ChecklistLine[];
  /** Its position in "In More Than One Meal". */
  index: number;
}

/** Take the snapshot BEFORE `splitMergedLine`; `null` for an id that is not a merged line. */
export function splitSnapshotOf(state: WeekShoppingState, id: string): SplitSnapshot | null {
  const index = state.merged.findIndex((m) => m.id === id);
  if (index < 0) return null;
  return {
    merged: state.merged.at(index)!,
    parts: allLines(state).filter((l) => l.mergedInto === id),
    index,
  };
}

/**
 * Undo a Split: put the merged line back exactly as it was, hiding its parts again. Only when
 * EVERY part is still there, not merged into anything else, and unchanged since the Split: the
 * same text AND the same tick. The undo writes the snapshot's copies back, so a part edited,
 * ticked or unticked after the Split would otherwise be silently reverted. Otherwise the state
 * is returned unchanged (the same object), so the caller can tell the undo was skipped.
 */
export function restoreMergedLine(
  state: WeekShoppingState,
  snapshot: SplitSnapshot
): WeekShoppingState {
  const current = new Map(allLines(state).map((l) => [l.id, l] as const));
  const intact = snapshot.parts.every((p) => {
    const now = current.get(p.id);
    return (
      now !== undefined &&
      now.mergedInto === undefined &&
      now.text === p.text &&
      now.checked === p.checked
    );
  });
  if (
    !intact ||
    snapshot.parts.length === 0 ||
    state.merged.some((m) => m.id === snapshot.merged.id)
  ) {
    return state;
  }
  const before = new Map(snapshot.parts.map((p) => [p.id, p] as const));
  const merged = [...state.merged];
  merged.splice(Math.min(snapshot.index, merged.length), 0, snapshot.merged);
  return {
    sections: patchSectionLines(state.sections, (l) => before.get(l.id) ?? l),
    merged,
  };
}
