import type { RegistryEntry } from '@/types/models';
import { features } from '@/config/features';
import { logEvent } from '@/services/telemetry';

/**
 * Result of a registry write.
 *
 * `pointerAccepted` reports whether the server moved the family's canonical
 * pointer (`provider` / `fileId` / `displayPath`). Only the family's registered
 * owner may move it — see the guard in `infrastructure/lambda/registry/index.mjs`.
 * A refusal is *expected and boring* for member devices, which send pointer
 * fields on every login simply because the payload is uniform; it is *data at
 * risk* when the caller deliberately meant to re-point, because the registry now
 * disagrees with where the pod actually is.
 */
export interface RegistryWriteResult {
  pointerAccepted: boolean;
}

/**
 * The shape a caller supplies when writing a registry entry. It's the stored
 * `RegistryEntry` minus the server-owned key/timestamp, plus a transient
 * `isLoginEvent` flag. The flag is NOT a stored attribute: the Lambda reads it
 * to decide whether to stamp `lastLoginAt = today` and then discards it, so it
 * lives on the write payload only, never on `RegistryEntry`.
 */
export type RegistryWritePayload = Omit<RegistryEntry, 'familyId' | 'updatedAt'> & {
  isLoginEvent?: boolean;
  /**
   * Transient, like `isLoginEvent` — never stored. Marks the ONE write that
   * accompanies family creation, which is the only write permitted to stamp
   * `signupPlatform`. Row existence cannot stand in for this: `disconnect()`
   * deletes the row, so a reconnect from another platform would otherwise
   * relabel the family permanently.
   */
  isSignupEvent?: boolean;
};

const API_URL = import.meta.env.VITE_REGISTRY_API_URL;
const API_KEY = import.meta.env.VITE_REGISTRY_API_KEY;

async function request(method: string, familyId: string, body?: object): Promise<Response> {
  const res = await fetch(`${API_URL}/family/${familyId}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

/**
 * Typed lookup outcome. `lookupFamily` collapsed 404, non-2xx and a network
 * throw into a single `null`, which makes "this family has no registry row"
 * indistinguishable from "we couldn't ask". Callers that must fail OPEN — most
 * importantly the canonical-pod check, which would otherwise accuse a user of
 * working on a copy every time the registry hiccuped — need the difference.
 */
export type RegistryLookup =
  | { status: 'found'; entry: RegistryEntry }
  | { status: 'absent' }
  | { status: 'unavailable'; error?: unknown };

/**
 * Look up a family's file location by familyId, distinguishing absent from
 * unavailable.
 *
 * A disabled registry reports `absent` (not `unavailable`): on a self-host with
 * no registry there genuinely is no canonical row, and reporting `unavailable`
 * would make callers retry something that will never succeed.
 */
export async function lookupFamilyResult(familyId: string): Promise<RegistryLookup> {
  if (!features.registry) return { status: 'absent' };

  try {
    const res = await request('GET', familyId);
    if (res.status === 404) return { status: 'absent' };
    if (!res.ok) {
      logEvent({
        level: 'warn',
        surface: 'registry',
        message: 'family lookup failed',
        context: { action: 'lookup-unavailable', http_status: res.status },
      });
      return { status: 'unavailable' };
    }
    return { status: 'found', entry: (await res.json()) as RegistryEntry };
  } catch (err) {
    // Previously a bare console.warn — registry outages were invisible in the
    // firehose, so nobody could tell a dead registry from a quiet one.
    console.warn('[registry] lookupFamily failed — registry unavailable', err);
    logEvent({
      level: 'warn',
      surface: 'registry',
      message: 'family lookup threw',
      context: { action: 'lookup-unavailable' },
      error: err,
    });
    return { status: 'unavailable', error: err };
  }
}

/**
 * Look up a family's file location by familyId.
 * Returns null if not found or if the registry is unavailable.
 *
 * Thin wrapper over `lookupFamilyResult` — kept so existing call sites that
 * genuinely cannot act on the difference stay unchanged. Prefer
 * `lookupFamilyResult` in new code.
 */
export async function lookupFamily(familyId: string): Promise<RegistryEntry | null> {
  const r = await lookupFamilyResult(familyId);
  return r.status === 'found' ? r.entry : null;
}

/**
 * Register or update a family's file location.
 * Fire-and-forget — failures are logged but never block the caller.
 *
 * Used by every non-critical write path (background sync, country change,
 * etc.). Callers that NEED the write to succeed before they can proceed
 * (notably `syncStore.createNewFile`, where the registry write is the
 * recovery anchor for resume-from-registry) must use
 * `registerFamilyOrThrow` instead.
 */
export async function registerFamily(
  familyId: string,
  entry: RegistryWritePayload
): Promise<RegistryWriteResult | null> {
  try {
    return await registerFamilyOrThrow(familyId, entry);
  } catch (err) {
    console.warn('[registry] registerFamily failed — registry unavailable', err);
    return null; // swallowed a failure — the caller learns nothing about the pointer
  }
}

/**
 * Register or update a family's file location — THROWS on failure.
 *
 * Use from call sites where the registry write is critical (e.g. pod
 * creation, where the recovery flow reads `fileId` from the registry to
 * find the user's pod on a fresh device). For non-critical background
 * writes, use `registerFamily` which swallows failures.
 *
 * Behaviour matches `registerFamily` in the registry-disabled case: it's
 * a no-op success (the registry just isn't part of this self-host's
 * feature set, so the contract is trivially satisfied).
 */
export async function registerFamilyOrThrow(
  familyId: string,
  entry: RegistryWritePayload
): Promise<RegistryWriteResult> {
  // Registry disabled → the contract is trivially satisfied, and there is no
  // pointer to refuse. Reporting `pointerAccepted: false` here would generate
  // false criticals on every self-host.
  if (!features.registry) return { pointerAccepted: true };

  const res = await request('PUT', familyId, entry);
  if (!res.ok) {
    throw new Error(
      `Registry PUT failed: HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`
    );
  }
  // ABSENT MEANS ACCEPTED. A self-hoster on an older Lambda — and the prod window
  // between the server hotfix and the client shipping — must not generate false
  // `critical` reports. Only an explicit `false` is a refusal.
  const parsed = (await res.json().catch(() => ({}))) as { pointerAccepted?: boolean };
  return { pointerAccepted: parsed?.pointerAccepted !== false };
}

/**
 * Remove a family from the registry.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export async function removeFamily(familyId: string): Promise<void> {
  if (!features.registry) return;

  try {
    await request('DELETE', familyId);
  } catch (err) {
    console.warn('[registry] removeFamily failed — registry unavailable', err);
  }
}
