import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SettingsAdminOnlyNotice from '../SettingsAdminOnlyNotice.vue';

// Echo translation keys so we can assert the right string is used.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SettingsAdminOnlyNotice', () => {
  it('renders the admin-only hint with a lock affordance', () => {
    const wrapper = mount(SettingsAdminOnlyNotice);
    expect(wrapper.text()).toContain('settings.adminOnly');
    expect(wrapper.text()).toContain('🔒');
  });
});
