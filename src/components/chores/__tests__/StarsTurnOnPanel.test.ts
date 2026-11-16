/**
 * Stars and rewards (#148): the turn-on panel the "Stars and Rewards" view shows while the
 * feature is off. One action, "Turn On Stars and Rewards", from the session grown-up; no way to
 * dismiss it (there is no "Not now"); a `null` from the store (already toasted) shows nothing
 * more; the sample strip draws the family's first child.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/starStore', async () => (await import('./choreTestKit')).starStoreModule);
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: toast }),
  showToast: toast,
}));

import StarsTurnOnPanel from '../StarsTurnOnPanel.vue';
import StarPathStrip from '../StarPathStrip.vue';
import { resetKit, starActions, stars } from './choreTestKit';

beforeEach(() => {
  resetKit();
  toast.mockReset();
  stars.earners = ['kid', 'sib'];
});

const mountPanel = () => mount(StarsTurnOnPanel, { global: { stubs: { BeanieAvatar: true } } });

describe('StarsTurnOnPanel', () => {
  it('turns it on for the session grown-up', async () => {
    const w = mountPanel();
    await w.get('[data-testid="stars-turn-on"]').trigger('click');
    await flushPromises();
    expect(starActions.setRewards).toHaveBeenCalledWith({ on: true }, 'mom');
  });

  it('has one action and no way to dismiss it', () => {
    const w = mountPanel();
    expect(w.findAll('button')).toHaveLength(1);
    expect(w.text()).not.toContain('notNow');
  });

  it('a refused or failed turn-on (null, already toasted) shows nothing more', async () => {
    starActions.setRewards.mockResolvedValue(null);
    const w = mountPanel();
    await w.get('[data-testid="stars-turn-on"]').trigger('click');
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
    expect(w.get('[data-testid="stars-turn-on"]').attributes('disabled')).toBeUndefined();
  });

  it("the sample strip draws the family's first child on a 20-step week at an 80% bar", () => {
    const strip = mountPanel().findComponent(StarPathStrip);
    expect(strip.props('member')).toMatchObject({ id: 'kid' });
    expect(strip.props('path')).toMatchObject({ steps: 20, earned: 11, barAt: 15 });
    expect(strip.props('barPct')).toBe(80);
  });
});
