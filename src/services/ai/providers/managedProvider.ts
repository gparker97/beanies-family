// Managed-tier provider (beanies-managed, default tier). The single compressed document
// is sent to OUR server-side proxy, which holds the Tinfoil API key and retains nothing.
// A browser PWA cannot safely hold the provider key, hence the proxy.
//
// RATE LIMITING — corrected twice, so state it precisely and do not drift again. This
// comment once claimed per-family limiting when there was none (corrected 2026-08-25 to
// "there is none, and never has been"). As of #83 there IS one, so the correction is now
// wrong in the other direction. What is actually deployed:
//   1. a global API-Gateway route throttle on `POST /ai-extract` (burst 5 / rate 2), shared
//      by every caller — the backstop, and the reason the limiter below may fail open;
//   2. a per-FAMILY hourly limit, keyed on the `familyId` this provider sends;
//   3. a per-IP hourly limit, keyed on the source address API Gateway observed.
// (2) and (3) apply to EVERY sealed request as of #49, not just text ones: ciphertext hides the
// source kind, so the limiter cannot be conditional on it, and it is the compensating control for
// the server-side `sources` fence that ciphertext retires permanently. Neither is authoritative:
// family is forgeable (it is client-supplied), IP is shared behind NAT. Either tripping refuses.
//
// ⚠️ The proxy NO LONGER returns a typed result. It returns the enclave's sealed reply, which
// this provider opens and parses itself with the same `parseChatCompletion` the BYOK tier uses.
// Prompt building moved here too: the Lambda cannot build a prompt for a document it cannot read.
//
// GATE 3 — SHIPPED (#49). This provider verifies the enclave's AMD SEV-SNP attestation, gets the
// HPKE public key BOUND to that attested measurement, and encrypts the chat-completions body to it
// before anything leaves the device. Our proxy forwards ciphertext it cannot read. Verification
// failure REFUSES the send; there is no degrade-to-plaintext path, by construction, because a
// caller cannot obtain a key without verifying.
//
// ⚠️ The claim is true for THIS client, not for every client. Store builds that have not been
// updated still use the Lambda's legacy plaintext arm, which is why ADR-030 records Gate 3 as
// "closed for sealed clients, open overall" rather than awarding it a tick the fleet has not
// earned. See the sunset condition there.
//
// Until the proxy is deployed, the endpoint env var is unset and this provider degrades to a
// typed `not_available` — an honest seam, not a fake success. The BYOK and on-device paths,
// and the whole wedge UX, are exercisable without it.

import { EXTRACTION_PARSERS, EXTRACTION_TASKS } from '../extractionPrompt';
import {
  ExtractionProviderError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResultByTask,
  type ExtractionTask,
} from '../types';
import { buildSignal, parseChatCompletion } from './openaiCompatible';
import { invalidateEnclaveVerification, verifyEnclave } from '../enclave/attestation';
import { openSealed, sealForEnclave } from '../enclave/seal';
import { base64ToBuffer, bufferToBase64, sha256Hex } from '@/utils/encoding';

/** Proxy endpoint (our Lambda). Unset until the Phase-2 backend is deployed. */
const PROXY_URL = import.meta.env.VITE_AI_EXTRACT_URL;
/** Soft key the proxy expects (in the public bundle; deters casual abuse). */
const PROXY_API_KEY = import.meta.env.VITE_AI_EXTRACT_API_KEY;
/** The wire discriminator. Must match `SEALED_PROTOCOL` in the Lambda; the parity test asserts it. */
const SEALED_PROTOCOL = 'ehbp-1';
/** Asks the proxy which model to name inside the sealed body. Same route, no new endpoint. */
const SEALED_CONFIG_PROTOCOL = 'ehbp-config';

/**
 * The model id, from the proxy, memoised for the session.
 *
 * ⚠️ THIS IS NOT OPTIONAL AND NOT COSMETIC. The enclave rejects a body with no `model`
 * (`400 Missing required parameter: 'model'`, checked before auth), and because our body is
 * ciphertext the Lambda cannot add it on the way through — so the client must name it before it
 * seals. A first version of this code omitted it and would have failed 100% of managed
 * extractions; every test passed because the seal was mocked and its payload never asserted.
 *
 * Fetched rather than hardcoded so the `TINFOIL_MODEL` Terraform lever keeps working.
 * `variables.tf` records that lever hotfixing a Tinfoil model retirement the same day; a baked-in
 * constant would make the next retirement need an App Store release.
 */
let modelPromise: Promise<string> | null = null;

async function enclaveModel(signal?: AbortSignal): Promise<string> {
  modelPromise ??= (async () => {
    const body = (await postToProxy({ protocol: SEALED_CONFIG_PROTOCOL }, signal)) as {
      model?: string;
    };
    if (typeof body?.model !== 'string' || !body.model) {
      throw new ExtractionProviderError(
        'not_available',
        'Managed proxy did not report which model to use'
      );
    }
    return body.model;
  })().catch((err) => {
    // Never cache a failure, or one blip disables the tier for the session.
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

/** Test seam, and used by the provider when a sealed request fails for any reason. */
export function __resetManagedModelForTesting(): void {
  modelPromise = null;
}

/**
 * The bill bound that moved client-side when the Lambda stopped being able to read the text (#49).
 *
 * ⚠️ There are deliberately THREE text limits in this codebase and they are not duplicates:
 *   • `MAX_SHARE_TEXT_CHARS` (share/types.ts)   — what the share path TRUNCATES to before sending
 *   • `MAX_SHARE_TEXT_CEILING` (share/types.ts) — the share path's hard refusal
 *   • this one                                  — what a MANAGED read may cost us, for any source
 *
 * The link arm is why this has to exist: its text comes back from the content-fetch Lambda and the
 * client never bounded it, because `MAX_TEXT_CHARS` did that server-side. Ciphertext ends that.
 * Pinned to the Lambda's value by `lambdaContractParity.test.ts`; do not fold the three together.
 */
const MANAGED_TEXT_BILL_BOUND = 32_000;

interface SealedProxyBody {
  /** The enclave's reply, still sealed. */
  sealed?: string;
  /** `ehbp-*` headers the proxy relayed back; the response nonce lives here. */
  ehbp?: Record<string, string>;
  /** A one-use grant to re-read this document as a different kind, free. Managed tier only. */
  correction?: { token: string };
  /**
   * Did the proxy actually SPEND a grant on this request? The client's kind-guard needs it: the
   * Lambda's equivalent ran on a value set only for a spent grant, so it could never fire on the
   * kill-switch or store-blip paths, and the client's must not either.
   */
  correctionFree?: boolean;
}

/**
 * Fingerprint of what is actually being sent, mirroring the Lambda's `sourceFingerprint`.
 *
 * ⚠️ Byte-parity with the server is load-bearing and pinned by `lambdaContractParity.test.ts`. A
 * divergence would refuse every correction AND fire `GRANT_MISMATCH_PREFIX`, which is the one
 * alarm that means the feature is broken rather than someone probing it.
 *
 * Deliberately UNSALTED. Salting per family would break that parity, and a family that read on one
 * bundle then corrected after an in-hour app update would hash differently and trip that alarm. It
 * is the one new piece of cleartext metadata the sealed arm adds: it reveals no content, but it is
 * a stable identifier, so ADR-030 states plainly what the server still learns.
 */
export async function sourceHash(request: ExtractionRequest): Promise<string> {
  return request.source.kind === 'text'
    ? sha256Hex(`t:${request.source.text}`)
    : sha256Hex(`i:${request.source.imageDataUrls.join('\n')}`);
}

/**
 * POST one document to the proxy for the given `task` and return the raw `{ result, attestation }`
 * envelope. Owns the shared transport + error classification (timeout / upstream_busy /
 * provider_error / malformed) so the event and travel paths don't duplicate it.
 */
async function postToProxy(envelope: unknown, signal?: AbortSignal): Promise<SealedProxyBody> {
  if (!PROXY_URL) {
    throw new ExtractionProviderError(
      'not_available',
      'Managed AI tier is not configured (proxy endpoint unset)'
    );
  }

  let res: Response;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PROXY_API_KEY ? { 'x-api-key': PROXY_API_KEY } : {}),
      },
      // The envelope is PLAINTEXT METADATA ONLY — protocol, familyId, task, srcHash, the
      // correction token and the ehbp headers. The document itself is inside `sealed`, encrypted
      // to the enclave. Deliberately NOT here: `todayIso` (the client builds the prompt now) and
      // `correction.to` (see the run() comment; it would leak the family's own assertion about
      // their document in cleartext for no remaining server-side purpose).
      body: JSON.stringify(envelope),
      signal: buildSignal(signal),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
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
    // Match on the STATUS as well as our own `code`, and a pre-existing bug closes for free.
    // The API-Gateway route throttle returns a bare 429 with `{"message":"Too Many Requests"}`
    // and NO `code`, which until now fell through to `provider_error` — reported by the shared
    // toast mapper's `default:` arm WITH an error surface, i.e. paging #beanies-errors every
    // time two families extracted at once. Matching the status is strictly more robust.
    //
    // (Caveat worth recording rather than re-discovering: an API-Gateway-generated 429 carries
    // no CORS headers, so from a browser it surfaces as a network error and classifies as
    // `provider_error` regardless. Our OWN 429 goes through the Lambda's `response()` helper
    // and does carry them, which is the case this branch actually catches.)
    if (code === 'rate_limited' || res.status === 429) {
      // Developer channel, matching the `unknown_task` precedent below: the toast copy is
      // deliberately generic, so the specifics belong in the console rather than in a widened
      // result type nobody reads.
      console.error(
        '[ai-extract] the proxy refused this extraction: too many requests in the current ' +
          'window. This is an intentional abuse limit, not an outage. See the ' +
          'beanies-ai-rate-{env} DynamoDB table and the ai-extract Lambda logs for which ' +
          'limit tripped (family or ip).'
      );
      throw new ExtractionProviderError(
        'rate_limited',
        `Managed proxy rate-limited this request (HTTP ${res.status})`
      );
    }
    if (code === 'correction_disagreed' || res.status === 422) {
      // The model read it again and still does not agree. Its own code rather than the generic
      // malformed-output one: nothing went wrong, so the toast must not say it did.
      throw new ExtractionProviderError(
        'correction_disagreed',
        `Managed proxy: the document does not support that correction (HTTP ${res.status})`
      );
    }
    if (code === 'correction_refused' || res.status === 409) {
      // The grant was missing, already spent, expired, or issued against a different document.
      // The proxy refuses instead of downgrading to a charged, unhinted re-read — so nothing
      // reached the model and nothing was counted. Its own code, not `provider_error`: this is
      // an expected refusal with a specific message, and folding it into the generic error
      // would tell the user something went wrong when nothing did.
      throw new ExtractionProviderError(
        'correction_refused',
        `Managed proxy refused this correction (HTTP ${res.status})`
      );
    }
    if (code === 'unknown_protocol') {
      // The deployed Lambda predates the sealed arm. A DEPLOY-ORDER problem, not a user problem,
      // so it maps to the existing `not_available` that the shared toast mapper already renders
      // as the friendly "not set up yet" notice. No new code, no new string.
      console.error(
        '[ai-extract] the deployed proxy does not understand the sealed protocol. The ai-extract ' +
          'Lambda must be deployed BEFORE a bundle that sends it. Deploy ' +
          'infrastructure/lambda/ai-extract, then reload.'
      );
      throw new ExtractionProviderError(
        'not_available',
        'Managed proxy does not support encrypted requests yet'
      );
    }
    if (code === 'payload_too_large' || res.status === 413) {
      // The SERVER's verdict, deliberately, rather than a client-side size guess: a client bound
      // would have to model the envelope and base64 overhead to avoid being wrong in the direction
      // that matters. Developer channel, matching the precedents below.
      console.error(
        '[ai-extract] the sealed request exceeded the proxy body cap. Sealing adds roughly 33% ' +
          'over the compressed bytes, so a 5-page document is the practical ceiling. Ask the ' +
          'family for fewer pages.'
      );
      throw new ExtractionProviderError(
        'provider_error',
        `Managed proxy refused an oversized request (HTTP ${res.status})`
      );
    }
    if (code === 'unknown_task') {
      // The client is ahead of the proxy: this build asks for a task the deployed Lambda
      // does not know yet. That is a DEPLOY-ORDER problem, not a user problem, so it maps
      // to the existing `not_available` code — which the shared toast mapper already
      // renders as the friendly "not set up yet" info toast. No new code, no new string.
      console.error(
        '[ai-extract] the deployed proxy does not know this extraction task. The ai-extract ' +
          'Lambda must be deployed BEFORE a client that requests a new task. Deploy ' +
          'infrastructure/lambda/ai-extract, then reload.'
      );
      throw new ExtractionProviderError(
        'not_available',
        'Managed proxy does not support this extraction task yet'
      );
    }
    throw new ExtractionProviderError(
      'provider_error',
      `Managed proxy returned HTTP ${res.status}`
    );
  }

  try {
    return (await res.json()) as SealedProxyBody;
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
  async run<T extends ExtractionTask>(
    task: T,
    request: ExtractionRequest
  ): Promise<ExtractionResultByTask[T]> {
    // The ONE validation the Lambda genuinely lost. Mime and page count are not re-checked here:
    // every image goes through `compress()`, which always emits JPEG, and the page count is bounded
    // by `MAX_EXTRACT_PAGES` — so a client-side validator for those would be dead code.
    if (request.source.kind === 'text' && request.source.text.length > MANAGED_TEXT_BILL_BOUND) {
      throw new ExtractionProviderError(
        'provider_error',
        `Text source exceeds the managed bill bound (${request.source.text.length} chars)`
      );
    }

    let body: SealedProxyBody;
    let envelope: unknown;
    let context: Awaited<ReturnType<typeof sealForEnclave>>['context'];
    let enclave: Awaited<ReturnType<typeof verifyEnclave>>;
    try {
      // Verify BEFORE anything is built or sent. Throws on failure, so there is no branch in which
      // an unverified enclave gets a document: the key simply does not exist to encrypt to.
      enclave = await verifyEnclave(request.signal);

      // The prompt is built HERE now. The Lambda cannot build one for a document it cannot read,
      // and this is the same `EXTRACTION_TASKS` seam the BYOK tier uses, so adding a task still
      // touches neither file.
      const messages = EXTRACTION_TASKS[task].buildMessages(
        request.source,
        request.todayIso,
        // The hint reaches OUR prompt, never the wire. The server-side "hint only when a grant was
        // spent" fence dies with plaintext, exactly as it already does for BYOK; biasing your own
        // read costs you a bean, which is the same trade that tier already makes.
        request.correction?.to
      );

      const sealed = await sealForEnclave(enclave.hpkePublicKey, {
        // ⚠️ `model` is REQUIRED by the enclave and must be inside the CIPHERTEXT — the proxy
        // cannot add it to a body it cannot read. Omitting it fails every extraction.
        model: await enclaveModel(request.signal),
        messages,
        temperature: 0,
      });
      context = sealed.context;

      body = await postToProxy(
        {
          protocol: SEALED_PROTOCOL,
          task,
          srcHash: await sourceHash(request),
          ...(request.familyId ? { familyId: request.familyId } : {}),
          // TOKEN ONLY. `to` is deliberately absent from the wire: `consumeGrant` no longer
          // conditions on the kind, and the closed-set check on `to` existed only because it
          // reached the model's instruction server-side, which it cannot do now. Sending it would
          // put the family's own assertion about their document in cleartext for nothing.
          ...(request.correction?.token ? { correction: { token: request.correction.token } } : {}),
          ehbp: sealed.headers,
          // The PLAINTEXT body's type, which EHBP keeps in cleartext; the enclave's inner handler
          // needs it. See seal.ts — overriding it with a binary type risks a 415 on every request.
          contentType: sealed.contentType,
          sealed: bufferToBase64(sealed.ciphertext),
        },
        request.signal
      );
      if (typeof body.sealed !== 'string' || body.sealed.length === 0) {
        throw new ExtractionProviderError(
          'malformed_output',
          'Managed proxy returned no sealed body'
        );
      }

      // ⚠️ INSIDE the try, all of it. `base64ToBuffer` throws a bare `Error` (and `atob` a
      // DOMException) on malformed input — neither an ExtractionProviderError, so outside a
      // handler they escape `run()`, miss the `instanceof` check downstream, and render a
      // developer string like "decoded N bytes, expected M" straight to the family.
      //
      // And `openSealed` failing IS the stale-key symptom: after a key rotation the seal succeeds
      // against the memoised key and the enclave still answers 200, so outside the catch the dead
      // key would stay memoised for the full TTL while every retry re-sealed to it, cost a bean,
      // and told the family to try a clearer photo.
      envelope = await openSealed(
        context,
        new Uint8Array(base64ToBuffer(body.sealed)),
        body.ehbp ?? {}
      );
    } catch (err) {
      // Clear the memo after ANY failed sealed request, not only a stale-key-shaped one. We have
      // never observed what a Tinfoil key rotation looks like on the wire, and classifying a
      // failure nobody has seen is how you write a branch nobody can test. The cost is one extra
      // verification after a failure that already cost the user a retry.
      invalidateEnclaveVerification();
      __resetManagedModelForTesting();
      // Everything this module throws is an ExtractionProviderError and callers rely on it;
      // base64ToBuffer and atob do not honour that, so classify rather than let one escape.
      if (err instanceof ExtractionProviderError) throw err;
      throw new ExtractionProviderError(
        'malformed_output',
        'Could not read the managed proxy response',
        err
      );
    }

    const parse = EXTRACTION_PARSERS[task] as (raw: unknown) => ExtractionResultByTask[T];
    const result = parseChatCompletion(envelope, parse);

    // The kind guard, moved from the Lambda (which can no longer run it). Mirrors
    // `index.mjs`'s LEGACY-PLAINTEXT-ARM block exactly, INCLUDING the `none` split: a `none`
    // answer is a DISAGREEMENT, not a malformed one — the hinted prompt leaves the model exactly
    // one way out, and reporting "try a clearer photo" for a perfectly legible page is both false
    // and an invitation to a retry that costs a bean.
    // ⚠️ Gated on `body.correctionFree`, NOT merely on the user having asserted a kind. The
    // Lambda's guard ran on `read.kindHint`, which `meter.mjs` sets only when a grant was actually
    // SPENT, so it deliberately could not fire on the two fall-through outcomes: the
    // CORRECTION_GRANTS kill switch, and a DynamoDB blip. Without this gate, during exactly the
    // incident the kill switch exists for, a family taps the free-correction banner, is charged
    // against the billable column, and is then shown a toast whose copy says nothing was charged.
    const asserted = body.correctionFree ? request.correction?.to : undefined;
    if (asserted && (result as { kind?: string }).kind !== asserted) {
      const disagreed = (result as { kind?: string }).kind === 'none';
      throw new ExtractionProviderError(
        disagreed ? 'correction_disagreed' : 'malformed_output',
        disagreed
          ? 'The document does not support that correction'
          : `Managed enclave returned wrong-shape ${task} JSON`
      );
    }

    // Built from OUR verification, never from a server header. The old code trusted a
    // `tinfoil-enclave` string the proxy passed through; this is the first version in which
    // `verified` means something a reader can rely on.
    result.attestation = { enclave: enclave.enclave, verified: true };
    if (body.correction) result.correction = body.correction;
    return result;
  },
};
