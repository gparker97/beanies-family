/** WallMemoryNote (#140): each text memory type renders, with the owner's name small. */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import WallMemoryNote from '../WallMemoryNote.vue';
import type { SlideText } from '@/utils/wallSlideshow';

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'm1', name: 'Juno' }] }),
}));

function piece(type: 'saying' | 'favorite' | 'note', payload: object, memberId = 'm1'): SlideText {
  return {
    kind: 'text',
    memberId,
    entry: { id: 'e1', type, memberId, payload } as unknown as SlideText['entry'],
  };
}

describe('WallMemoryNote', () => {
  it('draws a saying as a sticky in Caveat', () => {
    const w = mount(WallMemoryNote, {
      props: { piece: piece('saying', { words: 'Goodnight, beans' }) },
    });
    const sticky = w.get('.mem-sticky');
    expect(sticky.classes()).toContain('font-caveat');
    expect(sticky.text()).toContain('Goodnight, beans');
    expect(w.get('.mem-who').text()).toBe('Juno');
  });

  it('draws a favorite as a card, taped on request', () => {
    const p = piece('favorite', { name: 'Pancakes', description: 'With berries' });
    const plain = mount(WallMemoryNote, { props: { piece: p } });
    expect(plain.get('.mem-card b').text()).toBe('Pancakes');
    expect(plain.text()).toContain('With berries');
    expect(plain.find('.mem-tape').exists()).toBe(false);
    expect(
      mount(WallMemoryNote, { props: { piece: p, tape: true } })
        .find('.mem-tape')
        .exists()
    ).toBe(true);
  });

  it('draws a note as torn paper with its title', () => {
    const w = mount(WallMemoryNote, {
      props: { piece: piece('note', { title: 'Reminder', body: 'Brush teeth' }) },
    });
    expect(w.get('.mem-rip b').text()).toBe('Reminder');
    expect(w.text()).toContain('Brush teeth');
  });

  it("clamps every text like the timeline's pieces, so a long one never outgrows its slot", () => {
    const long = 'word '.repeat(400);
    const clampOf = (type: 'saying' | 'favorite' | 'note', payload: object, text: string) =>
      mount(WallMemoryNote, { props: { piece: piece(type, payload) } })
        .findAll('b, span')
        .find((el) => el.text() === text.trim())!
        .classes()
        .find((c) => c.startsWith('line-clamp-'));
    expect(clampOf('saying', { words: long }, long)).toBe('line-clamp-4');
    expect(clampOf('note', { title: 'T', body: long }, long)).toBe('line-clamp-4');
    expect(clampOf('note', { title: long, body: 'b' }, long)).toBe('line-clamp-2');
    expect(clampOf('favorite', { name: 'N', description: long }, long)).toBe('line-clamp-2');
    expect(clampOf('favorite', { name: long }, long)).toBe('line-clamp-2');
  });

  it('omits the owner when the member is unknown, and sizes pins larger', () => {
    const w = mount(WallMemoryNote, {
      props: { piece: piece('saying', { words: 'Hi' }, 'gone'), size: 'pin' },
    });
    expect(w.find('.mem-who').exists()).toBe(false);
    expect(w.get('.mem-note').classes()).toContain('wall-memory-pin');
  });
});
