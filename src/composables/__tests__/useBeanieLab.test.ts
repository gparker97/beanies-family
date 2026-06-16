/**
 * Unit tests for useBeanieLab — the single source of truth for Beanie Lab
 * visibility. Both SettingsPage (the section mount guard + drawer / deep-link
 * guards) and BeanieLabSection (the card list) consume these computeds, so this
 * is where the gating contract is pinned:
 *   - aiAvailable     = isFlagEnabled('aiPhotoExtract') OR isFlagEnabled('aiTravelExtract')
 *   - calendarAvailable = isFlagEnabled('googleCalendarSync')
 *   - hasAnyLabFeature  = aiAvailable OR calendarAvailable   (independent of the opt-in)
 *   - aiVisible       = labEnabled AND aiAvailable
 *   - calendarVisible = labEnabled AND calendarAvailable
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIsFlagEnabled } = vi.hoisted(() => ({
  mockIsFlagEnabled: vi.fn((_flag: string) => true),
}));

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

  /** Turn on exactly the named flags; everything else reads false. */
  function only(...on: string[]) {
    mockIsFlagEnabled.mockImplementation((flag: string) => on.includes(flag));
  }

  it('all hidden when the Lab is off, regardless of the flags', () => {
    setLab(false);
    const { labEnabled, aiVisible, calendarVisible } = useBeanieLab();
    expect(labEnabled.value).toBe(false);
    expect(aiVisible.value).toBe(false);
    expect(calendarVisible.value).toBe(false);
  });

  it('both AI and calendar visible when the Lab is on and every flag is alive', () => {
    setLab(true);
    mockIsFlagEnabled.mockReturnValue(true);
    const { aiVisible, calendarVisible } = useBeanieLab();
    expect(aiVisible.value).toBe(true);
    expect(calendarVisible.value).toBe(true);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith('googleCalendarSync');
  });

  it('AI requires the Lab AND at least one reader flag (OR of the two readers)', () => {
    setLab(true);

    only('aiPhotoExtract');
    expect(useBeanieLab().aiVisible.value).toBe(true);

    only('aiTravelExtract');
    expect(useBeanieLab().aiVisible.value).toBe(true);

    only(); // both reader flags off
    expect(useBeanieLab().aiVisible.value).toBe(false);
  });

  it('calendar requires the Lab AND googleCalendarSync', () => {
    setLab(true);

    only('googleCalendarSync');
    expect(useBeanieLab().calendarVisible.value).toBe(true);

    only(); // flag off
    expect(useBeanieLab().calendarVisible.value).toBe(false);
  });

  describe('hasAnyLabFeature (drives whether the section renders at all)', () => {
    it('is false when no Lab feature is available — independent of the opt-in', () => {
      mockIsFlagEnabled.mockReturnValue(false);

      setLab(false);
      const off = useBeanieLab();
      expect(off.hasAnyLabFeature.value).toBe(false);
      expect(off.aiVisible.value).toBe(false);
      expect(off.calendarVisible.value).toBe(false);

      // Even with the opt-in ON, nothing available ⟹ still empty.
      setLab(true);
      expect(useBeanieLab().hasAnyLabFeature.value).toBe(false);
    });

    it.each(['aiPhotoExtract', 'aiTravelExtract', 'googleCalendarSync'])(
      'is true when only %s is available, regardless of the opt-in',
      (flag) => {
        only(flag);

        setLab(false);
        expect(useBeanieLab().hasAnyLabFeature.value).toBe(true);

        setLab(true);
        expect(useBeanieLab().hasAnyLabFeature.value).toBe(true);
      }
    );
  });
});
