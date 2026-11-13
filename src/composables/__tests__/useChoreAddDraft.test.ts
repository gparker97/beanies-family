/**
 * The Add Chores list (#146): one list for the session, sets appended without duplicates (same
 * title, same block, any case), a set taken off keeps its edited rows, and the edit count is
 * what `chores-add-edited` logs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addBlankRow,
  addSet,
  clearChoreAddDraft,
  editCount,
  isSetOn,
  previewSet,
  removeRow,
  removeSet,
  useChoreAddDraft,
} from '@/composables/useChoreAddDraft';
import { CHORE_STARTER_SETS, choreStarterSet } from '@/constants/choreStarterSets';

const resolve = (k: string) => k;
const list = useChoreAddDraft();

beforeEach(() => clearChoreAddDraft());

describe('useChoreAddDraft', () => {
  it('appends a set once, skipping what the list already has in that block', () => {
    expect(addSet('bedtime', resolve)).toBe(choreStarterSet('bedtime')!.chores.length);
    expect(isSetOn('bedtime')).toBe(true);
    // School Morning's brush-teeth is a MORNING chore: not a duplicate of Bedtime's evening one.
    expect(previewSet('school-morning', resolve).filter((p) => p.dup)).toHaveLength(0);
    addBlankRow('morning').draft.title = '  CHOREBOARD.STARTERCHORE.MAKEBED ';
    expect(
      previewSet('school-morning', resolve)
        .filter((p) => p.dup)
        .map((p) => p.draft.starterChoreKey)
    ).toEqual(['make-bed']);
    expect(addSet('school-morning', resolve)).toBe(
      choreStarterSet('school-morning')!.chores.length - 1
    );
  });

  it('taking a set off keeps its edited rows; the edit count covers changes, own rows and removals', () => {
    addSet('tidy-up', resolve);
    list.rows[0]!.draft.title = 'Toys in the box';
    list.rows[1]!.draft.block = 'evening';
    removeRow(list.rows[2]!.id);
    addBlankRow('anytime'); // blank: not an edit yet
    expect(editCount()).toBe(3);
    list.rows.at(-1)!.draft.title = 'Feed the fish';
    expect(editCount()).toBe(4);
    removeSet('tidy-up');
    expect(isSetOn('tidy-up')).toBe(false);
    expect(list.rows.map((r) => r.draft.title)).toEqual([
      'Toys in the box',
      'choreboard.starterChore.clothesHamper',
      'Feed the fish',
    ]);
  });

  it('clear forgets everything; the definitions are never touched', () => {
    const before = JSON.stringify(CHORE_STARTER_SETS);
    addSet('pet-care', resolve);
    list.rows[0]!.draft.title = 'X';
    clearChoreAddDraft();
    expect(list.rows).toEqual([]);
    expect(list.sets).toEqual([]);
    expect(editCount()).toBe(0);
    expect(JSON.stringify(CHORE_STARTER_SETS)).toBe(before);
  });
});
