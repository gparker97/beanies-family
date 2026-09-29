import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, currentLanguage: ref('en') }),
}));

import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';

function mountModal(props: Record<string, unknown> = {}) {
  return mount(CreatedConfirmModal, {
    props: { open: true, title: 'Created', message: 'Done', details: [], ...props },
    global: {
      stubs: {
        // Render the footer slot inline so its buttons are reachable.
        BaseModal: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  });
}

describe('CreatedConfirmModal: view action', () => {
  it('shows no view button unless a caller opts in', () => {
    expect(mountModal().find('[data-testid="created-confirm-view"]').exists()).toBe(false);
  });

  it('renders the caller label and emits view (not close) when tapped', async () => {
    const w = mountModal({ allowView: true, viewLabel: 'View Activity' });
    const btn = w.find('[data-testid="created-confirm-view"]');
    expect(btn.text()).toBe('View Activity');
    await btn.trigger('click');
    expect(w.emitted('view')).toHaveLength(1);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('falls back to the generic View label', () => {
    const w = mountModal({ allowView: true });
    expect(w.find('[data-testid="created-confirm-view"]').text()).toBe('action.view');
  });
});
