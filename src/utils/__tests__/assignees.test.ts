import { describe, it, expect } from 'vitest';
import { normalizeAssignees, toAssigneePayload } from '../assignees';

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
