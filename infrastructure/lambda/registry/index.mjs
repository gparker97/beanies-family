/* global process */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({});
const PROD_TABLE = process.env.TABLE_NAME;
const DEV_TABLE = process.env.DEV_TABLE_NAME || PROD_TABLE; // safe fallback
const API_KEY = process.env.REGISTRY_API_KEY;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim());
const DEV_ORIGINS = new Set(
  (process.env.DEV_ORIGINS || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

/**
 * Pick the DynamoDB table based on the request Origin. Localhost origins
 * write to the dev table; everything else writes to prod. Unknown origins
 * default to prod for safety — but they would also fail CORS upstream so
 * in practice only allowlisted origins ever reach the Lambda body.
 */
function tableForOrigin(origin) {
  return origin && DEV_ORIGINS.has(origin) ? DEV_TABLE : PROD_TABLE;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  };
}

function response(statusCode, body, event) {
  return { statusCode, headers: getHeaders(event), body: JSON.stringify(body) };
}

/**
 * The only accepted `signupPlatform` values — the `getPlatform()` vocabulary the
 * client and Plausible both use (`src/services/sync/capabilities.ts`), NOT the
 * coarse `'app' | 'pwa' | 'web'` bucket in `src/utils/platformLabel.ts`.
 *
 * Guarded because this field is client-supplied AND permanent: an unvalidated
 * value is stamped once and then preserved forever by the write-once merge
 * below, so no later write could correct it.
 */
const SIGNUP_PLATFORMS = new Set(['web', 'ios', 'android']);

const validPlatform = (v) => (SIGNUP_PLATFORMS.has(v) ? v : null);

export async function handler(event) {
  // API key check
  const key = event.headers?.['x-api-key'];
  if (key !== API_KEY) {
    return response(401, { error: 'Unauthorized' }, event);
  }

  const familyId = event.pathParameters?.familyId;
  if (!familyId || !UUID_RE.test(familyId)) {
    return response(400, { error: 'Invalid familyId — must be a UUID' }, event);
  }

  const method = event.requestContext?.http?.method;
  const tableName = tableForOrigin(event.headers?.origin);

  try {
    if (method === 'GET') {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
        })
      );
      if (!Item) return response(404, { error: 'Family not found' }, event);
      return response(200, unmarshall(Item), event);
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();
      const today = now.slice(0, 10); // YYYY-MM-DD — date-only login stamp

      // Read existing row to preserve write-once fields (createdAt, ownerEmail,
      // subscribeNewsletter). registerFamily() fires on every sync-config change,
      // so only the first write should stamp these.
      const { Item: existingRaw } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
        })
      );
      const existing = existingRaw ? unmarshall(existingRaw) : {};

      // ─── Canonical-pointer guard (2026-08-10) ────────────────────────────
      //
      // Only the family's registered owner may move the canonical pointer
      // (provider / fileId / displayPath). Members still write activity and
      // metadata (lastLoginAt, country, beanpodSizeKb, familyName) — those are
      // per-family facts any device can report. The pointer is not.
      //
      // This lives here, not in the client, because the client cannot close the
      // hole: the propagation vector is ALREADY DEPLOYED. Native and cached web
      // builds running the pre-fix code keep sending pointer writes for as long
      // as they run, and a client-side guard protects only devices that already
      // took the fix — i.e. not the ones causing the damage. A curl gets the same
      // answer here too. See docs/plans/2026-08-10-never-fork-a-family-pod.md §5.
      //
      // AUTHORITY IS `ownerMemberId`, NOT `ownerEmail`.
      //
      // `ownerEmail` was added (2026-04-12) as an ops/contact capture, alongside
      // the newsletter opt-in — "who do we email about this family". It is the
      // signed-in member's PROFILE email, which the user can edit in the app. Using
      // it as the permission check would mean an owner who edits their own email
      // sends a new address on their next write, gets refused, and — because the
      // field is write-once — has no way back. `memberId` is a stable UUID from the
      // family document and survives any profile edit, so it is the real identity.
      //
      // Three tiers, in order:
      //   1. Row has ownerMemberId  -> compare memberId. The normal path.
      //   2. Row has only ownerEmail (registered between 2026-04-12 and this
      //      change) -> compare email, and stamp ownerMemberId on the way through
      //      so the row upgrades itself the first time its owner writes.
      //   3. Row has neither (pre-2026-04-12, dormant since) -> fall open, exactly
      //      as today, and stamp both.
      const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : null);
      const isOwner = existing.ownerMemberId
        ? body.ownerMemberId === existing.ownerMemberId
        : !existing.ownerEmail ||
          (!!normEmail(body.ownerEmail) &&
            normEmail(body.ownerEmail) === normEmail(existing.ownerEmail));

      // A write that would not CHANGE the pointer is a no-op, not a refusal.
      // This matters: the common case is a member device re-picking the family's
      // correct file, or simply logging in and echoing the pointer back. Reporting
      // those as refused would page the team every time a member recovers normally,
      // and would drown the one signal that means something — a device actually
      // trying to MOVE the family's pointer somewhere it shouldn't.
      const samePointer =
        (body.provider || 'local') === (existing.provider || 'local') &&
        (body.fileId || null) === (existing.fileId ?? null) &&
        (body.displayPath || null) === (existing.displayPath ?? null);

      const pointerAccepted = isOwner || samePointer;

      if (!pointerAccepted) {
        // Domains + id tails only — never full member emails or ids in CloudWatch.
        console.warn(
          '[registry] pointer write refused',
          familyId,
          String(existing.ownerEmail).split('@')[1],
          String(body.ownerEmail).split('@')[1],
          String(existing.ownerMemberId ?? '').slice(-6),
          String(body.ownerMemberId ?? '').slice(-6)
        );
      }

      const item = {
        familyId,
        provider: pointerAccepted ? body.provider || 'local' : existing.provider || 'local',
        fileId: pointerAccepted ? body.fileId || null : (existing.fileId ?? null),
        displayPath: pointerAccepted ? body.displayPath || null : (existing.displayPath ?? null),
        // Preserve-on-omit (2026-08-10): an omitted name previously nulled a
        // stored one. Same semantics as country/subscribeNewsletter below.
        familyName: body.familyName || existing.familyName || null,
        createdAt: existing.createdAt || now,
        // Write-once. Previously `body.ownerEmail ?? existing.ownerEmail` let the
        // last writer win, so a member device could take over the row. This stays
        // an ops/contact field (see the guard above) but is also the LEGACY
        // authority for rows registered before `ownerMemberId` existed, so it must
        // be stable either way.
        ownerEmail: existing.ownerEmail ?? body.ownerEmail ?? null,
        // Write-once, and the real pointer authority. Stamped on a row's first
        // accepted write — including the first write by the owner of a legacy
        // email-only row, which upgrades that row off the mutable email.
        ownerMemberId:
          existing.ownerMemberId ?? (pointerAccepted ? body.ownerMemberId : null) ?? null,
        subscribeNewsletter:
          typeof body.subscribeNewsletter === 'boolean'
            ? body.subscribeNewsletter
            : (existing.subscribeNewsletter ?? null),
        // Same preserved-merge semantics as subscribeNewsletter: a write that
        // omits `country` (older client, member device without the local
        // setting) preserves the existing value. A `null` body.country also
        // preserves — clearing country is a deliberate ops action, not a side
        // effect of registering.
        country: typeof body.country === 'string' ? body.country : (existing.country ?? null),
        // Usage signals (metadata, never content). Same preserve-on-omit
        // semantics as country/subscribeNewsletter above.
        //
        // lastLoginAt: server-stamped (never client-supplied — no clock trust)
        // and moved ONLY when the client marks a genuine login/resume via the
        // transient `isLoginEvent` flag. Every other PUT (country change, Drive
        // connect, background sync) preserves it, so it stays a clean activity
        // signal distinct from `updatedAt`. `isLoginEvent` itself is never stored.
        lastLoginAt: body.isLoginEvent === true ? today : (existing.lastLoginAt ?? null),
        // beanpodSizeKb: client-rounded approximate .beanpod size. Number-guarded
        // so a malformed/negative value is ignored (preserve existing), never fatal.
        beanpodSizeKb:
          typeof body.beanpodSizeKb === 'number' && body.beanpodSizeKb >= 0
            ? Math.round(body.beanpodSizeKb)
            : (existing.beanpodSizeKb ?? null),
        // memberCount: how many members the family roster holds — a bare integer
        // for analytics (total users across families), never names or ids. Sent
        // by clients from the decrypted in-memory roster (the unencrypted
        // envelope would undercount: unclaimed beans carry no wrappedKey).
        // Same guarded preserve-on-omit idiom as beanpodSizeKb; refreshes on
        // every write so it tracks the roster as families grow.
        memberCount:
          typeof body.memberCount === 'number' && body.memberCount >= 1
            ? Math.round(body.memberCount)
            : (existing.memberCount ?? null),
        // Which platform the family signed up ON. Two independent conditions, and
        // BOTH are load-bearing:
        //
        //   1. `existing.signupPlatform ??` — never move a value already stamped.
        //      Note this is NOT the plain `existing.x ?? body.x` write-once idiom
        //      by itself: that alone would stamp every row created before this
        //      shipped with whichever device wrote next, relabelling a family
        //      created on iOS as `web` the first time its owner opened a browser.
        //   2. `body.isSignupEvent` — only a genuine family-creation write may
        //      stamp at all. Row EXISTENCE is NOT a usable proxy for "this is a
        //      signup": `syncStore.disconnect()` DELETES the row (an ordinary
        //      Settings action, fire-and-forget), so an iOS family whose owner
        //      later disconnects and reconnects from a browser would come back
        //      through the create branch and be permanently relabelled `web`.
        //
        // Together: absent stays absent, and absent means UNKNOWN — excluded from
        // platform breakdowns, never assumed web. A pod creation whose registry
        // write fails (offline) simply leaves the field unknown rather than
        // letting some later device's platform stand in for it.
        //
        // Residual, accepted: the Put is unconditioned (as are the other six merge
        // idioms here), so two concurrent first writes could race. Only the single
        // pod-creation call site sends `isSignupEvent`, which makes the window
        // very small, and the cost of losing it is one coarse label. Adding a
        // ConditionExpression means reworking every merge idiom in a component
        // that deploys on its own cadence — deliberately not done here.
        signupPlatform:
          existing.signupPlatform ??
          (body.isSignupEvent === true ? validPlatform(body.signupPlatform) : null),
        updatedAt: now,
      };
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
      // `pointerAccepted` lets the client distinguish a refused DELIBERATE
      // re-point (data at risk — the registry now disagrees with where the pod
      // actually is) from the boring ambient case (every member device sends
      // pointer fields on every login because the payload is uniform). Clients
      // that predate this field treat its absence as accepted.
      return response(200, { success: true, pointerAccepted }, event);
    }

    if (method === 'DELETE') {
      await client.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
        })
      );
      return response(200, { success: true }, event);
    }

    return response(405, { error: 'Method not allowed' }, event);
  } catch (err) {
    console.error('Registry error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}
