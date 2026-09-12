import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BirthdayDetailsModal from '../BirthdayDetailsModal.vue';
import type { BirthdayOccurrence } from '@/utils/birthdays';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        'planner.birthday.today': 'Today!',
        'planner.birthday.tomorrow': 'Tomorrow',
        'planner.birthday.sleeps': '{count} sleeps away',
        'planner.birthday.turns': 'Turns {age}',
        'planner.birthday.withAge': "{name}'s {age} birthday",
        'planner.birthday.noAge': "{name}'s birthday",
        'planner.birthday.source': 'beanies works this out from their profile.',
        'planner.birthday.openProfile': 'Open their profile',
      })[k] ?? k,
  }),
}));

function birthday(over: Partial<BirthdayOccurrence> = {}): BirthdayOccurrence {
  return { date: '2026-09-19', memberId: 'm-joey', name: 'Joey', age: 7, isPet: false, ...over };
}

function open(b: BirthdayOccurrence, todayYmd = '2026-09-12') {
  return mount(BirthdayDetailsModal, {
    props: { open: true, birthday: b, todayYmd },
    global: { stubs: { CelebrationConfetti: true, BaseModal: { template: '<div><slot/></div>' } } },
  });
}

describe('BirthdayDetailsModal', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("counts the sleeps, in the Nook's own words", () => {
    expect(open(birthday()).text()).toContain('7 sleeps away');
  });

  it('says Today! on the day', () => {
    expect(open(birthday(), '2026-09-19').text()).toContain('Today!');
  });

  it('says Tomorrow rather than "1 sleeps away"', () => {
    expect(open(birthday(), '2026-09-18').text()).toContain('Tomorrow');
  });

  it('never prints a NEGATIVE countdown for a past birthday', () => {
    // Scrolling back through the year must not read "-30 sleeps away", which is
    // the obvious thing to compute and the wrong thing to show.
    const text = open(birthday(), '2026-10-19').text();
    expect(text).not.toMatch(/-\d+ sleeps/);
    expect(text).not.toContain('sleeps away');
  });

  it('shows the age even when the CHIP has gone quiet past 21', () => {
    // The label rule is presentation on a 12px chip; in the drawer the number is
    // the thing somebody opened it for.
    expect(open(birthday({ age: 43 })).text()).toContain('Turns 43');
  });

  it('omits the age line when no birth year is on file', () => {
    expect(open(birthday({ age: undefined })).text()).not.toContain('Turns');
  });

  it('offers the profile rather than an edit control', () => {
    // There is no stored record to edit; the honest action is the place the
    // birthday can actually be corrected.
    const w = open(birthday());
    expect(w.text()).toContain('Open their profile');
    expect(w.text()).toContain('beanies works this out from their profile.');
  });

  it('emits the member id so the caller can route to the bean', async () => {
    const w = open(birthday());
    await w.find('button').trigger('click');
    expect(w.emitted('open-profile')?.[0]).toEqual(['m-joey']);
  });

  it('renders nothing when there is no birthday selected', () => {
    const w = mount(BirthdayDetailsModal, {
      props: { open: false, birthday: null, todayYmd: '2026-09-12' },
      global: {
        stubs: { CelebrationConfetti: true, BaseModal: { template: '<div><slot/></div>' } },
      },
    });
    expect(w.text()).toBe('');
  });
});
