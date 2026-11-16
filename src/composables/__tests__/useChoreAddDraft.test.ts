/**
 * The Add Chores list (#146): one list for the session, sets appended without duplicates (same
 * title, same block, any case), a set taken off keeps its edited rows, and the edit count is
 * what `chores-add-edited` logs. A committed title's picture follows the rename rule
 * (`renameRow`): a set's picture and card art stay on a small edit and give way to a title that
 * suggests something different, as a pick by hand does.
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
  renameRow,
  useChoreAddDraft,
} from '@/composables/useChoreAddDraft';
import { CHORE_STARTER_SETS, choreStarterSet } from '@/constants/choreStarterSets';
import { DEFAULT_CHORE_EMOJI } from '@/constants/choreBlocks';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';

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

  it('a row whose days were changed counts as edited and stays when its set is taken off', () => {
    addSet('school-morning', resolve);
    const row = list.rows[0]!;
    row.draft.days = [1, 3, 5];
    expect(editCount()).toBe(1);
    removeSet('school-morning');
    expect(list.rows).toEqual([row]);
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

describe('renameRow: a committed title and the rename rule', () => {
  const english = (k: UIStringKey) => UI_STRINGS[k];
  const rowOf = (chore: string) => list.rows.find((r) => r.draft.starterChoreKey === chore)!;

  it('a set row keeps its picture and card art on a small edit, and takes a new suggestion', () => {
    addSet('school-morning', english);
    const bag = rowOf('pack-bag');
    expect(bag.draft).toMatchObject({ emoji: '🎒', illustration: 'school-drop-off' });
    renameRow(bag, 'Pack your school bag tonight');
    expect(bag.draft).toMatchObject({ emoji: '🎒', illustration: 'school-drop-off' });
    renameRow(bag, 'Make your lunch');
    expect(bag.draft.emoji).toBe('🥪');
    expect(bag.draft.illustration).toBeUndefined();
    // A title that suggests nothing keeps the set's picture.
    const shoes = rowOf('shoes-on');
    renameRow(shoes, 'Say goodbye');
    expect(shoes.draft.emoji).toBe('👟');
  });

  it('a hand pick stays on a small edit and gives way to a title that suggests something else', () => {
    addSet('school-morning', english);
    const bed = rowOf('make-bed');
    bed.draft.emoji = '🧸'; // picked by hand
    renameRow(bed, 'Make your bed neatly');
    expect(bed.draft.emoji).toBe('🧸');
    renameRow(bed, 'Brush teeth');
    expect(bed.draft.emoji).toBe('🪥');
  });

  it('a blank row takes its first title’s suggestion, else the default; committing the same title changes nothing', () => {
    const own = addBlankRow('anytime');
    renameRow(own, 'Say thank you');
    expect(own.draft.emoji).toBe(DEFAULT_CHORE_EMOJI);
    renameRow(own, 'Feed the dog');
    expect(own.draft.emoji).toBe('🐕');
    own.draft.emoji = '⭐';
    renameRow(own, 'Feed the dog');
    expect(own.draft.emoji).toBe('⭐');
  });
});
