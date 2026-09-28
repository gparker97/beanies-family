/**
 * useResponsibilityCardLabel.holderLines: the ONE list of a card's parts and holders, shared
 * by the deal pile's banner (held parts only) and the Card Details split list (every part).
 * An open part must come back with `held: null`, never dropped; a holder with no recorded
 * time comes back with `date: null`, never an invented one.
 */
import { describe, it, expect, vi } from 'vitest';
import { reactive } from 'vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const family = reactive({
  members: [
    { id: 'greg', name: 'greg', role: 'owner', ageGroup: 'adult' },
    { id: 'mia', name: 'Mia', role: 'member', ageGroup: 'child' },
    { id: 'leo', name: 'Leo', role: 'member', ageGroup: 'child' },
  ],
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';

describe('holderLines', () => {
  it('returns every part: a held one with its holder, an open one with held: null', () => {
    const { holderLines } = useResponsibilityCardLabel();
    const lines = holderLines({
      splitMode: 'child',
      state: null,
      parts: [{ key: 'mia', holderId: 'greg', since: '2026-09-02T10:00:00Z' }, { key: 'leo' }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      key: 'mia',
      memberId: 'greg',
      caption: 'whoOwnsWhat.card.forChild',
    });
    expect(lines[0]!.held?.name).toBe('greg');
    expect(lines[0]!.held?.date).toBeTruthy();
    expect(lines[1]).toMatchObject({ key: 'leo', memberId: null, held: null });
  });

  it('a holder with no recorded time has date: null, and an unsplit card has no caption', () => {
    const { holderLines } = useResponsibilityCardLabel();
    const [line] = holderLines({
      splitMode: 'single',
      state: null,
      parts: [{ key: 'main', holderId: 'greg' }],
    });
    expect(line).toMatchObject({ caption: '', held: { name: 'greg', date: null } });
  });
});
