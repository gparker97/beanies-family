// Managed-tier provider (beanies-managed, default tier). The single compressed document
// is sent to OUR server-side proxy, which holds the Tinfoil API key, rate-limits per
// family, and retains nothing. A browser PWA cannot safely hold the provider key, hence
// the proxy. The proxy returns our typed JSON contract ({ ...ExtractionResult }), so this
// provider validates that shape rather than parsing a raw chat completion.
//
// GATE 3 (deferred — lands with the Phase-2 backend): integrate Tinfoil's verification SDK
// + EHBP so the client encrypts the document body to the ATTESTED enclave and the proxy
// forwards ciphertext it cannot read. Until that ships, do NOT claim "no intermediary sees
// the document"; scope to "attested confidential compute + zero retention" (ADR-030).
//
// Until the proxy is deployed, the endpoint env var is unset and this provider degrades to a
// typed `not_available` — an honest seam, not a fake success. The BYOK and on-device paths,
// and the whole wedge UX, are exercisable without it.

import { parseExtractionResult, parseTravelExtractionResult } from '../extractionPrompt';
import {
  ExtractionProviderError,
  type AttestationInfo,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
  type TravelExtractionResult,
} from '../types';

/** Proxy endpoint (our Lambda). Unset until the Phase-2 backend is deployed. */
const PROXY_URL = import.meta.env.VITE_AI_EXTRACT_URL;
/** Soft key the proxy expects (in the public bundle; deters casual abuse). */
const PROXY_API_KEY = import.meta.env.VITE_AI_EXTRACT_API_KEY;
const DEFAULT_TIMEOUT_MS = 30_000;

function buildSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface ProxyBody {
  result?: unknown;
  attestation?: AttestationInfo;
}

/**
 * POST one document to the proxy for the given `task` and return the raw `{ result, attestation }`
 * envelope. Owns the shared transport + error classification (timeout / upstream_busy /
 * provider_error / malformed) so the event and travel paths don't duplicate it.
 */
async function postToProxy(
  request: ExtractionRequest,
  task: 'event' | 'travel'
): Promise<ProxyBody> {
  if (!PROXY_URL) {
    throw new ExtractionProviderError(
      'not_available',
      'Managed AI tier is not configured (proxy endpoint unset)'
    );
  }

  // GATE 3 TODO: replace this plaintext-body POST with EHBP — encrypt `imageDataUrl`
  // to the attested enclave's HPKE key (via the Tinfoil verification SDK) so the proxy
  // forwards ciphertext only. The proxy contract (single document → typed JSON) is unchanged.
  let res: Response;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PROXY_API_KEY ? { 'x-api-key': PROXY_API_KEY } : {}),
      },
      body: JSON.stringify({
        imageDataUrl: request.imageDataUrl,
        todayIso: request.todayIso,
        task,
      }),
      signal: buildSignal(request.signal),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ExtractionProviderError('timeout', 'Managed extraction timed out', err);
    }
    throw new ExtractionProviderError('provider_error', 'Network error calling managed proxy', err);
  }

  if (!res.ok) {
    // The proxy returns { error, code } on failure so we can distinguish a transient upstream
    // outage (retry) from a hard failure. Read the body defensively — fall back to status-based
    // mapping if it's absent/unreadable so we never mis-handle a failure.
    let code: string | undefined;
    try {
      code = ((await res.json()) as { code?: string })?.code;
    } catch {
      /* no/unreadable error body — use the HTTP status below */
    }
    if (code === 'upstream_unavailable' || res.status === 503) {
      throw new ExtractionProviderError(
        'upstream_busy',
        `Managed proxy upstream unavailable (HTTP ${res.status})`
      );
    }
    if (code === 'upstream_timeout' || res.status === 504) {
      throw new ExtractionProviderError('timeout', 'Managed extraction timed out upstream');
    }
    throw new ExtractionProviderError(
      'provider_error',
      `Managed proxy returned HTTP ${res.status}`
    );
  }

  try {
    return (await res.json()) as ProxyBody;
  } catch (err) {
    throw new ExtractionProviderError(
      'malformed_output',
      'Could not read managed proxy response',
      err
    );
  }
}

export const managedProvider: ExtractionProvider = {
  id: 'tinfoil',
  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const body = await postToProxy(request, 'event');
    try {
      const result = parseExtractionResult(body.result);
      // Attestation is managed-tier-only metadata (optional on ExtractionResult).
      return body.attestation ? { ...result, attestation: body.attestation } : result;
    } catch (err) {
      throw new ExtractionProviderError(
        'malformed_output',
        'Managed proxy returned unparseable or wrong-shape JSON',
        err
      );
    }
  },
  async extractTravel(request: ExtractionRequest): Promise<TravelExtractionResult> {
    const body = await postToProxy(request, 'travel');
    try {
      return parseTravelExtractionResult(body.result);
    } catch (err) {
      throw new ExtractionProviderError(
        'malformed_output',
        'Managed proxy returned unparseable or wrong-shape travel JSON',
        err
      );
    }
  },
};
