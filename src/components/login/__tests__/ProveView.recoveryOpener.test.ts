/**
 * ProveView — a kit and a family passphrase are not the same arrival.
 *
 * Both are family-level secrets that open the pod without identifying a member. ONLY THE
 * KIT MAY RESET A PIN.
 *
 * A kit is break-glass: reaching for one means the PIN is gone, so the reset is the
 * screen. A family passphrase is the ORDINARY route onto a device that has never seen
 * this family — there is no device wrap yet, so the file must be decrypted before any PIN
 * can be checked — and that person usually still knows their PIN.
 *
 * The reason this is more than a different default: a PIN reset hands over a member's
 * IDENTITY. Decryption alone does not, since whoever holds the passphrase can already
 * read everything, so a secret that can reset any PIN is a full member-impersonation
 * credential. Of the two, the passphrase is the loosely-held one: memorised, typed on
 * devices, plausibly spoken aloud in a house with children. Nobody is stranded, because
 * `RecoveryKitLink` is unconditionally on this screen (the never-blank guarantee).
 *
 * The UI half of this is only half: `useLoginFlow.onResetPin` carries the matching
 * authorization gate, tested separately.
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
    expect(w.text().toLowerCase()).toContain("you're in with your recovery kit");
  });

  it('PASSPHRASE lands on the member’s own methods, not a reset', () => {
    const w = mountProve('passphrase');
    const text = w.text().toLowerCase();
    // The reported bug: a passphrase arrival was told it was in with a recovery kit...
    expect(text).not.toContain("you're in with your recovery kit");
    // ...and pushed to replace a PIN that works.
    expect(text).not.toContain('set a fresh 6-digit pin to use from now on');
  });

  it('PASSPHRASE offers NO reset at all, not even as a switch link', () => {
    // The reset belongs to the kit alone, because it hands over a member's identity.
    const w = mountProve('passphrase');
    expect(w.text().toLowerCase()).not.toContain('set a new pin');
  });

  it('PASSPHRASE still shows the kit link, which is the route to a reset', () => {
    // Not a lockout: someone who arrived by passphrase BECAUSE they forgot their PIN
    // reaches the reset through the kit, without starting over.
    const w = mountProve('passphrase');
    expect(w.find('.kit-link').exists()).toBe(true);
  });

  it('a member credential offers no reset and names no recovery secret', () => {
    const w = mountProve(null);
    const text = w.text().toLowerCase();
    expect(text).not.toContain('set a new pin');
    expect(text).not.toContain("you're in with your recovery kit");
  });
});

describe('ProveView — the kit prompt names what is being asked for', () => {
  /**
   * The pill said only "Use a recovery kit", which does not say WHEN to reach for one —
   * it read as an alternative sign-in rather than the break-glass it is. The prompt above
   * it now names the credential the screen is currently asking for.
   */
  function mountWithMethods(methods: ProveMethod[], openedBy: 'kit' | 'passphrase' | null) {
    setActivePinia(createPinia());
    return mount(ProveView, {
      props: {
        familyName: 'Beans',
        person,
        methods,
        error: null,
        isBusy: false,
        podOpen: true,
        recoveryOpenedBy: openedBy,
      },
    });
  }

  it('a PIN challenge asks "Forgot your PIN?"', () => {
    const w = mountWithMethods([{ kind: 'pin', hasDeviceWrap: false }, { kind: 'recovery' }], null);
    expect(w.text().toLowerCase()).toContain('forgot your pin?');
  });

  it('a password form asks about the password, not the PIN', () => {
    const w = mountWithMethods([{ kind: 'password' }, { kind: 'recovery' }], null);
    const text = w.text().toLowerCase();
    expect(text).toContain('forgot your password?');
    expect(text).not.toContain('forgot your pin?');
  });

  it('names nothing once the kit has already been redeemed', () => {
    // On the reset-PIN pane the kit is spent; "forgot your PIN?" there is nonsense.
    const w = mountWithMethods(
      [{ kind: 'pin', hasDeviceWrap: false }, { kind: 'recovery' }],
      'kit'
    );
    expect(w.text().toLowerCase()).not.toContain('forgot your');
  });
});
