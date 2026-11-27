/**
 * Settings › Reminders: the Family Flight Arrivals row (#143), and the extracted
 * `SettingSubRow` the Helpful Hints sub-rows share with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  flags: { helpfulHints: false },
}));

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => h.store }));
vi.mock('@/stores/flightStatusStore', () => ({
  useFlightStatusStore: () => ({ isEntitled: true }),
}));
vi.mock('@/composables/useReadOnlyCopy', () => ({
  useReadOnlyCopy: () => ({ planRouteExists: false, seePlans: vi.fn() }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => false }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (f: string) => f === 'helpfulHints' && h.flags.helpfulHints,
}));

import RemindersSettings from '../RemindersSettings.vue';

function resetStore(over: Record<string, unknown> = {}) {
  h.store = {
    remindersEnabled: true,
    activityReminderLead: 30,
    todoReminderLead: 30,
    travelReminderLeads: {
      flight_outbound: 120,
      flight_return: 120,
      flight_other: 120,
      cruise: 120,
      train: 60,
      ferry: 60,
    },
    liveFlightChecksEnabled: true,
    liveFlightChangeAlerts: true,
    familyArrivalAlerts: true,
    familyArrivalLead: 60,
    helpfulHintsEnabled: true,
    helpfulHintLeadDays: {},
    helpfulHintNotifyByType: {},
    setFamilyArrivalAlerts: vi.fn(async () => {}),
    setFamilyArrivalLead: vi.fn(async () => {}),
    ...over,
  };
}

function mountIt() {
  return mount(RemindersSettings, {
    props: { open: true },
    global: {
      stubs: {
        BeanieFormModal: { template: '<div><slot /></div>' },
        BeanieBellIcon: true,
        BetaBadge: true,
        InfoHintBadge: true,
      },
    },
  });
}

beforeEach(() => {
  h.flags.helpfulHints = false;
  resetStore();
});

describe('RemindersSettings: Family Flight Arrivals', () => {
  it('shows the switch on, with the notice picker at one hour by default', () => {
    const w = mountIt();
    const toggle = w.get('[data-testid="family-arrivals"]');
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(w.text()).toContain('reminders.familyArrivals');
    expect(w.text()).toContain('reminders.familyArrivalsHint');
    expect(w.text()).toContain('reminders.familyArrivalsNotice');
    const select = w.get('[data-testid="family-arrivals-lead"] select');
    expect((select.element as HTMLSelectElement).value).toBe('60');
  });

  it('hides the notice picker with the switch off', () => {
    resetStore({ familyArrivalAlerts: false });
    const w = mountIt();
    expect(w.get('[data-testid="family-arrivals"]').attributes('aria-checked')).toBe('false');
    expect(w.find('[data-testid="family-arrivals-lead"]').exists()).toBe(false);
    expect(w.text()).not.toContain('reminders.familyArrivalsNotice');
  });

  it('writes the switch and the lead through the store', async () => {
    const w = mountIt();
    await w.get('[data-testid="family-arrivals"]').trigger('click');
    expect(h.store.setFamilyArrivalAlerts).toHaveBeenCalledWith(false);
    await w.get('[data-testid="family-arrivals-lead"] select').setValue('1440');
    expect(h.store.setFamilyArrivalLead).toHaveBeenCalledWith(1440);
  });

  it('a failed write is swallowed by the handler (the store already toasted)', async () => {
    resetStore({ setFamilyArrivalAlerts: vi.fn(async () => Promise.reject(new Error('x'))) });
    const w = mountIt();
    await w.get('[data-testid="family-arrivals"]').trigger('click');
    // Still on: the control reads the persisted value.
    expect(w.get('[data-testid="family-arrivals"]').attributes('aria-checked')).toBe('true');
  });
});

describe('RemindersSettings: Helpful Hints sub-rows (SettingSubRow extraction)', () => {
  it('render the same label-and-control lines, indented by the caller', () => {
    h.flags.helpfulHints = true;
    const w = mountIt();
    const lines = w
      .findAll('div.pl-\\[2\\.1rem\\]')
      .map((d) => [d.classes().join(' '), d.find('span').text()]);
    expect(lines.length).toBeGreaterThan(0);
    for (const [classes, label] of lines) {
      expect(classes).toContain('flex items-center justify-between gap-4');
      expect([
        'settings.helpfulHints.howFarAhead',
        'settings.helpfulHints.notifyOnDevice',
      ]).toContain(label);
    }
    expect(lines.some(([c]) => c.includes('mt-2.5'))).toBe(true);
    expect(lines.some(([c]) => /(^| )mt-2( |$)/.test(c))).toBe(true);
  });
});
