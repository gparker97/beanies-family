import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import TripChip from '../TripChip.vue';
import { member, trip } from '@/test/monthCellFixtures';

const MEMBERS = [member('m-aria', 'Aria'), member('m-bo', 'Bo'), member('m-cy', 'Cy')];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: MEMBERS, humans: MEMBERS }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));

beforeEach(() => setActivePinia(createPinia()));

const inner = (w: ReturnType<typeof mount>) => w.findComponent({ name: 'AllDayChip' });

describe('TripChip', () => {
  it('draws the trip name and its emoji on a single-day run, rounded both ends', () => {
    const w = mount(TripChip, {
      props: { vacation: trip('v1', { name: 'Bali', emoji: '🏝️' }), isStart: true, isEnd: true },
    });
    expect(w.text()).toContain('Bali');
    expect(w.text()).toContain('🏝️');
    expect(w.attributes('data-testid')).toBe('trip-chip');
    expect(w.attributes('title')).toBe('Bali');
    expect(w.classes()).toEqual(expect.arrayContaining(['rounded-l-md', 'rounded-r-md']));
  });

  it('rounds only the true ends of a run', () => {
    const mid = mount(TripChip, {
      props: { vacation: trip('v1'), isStart: false, isEnd: false },
    });
    expect(mid.classes()).not.toContain('rounded-l-md');
    expect(mid.classes()).not.toContain('rounded-r-md');
    const end = mount(TripChip, { props: { vacation: trip('v1'), isStart: false, isEnd: true } });
    expect(end.classes()).toContain('rounded-r-md');
    expect(end.classes()).not.toContain('rounded-l-md');
  });

  it('showLabel is tri-state: unset follows isStart, true or false overrides', () => {
    const v = trip('v1', { name: 'Bali' });
    expect(
      mount(TripChip, { props: { vacation: v, isStart: false, isEnd: true } }).text()
    ).not.toContain('Bali');
    expect(
      mount(TripChip, {
        props: { vacation: v, isStart: false, isEnd: true, showLabel: true },
      }).text()
    ).toContain('Bali');
    expect(
      mount(TripChip, {
        props: { vacation: v, isStart: true, isEnd: true, showLabel: false },
      }).text()
    ).not.toContain('Bali');
  });

  it('resolves travellers from the roster in id order and drops unknown ids', () => {
    const w = mount(TripChip, {
      props: {
        vacation: trip('v1', { travellerIds: ['m-cy', 'gone', 'm-aria'] }),
        isStart: true,
        isEnd: true,
      },
    });
    const faces = inner(w).props('faces') as { id: string }[];
    expect(faces.map((f) => f.id)).toEqual(['m-cy', 'm-aria']);
    expect(inner(w).props('solo')).toBe(false);
  });

  it('uses the themed trip ink and silk wash', () => {
    const w = mount(TripChip, { props: { vacation: trip('v1'), isStart: true, isEnd: true } });
    expect(inner(w).props('color')).toBe('var(--trip-ink)');
    expect(inner(w).props('bgColor')).toBe('var(--tint-silk-30)');
  });

  it('click carries the native event, so a parent @click.stop works', async () => {
    const parent = vi.fn();
    const w = mount(
      {
        components: { TripChip },
        setup: () => ({ v: trip('v1'), parent }),
        template:
          '<div @click="parent"><TripChip :vacation="v" :is-start="true" :is-end="true" @click.stop="() => {}" /></div>',
      },
      {}
    );
    await w.get('[data-testid="trip-chip"]').trigger('click');
    expect(parent).not.toHaveBeenCalled();
    const chip = w.findComponent(TripChip);
    expect(chip.emitted('click')).toHaveLength(1);
    expect(chip.emitted('click')![0][0]).toBeInstanceOf(MouseEvent);
  });
});
