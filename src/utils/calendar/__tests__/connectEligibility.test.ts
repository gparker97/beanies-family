import { describe, it, expect } from 'vitest';
import { syncIneligibility, viewIneligibility } from '../connectEligibility';
import { encodeCalendarResumeIntent, parseCalendarResumeIntent } from '../resumeIntent';

const primary = { id: 'me@example.com', summary: 'Me', primary: true };
const secondary = { id: 'kids@group.calendar.google.com', summary: 'Kids', primary: false };

describe('syncIneligibility', () => {
  it('offers a writable calendar nothing syncs to yet', () => {
    expect(syncIneligibility(secondary, 'me@example.com', [])).toBeNull();
    expect(
      syncIneligibility({ ...secondary, accessRole: 'writer' }, 'me@example.com', [])
    ).toBeNull();
  });

  it.each(['reader', 'freeBusyReader'])('refuses a %s calendar as view only', (accessRole) => {
    expect(syncIneligibility({ ...secondary, accessRole }, 'me@example.com', [])).toBe('view-only');
  });

  it('refuses a calendar that is already a destination, whichever account reaches it', () => {
    const connections = [
      {
        accountEmail: 'dad@example.com',
        destinationCalendarId: secondary.id,
        status: 'ok' as const,
      },
    ];
    expect(syncIneligibility(secondary, 'me@example.com', connections)).toBe('already-connected');
  });

  it('R1: a connection stuck mid-teardown (disconnecting) is not a live destination', () => {
    const stuck = [
      {
        accountEmail: 'me@example.com',
        destinationCalendarId: secondary.id,
        status: 'disconnecting' as const,
      },
    ];
    expect(syncIneligibility(secondary, 'me@example.com', stuck)).toBeNull();
    expect(viewIneligibility(secondary, 'me@example.com', stuck, [])).toBeNull();
    const stuckAlias = [
      {
        accountEmail: 'me@example.com',
        destinationCalendarId: 'primary',
        status: 'disconnecting' as const,
      },
    ];
    expect(syncIneligibility(primary, 'me@example.com', stuckAlias)).toBeNull();
    // Any other status still blocks.
    for (const status of ['ok', 'error', 'needs_reconnect'] as const) {
      expect(syncIneligibility(secondary, 'me@example.com', [{ ...stuck[0]!, status }])).toBe(
        'already-connected'
      );
    }
  });

  // The list falls back to one `'primary'` row when an account's calendar list can't
  // be read (list scope unticked, or a transient failure). A legacy `'primary'`
  // connection on ANOTHER account must not block it: different accounts, different
  // calendars.
  const fallbackRow = { id: 'primary', summary: '', primary: true };
  const legacyDad = [
    { accountEmail: 'dad@example.com', destinationCalendarId: 'primary', status: 'ok' as const },
  ];

  it("a legacy 'primary' connection on another account never blocks a fallback 'primary' row", () => {
    expect(syncIneligibility(fallbackRow, 'mom@example.com', legacyDad)).toBeNull();
    expect(viewIneligibility(fallbackRow, 'mom@example.com', legacyDad, [])).toBeNull();
  });

  it('the confirm guard (id only) lets another account connect its primary', () => {
    const chosen = { id: 'primary', summary: '', primary: false };
    expect(syncIneligibility(chosen, 'mom@example.com', legacyDad)).toBeNull();
    expect(syncIneligibility(chosen, null, legacyDad)).toBeNull();
  });

  it("a 'primary' alias never matches a secondary calendar of the same account", () => {
    expect(syncIneligibility(secondary, 'dad@example.com', legacyDad)).toBeNull();
  });
});

/**
 * R2: the full truth table of "is this row the connected calendar?".
 *
 * The connection is on Dad's account, its destination stored as the alias
 * `'primary'` or as the real id `dad@example.com` (the same calendar). The calendar
 * list comes from Dad's own account, from Mom's (Dad's calendar shared with her as a
 * writer), or from an account whose email is unknown. The rule: resolve both sides
 * to Google's global id (the alias becomes its own account's email) and compare;
 * an alias whose account email is unknown resolves to nothing and fails OPEN (not
 * connected), as HEAD did, because a wrong "connected" would block the member's own
 * calendar with no way round it.
 */
describe('R2: already-connected truth table', () => {
  const DAD = 'dad@example.com';
  const MOM = 'mom@example.com';
  const kids = { id: 'kids@group.calendar.google.com', summary: 'Kids', primary: false };
  type Lister = 'same' | 'different' | 'unknown';
  const listerEmail: Record<Lister, string | null> = { same: DAD, different: MOM, unknown: null };
  /** That account's primary row: its real id, or the fallback alias row when its email is unknown. */
  function ownPrimary(lister: Lister) {
    const email = listerEmail[lister];
    return email
      ? { id: email, summary: email, primary: true }
      : { id: 'primary', summary: '', primary: true };
  }
  /** The row whose id is the OTHER account's email (a primary calendar shared across). */
  function otherEmailRow(lister: Lister) {
    return { id: lister === 'same' ? MOM : DAD, summary: '', primary: false };
  }

  const cases: Array<
    [
      stored: string,
      lister: Lister,
      row: 'own-primary' | 'other-email' | 'unrelated',
      expected: boolean,
    ]
  > = [
    // Stored as the alias.
    ['primary', 'same', 'own-primary', true],
    ['primary', 'same', 'other-email', false],
    ['primary', 'same', 'unrelated', false],
    ['primary', 'different', 'own-primary', false],
    ['primary', 'different', 'other-email', true], // Dad's primary, shared to Mom
    ['primary', 'different', 'unrelated', false],
    ['primary', 'unknown', 'own-primary', false], // fallback alias of an unknown account: fail open
    ['primary', 'unknown', 'other-email', true],
    ['primary', 'unknown', 'unrelated', false],
    // Stored as the real id: the same answers.
    [DAD, 'same', 'own-primary', true],
    [DAD, 'same', 'other-email', false],
    [DAD, 'same', 'unrelated', false],
    [DAD, 'different', 'own-primary', false],
    [DAD, 'different', 'other-email', true],
    [DAD, 'different', 'unrelated', false],
    [DAD, 'unknown', 'own-primary', false],
    [DAD, 'unknown', 'other-email', true],
    [DAD, 'unknown', 'unrelated', false],
  ];

  it.each(cases)(
    'stored %s, listed by the %s account, %s row -> connected: %s',
    (stored, lister, row, expected) => {
      const connections = [
        { accountEmail: DAD, destinationCalendarId: stored, status: 'ok' as const },
      ];
      const calendar =
        row === 'own-primary'
          ? ownPrimary(lister)
          : row === 'other-email'
            ? otherEmailRow(lister)
            : kids;
      const want = expected ? 'already-connected' : null;
      expect(syncIneligibility(calendar, listerEmail[lister], connections)).toBe(want);
      expect(viewIneligibility(calendar, listerEmail[lister], connections, [])).toBe(want);
    }
  );

  it("the connection's own email unknown: an alias resolves to nothing (fail open), a real id still matches", () => {
    for (const email of ['unknown', '']) {
      const alias = [
        { accountEmail: email, destinationCalendarId: 'primary', status: 'ok' as const },
      ];
      expect(syncIneligibility({ id: DAD, summary: '', primary: true }, DAD, alias)).toBeNull();
      expect(
        syncIneligibility({ id: 'primary', summary: '', primary: true }, null, alias)
      ).toBeNull();
      const real = [{ accountEmail: email, destinationCalendarId: kids.id, status: 'ok' as const }];
      expect(syncIneligibility(kids, MOM, real)).toBe('already-connected');
    }
  });

  it('compares email-shaped ids without case', () => {
    const connections = [
      { accountEmail: 'Dad@Example.com', destinationCalendarId: 'primary', status: 'ok' as const },
    ];
    expect(
      syncIneligibility({ id: 'DAD@example.com', summary: '', primary: false }, MOM, connections)
    ).toBe('already-connected');
  });
});

describe('calendar resume intent', () => {
  it('round-trips a fresh connect and a reconnect in the wire format older builds wrote', () => {
    expect(encodeCalendarResumeIntent({ kind: 'connect' })).toBe('connect');
    expect(encodeCalendarResumeIntent({ kind: 'reconnect', connectionId: 'c1' })).toBe('c1');
    expect(parseCalendarResumeIntent('connect')).toEqual({ kind: 'connect' });
    expect(parseCalendarResumeIntent('c1')).toEqual({ kind: 'reconnect', connectionId: 'c1' });
  });
});

describe('view-only calendars in the add step', () => {
  it('a calendar the family already views is already connected for syncing too', () => {
    expect(syncIneligibility(secondary, 'me@example.com', [], [secondary.id])).toBe(
      'already-connected'
    );
  });

  it.each(['reader', 'freeBusyReader', 'writer', 'owner'])(
    'offers a %s calendar as view only',
    (accessRole) => {
      expect(viewIneligibility({ ...secondary, accessRole }, 'me@example.com', [], [])).toBeNull();
    }
  );

  it('refuses a calendar already viewed on any account, or already synced to', () => {
    expect(viewIneligibility(secondary, 'me@example.com', [], [secondary.id])).toBe(
      'already-connected'
    );
    const connections = [
      { accountEmail: 'me@example.com', destinationCalendarId: 'primary', status: 'ok' as const },
    ];
    expect(viewIneligibility(primary, 'me@example.com', connections, [])).toBe('already-connected');
    // Seen from Dad's account (shared with him) it is still the same calendar (R2).
    expect(viewIneligibility(primary, 'dad@example.com', connections, [])).toBe(
      'already-connected'
    );
    // Dad's own primary is a different calendar.
    const dadsPrimary = { id: 'dad@example.com', summary: 'Dad', primary: true };
    expect(viewIneligibility(dadsPrimary, 'dad@example.com', connections, [])).toBeNull();
  });
});
