/* global process */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
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
          // Strongly consistent. An eventually-consistent read can miss a row
          // written moments ago, and a client told "absent" for a family that
          // does exist takes a recovery path it had no business taking.
          ConsistentRead: true,
        })
      );
      if (!Item) return response(404, { error: 'Family not found' }, event);
      const row = unmarshall(Item);
      // A tombstoned row is GONE as far as every client is concerned. Its
      // identity attributes survive so a later PUT can restore them (see the
      // DELETE arm); that is bookkeeping, not a live family.
      if (row.deletedAt) return response(404, { error: 'Family not found' }, event);
      return response(200, row, event);
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
          // Strongly consistent, and this one is load-bearing: the result feeds a
          // full-row PutItem, so a stale miss does not merely read wrong — it
          // CLOBBERS every write-once field (createdAt, ownerMemberId,
          // ownerEmail, signupPlatform) with the defaults below.
          ConsistentRead: true,
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

      // ─── WHO IS WRITING, vs who the row says OWNS the family ───────────────
      //
      // Until 2026-09-09 these were one field. The client sent the signed-in
      // member's id AS `ownerMemberId`, so "the owner is whoever is writing" was
      // baked into the wire format, and a member device writing to a row the
      // registry had just lost stamped itself owner. `ownerMemberId` now means
      // the OWNER FROM THE POD ROSTER and `writerMemberId` means this device's
      // signed-in member; the guard asks the second and protects the first.
      //
      // The fallback is presence-based, NOT `??`, and the distinction is the
      // whole point:
      //
      //   - Field ABSENT  => a client that predates the split. It is sending its
      //     own session id as `ownerMemberId`, which is exactly the value the
      //     old guard compared, so judging it on that keeps it working. Without
      //     this, deploying the guard refuses the pointer for the whole fleet at
      //     once.
      //   - Field PRESENT but null => a current client with NO signed-in member.
      //     `??` would fall back to `ownerMemberId` — the roster owner, a value
      //     any device holding the decrypted pod can compute — and hand the
      //     guard's own answer to an unauthenticated writer. Presence keeps that
      //     shut: no writer id, no pointer move.
      //
      // Remove the fallback only once no pre-split client is in the field.
      const writerMemberId = 'writerMemberId' in body ? body.writerMemberId : body.ownerMemberId;

      // ⚠️ TIER 2 NEEDS THE SAME SPLIT, and missing it opened a hole rather than
      // closing one. The email arm below is the LEGACY authority for rows
      // registered between 2026-04-12 and 2026-08-10, which have `ownerEmail` and
      // no `ownerMemberId`. It used to compare the SIGNED-IN member's email,
      // because that is what the client sent — so a member device sent its own
      // address and was refused.
      //
      // Once `ownerEmail` started coming from the pod roster, every device sent
      // the OWNER'S address, which of course matches: the arm would have accepted
      // a pointer move from any member on every legacy row, which is the exact
      // family-fork the guard exists to prevent, reported as `pointerAccepted:
      // true` so nothing pages. Same presence rule as the id above.
      const writerEmail = 'writerEmail' in body ? body.writerEmail : body.ownerEmail;

      const isOwner = existing.ownerMemberId
        ? writerMemberId === existing.ownerMemberId
        : !existing.ownerEmail ||
          (!!normEmail(writerEmail) && normEmail(writerEmail) === normEmail(existing.ownerEmail));

      // ─── A DELETED FAMILY IS NOT WRITEABLE EXCEPT BY ITS OWNER ────────────
      //
      // ⚠️ THIS GUARD IS `isOwner`, NOT `pointerAccepted`, AND THE FIRST CUT GOT
      // THAT WRONG IN A WAY THAT LOOKED RIGHT. `pointerAccepted` is
      // `isOwner || samePointer`, and `samePointer` is VACUOUSLY TRUE against a
      // tombstone: the DELETE arm deliberately drops `provider`/`fileId`/
      // `displayPath`, so a device that sends a null pointer — a cold boot, an
      // evicted provider config, an `ensureRegistered` mid-boot — compares
      // 'local' to 'local' and null to null, matches, and lifts the tombstone.
      // The family came back LIVE pointing at nothing.
      //
      // ⚠️ AND IT RETURNS RATHER THAN MERGING. Preserving only `deletedAt` was
      // not enough either: the same `PutItem` re-stamps `familyName`,
      // `subscribeNewsletter`, `country`, `memberCount`, `beanpodSizeKb` and, on
      // a login, `lastLoginAt: today` — every field the DELETE arm dropped ON
      // PURPOSE, because they are family content, a marketing consent, and
      // activity signals that would keep a deleted family alive in the metrics.
      // A member's ordinary background register would have resurrected the
      // deleted family's NAME and its newsletter opt-in, invisibly, because GET
      // still 404s.
      //
      // So: nothing to merge, nothing to write. The family is deleted, and the
      // caller gets the same success a write to a deleted row has always got.
      //
      // ⚠️ AND `isOwner` ALONE IS NOT ENOUGH, because its third tier FALLS OPEN.
      // `isOwner` is `existing.ownerMemberId ? … : !existing.ownerEmail || …`, so
      // a row with NEITHER owner field answers true for every writer. That is the
      // right default for a live legacy row and catastrophic for a deleted one:
      // any device revived the family AND took the write-once owner field, which
      // has no route back. Such tombstones are reachable — the client sends both
      // owner fields null when the roster is not loaded (a background write
      // mid-boot), which is the very path this guard's trigger names.
      const ownerKnown = !!existing.ownerMemberId || !!existing.ownerEmail;
      if (existing.deletedAt && !(ownerKnown && isOwner)) {
        // Rule 1: a security-relevant branch says why. Without this the rate of
        // devices writing to deleted families is unobservable — which is exactly
        // the signal that would have caught the resurrection this branch fixes.
        // Masked to tails, like the pointer-refusal warn it returns above.
        console.warn(
          '[registry] write to a deleted family refused',
          familyId,
          ownerKnown ? 'owner-known' : 'no-recorded-owner',
          String(writerMemberId ?? '').slice(-6) || 'no-writer-id'
        );
        return response(200, { success: true, pointerAccepted: false }, event);
      }

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
          String(writerEmail).split('@')[1],
          String(existing.ownerMemberId ?? '').slice(-6),
          String(writerMemberId ?? '').slice(-6)
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
        // ⚠️ `|| null` ON THE BODY, because this field is WRITE-ONCE and `''` is
        // not nullish. An empty string from any client — deployed ones included,
        // which is why the guard is here and not only in the client — would latch
        // permanently, and the legacy pointer tier reads `!existing.ownerEmail`
        // as TRUE, falling open for every writer on that row forever.
        ownerEmail: existing.ownerEmail ?? (body.ownerEmail || null) ?? null,
        // Write-once, and the real pointer authority. Stamped on a row's first
        // accepted write — including the first write by the owner of a legacy
        // email-only row, which upgrades that row off the mutable email.
        // ⚠️ `isOwner`, NOT `pointerAccepted`. This is a WRITE-ONCE field, so a
        // wrong value is permanent and there is no in-app route back. Gating it
        // on `pointerAccepted` let `samePointer` do the stamping: every member
        // device echoes the family's real pointer on every login, so on a legacy
        // (email-only) row a member running a still-deployed PRE-SPLIT client —
        // which sends its own id as `ownerMemberId` — matched on the pointer and
        // stamped ITSELF as the family's permanent registry owner. The real owner
        // then fails tier 1 forever and every deliberate re-point pages Slack.
        //
        // The tier-2 comment above already says what this should be: stamp "the
        // first time its OWNER writes".
        ownerMemberId:
          existing.ownerMemberId ?? (isOwner ? body.ownerMemberId || null : null) ?? null,
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
        //      signup". This used to cite `syncStore.disconnect()`, which dropped
        //      the row outright from an ordinary Settings action; that function is
        //      deleted and the DELETE arm below tombstones rather than drops, so a
        //      deleted-then-recreated family now comes back with its original
        //      stamp. The flag stays anyway: the guarantee must not rest on which
        //      callers happen to exist this week, and a row can still be removed
        //      by hand in ops.
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
        // No `deletedAt` here, deliberately: `PutItem` replaces the whole item,
        // so reaching this point at all IS the revival. Only the owner reaches
        // it — every other writer returned above with the family still deleted.
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
      // ─── TOMBSTONE, NOT A DROP (2026-09-09) ──────────────────────────────
      //
      // A hard delete lost `createdAt`, `ownerMemberId`, `ownerEmail`, `country`
      // and `signupPlatform` irrecoverably, and the next write from ANY member
      // device recreated the row from scratch with that member stamped as the
      // owner. That is how greg's pod reported an owner it never had. See
      // docs/investigations/2026-09-08-compaction-fallout.md items 3 + 8.
      //
      // Keeping the identity attributes makes that loss structurally impossible:
      // a re-registration restores the row the family had rather than inventing
      // a new one. The client-side fix (a per-device action no longer issues a
      // DELETE at all) closes the door that was actually used; this closes the
      // room, because the investigation could not fully identify the trigger and
      // defence in depth is the whole design here.
      const { Item: existingRaw } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ familyId }),
          ConsistentRead: true,
        })
      );
      const existing = existingRaw ? unmarshall(existingRaw) : null;

      // Nothing to tombstone. Writing a bare `deletedAt` row for a family that
      // never registered would manufacture junk every reader then has to filter,
      // so report the same idempotent success the hard delete gave.
      if (!existing) return response(200, { success: true }, event);

      // ─── DELETE ladder, step 1 of 2: MEASURE, DO NOT ENFORCE ─────────────
      //
      // NOT AUTHORIZATION, and it must not later be mistaken for it. The API key
      // ships inside the client bundle, so a curl gets the same answer here that
      // the app does — exactly as the pointer guard above already concedes. This
      // defends a family against the APP'S OWN BUGS, which is the failure that
      // actually happened, and against nothing else.
      //
      // The delete still proceeds. This warn IS the measurement that decides when
      // the 403 can ship: every client deployed before the writer id goes on the
      // wire sends none at all and would be refused on day one, including the
      // Playwright teardown hook. Enforce only once this line is quiet for real
      // families for a full release cycle.
      const writerMemberId = event.queryStringParameters?.writerMemberId;
      const writerValid = typeof writerMemberId === 'string' && UUID_RE.test(writerMemberId);
      const deleteAuthorized =
        writerValid && !!existing.ownerMemberId && writerMemberId === existing.ownerMemberId;

      if (!deleteAuthorized) {
        // Id TAILS only — never a full member id in CloudWatch, matching the
        // masking the pointer-refusal warn above already uses.
        console.warn(
          '[registry] delete would be refused',
          familyId,
          writerValid ? String(writerMemberId).slice(-6) : 'no-writer-id',
          String(existing.ownerMemberId ?? '').slice(-6) || 'no-owner'
        );
      }

      const deletedNow = new Date().toISOString();
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: marshall(
            {
              familyId,
              // Identity and provenance survive so a restore is a restore.
              createdAt: existing.createdAt ?? null,
              ownerMemberId: existing.ownerMemberId ?? null,
              ownerEmail: existing.ownerEmail ?? null,
              country: existing.country ?? null,
              signupPlatform: existing.signupPlatform ?? null,
              // Everything else is deliberately DROPPED, and the omissions are
              // decisions: the canonical pointer (a stale pointer is worse than
              // none), the activity signals and roster size (they would keep a
              // deleted family alive in the metrics), and `familyName` +
              // `subscribeNewsletter` (family content and a marketing consent —
              // the user asked for this family to be gone).
              deletedAt: deletedNow,
              // Ops hygiene: every other row carries one, and a tombstone with
              // no `updatedAt` is invisible to a "what changed recently" scan.
              updatedAt: deletedNow,
            },
            { removeUndefinedValues: true }
          ),
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
