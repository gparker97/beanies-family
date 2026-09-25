// Generic AI-capability gate (ADR-030, #133). Exposes the current tier + BYOK config so the
// wedge — and future AI features — read availability from ONE place. Keeping this generic
// (no document/activity concepts) is the reuse seam: feature #2 consumes useAiCapability +
// the extraction service without touching anything wedge-specific.

import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { assertNever } from '@/utils/assertNever';
import { apiKeyForProvider } from '@/utils/aiApiKeys';
import type { ByokConfig } from '@/services/ai/providers/byokProvider';
import type { AiTier, ExtractionContext } from '@/services/ai/types';
import type { ExtractOptions } from '@/services/ai/documentExtractionService';
import type { ConsentGrant } from '@/composables/useDocumentConsent';
import { toDateInputValue } from '@/utils/date';

export function useAiCapability() {
  const settingsStore = useSettingsStore();

  // Phase 4: the tier is the user's explicit, persisted choice (settingsStore.aiTier, coalesced
  // to 'managed' for upgraded docs). BYOK is the only tier with a client-side key — the managed
  // (Tinfoil) key lives server-side and on-device is a future stub.
  const tier = computed<AiTier>(() => settingsStore.aiTier);

  const byokConfig = computed<ByokConfig | null>(() => {
    if (tier.value !== 'byok') return null;
    const provider = settingsStore.aiProvider;
    if (provider === 'none' || provider === undefined) return null;
    const apiKey = apiKeyForProvider(provider, settingsStore.settings.aiApiKeys);
    if (!apiKey) return null;
    return { provider, apiKey };
  });

  /**
   * Whether the selected tier can run without further setup. Managed is always selectable
   * (an undeployed proxy surfaces `not_available` at call time, not here); BYOK needs a key;
   * on-device is a future stub.
   */
  const isConfigured = computed(() => {
    switch (tier.value) {
      case 'managed':
        return true;
      case 'byok':
        return byokConfig.value !== null;
      case 'on-device':
        return false;
      default:
        return assertNever(tier.value, 'useAiCapability.isConfigured');
    }
  });

  /**
   * THE one assembly of the options every read needs: the tier, its BYOK key, today's date,
   * the consent grant and the billable family. It used to be spelled out inline at each read
   * site, which is how two sites drift (one forgets `byok`, and a BYOK family's reads silently
   * go to the managed tier). Task-specific extras (`correction`, `context`) are spread by the
   * caller on top.
   */
  function extractOptions(args: {
    grant: ConsentGrant;
    familyId: string;
    signal?: AbortSignal;
    context?: ExtractionContext;
  }): ExtractOptions {
    return {
      tier: tier.value,
      todayIso: toDateInputValue(new Date()),
      byok: byokConfig.value ?? undefined,
      grant: args.grant,
      familyId: args.familyId,
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.context ? { context: args.context } : {}),
    };
  }

  return { tier, byokConfig, isConfigured, extractOptions };
}
