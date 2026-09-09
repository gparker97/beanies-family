/* global process */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

let handler;

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
        familyName: 'The Parker Beanies',
      }
    );
    expect(item.familyName).toBe('The Parker Beanies');
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

/** Drive a GET through the handler. */
async function get(existing = null) {
  sendMock.mockReset();
  sendMock.mockImplementation(() =>
    Promise.resolve({ Item: existing ? marshall(existing) : undefined })
  );
  const res = await handler({
    headers: { 'x-api-key': API_KEY, origin: 'https://app.beanies.family' },
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
    provider: 'google_drive',
    fileId: 'FILE-1',
    displayPath: '/beanies/pod.beanpod',
    familyName: 'The Parkers',
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
      },
      TOMB
    );
    expect(item.createdAt).toBe('2025-03-01T00:00:00.000Z');
    expect(item.ownerMemberId).toBe(M_A);
    // Signed up on iOS then re-registered from a browser: still iOS.
    expect(item.signupPlatform).toBe('ios');
  });

  it('clears deletedAt, so the row is live again', async () => {
    const { item } = await put(
      { provider: 'google_drive', fileId: 'FILE-2', ownerMemberId: M_A, writerMemberId: M_A },
      TOMB
    );
    expect(item.deletedAt).toBeUndefined();
  });

  it('still refuses a non-owner the pointer on a tombstoned row', async () => {
    // Deleting a family does not relinquish ownership of its id.
    const { res, item } = await put(
      { provider: 'google_drive', fileId: 'MEMBER-COPY', ownerMemberId: M_A, writerMemberId: M_B },
      TOMB
    );
    expect(JSON.parse(res.body).pointerAccepted).toBe(false);
    expect(item.fileId).toBeNull();
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

  beforeEach(() => {
    // `spyOn` on an already-spied method hands back the SAME spy, so without the
    // clear the call history accumulates across tests in this block and the
    // "is silent" assertion reads three earlier tests' warns as its own.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
  });

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

  it('a REFUSED write leaves the family deleted', async () => {
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
    expect(item.deletedAt).toBe('2026-09-09T00:00:00.000Z');
    expect(item.fileId).toBeNull();
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

  it('a same-pointer write lifts it too — it is not moving anything', async () => {
    const { item } = await put(
      { provider: 'local', ownerMemberId: M_A, writerMemberId: M_B },
      { ...TOMB, provider: 'local', fileId: null, displayPath: null }
    );
    expect(item.deletedAt).toBeUndefined();
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
