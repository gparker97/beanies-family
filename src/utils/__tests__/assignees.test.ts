import { describe, it, expect } from 'vitest';
import { membersByIds, normalizeAssignees, toAssigneePayload } from '../assignees';
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
