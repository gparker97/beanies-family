/* global process */
/**
 * #125 handler cases: the step-1 write (`signupStart`), the signup-gated `createdAt`, the
 * `deviceCountry` stamp, `DELETE ?neverFinishedOnly=1` and create-time inference.
 *
 * Its own copy of the client mock (index.test.mjs has the same scaffold): `vi.mock` is hoisted
 * per file, so a shared helper module would fight the hoisting rules, and duplicating twenty
 * lines is the smaller cost than pushing index.test.mjs past 3000 lines.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    QueryCommand: class QueryCommand extends Command {},
  };
});

const API_KEY = 'test-key';
const FAMILY_ID = '11111111-2222-4333-8444-555555555555';
const FAMILY_HASH = createHash('sha256').update(FAMILY_ID).digest('hex');
const M_OWNER = 'aaaaaaaa-1111-4222-8333-444444444444';
const M_OTHER = 'bbbbbbbb-1111-4222-8333-444444444444';
const APP_ORIGIN = 'https://app.beanies.family';
const DEV_ORIGIN = 'http://localhost:5173';
const NOW = '2026-10-07T08:00:00.000Z';
const NOW_SEC = Date.parse(NOW) / 1000;
const STARTED = '2026-10-07T07:50:00.000Z';
const TAG = {
  utm_source: 'chatgpt',
  utm_medium: 'cpc',
  utm_campaign: 'sg-pilot-oct26',
  utm_content: 'funny-dinner',
};

let handler;

function setEnv() {
  process.env.TABLE_NAME = 'registry-prod';
  process.env.DEV_TABLE_NAME = 'registry-dev';
  process.env.REGISTRY_API_KEY = API_KEY;
  process.env.CORS_ORIGIN = `${APP_ORIGIN},${DEV_ORIGIN}`;
  process.env.DEV_ORIGINS = DEV_ORIGIN;
  process.env.EVENTS_TABLE_NAME = 'events-prod';
  process.env.EVENTS_DEV_TABLE_NAME = 'events-dev';
}

beforeAll(async () => {
  setEnv();
  ({ handler } = await import('./index.mjs'));
});

let logSpy;
let warnSpy;
let errorSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/**
 * Drive one request. `rows` is what successive registry GetItems return (the last one repeats),
 * `putErrors` what successive PutItems throw (undefined = success), `queryItems` the ledger rows a
 * Query returns, or an Error to throw.
 */
async function call(
  method,
  {
    body,
    rows = [null],
    putErrors = [],
    queryItems = [],
    queryStringParameters,
    origin = APP_ORIGIN,
  } = {}
) {
  let gets = 0;
  let puts = 0;
  sendMock.mockReset();
  sendMock.mockImplementation((command) => {
    const kind = command.constructor.name;
    if (kind === 'GetItemCommand') {
      const row = rows[Math.min(gets, rows.length - 1)];
      gets += 1;
      return Promise.resolve({ Item: row ? marshall(row) : undefined });
    }
    if (kind === 'QueryCommand') {
      if (queryItems instanceof Error) return Promise.reject(queryItems);
      return Promise.resolve({ Items: queryItems.map((i) => marshall(i)) });
    }
    const err = putErrors.at(puts);
    puts += 1;
    return err ? Promise.reject(err) : Promise.resolve({});
  });
  const res = await handler({
    headers: { 'x-api-key': API_KEY, origin },
    pathParameters: { familyId: FAMILY_ID },
    requestContext: { http: { method } },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(queryStringParameters ? { queryStringParameters } : {}),
  });
  const commands = sendMock.mock.calls.map((c) => c[0]);
  const putCmds = commands.filter((c) => c.constructor.name === 'PutItemCommand');
  const last = putCmds.at(-1);
  return {
    res,
    body: JSON.parse(res.body),
    item: last ? unmarshall(last.input.Item) : null,
    puts: putCmds,
    queries: commands.filter((c) => c.constructor.name === 'QueryCommand'),
  };
}

const put = (body, opts = {}) => call('PUT', { body, ...opts });

/** Structured JSON log lines with this `msg`, parsed. */
function lines(msg) {
  return logSpy.mock.calls
    .map((c) => c[0])
    .filter((l) => typeof l === 'string' && l.startsWith('{'))
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === msg);
}

/** Everything any console method received, as one string (for "never logged" assertions). */
const allLogged = () =>
  JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]);

/** The body the wizard's step 1 sends (B2 `buildRegistryPayload` with `signupStart: true`). */
const stepOneBody = (over = {}) => ({
  signupStart: true,
  isSignupEvent: false,
  isLoginEvent: false,
  ownerSync: false,
  familyName: 'The Brambleworths',
  ownerEmail: 'owner@example.com',
  ownerMemberId: M_OWNER,
  writerMemberId: M_OWNER,
  subscribeNewsletter: true,
  signupPlatform: 'ios',
  attribution: null,
  deviceTimeZone: 'Asia/Singapore',
  ...over,
});

/** A step-1 row as `buildSignupStartItem` stores it. */
const STEP_ONE_ROW = {
  familyId: FAMILY_ID,
  familyName: 'The Brambleworths',
  ownerEmail: 'owner@example.com',
  ownerMemberId: M_OWNER,
  subscribeNewsletter: true,
  signupPlatform: 'ios',
  attribution: null,
  heardVia: null,
  attributionInferred: null,
  signupStartedAt: STARTED,
  deviceCountry: 'SG',
  updatedAt: STARTED,
};

/** The pod-creation write `createNewFile` sends. */
const podCreateBody = (over = {}) => ({
  provider: 'google_drive',
  fileId: 'FILE-1',
  displayPath: 'brambleworths.beanpod',
  familyName: 'The Brambleworths',
  ownerEmail: 'owner@example.com',
  ownerMemberId: M_OWNER,
  writerMemberId: M_OWNER,
  isLoginEvent: true,
  isSignupEvent: true,
  signupPlatform: 'ios',
  deviceTimeZone: 'Asia/Singapore',
  ...over,
});

/** A ledger store tap `minutesBefore` NOW. */
const tap = (eventId, minutesBefore, { platform = 'ios', fields = TAG } = {}) => {
  const tsEpoch = NOW_SEC - minutesBefore * 60;
  return {
    eventId,
    kind: 'store_tap',
    platform,
    tagged: !!fields,
    ...(fields ? { fields } : {}),
    ts: new Date(tsEpoch * 1000).toISOString(),
    tsEpoch,
    loc: '/ios',
  };
};

const ccfe = () =>
  Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

// ─── Step 1 (signupStart) ───────────────────────────────────────────────────

describe('registry PUT signupStart: the create-only step-1 write (#125)', () => {
  it('creates the step-1 row on an empty key, with no pointer, createdAt or activity at all', async () => {
    const { res, body, item, puts } = await put(stepOneBody());
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ success: true, signupStart: 'created', deviceCountry: 'SG' });
    expect(item).toEqual({
      familyId: FAMILY_ID,
      familyName: 'The Brambleworths',
      ownerEmail: 'owner@example.com',
      ownerMemberId: M_OWNER,
      subscribeNewsletter: true,
      signupPlatform: 'ios',
      attribution: null,
      heardVia: null,
      attributionInferred: null,
      signupStartedAt: NOW,
      deviceCountry: 'SG',
      updatedAt: NOW,
    });
    // Omitted entirely, not 'local' / null: every pointer reader keys on presence.
    for (const absent of [
      'provider',
      'fileId',
      'displayPath',
      'createdAt',
      'lastLoginAt',
      'country',
      'memberCount',
      'beanpodSizeKb',
    ]) {
      expect(item).not.toHaveProperty(absent);
    }
    // The ordinary first write's condition: a row created since the read is never overwritten.
    expect(puts[0].input.ConditionExpression).toBe('attribute_not_exists(familyId)');
  });

  it('never stores the transient flags, and never logs the zone', async () => {
    const { item } = await put(stepOneBody());
    expect(item).not.toHaveProperty('signupStart');
    expect(item).not.toHaveProperty('deviceTimeZone');
    expect(allLogged()).not.toContain('Asia/Singapore');
  });

  it('validates the stamped fields like the ordinary write (platform, attribution, email)', async () => {
    const { item } = await put(
      stepOneBody({
        signupPlatform: 'windows-phone',
        attribution: { utm_source: 'chatgpt', utm_term: 'bad value!' },
        ownerEmail: '1700000000@temp.beanies.family',
      })
    );
    expect(item.signupPlatform).toBeNull();
    expect(item.attribution).toEqual({ utm_source: 'chatgpt' });
    expect(item.ownerEmail).toBeNull();
  });

  it('logs one registry_signup_start line (hash only)', async () => {
    await put(stepOneBody());
    expect(lines('registry_signup_start')).toEqual([
      {
        msg: 'registry_signup_start',
        family_id_hash: FAMILY_HASH,
        outcome: 'created',
        platform: 'ios',
        has_country: true,
      },
    ]);
    expect(allLogged()).not.toContain(FAMILY_ID);
  });

  it('an unknown zone stores and returns a null country', async () => {
    const { body, item } = await put(stepOneBody({ deviceTimeZone: 'Etc/UTC' }));
    expect(item.deviceCountry).toBeNull();
    expect(body.deviceCountry).toBeNull();
    expect(lines('registry_signup_start')[0].has_country).toBe(false);
  });

  it('answers `exists` and writes nothing on a live row', async () => {
    const live = { ...STEP_ONE_ROW, createdAt: NOW, provider: 'local' };
    const { body, puts } = await put(stepOneBody(), { rows: [live] });
    expect(body).toEqual({ success: true, signupStart: 'exists' });
    expect(puts).toHaveLength(0);
    expect(lines('registry_signup_start')[0].outcome).toBe('exists');
  });

  it('answers `exists` and writes nothing on a tombstone (never lifts it)', async () => {
    const tomb = { familyId: FAMILY_ID, ownerMemberId: M_OWNER, deletedAt: STARTED };
    const { body, puts } = await put(stepOneBody(), { rows: [tomb] });
    expect(body.signupStart).toBe('exists');
    expect(puts).toHaveLength(0);
  });

  it('a concurrent create (ConditionalCheckFailedException) re-runs the round and answers `exists`', async () => {
    const { body, puts } = await put(stepOneBody(), {
      rows: [null, STEP_ONE_ROW],
      putErrors: [ccfe()],
    });
    expect(body).toEqual({ success: true, signupStart: 'exists' });
    expect(puts).toHaveLength(1);
    expect(lines('registry_signup_start').map((l) => l.outcome)).toEqual(['exists']);
    // Named as a create race, so a CloudWatch filter on the handover string never counts it.
    const retryWarns = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(retryWarns).toHaveLength(1);
    expect(retryWarns[0]).toContain('signup-start create race');
    expect(retryWarns[0]).not.toContain('owner-version conflict');
  });

  it.each([
    ['a writer who is not the owner it stamps', { writerMemberId: M_OTHER }],
    ['no writer id', { writerMemberId: undefined }],
    ['a null writer id', { writerMemberId: null }],
    ['an empty writer id', { writerMemberId: '', ownerMemberId: '' }],
  ])('refuses %s and writes nothing', async (_label, over) => {
    const { body, puts } = await put(stepOneBody(over));
    expect(body).toEqual({ success: true, signupStart: 'refused' });
    expect(puts).toHaveLength(0);
    expect(lines('registry_signup_start')[0].outcome).toBe('refused');
  });

  it('is judged by the step-1 arm alone even with isSignupEvent / isLoginEvent / ownerSync true', async () => {
    const { body, item } = await put(
      stepOneBody({ isSignupEvent: true, isLoginEvent: true, ownerSync: true })
    );
    expect(body.signupStart).toBe('created');
    expect(item).not.toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('lastLoginAt');
    expect(item).not.toHaveProperty('provider');
    expect(lines('registry_owner_sync')).toHaveLength(0);
  });

  it('does not answer with the step-1 field when the flag is not exactly true', async () => {
    const { body } = await put(stepOneBody({ signupStart: 'yes' }));
    expect(body).not.toHaveProperty('signupStart');
    expect(body.pointerAccepted).toBe(true);
  });
});

// ─── createdAt gate + carried fields ────────────────────────────────────────

describe('registry PUT: createdAt is stamped only by the pod-creation write on a step-1 row (#125)', () => {
  /** The country watcher's PUT (`registerCurrentFamily`): owner device, not a signup. */
  const watcherBody = {
    provider: 'local',
    ownerMemberId: M_OWNER,
    writerMemberId: M_OWNER,
    isLoginEvent: false,
    isSignupEvent: false,
    country: 'SG',
  };

  it('a watcher / background PUT on a step-1 row leaves createdAt absent', async () => {
    const { item } = await put(watcherBody, { rows: [STEP_ONE_ROW] });
    expect(item).not.toHaveProperty('createdAt');
    expect(item.signupStartedAt).toBe(STARTED);
    expect(item.deviceCountry).toBe('SG');
    expect(item.country).toBe('SG');
  });

  it('a login PUT on a step-1 row does not stamp createdAt either', async () => {
    const { item } = await put({ ...watcherBody, isLoginEvent: true }, { rows: [STEP_ONE_ROW] });
    expect(item).not.toHaveProperty('createdAt');
  });

  it('the pod-creation write lands the pointer and createdAt on the SAME row, keeping step-1 fields', async () => {
    // A watcher PUT may already have stamped a `local` pointer: the real one replaces it.
    const watched = { ...STEP_ONE_ROW, provider: 'local', fileId: null, country: 'SG' };
    const { body, item } = await put(podCreateBody(), { rows: [watched] });
    expect(body.pointerAccepted).toBe(true);
    expect(item.createdAt).toBe(NOW);
    expect(item.provider).toBe('google_drive');
    expect(item.fileId).toBe('FILE-1');
    expect(item.signupStartedAt).toBe(STARTED);
    expect(item.ownerMemberId).toBe(M_OWNER);
    expect(item.subscribeNewsletter).toBe(true);
    expect(item.lastLoginAt).toBe(NOW.slice(0, 10));
  });

  it('a legacy row (no signupStartedAt) still stamps createdAt on any write', async () => {
    const legacy = { familyId: FAMILY_ID, provider: 'local', ownerMemberId: M_OWNER };
    const { item } = await put(watcherBody, { rows: [legacy] });
    expect(item.createdAt).toBe(NOW);
    expect(item.signupStartedAt).toBeNull();
  });

  it('a first write with no row stamps createdAt exactly as before (old clients)', async () => {
    const { item } = await put({ provider: 'local' });
    expect(item.createdAt).toBe(NOW);
  });

  it('never moves an existing createdAt', async () => {
    const pod = { ...STEP_ONE_ROW, createdAt: '2026-10-07T07:55:00.000Z', provider: 'local' };
    const { item } = await put(podCreateBody(), { rows: [pod] });
    expect(item.createdAt).toBe('2026-10-07T07:55:00.000Z');
  });

  it('signupStartedAt and deviceCountry survive a member device write', async () => {
    const pod = { ...STEP_ONE_ROW, createdAt: NOW, provider: 'local' };
    const { item } = await put(
      { provider: 'local', ownerMemberId: M_OWNER, writerMemberId: M_OTHER, isLoginEvent: true },
      { rows: [pod] }
    );
    expect(item.signupStartedAt).toBe(STARTED);
    expect(item.deviceCountry).toBe('SG');
  });

  it('never stores the transient deviceTimeZone on an ordinary PUT', async () => {
    const { item } = await put(podCreateBody({ signupPlatform: 'web' }));
    expect(item).not.toHaveProperty('deviceTimeZone');
    expect(item).not.toHaveProperty('signupStart');
  });
});

describe('registry PUT: deviceCountry is write-once, stamped by signup writes only (#125)', () => {
  it('the pod-creation write stamps it and returns it', async () => {
    const { body, item } = await put(podCreateBody({ signupPlatform: 'web' }));
    expect(item.deviceCountry).toBe('SG');
    expect(body.deviceCountry).toBe('SG');
  });

  it('an old client (no zone sent) stamps null', async () => {
    const { body, item } = await put(
      podCreateBody({ signupPlatform: 'web', deviceTimeZone: undefined })
    );
    expect(item.deviceCountry).toBeNull();
    expect(body.deviceCountry).toBeNull();
  });

  it('a null stored at step 1 is re-evaluated by the pod-creation write', async () => {
    const row = { ...STEP_ONE_ROW, signupPlatform: 'web', deviceCountry: null };
    const { item } = await put(podCreateBody({ deviceTimeZone: 'America/Los_Angeles' }), {
      rows: [row],
    });
    expect(item.deviceCountry).toBe('US');
  });

  it('a stamped value never moves, and a non-signup write never stamps', async () => {
    const moved = await put(podCreateBody({ deviceTimeZone: 'America/Los_Angeles' }), {
      rows: [{ ...STEP_ONE_ROW, signupPlatform: 'web' }],
    });
    expect(moved.item.deviceCountry).toBe('SG');
    const notSignup = await put({ provider: 'local', deviceTimeZone: 'Asia/Singapore' });
    expect(notSignup.item.deviceCountry).toBeNull();
  });

  it('a non-signup PUT response carries no signup fields', async () => {
    const { body } = await put({ provider: 'local', isLoginEvent: true });
    expect(body).toEqual({ success: true, pointerAccepted: true });
  });
});

// ─── DELETE ?neverFinishedOnly=1 (Start over) ───────────────────────────────

describe('registry DELETE ?neverFinishedOnly=1: start over (#125)', () => {
  const del = (row, params = {}) =>
    call('DELETE', {
      rows: [row],
      queryStringParameters: { writerMemberId: M_OWNER, neverFinishedOnly: '1', ...params },
    });

  it('tombstones a step-1 row, keeping signupStartedAt and deviceCountry', async () => {
    const { res, item } = await del(STEP_ONE_ROW);
    expect(res.statusCode).toBe(200);
    expect(item.deletedAt).toBe(NOW);
    expect(item.signupStartedAt).toBe(STARTED);
    expect(item.deviceCountry).toBe('SG');
    expect(item.ownerMemberId).toBe(M_OWNER);
    expect(item).not.toHaveProperty('familyName');
    expect(item).not.toHaveProperty('subscribeNewsletter');
    expect(lines('registry_start_over')).toEqual([
      { msg: 'registry_start_over', family_id_hash: FAMILY_HASH, outcome: 'tombstoned' },
    ]);
  });

  it('leaves a pod row untouched (createdAt present)', async () => {
    const pod = { ...STEP_ONE_ROW, createdAt: NOW, provider: 'google_drive', fileId: 'F' };
    const { body, puts } = await del(pod);
    expect(body).toEqual({ success: true, skipped: 'pod-exists' });
    expect(puts).toHaveLength(0);
    expect(lines('registry_start_over')[0].outcome).toBe('skipped-pod-exists');
  });

  it('leaves a legacy pod row untouched (neither stamp)', async () => {
    const { body, puts } = await del({ familyId: FAMILY_ID, provider: 'local' });
    expect(body.skipped).toBe('pod-exists');
    expect(puts).toHaveLength(0);
  });

  it('an already-tombstoned step-1 row: writes nothing, answers already-tombstoned, logs it once', async () => {
    const tomb = { ...STEP_ONE_ROW, deletedAt: STARTED };
    const { res, body, puts } = await del(tomb);
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ success: true, skipped: 'already-tombstoned' });
    expect(puts).toHaveLength(0);
    expect(lines('registry_start_over')).toEqual([
      { msg: 'registry_start_over', family_id_hash: FAMILY_HASH, outcome: 'already-tombstoned' },
    ]);
  });

  it('no row: the idempotent success, logged as no-row', async () => {
    const { body, puts } = await del(null);
    expect(body).toEqual({ success: true });
    expect(puts).toHaveLength(0);
    expect(lines('registry_start_over')[0].outcome).toBe('no-row');
  });

  it('without the flag, the tombstone is exactly the pre-#125 item plus the two kept fields', async () => {
    const pod = {
      familyId: FAMILY_ID,
      createdAt: '2025-03-01T00:00:00.000Z',
      ownerMemberId: M_OWNER,
      ownerEmail: 'owner@example.com',
      country: 'SG',
      signupPlatform: 'ios',
      provider: 'google_drive',
      fileId: 'FILE-1',
      familyName: 'The Brambleworths',
      subscribeNewsletter: true,
      lastLoginAt: '2026-09-01',
    };
    const { body, item } = await call('DELETE', {
      rows: [pod],
      queryStringParameters: { writerMemberId: M_OWNER },
    });
    expect(body).toEqual({ success: true });
    expect(item).toEqual({
      familyId: FAMILY_ID,
      createdAt: '2025-03-01T00:00:00.000Z',
      ownerMemberId: M_OWNER,
      ownerEmail: 'owner@example.com',
      ownerHandoverAt: null,
      country: 'SG',
      signupPlatform: 'ios',
      attribution: null,
      heardVia: null,
      attributionInferred: null,
      signupStartedAt: null,
      deviceCountry: null,
      deletedAt: NOW,
      updatedAt: NOW,
    });
    expect(lines('registry_start_over')).toHaveLength(0);
  });

  it('without the flag, a step-1 row is tombstoned too (the flag only narrows)', async () => {
    const { item } = await call('DELETE', {
      rows: [STEP_ONE_ROW],
      queryStringParameters: { writerMemberId: M_OWNER },
    });
    expect(item.deletedAt).toBe(NOW);
  });
});

// ─── Create-time inference ──────────────────────────────────────────────────

describe('registry PUT: create-time inference on the pod-creation write (#125)', () => {
  const inference = () => lines('attribution_inference');

  it('scores a native untagged pod against a near tap, stores it and returns band + fields', async () => {
    const { body, item, queries } = await put(podCreateBody(), {
      rows: [STEP_ONE_ROW],
      queryItems: [tap('e1', 5)],
    });
    expect(queries).toHaveLength(1);
    expect(item.attributionInferred).toEqual({
      fields: TAG,
      confidence: 1,
      band: 'high',
      method: 'store_tap_v1',
      eventId: 'e1',
      gapMinutes: 5,
      candidates: 1,
      scoredAt: NOW,
    });
    expect(body.attributionInferred).toEqual({ band: 'high', fields: TAG });
    expect(body.deviceCountry).toBe('SG');
    expect(inference()).toEqual([
      {
        msg: 'attribution_inference',
        family_id_hash: FAMILY_HASH,
        platform: 'ios',
        outcome: 'scored',
        band: 'high',
        candidates: 1,
        gap_minutes: 5,
      },
    ]);
  });

  it('queries the sparse index, newest first, bounded to the 72-hour window', async () => {
    const { queries } = await put(podCreateBody(), { rows: [STEP_ONE_ROW] });
    const input = queries[0].input;
    expect(input.TableName).toBe('events-prod');
    expect(input.IndexName).toBe('platform-tsEpoch-index');
    expect(input.KeyConditionExpression).toBe('#p = :p AND tsEpoch BETWEEN :from AND :to');
    expect(input.ExpressionAttributeNames).toEqual({ '#p': 'platform' });
    expect(unmarshall(input.ExpressionAttributeValues)).toEqual({
      ':p': 'ios',
      ':from': NOW_SEC - 72 * 3600,
      ':to': NOW_SEC,
    });
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(200);
  });

  it('a dev origin queries the dev events table', async () => {
    const { queries } = await put(podCreateBody(), { rows: [STEP_ONE_ROW], origin: DEV_ORIGIN });
    expect(queries[0].input.TableName).toBe('events-dev');
  });

  it('also scores an old client creating a native pod with no step-1 row (requirement 12)', async () => {
    const { item } = await put(podCreateBody({ deviceTimeZone: undefined }), {
      queryItems: [tap('e1', 5)],
    });
    expect(item.attributionInferred.band).toBe('high');
    expect(item.deviceCountry).toBeNull();
  });

  it('no candidates: stores and returns null, logs no-candidates', async () => {
    const { body, item } = await put(podCreateBody(), { rows: [STEP_ONE_ROW], queryItems: [] });
    expect(item.attributionInferred).toBeNull();
    expect(body.attributionInferred).toBeNull();
    expect(inference()[0]).toMatchObject({ outcome: 'no-candidates', candidates: 0 });
  });

  it('below threshold: stores null, logs below-threshold', async () => {
    const { item } = await put(podCreateBody(), {
      rows: [STEP_ONE_ROW],
      queryItems: [tap('e1', 24 * 60)],
    });
    expect(item.attributionInferred).toBeNull();
    expect(inference()[0]).toMatchObject({ outcome: 'below-threshold', candidates: 1 });
  });

  it('a deterministic tag skips inference (no Query)', async () => {
    const tagged = { ...STEP_ONE_ROW, attribution: { utm_source: 'chatgpt' } };
    const { item, queries } = await put(podCreateBody(), { rows: [tagged] });
    expect(queries).toHaveLength(0);
    expect(item.attributionInferred).toBeNull();
    expect(inference()).toHaveLength(0);
  });

  it('a web pod skips inference (no Query)', async () => {
    const { queries } = await put(podCreateBody({ signupPlatform: 'web' }));
    expect(queries).toHaveLength(0);
  });

  it('a stored inferred value is kept and never re-queried', async () => {
    const stored = { band: 'medium', fields: TAG, eventId: 'old', method: 'store_tap_v1' };
    const { body, item, queries } = await put(podCreateBody(), {
      rows: [{ ...STEP_ONE_ROW, attributionInferred: stored }],
    });
    expect(queries).toHaveLength(0);
    expect(item.attributionInferred).toEqual(stored);
    expect(body.attributionInferred).toEqual({ band: 'medium', fields: TAG });
  });

  it('a non-signup write never queries, even on a step-1 row', async () => {
    const { queries } = await put(
      { provider: 'local', ownerMemberId: M_OWNER, writerMemberId: M_OWNER, isLoginEvent: true },
      { rows: [STEP_ONE_ROW] }
    );
    expect(queries).toHaveLength(0);
  });

  it('a Query error leaves the PUT intact: pointer, createdAt, null inference, logged', async () => {
    const { res, body, item } = await put(podCreateBody(), {
      rows: [STEP_ONE_ROW],
      queryItems: Object.assign(new Error('AccessDenied'), { name: 'AccessDeniedException' }),
    });
    expect(res.statusCode).toBe(200);
    expect(body.pointerAccepted).toBe(true);
    expect(item.createdAt).toBe(NOW);
    expect(item.fileId).toBe('FILE-1');
    expect(item.attributionInferred).toBeNull();
    expect(inference()[0]).toMatchObject({ outcome: 'error', reason: 'ddb_query' });
    expect(errorSpy.mock.calls[0][0]).toContain('platform-tsEpoch-index');
    expect(errorSpy.mock.calls[0][0]).toContain('dynamodb:Query');
  });
});

describe('registry PUT: create-time inference with no events table configured (#125)', () => {
  // The env is read at module load, so this case needs a fresh import (the V1_LAUNCH_AT precedent).
  let fileHandler;
  beforeAll(async () => {
    fileHandler = handler;
    delete process.env.EVENTS_TABLE_NAME;
    delete process.env.EVENTS_DEV_TABLE_NAME;
    vi.resetModules();
    ({ handler } = await import('./index.mjs'));
  });
  afterAll(() => {
    handler = fileHandler;
    setEnv();
  });

  it('skips with reason no-events-table and still creates the pod', async () => {
    const { res, item, queries } = await put(podCreateBody(), { rows: [STEP_ONE_ROW] });
    expect(res.statusCode).toBe(200);
    expect(queries).toHaveLength(0);
    expect(item.createdAt).toBe(NOW);
    expect(item.attributionInferred).toBeNull();
    expect(lines('attribution_inference')).toEqual([
      {
        msg: 'attribution_inference',
        family_id_hash: FAMILY_HASH,
        platform: 'ios',
        outcome: 'skipped',
        reason: 'no-events-table',
      },
    ]);
  });
});
