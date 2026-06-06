// Shared OpenAI-compatible vision chat caller.
//
// Both the BYOK path (provider's own endpoint + user key) and — later — any direct
// OpenAI-compatible managed call use this single funnel, so the wire format,
// JSON-fence stripping, parse/validate, and error classification live in ONE place.
// This module is the ONLY place OpenAI-wire concerns (chat/completions, `choices`,
// message roles) are allowed — they must never leak into types.ts or the service.

import {
  buildExtractionMessages,
  buildTravelExtractionMessages,
  parseExtractionResult,
  parseTravelExtractionResult,
  type ChatMessage,
} from '../extractionPrompt';
import {
  ExtractionProviderError,
  type ExtractionRequest,
  type ExtractionResult,
  type TravelExtractionResult,
} from '../types';

/** Hard ceiling on a single extraction call, so a hung upstream surfaces as a timeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface OpenAiCompatibleConfig {
  /** Base URL including `/v1` (e.g. `https://api.openai.com/v1`). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Strip ```json … ``` fences a model may wrap its JSON in, then parse. */
function parseJsonContent(content: string): unknown {
  const jsonText = content
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(jsonText);
}

/**
 * Combine the caller's optional abort signal with our own timeout so either can cancel
 * the fetch. `AbortSignal.any` is widely supported; the timeout guards against a hung host.
 */
function buildSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Call an OpenAI-compatible `/chat/completions` vision endpoint with the shipping
 * extraction prompt and return a typed {@link ExtractionResult}. Throws
 * {@link ExtractionProviderError} with a stable code on every failure mode:
 *   • abort/timeout → `timeout`
 *   • network error → `provider_error`
 *   • non-2xx       → `provider_error` (upstream body is NOT surfaced to the user)
 *   • bad JSON/shape → `malformed_output`
 */
async function callOpenAiCompatible<T>(
  config: OpenAiCompatibleConfig,
  request: ExtractionRequest,
  messages: ChatMessage[],
  parse: (raw: unknown) => T
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.model, messages, temperature: 0 }),
      signal: buildSignal(request.signal),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ExtractionProviderError('timeout', 'Extraction request timed out', err);
    }
    throw new ExtractionProviderError(
      'provider_error',
      'Network error calling inference provider',
      err
    );
  }

  if (!res.ok) {
    // Do not leak the upstream body to the user; keep status for diagnostics only.
    throw new ExtractionProviderError(
      'provider_error',
      `Inference provider returned HTTP ${res.status}`
    );
  }

  let content: string;
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = data?.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    throw new ExtractionProviderError('malformed_output', 'Could not read provider response', err);
  }

  try {
    return parse(parseJsonContent(content));
  } catch (err) {
    throw new ExtractionProviderError(
      'malformed_output',
      'Model returned unparseable or wrong-shape JSON',
      err
    );
  }
}

export function callOpenAiCompatibleVision(
  config: OpenAiCompatibleConfig,
  request: ExtractionRequest
): Promise<ExtractionResult> {
  return callOpenAiCompatible(
    config,
    request,
    buildExtractionMessages(request.imageDataUrl, request.todayIso),
    parseExtractionResult
  );
}

export function callOpenAiCompatibleTravel(
  config: OpenAiCompatibleConfig,
  request: ExtractionRequest
): Promise<TravelExtractionResult> {
  return callOpenAiCompatible(
    config,
    request,
    buildTravelExtractionMessages(request.imageDataUrl, request.todayIso),
    parseTravelExtractionResult
  );
}
