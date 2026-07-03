/**
 * Unit tests for useBeanieLab — the single source of truth for Beanie Lab
 * visibility. AI is the sole Lab feature (Google Calendar graduated to an
 * official Settings card on 2026-07-03). SettingsPage (section mount + AI drawer
 * guard) and BeanieLabSection (the AI card) consume these computeds:
 *   - aiAvailable    = isFlagEnabled('aiPhotoExtract') OR isFlagEnabled('aiTravelExtract')
 *   - hasAnyLabFeature = aiAvailable   (semantic alias; drives the section mount)
 *   - aiVisible      = labEnabled AND aiAvailable
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

  it('AI hidden when the Lab is off, regardless of the flags', () => {
    setLab(false);
    const { labEnabled, aiVisible } = useBeanieLab();
    expect(labEnabled.value).toBe(false);
    expect(aiVisible.value).toBe(false);
  });

  it('AI visible when the Lab is on and a reader flag is alive', () => {
    setLab(true);
    mockIsFlagEnabled.mockReturnValue(true);
    const { aiVisible } = useBeanieLab();
    expect(aiVisible.value).toBe(true);
  });

  it('does NOT gate on googleCalendarSync (calendar is no longer a Lab feature)', () => {
    setLab(true);
    only('googleCalendarSync'); // only the calendar flag on, no reader flags
    const { aiVisible, hasAnyLabFeature } = useBeanieLab();
    expect(aiVisible.value).toBe(false);
    expect(hasAnyLabFeature.value).toBe(false);
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

  describe('hasAnyLabFeature (drives whether the section renders at all)', () => {
    it('is false when no reader flag is available — independent of the opt-in', () => {
      mockIsFlagEnabled.mockReturnValue(false);

      setLab(false);
      const off = useBeanieLab();
      expect(off.hasAnyLabFeature.value).toBe(false);
      expect(off.aiVisible.value).toBe(false);

      // Even with the opt-in ON, nothing available ⟹ still empty.
      setLab(true);
      expect(useBeanieLab().hasAnyLabFeature.value).toBe(false);
    });

    it.each(['aiPhotoExtract', 'aiTravelExtract'])(
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
