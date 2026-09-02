import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { FamilyActivity, FamilyMember } from '@/types/models';

const classify = vi.fn();
vi.mock('@/composables/useActivityChipClass', () => ({
  useActivityChipClass: () => ({ classify }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ currentLanguage: 'en' }),
}));

import { useActivityIdentity } from '../useActivityIdentity';

const member = (id: string, color: string) => ({ id, name: id, color }) as unknown as FamilyMember;

const activity = (over: Partial<FamilyActivity> = {}) =>
  ({
    id: 'a1',
    title: 'Swim run',
    category: 'swimming',
    updatedAt: '2026-09-02T00:00:00Z',
    ...over,
  }) as FamilyActivity;

beforeEach(() => {
  setActivePinia(createPinia());
  classify.mockReset();
});

describe('useActivityIdentity', () => {
  it('hides the owner inside their own lane, because the lane header already names them', () => {
    classify.mockReturnValue({ kind: 'solo', color: '#111', members: [member('max', '#111')] });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity(), { laneMemberId: 'max' }).stackMembers).toEqual([]);
  });

  it('shows only the OTHER beans on a shared card inside a lane', () => {
    // A face inside a lane then always means "someone else is in this too" — which is
    // what lets shared events differentiate themselves without any decoration.
    classify.mockReturnValue({
      kind: 'shared',
      color: '#F15D22',
      members: [member('max', '#111'), member('sofia', '#222')],
    });
    const { identityFor } = useActivityIdentity();
    const ids = identityFor(activity(), { laneMemberId: 'max' }).stackMembers.map((m) => m.id);
    expect(ids).toEqual(['sofia']);
  });

  it('shows every owner where there is no lane context', () => {
    classify.mockReturnValue({
      kind: 'shared',
      color: '#F15D22',
      members: [member('max', '#111'), member('sofia', '#222')],
    });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity()).stackMembers).toHaveLength(2);
  });

  it('calls the classifier exactly once per activity, not once per face', () => {
    classify.mockReturnValue({
      kind: 'shared',
      color: '#F15D22',
      members: [member('a', '#111'), member('b', '#222'), member('c', '#333')],
    });
    const { identityFor } = useActivityIdentity();
    identityFor(activity());
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("gives a shared card the FIRST owner's edge over a blend, not a flat orange", () => {
    classify.mockReturnValue({
      kind: 'shared',
      color: '#F15D22',
      members: [member('max', '#3b82f6'), member('sofia', '#8b5cf6')],
    });
    const { identityFor } = useActivityIdentity();
    const id = identityFor(activity());
    expect(id.color).toBe('#3b82f6');
    expect(id.style.background).toContain('linear-gradient');
    expect(id.dashed).toBe(true);
  });

  it('keeps Heritage Orange for a no-owner event and does not dash it', () => {
    classify.mockReturnValue({ kind: 'family', color: '#F15D22', members: [member('a', '#111')] });
    const { identityFor } = useActivityIdentity();
    const id = identityFor(activity());
    expect(id.color).toBe('#F15D22');
    expect(id.dashed).toBe(false);
  });

  it('uses ONE wash alpha, expressed as rgba rather than a hex suffix', () => {
    // Seven call sites used four different alpha suffixes for this same wash.
    classify.mockReturnValue({ kind: 'solo', color: '#3b82f6', members: [member('a', '#3b82f6')] });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity()).style.background).toBe('rgba(59, 130, 246, 0.13)');
  });

  it('resolves a blank member colour rather than emitting a transparent wash', () => {
    classify.mockReturnValue({
      kind: 'shared',
      color: '#F15D22',
      members: [member('a', ''), member('b', '#8b5cf6')],
    });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity()).color).toBe('#6b7280');
  });

  it('memoises the celebration verdict per activity, and re-evaluates on edit', () => {
    classify.mockReturnValue({ kind: 'solo', color: '#111', members: [member('a', '#111')] });
    const { identityFor } = useActivityIdentity();
    const birthday = activity({ title: "Leo's birthday" });
    expect(identityFor(birthday).celebration.celebrating).toBe(true);
    const renamed = activity({ title: 'Swimming', updatedAt: '2026-09-03T00:00:00Z' });
    expect(identityFor(renamed).celebration.celebrating).toBe(false);
  });

  it('lets an explicit override win in both directions', () => {
    classify.mockReturnValue({ kind: 'solo', color: '#111', members: [member('a', '#111')] });
    const { identityFor } = useActivityIdentity();
    const birthday = activity({ title: "Leo's birthday" });
    expect(identityFor(birthday, { celebrationOverride: false }).celebration.celebrating).toBe(
      false
    );
    expect(identityFor(activity(), { celebrationOverride: true }).celebration.celebrating).toBe(
      true
    );
  });
});
