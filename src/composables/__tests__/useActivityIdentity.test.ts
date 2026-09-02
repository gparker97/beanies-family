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

  it('classifies ONCE even when a template asks several times', () => {
    // Real templates need the identity in four or five bindings (wash, dashed class,
    // emoji, stack). Without the memo each one re-ran `classify()` — a Set build plus
    // linear roster scans — so a month grid paid for hundreds of redundant
    // classifications per paint.
    classify.mockReturnValue({ kind: 'solo', color: '#111', members: [member('a', '#111')] });
    const { identityFor } = useActivityIdentity();
    const a = activity();
    identityFor(a);
    identityFor(a);
    identityFor(a);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('re-classifies when the activity changes', () => {
    classify.mockReturnValue({ kind: 'solo', color: '#111', members: [member('a', '#111')] });
    const { identityFor } = useActivityIdentity();
    identityFor(activity());
    identityFor(activity({ updatedAt: '2026-09-09T00:00:00Z' }));
    expect(classify).toHaveBeenCalledTimes(2);
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

  it('uses ONE wash alpha, themeable via a custom property', () => {
    // Seven call sites used four different alpha suffixes for this same wash. The alpha
    // rides on `--wash-a` rather than being baked in, because these are INLINE styles
    // and an inline style cannot be overridden by a `.dark` rule — the migrated
    // surfaces gave up theme-aware `var(--tint-*)` classes to get one consistent rule,
    // and 13% on a dark surface is close to invisible.
    classify.mockReturnValue({ kind: 'solo', color: '#3b82f6', members: [member('a', '#3b82f6')] });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity()).style.background).toBe('rgba(59, 130, 246, 0.13)');
  });

  it('deepens the wash in dark mode, where 13% all but disappears', () => {
    classify.mockReturnValue({ kind: 'solo', color: '#3b82f6', members: [member('a', '#3b82f6')] });
    document.documentElement.classList.add('dark');
    try {
      const { identityFor } = useActivityIdentity();
      expect(identityFor(activity()).style.background).toBe('rgba(59, 130, 246, 0.24)');
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('gives cards that own their surface an edge-only style', () => {
    // `background` is a shorthand and beats any class, so binding the full style on a
    // card carrying `bg-white dark:bg-slate-800` silently replaced that surface.
    classify.mockReturnValue({ kind: 'solo', color: '#3b82f6', members: [member('a', '#3b82f6')] });
    const { identityFor } = useActivityIdentity();
    const id = identityFor(activity());
    expect(id.edgeStyle).toEqual({ borderLeftColor: '#3b82f6' });
    expect(id.edgeStyle.background).toBeUndefined();
  });

  it('shows no faces for an unowned event INSIDE a lane', () => {
    // It is already in every bean's column; repeating the whole family in each one says
    // nothing and costs the title its width.
    classify.mockReturnValue({
      kind: 'family',
      color: '#F15D22',
      members: [member('a', '#111'), member('b', '#222')],
    });
    const { identityFor } = useActivityIdentity();
    expect(identityFor(activity(), { laneMemberId: 'a' }).stackMembers).toEqual([]);
    expect(identityFor(activity()).stackMembers).toHaveLength(2);
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
