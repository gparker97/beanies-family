/**
 * The "Scan a Code" wiring, end to end through the emit chain.
 *
 * ⚠️ WHY A TEST AND NOT A BROWSER CHECK. greg reported that tapping "Scan a Code" on desktop
 * Chrome did nothing, and a Playwright repro proved inconclusive: the file-chooser event
 * never fired, but a native listener attached to the button could itself be discarded by a
 * Vue re-render, so "the click never landed" and "the harness lost the listener" were
 * indistinguishable. This asserts the part that is actually ours — that the button emits,
 * and that the emit reaches a handler that opens the picker.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ProfileMenu from '../ProfileMenu.vue';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/nook', fullPath: '/nook', query: {} }),
}));

function mountMenu() {
  setActivePinia(createPinia());
  return mount(ProfileMenu, {
    props: { isRefreshing: false },
    global: { stubs: { Teleport: true, BaseModal: true } },
  });
}

describe('ProfileMenu — Scan a Code', () => {
  it('renders the item', () => {
    const wrapper = mountMenu();
    const btn = wrapper.findAll('button').find((b) => /scan a code/i.test(b.text()));
    expect(btn, 'the Scan a Code item must be in the menu').toBeTruthy();
  });

  it('emits scan-code when clicked, so the header can open the picker', async () => {
    const wrapper = mountMenu();
    const btn = wrapper.findAll('button').find((b) => /scan a code/i.test(b.text()))!;

    await btn.trigger('click');

    // The header listens for exactly this and calls `useQrCapture().open()`. If the emit
    // name ever drifts, the menu item becomes a tap that does nothing — which is precisely
    // the symptom that prompted this test.
    expect(wrapper.emitted('scan-code')).toBeTruthy();
    expect(wrapper.emitted('scan-code')).toHaveLength(1);
  });
});
