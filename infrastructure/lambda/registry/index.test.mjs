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
