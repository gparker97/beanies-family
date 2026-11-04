import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import AllDayChip from '../AllDayChip.vue';
import { DEFAULT_CELL_CHIPS, MONTH_CELL_CHIPS, type MonthCellChips } from '../monthCellChipsKey';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));

function withCtx(ctx: Partial<MonthCellChips>) {
  return { provide: { [MONTH_CELL_CHIPS as symbol]: ref({ ...DEFAULT_CELL_CHIPS, ...ctx }) } };
}
const FACES = [member('a', 'Aria'), member('b', 'Bo')];
const faceCount = (w: ReturnType<typeof mount>) =>
  w.findAllComponents({ name: 'BeanieAvatar' }).length;

const base = { title: 'Vesak Day', color: '#b5654a', bgColor: 'rgb(181 101 74 / 7%)' };

describe('AllDayChip', () => {
  it('renders the title (default slot) + leading emoji on the start cell', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, leadingEmoji: '🇸🇬', isStart: true, isEnd: true },
    });
    expect(wrapper.text()).toContain('🇸🇬');
    expect(wrapper.text()).toContain('Vesak Day');
    expect(wrapper.attributes('title')).toBe('Vesak Day');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('renders the slot content over the title fallback when a slot is provided', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, isStart: true, isEnd: true },
      slots: { default: 'Custom <b>label</b>' },
    });
    expect(wrapper.text()).toContain('Custom');
    expect(wrapper.text()).not.toContain('Vesak Day');
  });

  it('hides the label on a multi-day middle cell and renders square corners', () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: false, isEnd: false } });
    expect(wrapper.text()).not.toContain('Vesak Day');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('rounds right only on a multi-day end cell', () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: false, isEnd: true } });
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('applies the italic class when italic is set', () => {
    const wrapper = mount(AllDayChip, {
      props: { ...base, italic: true, isStart: true, isEnd: true },
    });
    expect(wrapper.classes()).toContain('italic');
  });

  it('uses the testid prop for the root data-testid (default "all-day-chip")', () => {
    expect(
      mount(AllDayChip, { props: { ...base, isStart: true, isEnd: true } }).attributes(
        'data-testid'
      )
    ).toBe('all-day-chip');
    expect(
      mount(AllDayChip, {
        props: { ...base, isStart: true, isEnd: true, testid: 'holiday-chip' },
      }).attributes('data-testid')
    ).toBe('holiday-chip');
  });

  it('emits click with the native MouseEvent', async () => {
    const wrapper = mount(AllDayChip, { props: { ...base, isStart: true, isEnd: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});

describe('AllDayChip showLabel (#141 tri-state)', () => {
  it('no showLabel prop: the label follows isStart (the Vue boolean-casting guard)', () => {
    // An absent Boolean prop is cast to false unless it has a declared default. If this
    // fails, every holiday, birthday and week-view chip has lost its label.
    expect(mount(AllDayChip, { props: { ...base, isStart: true, isEnd: false } }).text()).toContain(
      'Vesak Day'
    );
    expect(
      mount(AllDayChip, { props: { ...base, isStart: false, isEnd: true } }).text()
    ).not.toContain('Vesak Day');
  });

  it('showLabel is independent of isStart, both ways', () => {
    expect(
      mount(AllDayChip, {
        props: { ...base, isStart: false, isEnd: false, showLabel: true },
      }).text()
    ).toContain('Vesak Day');
    expect(
      mount(AllDayChip, {
        props: { ...base, isStart: true, isEnd: true, showLabel: false },
      }).text()
    ).not.toContain('Vesak Day');
  });
});

describe('AllDayChip month chip context (#141)', () => {
  const props = { ...base, leadingEmoji: '✈️', isStart: true, isEnd: true };

  it('no provider and no new props: unchanged (button, label, emoji, no faces)', () => {
    const w = mount(AllDayChip, { props });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('aria-hidden')).toBeUndefined();
    expect(w.text()).toContain('✈️');
    expect(w.text()).toContain('Vesak Day');
    expect(faceCount(w)).toBe(0);
    expect(w.classes()).toContain('py-0.5');
  });

  it('interactive: false gives an aria-hidden span that does not emit click', async () => {
    const w = mount(AllDayChip, { props, global: withCtx({ interactive: false }) });
    expect(w.element.tagName).toBe('SPAN');
    expect(w.attributes('aria-hidden')).toBe('true');
    expect(w.attributes('type')).toBeUndefined();
    await w.trigger('click');
    expect(w.emitted('click')).toBeUndefined();
  });

  it('bars density hides the label and the faces, leaving a plain bar', () => {
    const w = mount(AllDayChip, {
      props: { ...props, faces: FACES },
      global: withCtx({ density: 'bars' }),
    });
    expect(w.text()).toBe('');
    expect(faceCount(w)).toBe(0);
    expect(w.element.children).toHaveLength(0);
  });

  it('titles density drops the emoji and faces and uses leading-none', () => {
    const w = mount(AllDayChip, {
      props: { ...props, faces: FACES },
      global: withCtx({ density: 'titles' }),
    });
    expect(w.text()).toContain('Vesak Day');
    expect(w.text()).not.toContain('✈️');
    expect(faceCount(w)).toBe(0);
    expect(w.classes()).toEqual(expect.arrayContaining(['py-0', 'leading-none']));
    expect(w.classes()).not.toContain('py-0.5');
  });

  it('ink overrides the text colour only, in the plain and the celebrating branch', () => {
    const plain = mount(AllDayChip, { props: { ...props, ink: 'rgb(1, 2, 3)' } });
    const style = plain.attributes('style') ?? '';
    expect(style).toContain('color: rgb(1, 2, 3)');
    expect(style.toLowerCase()).toContain('border-left-color: #b5654a');

    const celebrating = mount(AllDayChip, {
      props: { ...props, ink: 'rgb(1, 2, 3)', celebrating: true },
    });
    expect(celebrating.attributes('style')).toContain('color: rgb(1, 2, 3)');
    expect(celebrating.classes()).toContain('is-celebration');
  });

  it('without ink the text takes the edge colour (today)', () => {
    expect(mount(AllDayChip, { props }).attributes('style')?.toLowerCase()).toContain(
      'color: #b5654a'
    );
  });

  it('faces render only on the true first day with a label', () => {
    expect(faceCount(mount(AllDayChip, { props: { ...props, faces: FACES } }))).toBe(2);
    // Not the start of the run (a wrapped row's repeated label is not the first day).
    expect(
      faceCount(
        mount(AllDayChip, {
          props: { ...props, isStart: false, showLabel: true, faces: FACES },
        })
      )
    ).toBe(0);
    // The label is hidden (phone lane).
    expect(
      faceCount(mount(AllDayChip, { props: { ...props, showLabel: false, faces: FACES } }))
    ).toBe(0);
  });

  it('a solo chip drops its face when the context hides solo faces, a shared one keeps them', () => {
    const ctx = withCtx({ hideSoloFace: true });
    expect(
      faceCount(
        mount(AllDayChip, { props: { ...props, faces: [FACES[0]], solo: true }, global: ctx })
      )
    ).toBe(0);
    expect(faceCount(mount(AllDayChip, { props: { ...props, faces: FACES }, global: ctx }))).toBe(
      2
    );
    expect(
      faceCount(
        mount(AllDayChip, {
          props: { ...props, faces: [FACES[0]], solo: true },
          global: withCtx({ hideSoloFace: false }),
        })
      )
    ).toBe(1);
  });
});
