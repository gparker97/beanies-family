// Shared per-document AI consent gate (ADR-030, #133 + #30).
//
// Both document wedges must get the user's agreement before a single document leaves the
// device. This composable owns the promise-based gate + the family-scoped "don't ask again"
// (skipDocumentConsentPrompt) so each page doesn't re-declare the resolver lifecycle. The
// gate runs BEFORE the file picker opens; a decline is a deliberate silent no-op.

import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { reportError } from '@/utils/errorReporter';

export function useDocumentConsent() {
  const settingsStore = useSettingsStore();

  const consentOpen = ref(false);
  let consentResolver: ((granted: boolean) => void) | null = null;

  /**
   * Await consent before any document leaves the device. If the family opted into "don't ask
   * again" we resolve immediately WITHOUT touching the modal lifecycle (no resolver assignment
   * → none can be left dangling).
   */
  function requestConsent(): Promise<boolean> {
    if (settingsStore.skipDocumentConsentPrompt) return Promise.resolve(true);
    return new Promise((resolve) => {
      consentResolver = resolve;
      consentOpen.value = true;
    });
  }

  function resolveConsent(granted: boolean): void {
    consentOpen.value = false;
    consentResolver?.(granted);
    consentResolver = null;
  }

  /**
   * Confirm handler for the consent modal. Proceeds for this document regardless; if the user
   * ticked "remember", persist the family-scoped skip — but a persist failure must never strand
   * the wedge, so consent resolves in `finally`.
   */
  async function onConsentConfirm(remember: boolean): Promise<void> {
    try {
      if (remember) await settingsStore.setSkipDocumentConsentPrompt(true);
    } catch (e) {
      reportError({
        surface: 'ai-consent',
        message: 'Failed to save the AI consent preference',
        error: e,
      });
    } finally {
      resolveConsent(true);
    }
  }

  return { consentOpen, requestConsent, resolveConsent, onConsentConfirm };
}
