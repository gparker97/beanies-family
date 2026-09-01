/**
 * ProveView rendering of the `invite-needed` terminal (#79).
 *
 * Two failure modes are pinned here, both of which would render a WRONG affordance
 * rather than throw:
 *   1. A leaked `invite-needed` switch link falls through `switchLabel`'s `default`
 *      and reads "Use password" — on a member who has no password.
 *   2. The password `<form>` is the template chain's `v-else` catch-all, so an
 *      `invite-needed` pane placed after it would render that form instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ProveView from '@/components/login/ProveView.vue';
import type { ProveMethod } from '@/services/auth/proveMethods';
import type { PersonCard } from '@/services/auth/loginFlow';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const person: PersonCard = {
  id: 'm1',
  name: 'Alex',
  color: '#F15D22',
  gender: 'other',
  ageGroup: 'adult',
  hasCredential: false,
};

function mountProve(methods: ProveMethod[]) {
  setActivePinia(createPinia());
  return mount(ProveView, {
    props: {
      familyName: 'Beans',
      person,
      methods,
      error: null,
      isBusy: false,
      podOpen: true,
    },
    global: { stubs: { RecoveryKitLink: { template: '<a class="kit-link" />' } } },
  });
}

describe('ProveView — invite-needed', () => {
  it('makes the explanation the active pane and renders no password form', () => {
    const w = mountProve([{ kind: 'invite-needed' }, { kind: 'recovery' }]);
    // Case-insensitive: beanie mode (the test default) lowercases the copy.
    expect(w.text().toLowerCase()).toContain('the pod');
    // The catch-all password form must not have been reached.
    expect(w.find('form').exists()).toBe(false);
    expect(w.find('input[type="password"]').exists()).toBe(false);
    // Nobody is stranded: the recovery escape is still on screen.
    expect(w.find('.kit-link').exists()).toBe(true);
  });

  it('never renders invite-needed as a switch link beside another method', () => {
    const w = mountProve([
      { kind: 'pin', hasDeviceWrap: true },
      { kind: 'invite-needed' },
      { kind: 'recovery' },
    ]);
    // A leak would surface as the `switchLabel` default, "Use password".
    expect(w.text().toLowerCase()).not.toContain('use password');
    expect(w.text().toLowerCase()).not.toContain('the pod');
  });
});
