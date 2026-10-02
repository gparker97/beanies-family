/* global process */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// --- Mock the DynamoDB client (keep util-dynamodb's marshall/unmarshall real) ---
const sendMock = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => {
  class Command {
    constructor(input) {
      this.input = input;
    }
  }
  return {
    DynamoDBClient: class DynamoDBClient {
      send(command) {
        return sendMock(command);
      }
    },
    GetItemCommand: class GetItemCommand extends Command {},
    PutItemCommand: class PutItemCommand extends Command {},
    DeleteItemCommand: class DeleteItemCommand extends Command {},
  };
});

const API_KEY = 'test-key';
const FAMILY_ID = '11111111-2222-4333-8444-555555555555';
const BILLING_TABLE = 'billing-prod';

let handler;

/**
 * Every live-row GET logs the `entitlement_computed` soak line (with no billing env it still
 * computes `beta` and logs). Silence it for the whole file; the entitlement block asserts on it
 * through this spy, which is fresh per test.
 */
let logSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

beforeAll(async () => {
  process.env.TABLE_NAME = 'registry-prod';
  process.env.DEV_TABLE_NAME = 'registry-dev';
  process.env.REGISTRY_API_KEY = API_KEY;
  process.env.CORS_ORIGIN = 'https://app.beanies.family';
  process.env.DEV_ORIGINS = 'http://localhost:5173';
  ({ handler } = await import('./index.mjs'));
});

/**
 * Drive a PUT through the handler. `existing` is the row already in the table
 * (null = first write). Returns the unmarshalled Item the handler tried to Put.
 */
async function put(body, existing = null) {
  sendMock.mockReset();
  sendMock.mockImplementation((command) => {
    const kind = command.constructor.name;
    if (kind === 'GetItemCommand') {
      return Promise.resolve({ Item: existing ? marshall(existing) : undefined });
    }
    // PutItemCommand / DeleteItemCommand
    return Promise.resolve({});
  });

  const res = await handler({
    headers: { 'x-api-key': API_KEY, origin: 'https://app.beanies.family' },
    pathParameters: { familyId: FAMILY_ID },
    requestContext: { http: { method: 'PUT' } },
    body: JSON.stringify(body),
  });

  const putCall = sendMock.mock.calls.find((c) => c[0].constructor.name === 'PutItemCommand');
  const item = putCall ? unmarshall(putCall[0].input.Item) : null;
  return { res, item };
}

describe('registry PUT — lastLoginAt (server-stamped, login-gated)', () => {
  beforeEach(() => vi.useRealTimers());

  it('stamps today (date-only) when isLoginEvent is true', async () => {
    const { res, item } = await put({ provider: 'local', isLoginEvent: true });
    expect(res.statusCode).toBe(200);
    expect(item.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // date-only slice of the same clock read that stamps updatedAt
    expect(item.lastLoginAt).toBe(item.updatedAt.slice(0, 10));
  });

  it('preserves the existing lastLoginAt when isLoginEvent is false', async () => {
    const { item } = await put(
      { provider: 'local', isLoginEvent: false },
      { createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-06-01' }
    );
    expect(item.lastLoginAt).toBe('2026-06-01');
  });

  it('preserves the existing lastLoginAt when isLoginEvent is omitted (older client)', async () => {
    const { item } = await put({ provider: 'local' }, { lastLoginAt: '2026-05-05' });
    expect(item.lastLoginAt).toBe('2026-05-05');
  });

  it('yields null lastLoginAt for a non-login first write with no prior row', async () => {
    const { item } = await put({ provider: 'local' });
    expect(item.lastLoginAt).toBeNull();
  });

  it('never persists the transient isLoginEvent flag', async () => {
    const { item } = await put({ provider: 'local', isLoginEvent: true });
    expect(item).not.toHaveProperty('isLoginEvent');
  });
});

describe('registry PUT — signupPlatform (stamped at row creation, never moved)', () => {
  it('stamps the platform on a genuine signup write', async () => {
    const { res, item } = await put({
      provider: 'local',
      signupPlatform: 'ios',
      isSignupEvent: true,
    });
    expect(res.statusCode).toBe(200);
    expect(item.signupPlatform).toBe('ios');
  });

  it('does NOT stamp a first write that is not a signup', async () => {
    // The disconnect/reconnect hole: `syncStore.disconnect()` DELETES the row,
    // so an ordinary reconnect arrives with no prior row. Row existence is
    // therefore not a usable proxy for "this is a signup".
    const { item } = await put({ provider: 'local', signupPlatform: 'web' });
    expect(item.signupPlatform).toBeNull();
  });

  it('never relabels an iOS family that reconnects from a browser after a disconnect', async () => {
    // Full sequence: created on iOS, row deleted by disconnect, reconnected from
    // the web. Even if that reconnect claimed to be a signup, there is no stored
    // value to preserve — so the honest outcome is UNKNOWN, never `web`.
    const { item } = await put({ provider: 'google_drive', signupPlatform: 'web' });
    expect(item.signupPlatform).toBeNull();
  });

  it('does NOT move when a later write comes from a different platform', async () => {
    const { item } = await put(
      { provider: 'local', signupPlatform: 'web' },
      { createdAt: '2026-01-01T00:00:00.000Z', signupPlatform: 'ios' }
    );
    expect(item.signupPlatform).toBe('ios');
  });

  it('does NOT move even if a later write claims to be a signup', async () => {
    const { item } = await put(
      { provider: 'local', signupPlatform: 'web', isSignupEvent: true },
      { createdAt: '2026-01-01T00:00:00.000Z', signupPlatform: 'android' }
    );
    expect(item.signupPlatform).toBe('android');
  });

  it('never stamps a PRE-EXISTING row retroactively', async () => {
    // The regression this field's `existingRaw` keying exists to prevent: every
    // row created before this shipped has no signupPlatform, and the ordinary
    // `existing.x ?? body.x` write-once idiom would relabel each one with
    // whichever device wrote next. Absent must stay absent (= unknown).
    const { item } = await put(
      { provider: 'local', signupPlatform: 'web' },
      { createdAt: '2026-06-01T00:00:00.000Z', ownerEmail: 'a@b.com' }
    );
    expect(item.signupPlatform).toBeNull();
  });

  it('rejects a value outside the vocabulary (permanent field, so it is guarded)', async () => {
    const { res, item } = await put({
      provider: 'local',
      signupPlatform: 'windows-phone',
      isSignupEvent: true,
    });
    expect(res.statusCode).toBe(200);
    expect(item.signupPlatform).toBeNull();
  });

  it('rejects a non-string value', async () => {
    const { item } = await put({
      provider: 'local',
      signupPlatform: { evil: true },
      isSignupEvent: true,
    });
    expect(item.signupPlatform).toBeNull();
  });

  it('yields null when an older client omits it entirely', async () => {
    const { item } = await put({ provider: 'local', isSignupEvent: true });
    expect(item.signupPlatform).toBeNull();
  });

  it('never persists the transient isSignupEvent flag', async () => {
    const { item } = await put({ provider: 'local', signupPlatform: 'web', isSignupEvent: true });
    expect(item).not.toHaveProperty('isSignupEvent');
  });
});

/**
 * Shared fixture strings. These are the EXACT literals of `ATTRIBUTION_FIXTURES` in
 * `src/utils/__tests__/attribution.test.ts` (the TS twin's test). They cannot be imported (a
 * Lambda is its own zip and its tests stay inside it); keep both copies identical so a value-rule
 * change on one side of the twin fails the other.
 */
const ATTRIBUTION_FIXTURES = {
  tooLong: 'a'.repeat(101),
  maxLen: 'a'.repeat(100),
  script: '<script>alert(1)</script>',
  padded: '  sg-pilot-oct26  ',
  mrkdwn: 'x_y~z:1',
  backtick: 'a`b',
};

const TAG = {
  utm_source: 'chatgpt',
  utm_medium: 'cpc',
  utm_campaign: 'sg-pilot-oct26',
  utm_content: 'calm-ad1',
  utm_term: 'family-planner',
  campaign_id: 'c1',
  ad_group_id: 'g1',
  ad_id: 'a1',
  oppref: 'opp.123',
};

/** Every `attribution_dropped` line the last call logged, parsed. */
function attributionDrops() {
  return logSpy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0]);
      } catch {
        return null;
      }
    })
    .filter((l) => l?.msg === 'attribution_dropped');
}

describe('registry PUT — attribution (stamped at signup, never moved, validated per field)', () => {
  const FAMILY_HASH = createHash('sha256').update(FAMILY_ID).digest('hex');

  it('stamps the full tag on a genuine signup write', async () => {
    const { res, item } = await put({ provider: 'local', attribution: TAG, isSignupEvent: true });
    expect(res.statusCode).toBe(200);
    expect(item.attribution).toEqual(TAG);
    expect(attributionDrops()).toEqual([]);
  });

  it('stores a fresh object, never the request body', async () => {
    // Only the allowlisted keys are copied out: the stored map has no path back to the input.
    const tag = { utm_source: 'chatgpt', evil: 'x' };
    const { item } = await put({ provider: 'local', attribution: tag, isSignupEvent: true });
    expect(item.attribution).toEqual({ utm_source: 'chatgpt' });
  });

  it('does NOT stamp a first write that is not a signup', async () => {
    const { item } = await put({ provider: 'local', attribution: TAG });
    expect(item.attribution).toBeNull();
  });

  it('does NOT move when a later write sends a different tag', async () => {
    const { item } = await put(
      { provider: 'local', attribution: { utm_source: 'reddit' } },
      { createdAt: '2026-01-01T00:00:00.000Z', attribution: TAG }
    );
    expect(item.attribution).toEqual(TAG);
  });

  it('does NOT move even if a later write claims to be a signup', async () => {
    const { item } = await put(
      { provider: 'local', attribution: { utm_source: 'reddit' }, isSignupEvent: true },
      { createdAt: '2026-01-01T00:00:00.000Z', attribution: TAG }
    );
    expect(item.attribution).toEqual(TAG);
  });

  it('survives a later PUT that omits it (the whole-item PutItem re-emits it)', async () => {
    const { item } = await put(
      { provider: 'local', isLoginEvent: true },
      { createdAt: '2026-01-01T00:00:00.000Z', attribution: TAG }
    );
    expect(item.attribution).toEqual(TAG);
  });

  it('never stamps a PRE-EXISTING row retroactively', async () => {
    const { item } = await put(
      { provider: 'local', attribution: TAG },
      { createdAt: '2026-06-01T00:00:00.000Z', ownerEmail: 'a@b.com' }
    );
    expect(item.attribution).toBeNull();
  });

  it.each([
    ['an array', ['chatgpt']],
    ['a string', 'utm_source=chatgpt'],
    ['a number', 42],
    ['a boolean', true],
  ])('stores null for %s and logs one not-object drop', async (_label, value) => {
    const { res, item } = await put({ provider: 'local', attribution: value, isSignupEvent: true });
    expect(res.statusCode).toBe(200);
    expect(item.attribution).toBeNull();
    expect(attributionDrops()).toEqual([
      { msg: 'attribution_dropped', family_id_hash: FAMILY_HASH, reason: 'not-object' },
    ]);
  });

  it('stores null with NO log when an older client omits it', async () => {
    const { item } = await put({ provider: 'local', isSignupEvent: true });
    expect(item.attribution).toBeNull();
    expect(attributionDrops()).toEqual([]);
  });

  it('stores null with NO log when the client sends null', async () => {
    const { item } = await put({ provider: 'local', attribution: null, isSignupEvent: true });
    expect(item.attribution).toBeNull();
    expect(attributionDrops()).toEqual([]);
  });

  it('drops an unknown key silently and keeps its valid siblings', async () => {
    // A newer client with an added key must not be nulled (or log) on an older Lambda.
    const { item } = await put({
      provider: 'local',
      attribution: { utm_source: 'chatgpt', utm_future: 'x', ref: 'INVITE' },
      isSignupEvent: true,
    });
    expect(item.attribution).toEqual({ utm_source: 'chatgpt' });
    expect(attributionDrops()).toEqual([]);
  });

  it('validates each shared fixture per field, logging only the drops', async () => {
    const { tooLong, maxLen, script, padded, mrkdwn, backtick } = ATTRIBUTION_FIXTURES;
    const { item } = await put({
      provider: 'local',
      attribution: {
        utm_source: tooLong,
        utm_medium: script,
        utm_campaign: padded,
        utm_content: mrkdwn,
        ad_id: backtick,
        campaign_id: 12345,
        oppref: maxLen,
      },
      isSignupEvent: true,
    });
    expect(item.attribution).toEqual({
      utm_campaign: 'sg-pilot-oct26', // trimmed
      utm_content: mrkdwn, // _ ~ : are inside the set
      oppref: maxLen, // exactly 100 is allowed
    });
    const drops = attributionDrops();
    expect(drops).toEqual(
      expect.arrayContaining([
        {
          msg: 'attribution_dropped',
          family_id_hash: FAMILY_HASH,
          key: 'utm_source',
          reason: 'too-long',
        },
        {
          msg: 'attribution_dropped',
          family_id_hash: FAMILY_HASH,
          key: 'utm_medium',
          reason: 'bad-charset',
        },
        {
          msg: 'attribution_dropped',
          family_id_hash: FAMILY_HASH,
          key: 'ad_id',
          reason: 'bad-charset',
        },
        {
          msg: 'attribution_dropped',
          family_id_hash: FAMILY_HASH,
          key: 'campaign_id',
          reason: 'not-string',
        },
      ])
    );
    expect(drops).toHaveLength(4);
    // The rejected value never reaches the log (it is arbitrary client input).
    expect(JSON.stringify(drops)).not.toContain('script');
  });

  it('drops an empty-after-trim value as bad-charset', async () => {
    const { item } = await put({
      provider: 'local',
      attribution: { utm_source: 'chatgpt', utm_term: '   ' },
      isSignupEvent: true,
    });
    expect(item.attribution).toEqual({ utm_source: 'chatgpt' });
    expect(attributionDrops()).toEqual([
      {
        msg: 'attribution_dropped',
        family_id_hash: FAMILY_HASH,
        key: 'utm_term',
        reason: 'bad-charset',
      },
    ]);
  });

  it('stores null when every field is invalid', async () => {
    const { item } = await put({
      provider: 'local',
      attribution: { utm_source: ATTRIBUTION_FIXTURES.script, utm_medium: null },
      isSignupEvent: true,
    });
    expect(item.attribution).toBeNull();
    expect(attributionDrops().map((d) => d.reason)).toEqual(['bad-charset', 'not-string']);
  });

  it('stores null for an empty object, with no log', async () => {
    const { item } = await put({ provider: 'local', attribution: {}, isSignupEvent: true });
    expect(item.attribution).toBeNull();
    expect(attributionDrops()).toEqual([]);
  });

  it('never validates (or logs) on a write that cannot stamp', async () => {
    await put({ provider: 'local', attribution: 'junk', isLoginEvent: true });
    expect(attributionDrops()).toEqual([]);
  });

  it('never persists the transient isSignupEvent flag', async () => {
    const { item } = await put({ provider: 'local', attribution: TAG, isSignupEvent: true });
    expect(item).not.toHaveProperty('isSignupEvent');
  });
});

describe('registry PUT — beanpodSizeKb (client value, preserve-on-omit, guarded)', () => {
  it('stores a rounded non-negative number', async () => {
    const { item } = await put({ provider: 'local', beanpodSizeKb: 34.7 });
    expect(item.beanpodSizeKb).toBe(35);
  });

  it('preserves the existing value when omitted', async () => {
    const { item } = await put({ provider: 'local' }, { beanpodSizeKb: 128 });
    expect(item.beanpodSizeKb).toBe(128);
  });

  it('ignores a negative value (preserves existing) and still returns 200', async () => {
    const { res, item } = await put(
      { provider: 'local', beanpodSizeKb: -5 },
      { beanpodSizeKb: 64 }
    );
    expect(res.statusCode).toBe(200);
    expect(item.beanpodSizeKb).toBe(64);
  });

  it('ignores a non-numeric value (preserves existing)', async () => {
    const { item } = await put({ provider: 'local', beanpodSizeKb: 'huge' }, { beanpodSizeKb: 12 });
    expect(item.beanpodSizeKb).toBe(12);
  });

  it('yields null when omitted with no prior row', async () => {
    const { item } = await put({ provider: 'local' });
    expect(item.beanpodSizeKb).toBeNull();
  });
});

describe('registry PUT — memberCount (client roster size, preserve-on-omit, guarded)', () => {
  it('stores a rounded positive integer and refreshes on later writes', async () => {
    const first = await put({ provider: 'local', memberCount: 4 });
    expect(first.item.memberCount).toBe(4);
    const grown = await put({ provider: 'local', memberCount: 5 }, { memberCount: 4 });
    expect(grown.item.memberCount).toBe(5);
  });

  it('preserves the existing value when omitted (older client)', async () => {
    const { item } = await put({ provider: 'local' }, { memberCount: 3 });
    expect(item.memberCount).toBe(3);
  });

  it('ignores zero and negative values (a family always has at least one member)', async () => {
    const { res, item } = await put({ provider: 'local', memberCount: 0 }, { memberCount: 2 });
    expect(res.statusCode).toBe(200);
    expect(item.memberCount).toBe(2);
  });

  it('ignores a non-numeric value (preserves existing)', async () => {
    const { item } = await put({ provider: 'local', memberCount: 'many' }, { memberCount: 6 });
    expect(item.memberCount).toBe(6);
  });

  it('yields null when omitted with no prior row', async () => {
    const { item } = await put({ provider: 'local' });
    expect(item.memberCount).toBeNull();
  });
});

describe('registry PUT — backward compatibility', () => {
  it('preserves createdAt and does not disturb unrelated fields', async () => {
    const { item } = await put(
      { provider: 'google_drive', isLoginEvent: true, beanpodSizeKb: 40 },
      { createdAt: '2025-12-25T00:00:00.000Z', ownerEmail: 'a@b.com', country: 'SG' }
    );
    expect(item.createdAt).toBe('2025-12-25T00:00:00.000Z');
    expect(item.ownerEmail).toBe('a@b.com');
    expect(item.country).toBe('SG');
  });
});

describe('registry PUT — canonical-pointer guard', () => {
  const OWNER = { ownerEmail: 'owner@example.com', provider: 'google_drive', fileId: 'ORIGINAL' };

  it('accepts the pointer when the row has no ownerEmail (legacy row falls open)', async () => {
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'NEW', ownerEmail: 'anyone@example.com' },
      { provider: 'google_drive', fileId: 'ORIGINAL' }
    );
    expect(item.fileId).toBe('NEW');
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
  });

  it('accepts the pointer from the registered owner', async () => {
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MOVED', ownerEmail: 'owner@example.com' },
      OWNER
    );
    expect(item.fileId).toBe('MOVED');
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
  });

  it('accepts the owner despite case/whitespace drift in the profile email', async () => {
    // ownerEmail comes from a user-editable member profile — drift must never
    // lock the real owner out of re-pointing their own pod.
    const { item } = await put(
      { provider: 'google_drive', fileId: 'MOVED', ownerEmail: '  Owner@Example.COM ' },
      OWNER
    );
    expect(item.fileId).toBe('MOVED');
  });

  it('REFUSES the pointer from a non-owner and preserves the original', async () => {
    // The incident: a member device re-homed onto a private copy and repointed
    // the family's canonical row at it.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MEMBER-PRIVATE-COPY', ownerEmail: 'member@example.com' },
      OWNER
    );
    expect(item.fileId).toBe('ORIGINAL');
    expect(item.provider).toBe('google_drive');
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
  });

  it('REFUSES the pointer when the writer sends no ownerEmail at all', async () => {
    const { item } = await put({ provider: 'local', fileId: null }, OWNER);
    expect(item.fileId).toBe('ORIGINAL');
    expect(item.provider).toBe('google_drive');
  });

  it('still records member activity and metadata on a refused pointer write', async () => {
    // The guard protects the pointer only — member logins must keep stamping
    // lastLoginAt, or families with an inactive owner read as dormant.
    const { item } = await put(
      {
        provider: 'local',
        ownerEmail: 'member@example.com',
        isLoginEvent: true,
        country: 'SG',
        beanpodSizeKb: 42,
      },
      OWNER
    );
    expect(item.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.country).toBe('SG');
    expect(item.beanpodSizeKb).toBe(42);
    expect(item.fileId).toBe('ORIGINAL'); // …but the pointer did not move
  });

  it('makes ownerEmail genuinely write-once', async () => {
    // Previously `body.ownerEmail ?? existing.ownerEmail` let the last writer
    // win, which is how a re-homed device could take over the row.
    const { item } = await put(
      { provider: 'google_drive', ownerEmail: 'member@example.com' },
      OWNER
    );
    expect(item.ownerEmail).toBe('owner@example.com');
  });

  it('preserves familyName when a write omits it', async () => {
    const { item } = await put(
      { provider: 'local', ownerEmail: 'owner@example.com' },
      {
        ...OWNER,
        familyName: 'The Brambleworth Beanies',
      }
    );
    expect(item.familyName).toBe('The Brambleworth Beanies');
  });
});

describe('registry PUT — pointer guard treats a no-op write as accepted', () => {
  const OWNER = {
    ownerEmail: 'owner@example.com',
    provider: 'google_drive',
    fileId: 'ORIGINAL',
    displayPath: 'Family.beanpod',
  };

  it('accepts a non-owner write that does not change the pointer', async () => {
    // The common case: a member re-picks the family's CORRECT file, or simply
    // logs in and echoes the pointer back. Reporting these as refused would page
    // the team on every normal member recovery and drown the real signal.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'ORIGINAL',
        displayPath: 'Family.beanpod',
        ownerEmail: 'member@example.com',
        isLoginEvent: true,
      },
      OWNER
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('still refuses a non-owner write that WOULD move the pointer', async () => {
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MEMBER-PRIVATE-COPY',
        displayPath: 'Family-abc.beanpod',
        ownerEmail: 'member@example.com',
      },
      OWNER
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });
});

describe('registry PUT — pointer authority is ownerMemberId, not the editable email', () => {
  const M_OWNER = 'member-owner-uuid';
  const M_OTHER = 'member-other-uuid';
  const ROW = {
    ownerEmail: 'owner@example.com',
    ownerMemberId: M_OWNER,
    provider: 'google_drive',
    fileId: 'ORIGINAL',
  };

  it('lets the owner re-point AFTER they change their profile email', async () => {
    // The lockout this field exists to prevent: `ownerEmail` is a user-editable
    // profile field, so an owner who renames their email would otherwise be
    // refused by their own family's registry with no way back (write-once).
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MOVED',
        ownerMemberId: M_OWNER,
        ownerEmail: 'brand-new-address@example.com',
      },
      ROW
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.fileId).toBe('MOVED');
    expect(item.ownerEmail).toBe('owner@example.com'); // still write-once
  });

  it('refuses another member even when they send the owner’s email', async () => {
    // memberId wins over email, so spoofing the address achieves nothing.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MEMBER-COPY',
        ownerMemberId: M_OTHER,
        ownerEmail: 'owner@example.com',
      },
      ROW
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('upgrades a legacy email-only row to memberId on the owner’s next write', async () => {
    const legacy = {
      ownerEmail: 'owner@example.com',
      provider: 'google_drive',
      fileId: 'ORIGINAL',
    };
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MOVED',
        ownerEmail: 'owner@example.com',
        ownerMemberId: M_OWNER,
      },
      legacy
    );
    expect(item.ownerMemberId).toBe(M_OWNER);
    expect(item.fileId).toBe('MOVED');
  });

  it('does NOT let a non-owner claim ownerMemberId on a legacy email-only row', async () => {
    // Otherwise the upgrade path would be a land-grab: a member writing first
    // would stamp themselves as the permanent authority.
    const legacy = {
      ownerEmail: 'owner@example.com',
      provider: 'google_drive',
      fileId: 'ORIGINAL',
    };
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MEMBER-COPY',
        ownerEmail: 'member@example.com',
        ownerMemberId: M_OTHER,
      },
      legacy
    );
    expect(item.ownerMemberId).toBeNull();
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('falls open on a pre-2026-04-12 row with neither field, and stamps both', async () => {
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'FIRST',
        ownerEmail: 'whoever@example.com',
        ownerMemberId: M_OWNER,
      },
      { provider: 'local' }
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.ownerMemberId).toBe(M_OWNER);
    expect(item.ownerEmail).toBe('whoever@example.com');
  });
});

/**
 * Drive a DELETE through the handler. `existing` is the row already in the
 * table (null = no row). Returns the unmarshalled Item the handler tried to
 * Put — a DELETE is a tombstone write, not a DeleteItem, since 2026-09-09.
 */
async function del(existing = null, queryStringParameters = undefined) {
  sendMock.mockReset();
  sendMock.mockImplementation((command) => {
    const kind = command.constructor.name;
    if (kind === 'GetItemCommand') {
      return Promise.resolve({ Item: existing ? marshall(existing) : undefined });
    }
    return Promise.resolve({});
  });

  const res = await handler({
    headers: { 'x-api-key': API_KEY, origin: 'https://app.beanies.family' },
    pathParameters: { familyId: FAMILY_ID },
    requestContext: { http: { method: 'DELETE' } },
    ...(queryStringParameters ? { queryStringParameters } : {}),
  });

  const putCall = sendMock.mock.calls.find((c) => c[0].constructor.name === 'PutItemCommand');
  return { res, item: putCall ? unmarshall(putCall[0].input.Item) : null };
}

/**
 * Drive a GET through the handler. `existing` is the registry row; `billing` is the billing-table
 * row (#95), dispatched on `TableName` so the two reads can differ. Pass an Error as `billing` to
 * make the billing read throw.
 */
async function get(
  existing = null,
  { billing = null, origin = 'https://app.beanies.family' } = {}
) {
  sendMock.mockReset();
  sendMock.mockImplementation((command) => {
    if (command.input.TableName === BILLING_TABLE) {
      if (billing instanceof Error) return Promise.reject(billing);
      return Promise.resolve({ Item: billing ? marshall(billing) : undefined });
    }
    return Promise.resolve({ Item: existing ? marshall(existing) : undefined });
  });
  const res = await handler({
    headers: { 'x-api-key': API_KEY, origin },
    pathParameters: { familyId: FAMILY_ID },
    requestContext: { http: { method: 'GET' } },
  });
  return { res, body: JSON.parse(res.body) };
}

/** Every GetItemCommand the last call issued, with its input. */
function getCommands() {
  return sendMock.mock.calls
    .map((c) => c[0])
    .filter((c) => c.constructor.name === 'GetItemCommand');
}

const M_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const M_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('registry — strongly consistent reads', () => {
  it('reads the row consistently on GET', async () => {
    await get({ provider: 'local' });
    expect(getCommands()[0].input.ConsistentRead).toBe(true);
  });

  it('reads the row consistently on PUT, because a stale miss clobbers write-once fields', async () => {
    await put({ provider: 'local' }, { createdAt: '2025-01-01T00:00:00.000Z' });
    expect(getCommands()[0].input.ConsistentRead).toBe(true);
  });

  it('reads the row consistently on DELETE', async () => {
    await del({ provider: 'local', createdAt: '2025-01-01T00:00:00.000Z' });
    expect(getCommands()[0].input.ConsistentRead).toBe(true);
  });
});

describe('registry DELETE — tombstone, not a drop', () => {
  const LIVE = {
    createdAt: '2025-03-01T00:00:00.000Z',
    ownerMemberId: M_A,
    ownerEmail: 'owner@example.com',
    country: 'SG',
    signupPlatform: 'ios',
    attribution: { utm_source: 'chatgpt', utm_content: 'calm-ad1' },
    provider: 'google_drive',
    fileId: 'FILE-1',
    displayPath: '/beanies/pod.beanpod',
    familyName: 'The Brambleworths',
    subscribeNewsletter: true,
    lastLoginAt: '2026-09-01',
    memberCount: 5,
    beanpodSizeKb: 350,
  };

  it('keeps identity and provenance so a re-registration is a restore', async () => {
    const { res, item } = await del(LIVE, { writerMemberId: M_A });
    expect(res.statusCode).toBe(200);
    expect(item.createdAt).toBe('2025-03-01T00:00:00.000Z');
    expect(item.ownerMemberId).toBe(M_A);
    expect(item.ownerEmail).toBe('owner@example.com');
    expect(item.country).toBe('SG');
    expect(item.signupPlatform).toBe('ios');
    expect(item.attribution).toEqual({ utm_source: 'chatgpt', utm_content: 'calm-ad1' });
    expect(item.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('drops the pointer, the activity signals and the family content', async () => {
    // A stale pointer is worse than none; activity signals would keep a deleted
    // family alive in the metrics; the name and the marketing consent are the
    // things the user actually asked to be rid of.
    const { item } = await del(LIVE, { writerMemberId: M_A });
    for (const gone of [
      'provider',
      'fileId',
      'displayPath',
      'familyName',
      'subscribeNewsletter',
      'lastLoginAt',
      'memberCount',
      'beanpodSizeKb',
    ]) {
      expect(item[gone]).toBeUndefined();
    }
  });

  it('writes nothing at all when there is no row to tombstone', async () => {
    const { res, item } = await del(null, { writerMemberId: M_A });
    expect(res.statusCode).toBe(200);
    expect(item).toBeNull();
  });

  it('never issues a DeleteItemCommand', async () => {
    await del(LIVE, { writerMemberId: M_A });
    expect(sendMock.mock.calls.some((c) => c[0].constructor.name === 'DeleteItemCommand')).toBe(
      false
    );
  });
});

describe('registry GET — a tombstoned row is gone', () => {
  it('returns 404 for a tombstoned row', async () => {
    const { res, body } = await get({
      createdAt: '2025-03-01T00:00:00.000Z',
      ownerMemberId: M_A,
      deletedAt: '2026-09-09T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(404);
    expect(body.error).toBe('Family not found');
  });

  it('still returns a live row', async () => {
    const { res, body } = await get({ provider: 'google_drive', fileId: 'FILE-1' });
    expect(res.statusCode).toBe(200);
    expect(body.fileId).toBe('FILE-1');
  });
});

describe('registry PUT — restoring a tombstoned row', () => {
  const TOMB = {
    createdAt: '2025-03-01T00:00:00.000Z',
    ownerMemberId: M_A,
    ownerEmail: 'owner@example.com',
    signupPlatform: 'ios',
    attribution: { utm_source: 'chatgpt' },
    deletedAt: '2026-09-09T00:00:00.000Z',
  };

  it('restores the original identity rather than inventing a new one', async () => {
    // This is the whole point of the tombstone: before it, a delete followed by
    // any member's write recreated the row with that member stamped as owner.
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'FILE-2',
        ownerMemberId: M_A,
        writerMemberId: M_A,
        isSignupEvent: true,
        signupPlatform: 'web',
        attribution: { utm_source: 'reddit' },
      },
      TOMB
    );
    expect(item.createdAt).toBe('2025-03-01T00:00:00.000Z');
    expect(item.ownerMemberId).toBe(M_A);
    // Signed up on iOS then re-registered from a browser: still iOS.
    expect(item.signupPlatform).toBe('ios');
    // Created from a ChatGPT ad: a re-registration's own tag never replaces it.
    expect(item.attribution).toEqual({ utm_source: 'chatgpt' });
  });

  it('clears deletedAt, so the row is live again', async () => {
    const { item } = await put(
      { provider: 'google_drive', fileId: 'FILE-2', ownerMemberId: M_A, writerMemberId: M_A },
      TOMB
    );
    expect(item.deletedAt).toBeUndefined();
  });

  it('still refuses a non-owner on a tombstoned row, without writing', async () => {
    // Deleting a family does not relinquish ownership of its id.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MEMBER-COPY', ownerMemberId: M_A, writerMemberId: M_B },
      TOMB
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item).toBeNull();
  });
});

describe('registry PUT — the guard asks the WRITER, not the claimed owner', () => {
  const OWNED = { ownerMemberId: M_A, provider: 'google_drive', fileId: 'ORIGINAL' };

  it('accepts a pre-split client that sends only its own id as ownerMemberId', async () => {
    // Compatibility: every client deployed before the split sends its session id
    // in `ownerMemberId`. Without the presence fallback, this deploy refuses the
    // pointer for the entire fleet at once.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MOVED', ownerMemberId: M_A },
      OWNED
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.fileId).toBe('MOVED');
  });

  it('refuses a pre-split member device, exactly as before', async () => {
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MEMBER-COPY', ownerMemberId: M_B },
      OWNED
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('accepts the owner when the roster owner and the writer are the same person', async () => {
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MOVED', ownerMemberId: M_A, writerMemberId: M_A },
      OWNED
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.fileId).toBe('MOVED');
  });

  it('REFUSES a member device even though it sends the correct roster owner', async () => {
    // The guard survives sourcing `ownerMemberId` from the roster. Every device
    // holding the decrypted pod can compute the roster owner, so if that value
    // were the credential, the guard would be worth nothing.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MEMBER-COPY', ownerMemberId: M_A, writerMemberId: M_B },
      OWNED
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('REFUSES a current client with no signed-in member, despite a matching ownerMemberId', async () => {
    // The reason the fallback tests PRESENCE and not nullishness. With `??`, an
    // explicit null here would fall back to `ownerMemberId` — the roster owner —
    // and hand the guard's own answer to an unauthenticated writer.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'ANON-COPY',
        ownerMemberId: M_A,
        writerMemberId: null,
      },
      OWNED
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('does not stamp the WRITER as owner on a row that has no owner yet', async () => {
    // `ownerMemberId` is the owner claim; `writerMemberId` is only ever the
    // permission question. A fall-open row must record the claimed owner.
    const { item } = await put(
      { provider: 'google_drive', fileId: 'FIRST', ownerMemberId: M_A, writerMemberId: M_B },
      { provider: 'local' }
    );
    expect(item.ownerMemberId).toBe(M_A);
  });
});

describe('registry DELETE — the ladder measures, it does not enforce', () => {
  const OWNED = { createdAt: '2025-03-01T00:00:00.000Z', ownerMemberId: M_A };
  let warn;

  // A fresh spy per test, restored after it: each assertion reads only its own test's warns
  // (the "is silent" case would otherwise see earlier tests' calls), and no spy outlives this
  // block to silence, or be restored by, anything else in the file.
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it('warns when the caller sends no writer id, and deletes anyway', async () => {
    const { res, item } = await del(OWNED);
    expect(warn).toHaveBeenCalledWith(
      '[registry] delete would be refused',
      FAMILY_ID,
      'no-writer-id',
      M_A.slice(-6)
    );
    expect(res.statusCode).toBe(200);
    expect(item.deletedAt).toBeTruthy();
  });

  it('warns on a writer who is not the owner, and deletes anyway', async () => {
    const { res, item } = await del(OWNED, { writerMemberId: M_B });
    expect(warn).toHaveBeenCalledWith(
      '[registry] delete would be refused',
      FAMILY_ID,
      M_B.slice(-6),
      M_A.slice(-6)
    );
    expect(res.statusCode).toBe(200);
    expect(item.deletedAt).toBeTruthy();
  });

  it('treats a malformed writer id as absent', async () => {
    await del(OWNED, { writerMemberId: 'not-a-uuid' });
    expect(warn).toHaveBeenCalledWith(
      '[registry] delete would be refused',
      FAMILY_ID,
      'no-writer-id',
      M_A.slice(-6)
    );
  });

  it('is silent when the owner deletes their own family', async () => {
    const { item } = await del(OWNED, { writerMemberId: M_A });
    expect(warn).not.toHaveBeenCalled();
    expect(item.deletedAt).toBeTruthy();
  });

  it('logs id TAILS only — never a full member id', async () => {
    await del(OWNED, { writerMemberId: M_B });
    const logged = warn.mock.calls[0].join(' ');
    expect(logged).not.toContain(M_A);
    expect(logged).not.toContain(M_B);
  });
});

describe('registry PUT — the LEGACY email tier asks the writer too', () => {
  // Rows registered 2026-04-12..2026-08-10 have `ownerEmail` and no
  // `ownerMemberId`, so the guard falls to the email arm — which never consults
  // `writerMemberId`.
  const LEGACY = {
    ownerEmail: 'owner@example.com',
    provider: 'google_drive',
    fileId: 'ORIGINAL',
  };

  it('REFUSES a member device that sends the roster owner as ownerEmail', async () => {
    // ⚠️ THE REGRESSION THIS PINS, and it was introduced by the roster change
    // itself. Once `ownerEmail` came from the pod roster, EVERY device sent
    // `owner@example.com` — so the legacy tier matched for everyone and any
    // member could re-point a legacy row at its own private copy, reported as
    // `pointerAccepted: true` so nothing paged.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MEMBER-PRIVATE-COPY',
        ownerEmail: 'owner@example.com',
        ownerMemberId: M_A,
        writerEmail: 'member@example.com',
        writerMemberId: M_B,
      },
      LEGACY
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBe('ORIGINAL');
  });

  it('accepts the real owner on a legacy row, and upgrades it off the email', async () => {
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MOVED',
        ownerEmail: 'owner@example.com',
        ownerMemberId: M_A,
        writerEmail: 'owner@example.com',
        writerMemberId: M_A,
      },
      LEGACY
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.fileId).toBe('MOVED');
    expect(item.ownerMemberId).toBe(M_A);
  });

  it('still judges a PRE-SPLIT client on ownerEmail, which is its own address', async () => {
    // Compatibility: no `writerEmail` in the body at all.
    const refused = await put(
      { provider: 'google_drive', fileId: 'MEMBER-COPY', ownerEmail: 'member@example.com' },
      LEGACY
    );
    expect(JSON.parse(refused.res.body).pointerAccepted).toBe(false);

    const accepted = await put(
      { provider: 'google_drive', fileId: 'MOVED', ownerEmail: 'owner@example.com' },
      LEGACY
    );
    expect(JSON.parse(accepted.res.body).pointerAccepted).toBe(true);
  });

  it('REFUSES a current client with no signed-in member on a legacy row', async () => {
    const { res } = await put(
      {
        provider: 'google_drive',
        fileId: 'ANON',
        ownerEmail: 'owner@example.com',
        ownerMemberId: M_A,
        writerEmail: null,
        writerMemberId: null,
      },
      LEGACY
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
  });
});

describe('registry PUT — a tombstone is only lifted by a write that may re-point', () => {
  const TOMB = {
    createdAt: '2025-03-01T00:00:00.000Z',
    ownerMemberId: M_A,
    ownerEmail: 'owner@example.com',
    deletedAt: '2026-09-09T00:00:00.000Z',
  };

  it('a refused write leaves the family deleted, and writes nothing', async () => {
    // ⚠️ THE REGRESSION THE TOMBSTONE ITSELF INTRODUCED. `PutItem` replaces the
    // whole item, so omitting `deletedAt` made every write revive the row —
    // including a refused one, which writes the else-arms' `provider: 'local',
    // fileId: null`. The family came back as LIVE with a pointer at nothing:
    // GET answers 200, the metrics count it forever, resume-from-registry dies
    // on the null fileId, and only the owner could ever repair it. A hard delete
    // could not produce that state.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'MEMBER-COPY',
        ownerMemberId: M_A,
        writerMemberId: M_B,
      },
      TOMB
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item).toBeNull();
  });

  it('the OWNER re-registering does lift it', async () => {
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'FILE-2',
        ownerMemberId: M_A,
        writerMemberId: M_A,
      },
      TOMB
    );
    expect(item.deletedAt).toBeUndefined();
    expect(item.fileId).toBe('FILE-2');
    expect(item.createdAt).toBe('2025-03-01T00:00:00.000Z');
  });

  it('a NULL-POINTER write from a non-owner does NOT lift it', async () => {
    // ⚠️ THIS TEST ASSERTED THE OPPOSITE AND PINNED A BUG AS CORRECT. The
    // tombstone carries no pointer by design, so `samePointer` is VACUOUSLY true
    // for any device sending nulls — a cold boot, an evicted provider config, an
    // `ensureRegistered` mid-boot. Gating the revival on `pointerAccepted`
    // therefore let a member device bring the deleted family back as LIVE,
    // pointing at nothing, and this test called that "it is not moving
    // anything".
    const { item } = await del(
      { createdAt: '2025-03-01T00:00:00.000Z', ownerMemberId: M_A },
      { writerMemberId: M_A }
    );
    expect(item.deletedAt).toBeTruthy();

    const revive = await put(
      { provider: 'local', fileId: null, displayPath: null, writerMemberId: M_B },
      item
    );
    expect(revive.item).toBeNull(); // nothing written at all
  });

  it('writes NOTHING for a non-owner, so the deleted name and consent stay gone', async () => {
    // Preserving only `deletedAt` was not enough: the same PutItem re-stamped
    // `familyName`, `subscribeNewsletter`, `country`, `memberCount`,
    // `beanpodSizeKb` and `lastLoginAt` — every field the DELETE arm dropped ON
    // PURPOSE. A member's ordinary login register would have resurrected the
    // deleted family's name and its newsletter opt-in, invisibly.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'X',
        familyName: 'The Brambleworths',
        subscribeNewsletter: true,
        country: 'SG',
        memberCount: 5,
        isLoginEvent: true,
        ownerMemberId: M_A,
        writerMemberId: M_B,
      },
      TOMB
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item).toBeNull();
  });

  it('never invents a deletedAt on an ordinary LIVE row, refused or not', async () => {
    // The preserve is conditional on there BEING a tombstone, so a refused write
    // to a live row must not stamp one.
    const refused = await put(
      { provider: 'google_drive', fileId: 'X', ownerMemberId: M_A, writerMemberId: M_B },
      { ownerMemberId: M_A, provider: 'google_drive', fileId: 'ORIGINAL' }
    );
    expect(JSON.parse(refused.res.body).pointerAccepted).toBe(false);
    expect(refused.item.deletedAt).toBeUndefined();

    const firstWrite = await put({ ownerMemberId: M_A, writerMemberId: M_A }, null);
    expect(firstWrite.item.deletedAt).toBeUndefined();
  });
});

describe('registry PUT — the write-once owner stamp needs OWNERSHIP', () => {
  it('a PRE-SPLIT member cannot stamp itself owner by echoing the pointer', async () => {
    // ⚠️ Pre-split clients are still in the field and they send their own id as
    // `ownerMemberId`. On a legacy (email-only) row `isOwner` is false for a
    // member — but every member device echoes the family's real pointer on every
    // login, so `samePointer` was true, `pointerAccepted` was true, and the
    // write-once stamp fired with the MEMBER's id. The field is permanent, so the
    // real owner then failed tier 1 forever with no in-app route back.
    const legacy = {
      ownerEmail: 'owner@example.com',
      provider: 'google_drive',
      fileId: 'ORIGINAL',
      displayPath: 'pod.beanpod',
    };
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'ORIGINAL',
        displayPath: 'pod.beanpod',
        ownerEmail: 'member@example.com',
        ownerMemberId: M_B,
      },
      legacy
    );
    expect(item.ownerMemberId).toBeNull();
  });

  it('the real owner still upgrades a legacy row off the mutable email', async () => {
    const legacy = { ownerEmail: 'owner@example.com', provider: 'google_drive', fileId: 'F' };
    const { item } = await put(
      {
        provider: 'google_drive',
        fileId: 'F',
        ownerEmail: 'owner@example.com',
        ownerMemberId: M_A,
        writerEmail: 'owner@example.com',
        writerMemberId: M_A,
      },
      legacy
    );
    expect(item.ownerMemberId).toBe(M_A);
  });
});

describe('registry PUT — a deleted family with NO recorded owner', () => {
  /**
   * ⚠️ VERIFIED EMPIRICALLY BY A REVIEWER before this test existed: driving the
   * real handler with `{deletedAt, ownerMemberId: null, ownerEmail: null}` and a
   * stranger's body returned `pointerAccepted: true`, lifted the tombstone, wrote
   * the stranger's fileId, and restored the deleted family's name and newsletter
   * consent.
   *
   * The cause is that `isOwner`'s third tier FALLS OPEN — `!existing.ownerEmail`
   * is true for everyone — which is correct for a live legacy row and
   * catastrophic for a deleted one. Both earlier tombstone fixtures pinned
   * `ownerMemberId`, so no test could reach it.
   *
   * And it is reachable: the client sends both owner fields null when the roster
   * is not loaded, which is the background-write-mid-boot path the guard's own
   * comment names as its trigger.
   */
  const ORPHAN_TOMB = {
    createdAt: '2025-03-01T00:00:00.000Z',
    ownerMemberId: null,
    ownerEmail: null,
    deletedAt: '2026-09-09T00:00:00.000Z',
  };

  it('lets the REAL OWNER restore an ownerless deleted family', async () => {
    // ⚠️ THE BRICK THIS PREVENTS, and the first cut of the guard caused it.
    // Requiring a KNOWN owner to write meant a family whose owner fields were
    // never stamped — a background register mid-boot sends both null — could not
    // be restored by anyone at all once deleted: the tombstone never lifted, GET
    // kept 404ing, and the client was told 200 success so restore never learned
    // its recovery anchor had been refused. Only a manual DynamoDB edit healed it.
    const { res, item } = await put(
      {
        provider: 'google_drive',
        fileId: 'RESTORED',
        ownerMemberId: M_A,
        writerMemberId: M_A,
      },
      ORPHAN_TOMB
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.deletedAt).toBeUndefined();
    expect(item.fileId).toBe('RESTORED');
    expect(item.createdAt).toBe('2025-03-01T00:00:00.000Z');
  });

  it('falls open for an ownerless row, exactly as a LIVE ownerless row does', async () => {
    // ⚠️ AN ACCEPTED TRADE, written down so it is not mistaken for an oversight.
    // A family with no recorded owner has no authority to check against, so the
    // pointer guard already lets its first writer through everywhere else.
    // Refusing everyone on a DELETED ownerless row is strictly worse: it bricks
    // the row for its real owner too. The refusal below is for rows that DO have
    // a recorded owner, which is every row a current client creates.
    const { res } = await put(
      { provider: 'google_drive', fileId: 'ANY', writerMemberId: M_B },
      ORPHAN_TOMB
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
  });

  it('still falls open for a LIVE legacy row with no owner recorded', async () => {
    // The fall-open tier is correct where it came from: a pre-2026-04-12 row that
    // has never had an owner must still be claimable by its first writer.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'FIRST', ownerMemberId: M_A, writerMemberId: M_A },
      { provider: 'local' }
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(true);
    expect(item.ownerMemberId).toBe(M_A);
  });
});

describe('registry PUT — an empty string never latches a write-once identity', () => {
  it('stores ownerEmail as null, not as an empty string', async () => {
    // ⚠️ THE POISONING THIS PREVENTS. `ownerEmail` is write-once and `''` is not
    // nullish, so an empty string latches forever — and the legacy pointer tier
    // reads `!existing.ownerEmail` as TRUE, falling open for EVERY writer on that
    // row from then on, with no route back. Guarded on the server as well as the
    // client because already-deployed clients can still send one.
    const { item } = await put({ provider: 'local', ownerEmail: '', ownerMemberId: '' }, {});
    expect(item.ownerEmail).toBeNull();
    expect(item.ownerMemberId).toBeNull();
  });

  it('REPAIRS a row already poisoned with an empty string', async () => {
    // ⚠️ PREVENTION WAS NOT ENOUGH. Deployed clients sent `''`, so such rows
    // exist — and `'' ?? x` is `''`, so the write-once merge preserved it even
    // when the real owner later sent a genuine address. The legacy tier reads
    // `!existing.ownerEmail` as TRUE for `''`, so the row fell open for every
    // writer, permanently, with no route back.
    const { item } = await put(
      { provider: 'local', ownerEmail: 'owner@example.com', ownerMemberId: M_A },
      { ownerEmail: '', ownerMemberId: '' }
    );
    expect(item.ownerEmail).toBe('owner@example.com');
    expect(item.ownerMemberId).toBe(M_A);
  });

  it('still preserves a real stored ownerEmail', async () => {
    const { item } = await put(
      { provider: 'local', ownerEmail: 'someone-else@example.com' },
      { ownerEmail: 'owner@example.com' }
    );
    expect(item.ownerEmail).toBe('owner@example.com');
  });
});

describe('registry GET: entitlement (#95)', () => {
  const ROW = {
    provider: 'google_drive',
    fileId: 'FILE-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    ownerEmail: 'owner@example.com',
  };
  const LAUNCH = '2026-11-01T00:00:00.000Z';
  const DAY = 24 * 60 * 60 * 1000;

  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    delete process.env.V1_LAUNCH_AT;
    delete process.env.BILLING_ENFORCE;
    // Scoped to this block so the GET tests above make no billing read. (They still compute
    // `beta` and log the soak line; the file-level `console.log` spy silences that.)
    process.env.BILLING_TABLE_NAME = BILLING_TABLE;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
    delete process.env.V1_LAUNCH_AT;
    delete process.env.BILLING_ENFORCE;
    delete process.env.BILLING_TABLE_NAME;
  });

  /** The structured `entitlement_computed` lines logged by the last call, parsed. */
  function computedLines() {
    return logSpy.mock.calls
      .map((c) => c[0])
      .filter((l) => typeof l === 'string' && l.includes('entitlement_computed'))
      .map((l) => JSON.parse(l));
  }

  function billingReads() {
    return getCommands().filter((c) => c.input.TableName === BILLING_TABLE);
  }

  it('joins the billing row: an active subscription is `active` with its plan', async () => {
    process.env.V1_LAUNCH_AT = LAUNCH;
    const { res, body } = await get(ROW, {
      billing: {
        familyId: FAMILY_ID,
        status: 'active',
        plan: 'full',
        cohort: 'pre_v1',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: '2027-10-01T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(body.fileId).toBe('FILE-1');
    expect(body.entitlement).toMatchObject({
      state: 'active',
      reason: 'subscribed',
      plan: 'full',
      cohort: 'pre_v1',
      currentPeriodEnd: '2027-10-01T00:00:00.000Z',
      enforced: false,
    });
  });

  it('a subscribed family is `active` even before launch', async () => {
    const { body } = await get(ROW, { billing: { status: 'active', plan: 'basic' } });
    expect(body.entitlement).toMatchObject({
      state: 'active',
      reason: 'subscribed',
      plan: 'basic',
      trialEndsAt: null,
    });
    expect(computedLines()[0]).toMatchObject({ state: 'active', launch_set: false });
  });

  it('a trialEndsAt override runs the trial clock before launch (the prod soak)', async () => {
    const { body } = await get(ROW, { billing: { trialEndsAt: '2020-01-01T00:00:00.000Z' } });
    expect(body.entitlement).toMatchObject({
      state: 'read_only',
      reason: 'trial_ended',
      trialEndsAt: '2020-01-01T00:00:00.000Z',
    });
  });

  it('reads the billing row by familyId, strongly consistent', async () => {
    await get(ROW);
    const [read] = billingReads();
    expect(unmarshall(read.input.Key)).toEqual({ familyId: FAMILY_ID });
    expect(read.input.ConsistentRead).toBe(true);
  });

  it('never returns the billing row raw (no customer id, no token hash)', async () => {
    process.env.V1_LAUNCH_AT = LAUNCH;
    const { res } = await get(ROW, {
      billing: {
        status: 'active',
        plan: 'basic',
        stripeCustomerId: 'cus_SECRET',
        stripeSubscriptionId: 'sub_SECRET',
        planTokenHash: 'deadbeef',
      },
    });
    expect(res.body).not.toContain('cus_SECRET');
    expect(res.body).not.toContain('sub_SECRET');
    expect(res.body).not.toContain('deadbeef');
  });

  it('no billing row and no launch: `beta`, plan null', async () => {
    const { res, body } = await get(ROW);
    expect(res.statusCode).toBe(200);
    expect(body.entitlement).toMatchObject({
      state: 'beta',
      reason: 'no_launch',
      plan: null,
      trialEndsAt: null,
    });
  });

  it('no billing row after launch: `trial` from launch + 90 days, plan null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
    process.env.V1_LAUNCH_AT = LAUNCH;
    const { body } = await get(ROW);
    expect(body.entitlement).toMatchObject({ state: 'trial', reason: 'in_trial', plan: null });
    // createdAt precedes launch, so every beta family gets a fresh 90 days from launch.
    expect(body.entitlement.trialEndsAt).toBe(
      new Date(Date.parse(LAUNCH) + 90 * DAY).toISOString()
    );
  });

  it('a lapsed subscription past the trial is `read_only` / `lapsed`', async () => {
    process.env.V1_LAUNCH_AT = '2025-01-01T00:00:00.000Z';
    const { body } = await get(
      { ...ROW, createdAt: '2025-01-01T00:00:00.000Z' },
      { billing: { status: 'canceled', plan: 'basic', stripeSubscriptionId: 'sub_1' } }
    );
    expect(body.entitlement).toMatchObject({ state: 'read_only', reason: 'lapsed', plan: null });
  });

  it('a billing read failure still answers 200 with the row and `entitlement: null`', async () => {
    process.env.V1_LAUNCH_AT = LAUNCH;
    const { res, body } = await get(ROW, { billing: new Error('ProvisionedThroughputExceeded') });
    // The pointer lookup that recovery-from-registry depends on must survive a billing blip.
    expect(res.statusCode).toBe(200);
    expect(body.fileId).toBe('FILE-1');
    expect(body.entitlement).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[registry] entitlement_unavailable'),
      expect.any(Error)
    );
    expect(errorSpy.mock.calls[0][0]).toContain('dynamodb:GetItem');
    expect(computedLines()).toHaveLength(0);
  });

  it('reflects BILLING_ENFORCE in `enforced`, and only the exact string "true" enforces', async () => {
    process.env.BILLING_ENFORCE = 'true';
    expect((await get(ROW)).body.entitlement.enforced).toBe(true);
    process.env.BILLING_ENFORCE = 'false';
    expect((await get(ROW)).body.entitlement.enforced).toBe(false);
    process.env.BILLING_ENFORCE = '1';
    expect((await get(ROW)).body.entitlement.enforced).toBe(false);
    delete process.env.BILLING_ENFORCE;
    expect((await get(ROW)).body.entitlement.enforced).toBe(false);
  });

  it('reads the ONE billing table even for a dev-origin request', async () => {
    await get(ROW, { origin: 'http://localhost:5173' });
    const tables = getCommands().map((c) => c.input.TableName);
    expect(tables).toEqual(['registry-dev', BILLING_TABLE]);
  });

  it('logs one structured `entitlement_computed` line per GET, hashed id only', async () => {
    process.env.V1_LAUNCH_AT = LAUNCH;
    process.env.BILLING_ENFORCE = 'true';
    await get(ROW);
    const lines = computedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      msg: 'entitlement_computed',
      family_id_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      state: 'trial',
      reason: 'in_trial',
      enforced: true,
      launch_set: true,
    });
    const everything = JSON.stringify([logSpy.mock.calls, warnSpy.mock.calls]);
    expect(everything).not.toContain(FAMILY_ID);
  });

  it('does not use or log the billing read for a tombstoned row', async () => {
    const { res, body } = await get(
      { ...ROW, deletedAt: '2026-09-09T00:00:00.000Z' },
      { billing: { status: 'active', plan: 'full' } }
    );
    expect(res.statusCode).toBe(404);
    expect(body).not.toHaveProperty('entitlement');
    expect(computedLines()).toHaveLength(0);
  });

  it('discards a failed billing read on a 404 without logging it', async () => {
    const { res } = await get(null, { billing: new Error('boom') });
    expect(res.statusCode).toBe(404);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(computedLines()).toHaveLength(0);
  });

  it('issues the billing read alongside the registry read, not after it', async () => {
    // Both GetItems are sent before either resolves: hold the registry read open and check.
    let releaseRegistry;
    sendMock.mockReset();
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === BILLING_TABLE) return Promise.resolve({ Item: undefined });
      return new Promise((resolve) => {
        releaseRegistry = () => resolve({ Item: marshall(ROW) });
      });
    });
    const pending = handler({
      headers: { 'x-api-key': API_KEY, origin: 'https://app.beanies.family' },
      pathParameters: { familyId: FAMILY_ID },
      requestContext: { http: { method: 'GET' } },
    });
    await Promise.resolve();
    expect(billingReads()).toHaveLength(1);
    releaseRegistry();
    expect((await pending).statusCode).toBe(200);
  });

  it('a registry read failure is still a 500, whatever the billing read did', async () => {
    sendMock.mockReset();
    sendMock.mockImplementation((command) =>
      command.input.TableName === BILLING_TABLE
        ? Promise.resolve({ Item: undefined })
        : Promise.reject(new Error('registry down'))
    );
    const res = await handler({
      headers: { 'x-api-key': API_KEY, origin: 'https://app.beanies.family' },
      pathParameters: { familyId: FAMILY_ID },
      requestContext: { http: { method: 'GET' } },
    });
    expect(res.statusCode).toBe(500);
  });

  it('unset BILLING_TABLE_NAME before launch is a supported config: `beta`, no read, no error', async () => {
    delete process.env.BILLING_TABLE_NAME;
    const { body } = await get(ROW);
    expect(body.entitlement.state).toBe('beta');
    expect(billingReads()).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('unset BILLING_TABLE_NAME after launch refuses to guess: `entitlement: null` + error', async () => {
    delete process.env.BILLING_TABLE_NAME;
    process.env.V1_LAUNCH_AT = LAUNCH;
    const { res, body } = await get(ROW);
    expect(res.statusCode).toBe(200);
    expect(body.entitlement).toBeNull();
    expect(errorSpy.mock.calls[0][0]).toContain('entitlement_unavailable');
  });

  it('an unparseable V1_LAUNCH_AT computes `beta` and says so', async () => {
    process.env.V1_LAUNCH_AT = 'next tuesday';
    const { body } = await get(ROW);
    expect(body.entitlement.state).toBe('beta');
    expect(computedLines()[0].launch_set).toBe(false);
    expect(errorSpy.mock.calls[0][0]).toContain('entitlement_launch_invalid');
  });

  it('a subscribed family with a garbage createdAt does not warn (createdAt was never used)', async () => {
    process.env.V1_LAUNCH_AT = '2025-01-01T00:00:00.000Z';
    const { body } = await get(
      { ...ROW, createdAt: 'garbage' },
      { billing: { status: 'active', plan: 'full' } }
    );
    expect(body.entitlement.state).toBe('active');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('an overridden trial with a garbage createdAt does not warn', async () => {
    process.env.V1_LAUNCH_AT = '2025-01-01T00:00:00.000Z';
    const { body } = await get(
      { ...ROW, createdAt: 'garbage' },
      { billing: { trialEndsAt: '2999-01-01T00:00:00.000Z' } }
    );
    expect(body.entitlement.state).toBe('trial');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a row with no usable createdAt gets a full trial and a warning', async () => {
    process.env.V1_LAUNCH_AT = '2025-01-01T00:00:00.000Z';
    const { body } = await get({ ...ROW, createdAt: 'garbage' });
    expect(body.entitlement.state).toBe('trial');
    expect(warnSpy.mock.calls[0][0]).toContain('entitlement_created_at_invalid');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(FAMILY_ID);
  });
});
