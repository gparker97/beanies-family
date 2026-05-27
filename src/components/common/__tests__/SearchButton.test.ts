import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import SearchButton from '../SearchButton.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stub GlobalSearch so we can assert the wiring (its `open` prop) without
// pulling in the real search overlay + its store/teleport dependencies.
vi.mock('@/components/common/GlobalSearch.vue', () => ({
  default: {
    name: 'GlobalSearch',
    props: ['open'],
    emits: ['close'],
    template: '<div data-testid="global-search" :data-open="open" />',
  },
}));

describe('SearchButton', () => {
  it('mounts GlobalSearch closed and opens it on click (search re-homing wiring)', async () => {
    const wrapper = mount(SearchButton);
    expect(wrapper.get('[data-testid="global-search"]').attributes('data-open')).toBe('false');

    await wrapper.get('button').trigger('click');
    expect(wrapper.get('[data-testid="global-search"]').attributes('data-open')).toBe('true');
  });
});
