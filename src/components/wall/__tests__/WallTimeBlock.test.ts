/**
 * One block, three densities, three states.
 *
 * The density rules are the reason this file exists: they are chosen from the
 * width the block ACTUALLY gets (its lane share), not the column's width, and
 * getting that wrong is invisible until a collision renders.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WallTimeBlock from '../WallTimeBlock.vue';
import type { ActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity, FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const member = (id: string, name: string): FamilyMember =>
  ({ id, name, color: '#F15D22' }) as FamilyMember;

const activity = {
  id: 'a1',
  title: 'Football training',
  date: '2026-09-03',
  category: 'football',
  assigneeIds: ['m1'],
} as FamilyActivity;

const identity: ActivityIdentity = {
  color: '#F15D22',
  kind: 'solo' as const,
  stackMembers: [member('m1', 'Leo')],
  emoji: '🏈',
  celebration: { celebrating: false, rule: 'none', suppressed: null },
  sticker: '',
  style: {},
  edgeStyle: { borderLeftColor: '#F15D22' },
  dashed: false,
};

function mountBlock(over: Record<string, unknown> = {}) {
  return mount(WallTimeBlock, {
    props: {
      activity,
      identity,
      width: 300,
      height: 120,
      capped: false,
      state: 'future',
      progress: 0,
      timeRange: '16:00–18:00',
      ownerNames: 'Leo',
      ...over,
    },
    global: { stubs: { CelebrationConfetti: true, ActivityOwnerStack: true } },
  });
}

describe('WallTimeBlock density', () => {
  it('shows the title and the detail line at full width', () => {
    const w = mountBlock({ width: 300 });
    expect(w.text()).toContain('Football training');
    expect(w.text()).toContain('16:00–18:00');
  });

  it('keeps the title but drops the detail line when tight', () => {
    const w = mountBlock({ width: 150 });
    expect(w.text()).toContain('Football training');
    expect(w.text()).not.toContain('16:00–18:00');
  });

  it('⭐ gives up the TITLE, never the position, below the sliver width', () => {
    // A collision on a 130px week column cannot show two titles. The block still
    // sits at its true time, still says what kind of thing it is, and still opens.
    const w = mountBlock({ width: 70 });
    expect(w.text()).not.toContain('Football training');
    expect(w.text()).toContain('🏈');
    // …and it is still reachable and still named, for a screen reader and a tap.
    expect(w.attributes('aria-label')).toContain('Football training');
  });

  it('⭐ a capped block always states its range, so the clamp is never silent', () => {
    // Otherwise a three-hour event and a one-hour event are the same size with
    // nothing on screen saying why.
    const w = mountBlock({ width: 150, capped: true });
    expect(w.text()).toContain('16:00–18:00');
  });
});

describe('WallTimeBlock accessibility', () => {
  it('⭐ carries the TIME in the accessible name, at every density', () => {
    // An explicit aria-label replaces the element's contents, so labelling the
    // button with the bare title dropped the one thing a grid expresses only as
    // pixel position: a screen-reader user could not tell a 07:30 school run
    // from a 19:30 bath time. The detail line is not even rendered at tight
    // density, so there was no textual time anywhere on the week view.
    for (const width of [300, 150, 70]) {
      const name = mountBlock({ width }).attributes('aria-label');
      expect(name, `width ${width}`).toContain('16:00–18:00');
      expect(name, `width ${width}`).toContain('Football training');
    }
  });

  it('⭐ does not clip its own celebration sticker', () => {
    // `style.css` draws the sticker as an ::after OUTSIDE the card's box, so a
    // surface showing it must not clip. `overflow-hidden` on the button clipped
    // it and a birthday lost its corner mark on every wall view.
    const w = mountBlock({
      identity: {
        ...identity,
        sticker: '🎂',
        celebration: { celebrating: true, rule: 'category', suppressed: null },
      },
    });
    expect(w.classes()).not.toContain('overflow-hidden');
    expect(w.attributes('data-sticker')).toBe('🎂');
  });
});

describe('WallTimeBlock state', () => {
  it('dims what has already happened', () => {
    expect(mountBlock({ state: 'past' }).classes()).toContain('wall-tblock-past');
    expect(mountBlock({ state: 'future' }).classes()).not.toContain('wall-tblock-past');
  });

  it('marks and fills the event that is running', () => {
    const w = mountBlock({ state: 'running', progress: 40 });
    expect(w.classes()).toContain('wall-tblock-running');
    expect(w.text()).toContain('wall.grid.runningNow');
    expect(w.find('.wall-tblock-progress').attributes('style')).toContain('width: 40%');
  });

  it('suppresses the now marker on a block too narrow to hold it', () => {
    const w = mountBlock({ state: 'running', progress: 40, width: 120 });
    expect(w.text()).not.toContain('wall.grid.runningNow');
    // The fill still shows — it costs no width.
    expect(w.find('.wall-tblock-progress').exists()).toBe(true);
  });

  it('carries a dashed edge for a shared event, the one cue needing no colour vision', () => {
    const w = mountBlock({ identity: { ...identity, dashed: true } });
    expect(w.classes()).toContain('border-dashed');
  });
});
