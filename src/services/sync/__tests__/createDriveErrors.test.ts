/**
 * The create flow's Drive error registry and its classifier.
 *
 * ⚠️ THIS FILE MOCKS NEITHER `googleAuth` NOR `driveService`, AND THAT IS THE POINT. The
 * classifier runs inside surfaces whose tests replace `googleAuth` wholesale (49 files) and inside
 * the dependency-light `resumePaths`, so it must work from leaf modules alone. Every input below
 * is a plain object or an `Error` carrying `name` / `status` / `reason`, which proves no class
 * identity from those modules is needed. Only the `@/types/sync` classes are matched by identity.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  CREATE_DRIVE_ERRORS,
  DRIVE_CONNECT_TIMEOUT_NAME,
  classifyCreateDriveFailure,
  createDriveFailureMessage,
  createDriveRecoveries,
  isCreateDriveErrorCode,
  type CreateDriveErrorCode,
} from '../createDriveErrors';
import { POPUP_AUTH_TIMEOUT_NAME, POPUP_BLOCKED_MESSAGE } from '@/services/google/oauthError';
import {
  CollisionCheckUnavailableError,
  DriveConsentDeniedError,
  FileNameCollisionError,
  OAuthRoundTripAbandonedError,
} from '@/types/sync';
import { UI_STRINGS, BEANIE_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { ZH_STRINGS } from '@/services/translation/zh';

/** An `Error` with the duck-typed fields the Drive and auth layers attach. */
function err(
  message: string,
  fields: { name?: string; status?: number; reason?: string; timedOut?: boolean } = {}
): Error {
  const e = new Error(message) as Error & Record<string, unknown>;
  if (fields.name) e.name = fields.name;
  if (fields.status !== undefined) e.status = fields.status;
  if (fields.reason !== undefined) e.reason = fields.reason;
  if (fields.timedOut !== undefined) e.timedOut = fields.timedOut;
  return e;
}

const ALL_CODES: readonly CreateDriveErrorCode[] = [
  'popup-blocked',
  'timeout',
  'offline',
  'consent-denied',
  'cancelled',
  'access-denied',
  'app-blocked',
  'auth-expired',
  'drive-busy',
  'drive-full',
  'drive-api-disabled',
  'name-collision',
  'collision-check-unavailable',
  'unsupported-browser',
  'unknown',
];

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe('classifyCreateDriveFailure: one input per code', () => {
  const rows: Array<[string, unknown, CreateDriveErrorCode]> = [
    ['an abandoned native round trip', new OAuthRoundTripAbandonedError('dismissed'), 'cancelled'],
    ['a denied file-access scope', new DriveConsentDeniedError('not granted'), 'consent-denied'],
    [
      'a same-name file',
      new FileNameCollisionError('exists', 'file-1', 'f.beanpod', true),
      'name-collision',
    ],
    [
      'a failed collision check',
      new CollisionCheckUnavailableError('could not list'),
      'collision-check-unavailable',
    ],
    ['the 150 s connect cap', err('too long', { name: DRIVE_CONNECT_TIMEOUT_NAME }), 'timeout'],
    ['the 120 s popup cap', err('no return', { name: POPUP_AUTH_TIMEOUT_NAME }), 'timeout'],
    [
      'a Drive request timeout (DriveTimeoutError shape)',
      err('Drive request timed out', { name: 'DriveTimeoutError', status: 408, timedOut: true }),
      'timeout',
    ],
    // A description does not prove a block (the #128 fixture is a localized plain decline), and
    // it is not the person's own Cancel either: its own neutral code.
    ['a described access_denied', err('access_denied: Zugriff verweigert'), 'access-denied'],
    ['a bare access_denied (Cancel on the consent screen)', err('access_denied'), 'cancelled'],
    ['admin_policy_enforced', 'admin_policy_enforced', 'app-blocked'],
    ['org_internal', err('org_internal'), 'app-blocked'],
    ['a 403 domainPolicy', err('policy', { status: 403, reason: 'domainPolicy' }), 'app-blocked'],
    ['a 401', err('Unauthorized', { status: 401 }), 'auth-expired'],
    ['a TokenExpiredError by name', err('expired', { name: 'TokenExpiredError' }), 'auth-expired'],
    [
      'a TokenExpiredError by its message contract',
      err('token rejected and silent refresh failed'),
      'auth-expired',
    ],
    [
      'a full Drive',
      err("The user's Drive storage quota has been exceeded.", {
        status: 403,
        reason: 'storageQuotaExceeded',
      }),
      'drive-full',
    ],
    [
      'a per-user throttle',
      err('Rate Limit', { status: 403, reason: 'userRateLimitExceeded' }),
      'drive-busy',
    ],
    [
      'a project quota throttle',
      err('Quota', { status: 403, reason: 'quotaExceeded' }),
      'drive-busy',
    ],
    ['a 429', err('Too Many Requests', { status: 429 }), 'drive-busy'],
    ['a 5xx', err('Backend Error', { status: 503 }), 'drive-busy'],
    [
      'the Drive API switched off for the project',
      err('Access Not Configured', { status: 403, reason: 'accessNotConfigured' }),
      'drive-api-disabled',
    ],
    // `offline` even while `navigator.onLine` is true (the table's default): it stays true on a
    // dead Wi-Fi link, and `unknown` would page Slack on every tap.
    ['a network failure', new TypeError('Failed to fetch'), 'offline'],
    ['an iOS network failure', new TypeError('Load failed'), 'offline'],
    ['a blocked popup', err(POPUP_BLOCKED_MESSAGE), 'popup-blocked'],
    ['a closed popup', err('Authentication cancelled'), 'cancelled'],
    [
      'some other 403',
      err('Forbidden', { status: 403, reason: 'insufficientPermissions' }),
      'unknown',
    ],
    ['anything else', err('Something odd'), 'unknown'],
    ['a non-error', undefined, 'unknown'],
  ];

  it.each(rows)('%s', (_label, input, code) => {
    expect(classifyCreateDriveFailure(input)).toBe(code);
  });

  it('offline when the browser says so and nothing more definite applies', () => {
    setOnline(false);
    expect(classifyCreateDriveFailure(err('Something odd'))).toBe('offline');
  });

  it.each([
    ['Failed to fetch', new TypeError('Failed to fetch')],
    ['Load failed', new TypeError('Load failed')],
    [
      'an iOS URLSession offline message',
      new TypeError('The Internet connection appears to be offline.'),
    ],
  ])('a network failure (%s) is offline whatever navigator.onLine says', (_label, e) => {
    setOnline(false);
    expect(classifyCreateDriveFailure(e)).toBe('offline');
    setOnline(true);
    expect(classifyCreateDriveFailure(e)).toBe('offline');
  });

  it('timeout and server stay transient whatever navigator.onLine says', () => {
    for (const online of [true, false]) {
      setOnline(online);
      expect(classifyCreateDriveFailure(new TypeError('The request timed out.'))).toBe('timeout');
      expect(classifyCreateDriveFailure(err('Backend Error', { status: 500 }))).toBe('drive-busy');
    }
  });

  it('a string input classifies as readily as an Error (the OAuthCallbackPage input)', () => {
    expect(classifyCreateDriveFailure('access_denied')).toBe('cancelled');
    expect(classifyCreateDriveFailure('access_denied: Access blocked by your admin')).toBe(
      'access-denied'
    );
    expect(classifyCreateDriveFailure('admin_policy_enforced')).toBe('app-blocked');
  });

  it('never returns unsupported-browser (only the local-file connect sets it)', () => {
    for (const [, input] of rows) {
      expect(classifyCreateDriveFailure(input)).not.toBe('unsupported-browser');
    }
  });
});

describe('classifyCreateDriveFailure: the order is the logic', () => {
  it('typed errors outrank the message predicates', () => {
    // Every message here would match a later rule on its own.
    expect(
      classifyCreateDriveFailure(
        new FileNameCollisionError('cancelled? popup blocked', 'f', 'n', true)
      )
    ).toBe('name-collision');
    expect(classifyCreateDriveFailure(new DriveConsentDeniedError('user cancelled'))).toBe(
      'consent-denied'
    );
    expect(classifyCreateDriveFailure(new CollisionCheckUnavailableError('Failed to fetch'))).toBe(
      'collision-check-unavailable'
    );
  });

  it('only an explicit policy code is a block: a described access_denied is access-denied, whatever it says', () => {
    // The #128 fixture (a localized plain decline) and an unverified app's test-user restriction
    // on a personal account both arrive described; neither proves a block.
    expect(
      classifyCreateDriveFailure(err('access_denied: Access blocked by your administrator'))
    ).toBe('access-denied');
    expect(
      classifyCreateDriveFailure(err('access_denied: app has not completed verification'))
    ).toBe('access-denied');
    expect(classifyCreateDriveFailure(err('access_denied'))).toBe('cancelled');
    expect(classifyCreateDriveFailure(err('admin_policy_enforced'))).toBe('app-blocked');
    expect(classifyCreateDriveFailure(err('org_internal'))).toBe('app-blocked');
  });

  it('a status outranks navigator.onLine: Google answered, so "offline" is provably wrong', () => {
    setOnline(false);
    expect(classifyCreateDriveFailure(err('Unauthorized', { status: 401 }))).toBe('auth-expired');
    expect(
      classifyCreateDriveFailure(err('full', { status: 403, reason: 'storageQuotaExceeded' }))
    ).toBe('drive-full');
    expect(classifyCreateDriveFailure(err('Forbidden', { status: 403 }))).toBe('unknown');
  });

  it('a status outranks the message regexes', () => {
    expect(classifyCreateDriveFailure(err('popup blocked, cancelled', { status: 400 }))).toBe(
      'unknown'
    );
    // `isNetworkError` would read "fetch" as offline; the status says Google answered.
    expect(classifyCreateDriveFailure(err('could not fetch', { status: 404 }))).toBe('unknown');
  });

  it('a full Drive is not read as a throttle, and the project quotaExceeded is not a full Drive', () => {
    expect(
      classifyCreateDriveFailure(err('x', { status: 403, reason: 'storageQuotaExceeded' }))
    ).toBe('drive-full');
    expect(classifyCreateDriveFailure(err('x', { status: 403, reason: 'quotaExceeded' }))).toBe(
      'drive-busy'
    );
  });

  it("a bare access_denied stays the person's Cancel even offline (isUserCancellation is above onLine)", () => {
    setOnline(false);
    expect(classifyCreateDriveFailure('access_denied')).toBe('cancelled');
    expect(classifyCreateDriveFailure('access_denied: blocked')).toBe('access-denied');
  });

  it('onLine outranks a token expiry (the refresh failed because the network went)', () => {
    setOnline(false);
    expect(classifyCreateDriveFailure(err('x', { name: 'TokenExpiredError' }))).toBe('offline');
  });
});

describe('CREATE_DRIVE_ERRORS registry', () => {
  it('has exactly one entry per code', () => {
    expect([...ALL_CODES].sort()).toEqual(Object.keys(CREATE_DRIVE_ERRORS).sort());
  });

  it('every message key exists in en, beanie and zh', () => {
    for (const code of ALL_CODES) {
      const key: UIStringKey = CREATE_DRIVE_ERRORS[code].messageKey;
      expect(UI_STRINGS[key], `${code} en`).toBeTruthy();
      expect(BEANIE_STRINGS[key], `${code} beanie`).toBeTruthy();
      expect(ZH_STRINGS[key], `${code} zh`).toBeTruthy();
    }
  });

  it('only our own configuration fault and the unknown page Slack', () => {
    const critical = ALL_CODES.filter((c) => CREATE_DRIVE_ERRORS[c].severity === 'critical');
    expect(critical.sort()).toEqual(['drive-api-disabled', 'unknown']);
  });

  it('an admin block offers no Try again: asking again cannot clear it', () => {
    expect(CREATE_DRIVE_ERRORS['app-blocked'].recoveries).not.toContain('retry');
  });
});

describe('createDriveRecoveries', () => {
  it('where local files work: offers useLocal, never getApp', () => {
    expect(createDriveRecoveries('unknown', true)).toEqual(['retry', 'useLocal']);
    expect(createDriveRecoveries('app-blocked', true)).toEqual(['chooseAccount', 'useLocal']);
    expect(createDriveRecoveries('drive-full', true)).toEqual([
      'retry',
      'chooseAccount',
      'useLocal',
    ]);
  });

  it('where they do not: never useLocal, getApp where the registry allows it', () => {
    expect(createDriveRecoveries('unknown', false)).toEqual(['retry', 'getApp']);
    expect(createDriveRecoveries('app-blocked', false)).toEqual(['chooseAccount', 'getApp']);
    // Drive full is fixable here, so no "get the app".
    expect(createDriveRecoveries('drive-full', false)).toEqual(['retry', 'chooseAccount']);
  });

  it.each([
    // Codes whose recoveries omit useLocal gain it once, at the end.
    ['popup-blocked', true, ['retry', 'useLocal']],
    ['offline', true, ['retry', 'useLocal']],
    ['auth-expired', true, ['retry', 'useLocal']],
    // A code that already offers it is not duplicated.
    ['drive-full', true, ['retry', 'chooseAccount', 'useLocal']],
    ['cancelled', true, ['retry', 'useLocal']],
    // Never where local files do not work.
    ['popup-blocked', false, ['retry']],
    ['app-blocked', false, ['chooseAccount', 'getApp']],
  ] as const)('alwaysOfferLocal: %s with local files %s is %j', (code, local, expected) => {
    expect(createDriveRecoveries(code, local, { alwaysOfferLocal: true })).toEqual(expected);
  });

  it('without alwaysOfferLocal, a code that omits useLocal does not gain it', () => {
    expect(createDriveRecoveries('popup-blocked', true)).toEqual(['retry']);
    expect(createDriveRecoveries('popup-blocked', true, { alwaysOfferLocal: false })).toEqual([
      'retry',
    ]);
  });

  it('keeps the registry order and never mutates the registry', () => {
    const before = [...CREATE_DRIVE_ERRORS.timeout.recoveries];
    createDriveRecoveries('timeout', false);
    expect(CREATE_DRIVE_ERRORS.timeout.recoveries).toEqual(before);
    const offline = [...CREATE_DRIVE_ERRORS.offline.recoveries];
    createDriveRecoveries('offline', true, { alwaysOfferLocal: true });
    expect(CREATE_DRIVE_ERRORS.offline.recoveries).toEqual(offline);
    expect(createDriveRecoveries('unsupported-browser', true)).toEqual([]);
  });
});

describe('createDriveFailureMessage', () => {
  const t = (k: UIStringKey) => `t:${k}`;

  it('no code is an empty message', () => {
    expect(createDriveFailureMessage(null, t)).toBe('');
  });

  it("every code resolves to its registry entry's translated message", () => {
    for (const code of ALL_CODES) {
      expect(createDriveFailureMessage(code, t)).toBe(`t:${CREATE_DRIVE_ERRORS[code].messageKey}`);
    }
  });
});

describe('isCreateDriveErrorCode', () => {
  it('accepts every registry code and nothing else', () => {
    for (const code of ALL_CODES) expect(isCreateDriveErrorCode(code)).toBe(true);
    // The legacy resume-stash reasons, renamed to registry codes, must fail validation.
    expect(isCreateDriveErrorCode('drive-declined')).toBe(false);
    expect(isCreateDriveErrorCode('drive-consent')).toBe(false);
    expect(isCreateDriveErrorCode('toString')).toBe(false);
    expect(isCreateDriveErrorCode(null)).toBe(false);
    expect(isCreateDriveErrorCode(42)).toBe(false);
  });
});
