/**
 * The seeding contract shared by ~22 entity modals.
 *
 * 🚨 THE RULE IS "OPEN ⇒ SEEDED", NOT "OPEN CHANGED ⇒ SEEDED", and the difference shipped a
 * bug. A caller opened a modal from its parent's `setup()` — a `watch(..., { immediate: true })`
 * that ran before the child had ever rendered — so `open` was already `true` on the modal's
 * first render, there was no transition to catch, and the form drew every field blank with a
 * perfectly good prefill sitting in its props. Nothing errored.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useFormModal } from '../useFormModal';

const onEdit = vi.fn();
const onNew = vi.fn();

const Host = defineComponent({
  props: {
    open: Boolean,
    entity: { type: Object as () => Record<string, unknown> | null, default: null },
  },
  setup(props) {
    const { isEditing, isSubmitting } = useFormModal(
      () => props.entity,
      () => props.open,
      { onEdit, onNew }
    );
    return { isEditing, isSubmitting };
  },
  template: '<div />',
});

function mountHost(props: { open: boolean; entity?: Record<string, unknown> }) {
  onEdit.mockClear();
  onNew.mockClear();
  return mount(Host, { props });
}

describe('seeding', () => {
  it('SEEDS A MODAL THAT IS ALREADY OPEN AT ITS FIRST RENDER', () => {
    // The regression. A parent that flips `open` during its own setup gives the child no
    // false→true transition, so a watch alone never fills the form in.
    mountHost({ open: true });
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("seeds from onMounted, so a consumer's declaration order cannot break it", () => {
    // `{ immediate: true }` would run `onNew` partway through the consumer's setup, and
    // `TransactionModal.onNew` closes over a `const` declared below its useFormModal call —
    // a hard `ReferenceError` at setup. This asserts the seed happens at mount instead.
    const order: string[] = [];
    const Late = defineComponent({
      props: { open: Boolean },
      setup(props) {
        useFormModal(
          () => null,
          () => props.open,
          {
            onEdit: () => {},
            // Reading a binding declared AFTER this call — safe only from onMounted.
            onNew: () => order.push(declaredLater.value),
          }
        );
        const declaredLater = ref('initialised');
        return {};
      },
      template: '<div />',
    });
    expect(() => mount(Late, { props: { open: true } })).not.toThrow();
    expect(order).toEqual(['initialised']);
  });

  it('calls onEdit, not onNew, when it opens with an entity', () => {
    mountHost({ open: true, entity: { id: 'x' } });
    expect(onEdit).toHaveBeenCalledWith({ id: 'x' });
    expect(onNew).not.toHaveBeenCalled();
  });

  it('does nothing at all for a modal mounted closed — every consumer today', () => {
    mountHost({ open: false });
    expect(onNew).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('still seeds on the ordinary false → true transition', async () => {
    const w = mountHost({ open: false });
    await w.setProps({ open: true });
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('does not re-seed when closing, so a close cannot wipe a pending save', async () => {
    const w = mountHost({ open: true });
    onNew.mockClear();
    await w.setProps({ open: false });
    await nextTick();
    expect(onNew).not.toHaveBeenCalled();
  });
});

describe('isEditing', () => {
  it('tracks whether an entity is present', async () => {
    const w = mountHost({ open: false });
    expect(w.vm.isEditing).toBe(false);
    await w.setProps({ entity: { id: 'x' } });
    expect(w.vm.isEditing).toBe(true);
  });
});
