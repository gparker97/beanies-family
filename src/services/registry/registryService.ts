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
  /**
   * The row's owner AFTER the write, as the Lambda stored it. Returned only for an
   * `ownerSync` write (`registryOwnerSync` reads it to confirm a transfer landed);
   * ABSENT on every other write and from a Lambda older than owner sync.
   */
  owner?: { memberId: string | null; email: string | null };
  /**
   * The Lambda's owner-sync outcome (`handover`, `email-synced`, `unchanged` or a
   * `refused-*` reason; `owner.mjs`). Returned only for an `ownerSync` write; absent
   * from a Lambda that predates it.
   */
  outcome?: string;
  /**
   * #125: the step-1 write's outcome (`created`, `exists` when a row was already there,
   * `refused` when the writer is not the owner it stamps). Returned only for a
   * `signupStart` write; absent from a Lambda that predates it, which
   * `signupStartDetail` reads as `unsupported`.
   */
  signupStart?: 'created' | 'exists' | 'refused';
  /**
   * #125: the ISO 3166-1 alpha-2 country the Lambda derived from `deviceTimeZone`, or
   * null when the zone mapped to none. Returned on a signup write (`signupStart` or
   * `isSignupEvent`) only; ops-facing (the Slack lines), never stored by the client.
   */
  deviceCountry?: string | null;
  /**
   * #125: the attribution the Lambda inferred from the store-tap ledger at pod creation
   * (native pods with no campaign tag), or null when it scored nothing. Returned on the
   * pod-creation write only; the client shows it in Slack and never stores it.
   */
  attributionInferred?: RegistryInferredAttribution | null;
}

/** The slice of the Lambda's create-time inference the client reads (#125). */
export interface RegistryInferredAttribution {
  band: 'high' | 'medium' | 'low';
  fields: Record<string, string>;
}

/**
 * The shape a caller supplies when writing a registry entry. It's the stored
 * `RegistryEntry` minus the server-owned key/timestamp, plus a transient
 * `isLoginEvent` flag. The flag is NOT a stored attribute: the Lambda reads it
 * to decide whether to stamp `lastLoginAt = today` and then discards it, so it
 * lives on the write payload only, never on `RegistryEntry`.
 */
export type RegistryWritePayload = Omit<RegistryEntry, 'familyId' | 'updatedAt'> & {
  /**
   * The signed-in member on the device MAKING this write, or null when nobody is
   * signed in. Transient like the two flags below — never stored.
   *
   * ⚠️ REQUIRED, NOT OPTIONAL, AND THE SERVER READS ITS PRESENCE. `ownerMemberId`
   * used to carry double duty: the client sent the signed-in member's id AS the
   * owner, so "the owner is whoever is writing" was baked into the wire and a
   * member device writing to a row the registry had just lost stamped itself
   * owner. The two are now separate questions, and the Lambda's pointer guard
   * asks this one.
   *
   * It must be present on every write even when null. The server distinguishes
   * ABSENT (a client from before the split, judged on `ownerMemberId` for
   * compatibility) from PRESENT-AND-NULL (a current client with nobody signed in,
   * which must NOT be able to move the pointer). Optional here would let a caller
   * silently take the compatibility path forever.
   */
  writerMemberId: string | null;
  /**
   * The signed-in member's email on the device making this write, or null.
   * Transient — never stored.
   *
   * ⚠️ REQUIRED FOR THE SAME REASON AS `writerMemberId`, and forgetting it opened
   * a hole rather than closing one. The server's pointer guard has a LEGACY tier
   * for rows registered before `ownerMemberId` existed, which compares emails.
   * Once `ownerEmail` began coming from the pod roster, every device sent the
   * OWNER'S address, so that tier matched for everyone and any member could move
   * a legacy row's pointer. This is the value that tier must compare.
   */
  writerEmail: string | null;
  isLoginEvent?: boolean;
  /**
   * Transient, like `isLoginEvent` — never stored. Marks the ONE write that
   * accompanies family creation, which is the only write permitted to stamp
   * `signupPlatform`. Row existence cannot stand in for this: a DELETE used to
   * drop the row outright, so a reconnect from another platform would otherwise
   * relabel the family permanently. (`syncStore.disconnect()`, cited here until
   * 2026-09-08, is deleted; `deleteLocalFamily` no longer removes the shared row
   * either. The flag stays because the owner-gated full deletion can still
   * remove a row, and because the guarantee should not rest on which callers
   * happen to exist this week.)
   */
  isSignupEvent?: boolean;
  /**
   * Transient, like `isSignupEvent` — never stored. Asks the Lambda to bring the
   * row's `ownerMemberId` / `ownerEmail` in line with this payload's pod owner. Ownership changes ONLY on a write carrying it (every other write keeps
   * the owner fields write-once), and the Lambda honours it only from the
   * registered owner on the canonical pointer. `registryOwnerSync` is the one
   * place that sets it.
   */
  ownerSync?: boolean;
  /**
   * Transient, sent only with `ownerSync`. Why the sync was sent, which decides
   * whether a HANDOVER may go through once the row has been handed over before
   * (the Lambda's `ownerHandoverAt` lock, `owner.mjs`): `'transfer'` (this device
   * just transferred ownership and saved it) always may; `'drift'` (the client
   * sends it for an owner email sync, same owner id) never needs to.
   */
  ownerSyncReason?: RegistryOwnerSyncReason;
  /**
   * Transient, never stored (#125). Marks the step-1 write of the create wizard: a
   * create-only row (no pointer, no `createdAt`) so a sign-up that never finishes is
   * still reachable. The Lambda judges a body carrying it by the step-1 rules alone
   * and ignores `isLoginEvent`, `isSignupEvent` and `ownerSync` on it, so the builder
   * never sets two modes on one payload.
   */
  signupStart?: boolean;
  /**
   * Transient, never stored (#125). The device's IANA time zone, sent on a signup write
   * only (`signupStart` or `isSignupEvent`), null otherwise. The Lambda maps it to a
   * country (`deviceCountry`) and discards the zone itself.
   */
  deviceTimeZone?: string | null;
  /**
   * Transient, never stored (#128). Set only on `syncStore.completePodSetup`'s write, the
   * create wizard's completion (after the survey). It asks the Lambda to return the signup
   * response fields (`deviceCountry`, `attributionInferred`) on that write even when the
   * survey was skipped, so the "Family pod created!" Slack line has them. Honoured only from
   * the owner.
   */
  setupComplete?: boolean;
};

/** Why an owner-sync write was sent; see `ownerSyncReason` on the payload. */
export type RegistryOwnerSyncReason = 'transfer' | 'drift';

const API_URL = import.meta.env.VITE_REGISTRY_API_URL;
const API_KEY = import.meta.env.VITE_REGISTRY_API_KEY;

async function request(
  method: string,
  familyId: string,
  body?: object,
  query?: Record<string, string>
): Promise<Response> {
  // Built with `URLSearchParams` rather than string concatenation so a value can
  // never terminate the path, and so `familyId` keeps meaning only the family id.
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const res = await fetch(`${API_URL}/family/${familyId}${qs}`, {
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
 * The observers of every successful registry GET. `entitlementStore` (#95)
 * reads the entitlement block and `counterWritesPolicy` (#117) reads
 * `dataPolicy`, so both ride the lookups `syncStore` already makes (four call
 * sites, all funnelled through `lookupFamilyResult`) without `syncStore`
 * knowing either exists. The same inversion as `setLocalChangeHandler` in
 * `docClient.ts`: this module imports no store.
 */
type RegistryEntryObserver = (entry: RegistryEntry) => void;
const registryEntryObservers = new Set<RegistryEntryObserver>();

/**
 * Add an observer of every `found` lookup. Returns its remover; adding the
 * same function twice registers it once.
 */
export function addRegistryEntryObserver(fn: RegistryEntryObserver): () => void {
  registryEntryObservers.add(fn);
  return () => {
    registryEntryObservers.delete(fn);
  };
}

/**
 * Hand a found entry to every observer. An observer that throws must never
 * turn a successful lookup into a failed one, nor keep the entry from the
 * observers after it: the canonical-pod check and recovery-from-registry depend
 * on this answer, entitlement and the Counter policy do not.
 */
function notifyObserver(entry: RegistryEntry): void {
  for (const observer of registryEntryObservers) {
    try {
      observer(entry);
    } catch (err) {
      console.warn('[registry] entry observer threw; the lookup result is unaffected', err);
      logEvent({
        level: 'warn',
        surface: 'registry',
        message: 'registry entry observer threw',
        context: { action: 'observer_failed' },
        error: err,
      });
    }
  }
}

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
    const entry = (await res.json()) as RegistryEntry;
    notifyObserver(entry);
    return { status: 'found', entry };
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
    // ⚠️ COUNTED, EVEN THOUGH IT IS SWALLOWED BY DESIGN. This is the write every
    // background sync, country change and Drive connect makes, and its failure
    // was console-only — so "the registry is rejecting our writes" was invisible
    // fleet-wide, and the investigation had to reconstruct it from Lambda logs.
    // Swallowing the failure for the CALLER is the contract; hiding it from the
    // firehose was never part of it.
    // An owner-sync write gets its own action, so the ambient `put-failed` rate
    // stays a rate of ambient writes and a failed ownership repair is greppable.
    const ownerSync = entry.ownerSync === true;
    logEvent({
      level: 'warn',
      surface: 'registry',
      message: ownerSync
        ? 'owner sync register failed — registry unavailable'
        : 'family register failed — registry unavailable',
      context: { action: ownerSync ? 'owner-sync-put-failed' : 'put-failed' },
      error: err,
    });
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
  const result = parseWriteResult(await res.json().catch(() => ({})));

  // ⚠️ NOT FOR AN `ownerSync` WRITE. `registryOwnerSync` logs that write's own
  // outcome, and it is ownership-only: it never
  // asks to move the pointer, so a no-op `pointerAccepted: false` on it (a
  // tombstoned row) is not a refused re-point. Counting it here would inflate the
  // ambient `put` rate and the `refused` ratio below with a write that is neither.
  if (entry.ownerSync === true) return result;

  // The success path too, and deliberately: a counter that only fires on failure
  // cannot give you a RATE. `count` says where the owner fields came from — 1
  // from the pod roster, 0 when no roster owner was resolvable and the fields
  // were left for the server to preserve. Once the roster-sourced owner is in
  // the field, a `count: 0` that stays high means devices are writing before the
  // document is loaded, which is the thing worth knowing.
  logEvent({
    level: 'info',
    surface: 'registry',
    message: 'family registered',
    context: { action: 'put', count: entry.ownerMemberId ? 1 : 0 },
  });

  if (!result.pointerAccepted) {
    // Boring for a member device — every one of them sends pointer fields on
    // every login because the payload is uniform — and DATA AT RISK when the
    // caller meant to re-point. The caller distinguishes those two; this counts
    // both, so the ratio is visible. It should fall to near zero for owner
    // devices once the owner fields come from the roster.
    logEvent({
      level: 'warn',
      surface: 'registry',
      message: 'registry refused the canonical pointer',
      context: { action: 'refused' },
    });
  }

  return result;
}

/**
 * Parse a PUT response into a `RegistryWriteResult`. Every field but `pointerAccepted`
 * is ADDITIVE: a value that is absent or not the expected shape is left out of the
 * result rather than guessed at, so an older Lambda (or a write that does not return
 * the field) produces exactly the result it always did.
 */
export function parseWriteResult(raw: unknown): RegistryWriteResult {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // ABSENT MEANS ACCEPTED. A self-hoster on an older Lambda — and the prod window
  // between the server hotfix and the client shipping — must not generate false
  // `critical` reports. Only an explicit `false` is a refusal.
  const result: RegistryWriteResult = { pointerAccepted: r.pointerAccepted !== false };
  const owner = parseOwner(r.owner);
  if (owner) result.owner = owner;
  if (typeof r.outcome === 'string' && r.outcome) result.outcome = r.outcome;
  if (r.signupStart === 'created' || r.signupStart === 'exists' || r.signupStart === 'refused') {
    result.signupStart = r.signupStart;
  }
  // A two-letter code or an explicit null (the zone mapped to no country). Anything else
  // never reaches a Slack line.
  if (r.deviceCountry === null) result.deviceCountry = null;
  else if (typeof r.deviceCountry === 'string' && /^[A-Z]{2}$/.test(r.deviceCountry)) {
    result.deviceCountry = r.deviceCountry;
  }
  const inferred = parseInferredAttribution(r.attributionInferred);
  if (inferred !== undefined) result.attributionInferred = inferred;
  return result;
}

/**
 * The `attributionInferred` block of a PUT response: `null` when the Lambda scored
 * nothing, `undefined` (absent) when the field is missing or malformed. Only the
 * band and string-valued fields are kept; the rest of the stored value is ops data.
 */
function parseInferredAttribution(raw: unknown): RegistryInferredAttribution | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const { band, fields } = raw as { band?: unknown; fields?: unknown };
  if (band !== 'high' && band !== 'medium' && band !== 'low') return undefined;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const entries = Object.entries(fields as Record<string, unknown>);
  if (!entries.every(([, v]) => typeof v === 'string')) return undefined;
  return { band, fields: Object.fromEntries(entries) as Record<string, string> };
}

/** The `registry` `signup-start` log detail for a step-1 write (#125). */
export type SignupStartDetail = 'created' | 'exists' | 'refused' | 'unsupported' | 'failed';

/**
 * Map a step-1 write's result to its log detail. `null` is a transport failure
 * (`registerFamily` swallowed it and logged `put-failed`). A result without
 * `signupStart` means the Lambda predates #125 and wrote an ordinary first row
 * (pointer and `createdAt` at step 1): that is the deploy-order tripwire.
 */
export function signupStartDetail(result: RegistryWriteResult | null): SignupStartDetail {
  if (!result) return 'failed';
  return result.signupStart ?? 'unsupported';
}

/**
 * The `owner` block of a PUT response, or `undefined` when it is absent or not the
 * expected shape (an older Lambda, a non-`ownerSync` write). A malformed block is
 * treated as absent rather than compared against.
 */
function parseOwner(raw: unknown): RegistryWriteResult['owner'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const { memberId, email } = raw as { memberId?: unknown; email?: unknown };
  const str = (v: unknown): string | null | undefined =>
    typeof v === 'string' ? v : v === null || v === undefined ? null : undefined;
  const id = str(memberId);
  const mail = str(email);
  if (id === undefined || mail === undefined) return undefined;
  return { memberId: id, email: mail };
}

/**
 * Remove a family from the registry. Returns whether the row is actually gone.
 *
 * ⚠️ ONLY the owner-gated full-family deletion may call this. It removes the
 * SHARED row for the whole family, not anything device-local. Until 2026-09-08
 * `familyContext.deleteLocalFamily` called it too, so "Delete Local Family Data"
 * on the login picker — whose own confirm copy promises "The original file is not
 * affected" — deleted the family's registry row, and the next write from any
 * member recreated it with that member stamped as the owner. That is how greg's
 * pod reported a new owner it never had.
 *
 * ⚠️ NO LONGER FIRE-AND-FORGET. The response used to be discarded entirely, so a
 * non-2xx was perfectly silent; the caller told the user their data was gone
 * while the row sat there. It returns a boolean now and the caller must surface a
 * false. `features.registry` off returns true: there is no row to remove, so
 * nothing failed.
 *
 * `opts.neverFinishedOnly` (#125, "Start over" on the resume-setup screen): tombstone the
 * row only if it is a step-1 row no pod was ever created for. The Lambda decides from the
 * stored row and leaves a real pod untouched, so the client never has to judge it.
 */
export async function removeFamily(
  familyId: string,
  writerMemberId: string | null,
  opts: { neverFinishedOnly?: boolean } = {}
): Promise<boolean> {
  if (!features.registry) return true;

  try {
    // A QUERY PARAMETER, not a body. A body on DELETE is legal and is dropped by
    // enough intermediaries to be a bad bet. The server validates it as a UUID,
    // logs a mismatch, and in this release still performs the delete — that warn
    // is the measurement that decides when it may start refusing.
    const query: Record<string, string> = {};
    if (writerMemberId) query.writerMemberId = writerMemberId;
    if (opts.neverFinishedOnly) query.neverFinishedOnly = '1';
    const res = await request(
      'DELETE',
      familyId,
      undefined,
      Object.keys(query).length ? query : undefined
    );
    if (!res.ok) {
      console.warn(`[registry] removeFamily refused — HTTP ${res.status}`);
      logEvent({
        level: 'warn',
        surface: 'registry',
        message: 'family delete refused',
        context: { action: 'delete-failed', http_status: res.status },
      });
      return false;
    }
    logEvent({
      level: 'info',
      surface: 'registry',
      message: 'family removed from registry',
      context: { action: 'delete' },
    });
    return true;
  } catch (err) {
    console.warn('[registry] removeFamily failed — registry unavailable', err);
    logEvent({
      level: 'warn',
      surface: 'registry',
      message: 'family delete threw',
      context: { action: 'delete-failed' },
      error: err,
    });
    return false;
  }
}
