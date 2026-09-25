// Shared OpenAI-compatible vision chat caller.
//
// Both the BYOK path (provider's own endpoint + user key) and — later — any direct
// OpenAI-compatible managed call use this single funnel, so the wire format,
// JSON-fence stripping, parse/validate, and error classification live in ONE place.
// This module is the ONLY place OpenAI-wire concerns (chat/completions, `choices`,
// message roles) are allowed — they must never leak into types.ts or the service.

import { EXTRACTION_PARSERS, EXTRACTION_TASKS, type ChatMessage } from '../extractionPrompt';
import {
  ExtractionProviderError,
  type ExtractionRequest,
  type ExtractionResultByTask,
  type ExtractionTask,
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
 *
 * Exported because `managedProvider` held a byte-identical copy until #49. One definition, so
 * the two tiers cannot drift into different timeout semantics.
 */
export function buildSignal(signal?: AbortSignal): AbortSignal {
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
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
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

  let envelope: unknown;
  try {
    envelope = await res.json();
  } catch (err) {
    throw new ExtractionProviderError('malformed_output', 'Could not read provider response', err);
  }

  return parseChatCompletion(envelope, parse);
}

/**
 * Turn an OpenAI-compatible chat-completion envelope into a typed result.
 *
 * Extracted at #49 so the sealed managed path reuses it rather than growing a second copy of the
 * `choices[0].message.content` read, the fence strip and the `malformed_output` classification.
 * The enclave path differs from this one only in TRANSPORT, so everything downstream of the
 * envelope is genuinely the same code.
 *
 * ⚠️ The thrown message is deliberately STATIC and the cause goes only in the `cause` slot.
 * V8's `JSON.parse` SyntaxError quotes a slice of its input, and on the sealed path that input is
 * model output derived from the family's document. `useExtractionErrorToast` already documents the
 * rule that keeps this contained: a provider detail may reach the console and the toast, never the
 * telemetry firehose, whose context is an allowlist precisely because free-form text can carry
 * anything. Do not fold the cause into a user- or telemetry-visible detail string.
 */
export function parseChatCompletion<T>(envelope: unknown, parse: (raw: unknown) => T): T {
  const content =
    (envelope as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message
      ?.content ?? '';
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

/**
 * Run ONE task against an OpenAI-compatible endpoint. Replaces the previous
 * `callOpenAiCompatibleVision` / `callOpenAiCompatibleTravel` pair, which differed only in
 * which builder and which parser they passed — a shape that grew a new near-identical
 * export per task. Adding a task now touches this file not at all.
 */
export function callOpenAiCompatibleTask<T extends ExtractionTask>(
  config: OpenAiCompatibleConfig,
  task: T,
  request: ExtractionRequest
): Promise<ExtractionResultByTask[T]> {
  // The correction hint rides the same channel here as it does on the managed tier, so a BYOK
  // family's "not right?" produces the same targeted re-read rather than a second blind guess.
  // There is no grant to spend — a BYOK read costs us nothing, so there is nothing to exempt.
  const messages = EXTRACTION_TASKS[task].buildMessages(
    request.source,
    request.todayIso,
    request.correction?.to,
    request.correction?.reason
  );
  const parse = EXTRACTION_PARSERS[task] as (raw: unknown) => ExtractionResultByTask[T];
  return callOpenAiCompatible(config, request, messages, parse);
}
