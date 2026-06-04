// Single source for the provider→stored-key lookup (#133). Both the capability gate
// (useAiCapability) and the BYOK settings UI (AiSettings) read keys this way; keeping it
// here prevents the two from drifting (e.g. one returning '' and the other null) and means
// adding a provider is a one-line change in one place.
import type { AIApiKeys, AIProvider } from '@/types/models';

/** The stored BYOK key for a provider, or undefined when none/unset. */
export function apiKeyForProvider(
  provider: AIProvider,
  keys: AIApiKeys | undefined
): string | undefined {
  if (!keys) return undefined;
  switch (provider) {
    case 'openai':
      return keys.openai;
    case 'claude':
      return keys.claude;
    case 'gemini':
      return keys.gemini;
    case 'none':
      return undefined;
    default:
      return undefined;
  }
}
