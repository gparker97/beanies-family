import { mount } from '@vue/test-utils';
import { describe, it, expect, afterEach } from 'vitest';
import ChoiceModal from '../ChoiceModal.vue';
import BaseModal from '../BaseModal.vue';

const options = [
  { id: 'a', icon: 'camera', label: 'Alpha', description: 'first option' },
  { id: 'b', icon: 'image', label: 'Beta' }, // no description
];

function mountModal(props: Record<string, unknown> = {}) {
  return mount(ChoiceModal, {
    props: { open: true, title: 'Pick one', options, ...props },
    global: { stubs: { teleport: true } },
  });
}

function optionButton(wrapper: ReturnType<typeof mountModal>, label: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(label));
}

describe('ChoiceModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one button per option with its label', () => {
    const w = mountModal();
    expect(optionButton(w, 'Alpha')).toBeTruthy();
    expect(optionButton(w, 'Beta')).toBeTruthy();
  });

  it('renders a description only when the option provides one', () => {
    const w = mountModal();
    expect(w.text()).toContain('first option'); // Alpha's description
    // Beta has none — exactly one description paragraph rendered.
    expect(w.findAll('p').filter((p) => p.text() === 'first option')).toHaveLength(1);
  });

  it('emits select with the option id when a choice is clicked', async () => {
    const w = mountModal();
    await optionButton(w, 'Beta')!.trigger('click');
    expect(w.emitted('select')?.[0]).toEqual(['b']);
  });

  it('re-emits close when the underlying BaseModal closes', () => {
    const w = mountModal();
    w.findComponent(BaseModal).vm.$emit('close');
    expect(w.emitted('close')).toBeTruthy();
  });
});
