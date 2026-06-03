// Generic AI-capability gate (ADR-030, #133). Exposes the current tier + BYOK config so the
// wedge — and future AI features — read availability from ONE place. Keeping this generic
// (no document/activity concepts) is the reuse seam: feature #2 consumes useAiCapability +
// the extraction service without touching anything wedge-specific.

import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ByokConfig } from '@/services/ai/providers/byokProvider';
import type { AiTier } from '@/services/ai/types';

export function useAiCapability() {
  const settingsStore = useSettingsStore();

  // INTERIM (Phase 3): the tier is derived from the existing provider-keyed settings. Phase 4
  // replaces this with an explicit, persisted `settings.aiTier` selector (the deliberate model
  // extension the plan calls for — do not persist a tier onto the provider fields here). Until
  // then: a configured BYOK provider + key ⇒ BYOK; otherwise the default managed tier.
  const byokConfig = computed<ByokConfig | null>(() => {
    const provider = settingsStore.aiProvider;
    if (provider === 'none' || provider === undefined) return null;
    const keys = settingsStore.settings.aiApiKeys ?? {};
    // Explicit access (not a dynamic index) keeps it type-safe and lint-clean.
    const apiKey =
      provider === 'openai' ? keys.openai : provider === 'claude' ? keys.claude : keys.gemini;
    if (!apiKey) return null;
    return { provider, apiKey };
  });

  const tier = computed<AiTier>(() => (byokConfig.value ? 'byok' : 'managed'));

  /**
   * Whether the selected tier can run without further setup. Managed is always selectable
   * (an undeployed proxy surfaces `not_available` at call time, not here); BYOK needs a key.
   */
  const isConfigured = computed(() => tier.value === 'managed' || byokConfig.value !== null);

  return { tier, byokConfig, isConfigured };
}
