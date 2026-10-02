/**
 * Unit tests for useBeanieLab. The Lab has no features (Google Calendar and magic
 * beans graduated to ordinary Settings cards), so:
 *   - aiAvailable      = isFlagEnabled('aiPhotoExtract') OR isFlagEnabled('aiTravelExtract'),
 *                        independent of the Lab opt-in (gates the magic beans card)
 *   - hasAnyLabFeature = false (the next experimental feature slots in as an OR term)
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

  it('aiAvailable follows the reader flags and ignores the Lab opt-in', () => {
    for (const lab of [false, true]) {
      setLab(lab);

      only('aiPhotoExtract');
      expect(useBeanieLab().aiAvailable.value).toBe(true);

      only('aiTravelExtract');
      expect(useBeanieLab().aiAvailable.value).toBe(true);

      only(); // both reader flags off
      expect(useBeanieLab().aiAvailable.value).toBe(false);
    }
  });

  it('does NOT gate on googleCalendarSync', () => {
    only('googleCalendarSync');
    expect(useBeanieLab().aiAvailable.value).toBe(false);
  });

  it('labEnabled mirrors the persisted opt-in', () => {
    setLab(true);
    expect(useBeanieLab().labEnabled.value).toBe(true);
    setLab(false);
    expect(useBeanieLab().labEnabled.value).toBe(false);
  });

  it('hasAnyLabFeature is false (no Lab features remain), whatever the flags and opt-in', () => {
    for (const lab of [false, true]) {
      setLab(lab);
      mockIsFlagEnabled.mockReturnValue(true);
      expect(useBeanieLab().hasAnyLabFeature.value).toBe(false);
    }
  });
});
