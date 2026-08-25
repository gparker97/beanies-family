// BYOK (bring-your-own-key) provider. The user supplies their own provider + API key
// (stored client-side in Settings.aiApiKeys); the call goes directly from the device to
// that provider — beanies never sees the key or the document. No managed proxy involved.
//
// v1 supports OpenAI-compatible vision (`openai`). Anthropic (`claude`) and Google
// (`gemini`) use different wire formats (not OpenAI `chat/completions` with `image_url`),
// so they are explicit, typed `not_available` seams to be filled in later — NOT silent
// no-ops. The factory keeps the key out of `ExtractionRequest`, preserving interface purity.

import { callOpenAiCompatibleTask, type OpenAiCompatibleConfig } from './openaiCompatible';
import {
  ExtractionProviderError,
  type AiProviderId,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResultByTask,
  type ExtractionTask,
} from '../types';

export interface ByokConfig {
  provider: AiProviderId;
  apiKey: string;
  /** Optional model override; otherwise a sensible vision-capable default per provider. */
  model?: string;
}

/** Default OpenAI vision model for BYOK. (GPT-4o-mini is a documented vision cost trap — see ADR-030.) */
const OPENAI_DEFAULT_MODEL = 'gpt-4o';
/** Exported so validateByokKey reuses the single source for the OpenAI base URL. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function createByokProvider(config: ByokConfig): ExtractionProvider {
  /**
   * Resolve the OpenAI-compatible call config, or throw the right typed `not_available`
   * for an unsupported/non-BYOK provider. Shared by both extract paths so the provider
   * support matrix lives in exactly one place.
   */
  function openAiConfig(): OpenAiCompatibleConfig {
    if (!config.apiKey) {
      throw new ExtractionProviderError('not_available', 'No BYOK API key configured');
    }
    switch (config.provider) {
      case 'openai':
        return {
          baseUrl: OPENAI_BASE_URL,
          apiKey: config.apiKey,
          model: config.model ?? OPENAI_DEFAULT_MODEL,
        };
      case 'claude':
      case 'gemini':
        // Different wire formats than OpenAI vision — a real future task, surfaced
        // honestly rather than pretended-supported.
        throw new ExtractionProviderError(
          'not_available',
          `BYOK vision for "${config.provider}" is not supported yet`
        );
      case 'tinfoil':
      case 'on-device':
        // These are not BYOK targets (tinfoil = managed tier; on-device = its own provider).
        throw new ExtractionProviderError(
          'not_available',
          `"${config.provider}" is not a BYOK provider`
        );
      default:
        throw new ExtractionProviderError(
          'not_available',
          `Unknown BYOK provider: ${String(config.provider)}`
        );
    }
  }

  return {
    id: config.provider,
    run<T extends ExtractionTask>(
      task: T,
      request: ExtractionRequest
    ): Promise<ExtractionResultByTask[T]> {
      return callOpenAiCompatibleTask(openAiConfig(), task, request);
    },
  };
}
