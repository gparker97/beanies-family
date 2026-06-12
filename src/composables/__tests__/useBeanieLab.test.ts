/**
 * Unit tests for useBeanieLab — the single source of truth for Beanie Lab
 * visibility. Both SettingsPage (drawer / deep-link guards) and BeanieLabSection
 * (the card list) consume these computeds, so this is where the gating contract
 * is pinned:
 *   - aiVisible      = labEnabled
 *   - calendarVisible = labEnabled AND isFlagEnabled('googleCalendarSync')
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIsFlagEnabled } = vi.hoisted(() => ({ mockIsFlagEnabled: vi.fn(() => true) }));

vi.mock('@/config/flags', () => ({ isFlagEnabled: mockIsFlagEnabled }));

import { useSettingsStore } from '@/stores/settingsStore';
import { useBeanieLab } from '@/composables/useBeanieLab';

describe('useBeanieLab', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsFlagEnabled.mockReturnValue(true);
  });

  function setLab(enabled: boolean) {
    const store = useSettingsStore();
    // Drive the getter directly via the underlying global settings ref.
    (store.$state as { globalSettings: Record<string, unknown> }).globalSettings.beanieLabEnabled =
      enabled;
  }

  it('all hidden when the Lab is off, regardless of the flag', () => {
    setLab(false);
    const { labEnabled, aiVisible, calendarVisible } = useBeanieLab();
    expect(labEnabled.value).toBe(false);
    expect(aiVisible.value).toBe(false);
    expect(calendarVisible.value).toBe(false);
  });

  it('AI follows the Lab toggle; calendar additionally requires the flag', () => {
    setLab(true);
    mockIsFlagEnabled.mockReturnValue(true);
    const { aiVisible, calendarVisible } = useBeanieLab();
    expect(aiVisible.value).toBe(true);
    expect(calendarVisible.value).toBe(true);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith('googleCalendarSync');
  });

  it('calendar stays hidden when the flag is off even with the Lab on', () => {
    setLab(true);
    mockIsFlagEnabled.mockReturnValue(false);
    const { aiVisible, calendarVisible } = useBeanieLab();
    expect(aiVisible.value).toBe(true); // AI does not depend on the flag
    expect(calendarVisible.value).toBe(false);
  });
});
