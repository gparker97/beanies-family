import { describe, it, expect } from 'vitest';
import {
  listAssignees,
  membersByIds,
  normalizeAssignees,
  toAssigneePayload,
  toListAssigneePayload,
} from '../assignees';
import { member } from '@/test/monthCellFixtures';

describe('normalizeAssignees', () => {
  it('returns assigneeIds when present and non-empty', () => {
    expect(normalizeAssignees({ assigneeIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('falls back to [assigneeId] when assigneeIds is absent', () => {
    expect(normalizeAssignees({ assigneeId: 'x' })).toEqual(['x']);
  });

  it('falls back to [assigneeId] when assigneeIds is empty', () => {
    expect(normalizeAssignees({ assigneeIds: [], assigneeId: 'x' })).toEqual(['x']);
  });

  it('prefers assigneeIds over assigneeId when both present', () => {
    expect(normalizeAssignees({ assigneeIds: ['a', 'b'], assigneeId: 'a' })).toEqual(['a', 'b']);
  });

  it('returns [] when neither field is set', () => {
    expect(normalizeAssignees({})).toEqual([]);
  });

  it('returns [] when assigneeId is empty string', () => {
    expect(normalizeAssignees({ assigneeId: '' })).toEqual([]);
  });
});

describe('toAssigneePayload', () => {
  it('returns both fields for a single ID', () => {
    expect(toAssigneePayload(['a'])).toEqual({
      assigneeIds: ['a'],
      assigneeId: 'a',
    });
  });

  it('returns first ID as legacy assigneeId for multiple IDs', () => {
    expect(toAssigneePayload(['a', 'b'])).toEqual({
      assigneeIds: ['a', 'b'],
      assigneeId: 'a',
    });
  });

  it('returns undefined assigneeId for empty array', () => {
    expect(toAssigneePayload([])).toEqual({
      assigneeIds: [],
      assigneeId: undefined,
    });
  });
});

describe('membersByIds', () => {
  const roster = [member('a'), member('b'), member('c')];

  it('returns members in the order of the ids, not the roster', () => {
    expect(membersByIds(roster, ['c', 'a']).map((m) => m.id)).toEqual(['c', 'a']);
  });

  it('drops unknown ids', () => {
    expect(membersByIds(roster, ['a', 'ghost', 'b']).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for no ids or an empty roster', () => {
    expect(membersByIds(roster, [])).toEqual([]);
    expect(membersByIds([], ['a'])).toEqual([]);
  });
});

describe('listAssignees (the one reader of a list owner pair)', () => {
  it('absent assigneeIds (an older list) reads as its owner', () => {
    expect(listAssignees({ ownerId: 'a' })).toEqual(['a']);
    expect(listAssignees({ ownerId: 'a', assigneeIds: [] })).toEqual(['a']);
  });
  it('in step: every assignee, owner first', () => {
    expect(listAssignees({ ownerId: 'a', assigneeIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  it('owner listed but not first (two devices merged field by field): everyone, owner first', () => {
    expect(listAssignees({ ownerId: 'b', assigneeIds: ['a', 'b'] })).toEqual(['b', 'a']);
    expect(listAssignees({ ownerId: 'c', assigneeIds: ['a', 'b', 'c', 'd'] })).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });
  it('owner not listed (an older build moved the owner to someone else): the newer ownerId wins', () => {
    expect(listAssignees({ ownerId: 'c', assigneeIds: ['a', 'b'] })).toEqual(['c']);
  });
  it('an empty owner with no ids is nobody', () => {
    expect(listAssignees({ ownerId: '' })).toEqual([]);
    expect(listAssignees({ ownerId: '', assigneeIds: [''] })).toEqual([]);
  });
  it('an empty owner falls back to the stored ids, de-duplicated with blanks dropped', () => {
    expect(listAssignees({ ownerId: '', assigneeIds: ['b', '', 'a', 'b'] })).toEqual(['b', 'a']);
  });
});

describe('toListAssigneePayload (the one producer of the pair)', () => {
  it('keeps the order and makes the first the owner', () => {
    expect(toListAssigneePayload(['b', 'a'])).toEqual({ assigneeIds: ['b', 'a'], ownerId: 'b' });
  });
  it('de-duplicates and drops blanks', () => {
    expect(toListAssigneePayload(['a', 'b', 'a', '', 'b'])).toEqual({
      assigneeIds: ['a', 'b'],
      ownerId: 'a',
    });
  });
  it('never throws on an empty set (the store refuses it before writing)', () => {
    expect(toListAssigneePayload([])).toEqual({ assigneeIds: [], ownerId: '' });
  });
  it('round-trips through listAssignees', () => {
    const ids = ['k', 'a', 'k'];
    expect(listAssignees(toListAssigneePayload(ids))).toEqual(['k', 'a']);
  });
});
