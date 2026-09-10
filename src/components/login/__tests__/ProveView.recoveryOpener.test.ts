/**
 * ProveView — a kit and a family passphrase are not the same arrival.
 *
 * Both are family-level secrets that open the pod without identifying a member, so both
 * offer SET-A-NEW-PIN. Only the KIT leads with it.
 *
 * A kit is break-glass: reaching for one means the PIN is gone, so the reset is the
 * screen. A family passphrase is the ORDINARY route onto a device that has never seen
 * this family — there is no device wrap yet, so the file must be decrypted before any PIN
 * can be checked — and that person usually still knows their PIN. Leading with a reset
 * there told a whole class of users to replace a credential that works, and told them so
 * in copy that said "you're in with your recovery kit".
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
  hasCredential: true,
};

/** The methods a member has once a family-level secret has opened the pod. */
const METHODS: ProveMethod[] = [{ kind: 'pin', hasDeviceWrap: false }, { kind: 'recovery' }];

function mountProve(openedBy: 'kit' | 'passphrase' | null) {
  setActivePinia(createPinia());
  return mount(ProveView, {
    props: {
      familyName: 'Beans',
      person,
      methods: METHODS,
      error: null,
      isBusy: false,
      podOpen: true,
      recoveryOpenedBy: openedBy,
    },
    global: { stubs: { RecoveryKitLink: { template: '<a class="kit-link" />' } } },
  });
}

describe('ProveView — which secret opened the pod', () => {
  it('KIT leads with the PIN reset', () => {
    const w = mountProve('kit');
    expect(w.text().toLowerCase()).toContain('recovery kit');
    // The reset pane is the active one: it has the new-PIN inputs.
    expect(w.text().toLowerCase()).toContain('set a');
  });

  it('PASSPHRASE does NOT lead with the PIN reset', () => {
    const w = mountProve('passphrase');
    const text = w.text().toLowerCase();
    // The bug: someone who typed a passphrase was told they were in with a kit.
    expect(text).not.toContain("you're in with your recovery kit");
    // ...and was pushed to replace a PIN that works.
    expect(text).not.toContain('set a fresh 6-digit pin to use from now on');
  });

  it('PASSPHRASE still keeps the reset one tap away', () => {
    // Not a removal: someone who arrived by passphrase BECAUSE they forgot their PIN must
    // still be able to reach the reset without starting over.
    const w = mountProve('passphrase');
    expect(w.text().toLowerCase()).toContain('set a new pin');
  });

  it('the reset pane, once reached by passphrase, names the PASSPHRASE not a kit', async () => {
    // ⚠️ The assertion the earlier "does not lead with reset" test CANNOT make: while the
    // reset pane is not the active one, its copy is not rendered at all, so a test that
    // only checks the landing screen passes whether or not the copy is branched. Reach
    // the pane the way a user does — the switch link — and read what it actually says.
    const w = mountProve('passphrase');
    const reset = w.findAll('button').find((b) => b.text().toLowerCase().includes('set a new pin'));
    expect(reset).toBeTruthy();
    await reset!.trigger('click');

    const text = w.text().toLowerCase();
    expect(text).toContain('family passphrase');
    expect(text).not.toContain('recovery kit');
  });

  it('the reset pane, reached by kit, still names the KIT', async () => {
    const w = mountProve('kit');
    expect(w.text().toLowerCase()).toContain("you're in with your recovery kit");
  });

  it('a member credential offers no reset at all', () => {
    const w = mountProve(null);
    expect(w.text().toLowerCase()).not.toContain('set a new pin');
    expect(w.text().toLowerCase()).not.toContain("you're in with your recovery kit");
  });
});
