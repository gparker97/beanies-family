import { describe, expect, it } from 'vitest';
import {
  normEmail,
  onCanonicalPointer,
  ownerVersionCondition,
  realEmail,
  resolveOwnerFields,
} from './owner.mjs';

const FAMILY_ID = '11111111-2222-4333-8444-555555555555';
const OWNER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const NEW_OWNER_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const NOW = '2026-10-06T09:00:00.000Z';
const EARLIER = '2026-09-01T00:00:00.000Z';

const ROW = Object.freeze({
  familyId: FAMILY_ID,
  provider: 'google_drive',
  fileId: 'CANON',
  displayPath: 'Family.beanpod',
  ownerMemberId: OWNER_ID,
  ownerEmail: 'owner@example.com',
});

/** A current-client ownerSync body from the registered owner, on the canonical pointer. */
const syncBody = (over = {}) => ({
  provider: 'google_drive',
  fileId: 'CANON',
  displayPath: 'Family.beanpod',
  writerMemberId: OWNER_ID,
  ownerMemberId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  ownerSync: true,
  ...over,
});

describe('realEmail', () => {
  it.each([
    ['a plain address', 'user@example.com', 'user@example.com'],
    ['trims', '  user@example.com  ', 'user@example.com'],
    ['keeps case', 'User@Example.COM', 'User@Example.COM'],
    ['a temp placeholder', '1717171717@temp.beanies.family', null],
    ['a setup placeholder', 'pending-abc@setup.local', null],
    ['a placeholder in another case', 'X@TEMP.Beanies.Family', null],
    ['a padded placeholder', ' pending-abc@setup.local ', null],
    ['empty', '', null],
    ['whitespace', '   ', null],
    ['no @', 'no-at', null],
    ['no dot in the domain', 'a@b', null],
    ['inner whitespace', 'a b@example.com', null],
    ['254 chars', 'a'.repeat(242) + '@example.com', 'a'.repeat(242) + '@example.com'],
    ['255 chars', 'a'.repeat(243) + '@example.com', null],
    ['null', null, null],
    ['undefined', undefined, null],
    ['a number', 42, null],
  ])('%s', (_name, input, expected) => {
    expect(realEmail(input)).toBe(expected);
  });
});

describe('normEmail / onCanonicalPointer', () => {
  it('case-folds and trims, null for a non-string', () => {
    expect(normEmail('  Owner@Example.COM ')).toBe('owner@example.com');
    expect(normEmail(null)).toBeNull();
  });

  it('compares provider and fileId with the PUT arm normalisation, ignoring displayPath', () => {
    expect(onCanonicalPointer({ provider: 'google_drive', fileId: 'CANON' }, ROW)).toBe(true);
    expect(
      onCanonicalPointer({ provider: 'google_drive', fileId: 'CANON', displayPath: 'x' }, ROW)
    ).toBe(true);
    expect(onCanonicalPointer({ provider: 'google_drive', fileId: 'COPY' }, ROW)).toBe(false);
    expect(onCanonicalPointer({ provider: 'local', fileId: 'CANON' }, ROW)).toBe(false);
    expect(onCanonicalPointer({}, {})).toBe(true); // local/null on both sides
    expect(onCanonicalPointer({ fileId: '' }, { provider: 'local' })).toBe(true);
  });
});

describe('resolveOwnerFields — no ownerSync flag (write-once, today)', () => {
  it('keeps the stored owner whatever the body says, owner or not', () => {
    for (const isOwner of [true, false]) {
      const r = resolveOwnerFields({
        existing: ROW,
        body: { ownerMemberId: NEW_OWNER_ID, ownerEmail: 'new@example.com' },
        isOwner,
      });
      expect(r).toEqual({
        ownerMemberId: OWNER_ID,
        ownerEmail: 'owner@example.com',
        ownerHandoverAt: null,
        write: true,
        sync: null,
      });
    }
  });

  it('stamps an empty row from the body: id only for the owner, a real email always', () => {
    const body = { ownerMemberId: NEW_OWNER_ID, ownerEmail: ' new@example.com ' };
    expect(resolveOwnerFields({ existing: {}, body, isOwner: true })).toMatchObject({
      ownerMemberId: NEW_OWNER_ID,
      ownerEmail: 'new@example.com',
      write: true,
    });
    expect(resolveOwnerFields({ existing: {}, body, isOwner: false })).toMatchObject({
      ownerMemberId: null,
      ownerEmail: 'new@example.com',
    });
  });

  it('never latches a placeholder, an empty string or a malformed address', () => {
    for (const ownerEmail of ['123@temp.beanies.family', 'pending-x@setup.local', '', 'no-at']) {
      const r = resolveOwnerFields({ existing: {}, body: { ownerEmail }, isOwner: true });
      expect(r.ownerEmail).toBeNull();
    }
  });

  it('repairs stored empty strings', () => {
    const r = resolveOwnerFields({
      existing: { ownerMemberId: '', ownerEmail: '' },
      body: { ownerMemberId: OWNER_ID, ownerEmail: 'owner@example.com' },
      isOwner: true,
    });
    expect(r).toMatchObject({ ownerMemberId: OWNER_ID, ownerEmail: 'owner@example.com' });
  });

  it('treats a non-true ownerSync as absent', () => {
    for (const ownerSync of [false, 'true', 1, null]) {
      const r = resolveOwnerFields({
        existing: ROW,
        body: syncBody({ ownerSync, ownerMemberId: NEW_OWNER_ID }),
        isOwner: true,
      });
      expect(r).toMatchObject({ ownerMemberId: OWNER_ID, write: true, sync: null });
    }
  });
});

describe('resolveOwnerFields — ownerSync outcomes', () => {
  const stored = { ownerMemberId: OWNER_ID, ownerEmail: 'owner@example.com', write: false };

  it.each([
    ['refused-deleted', 'no row', {}, syncBody(), true],
    [
      'refused-deleted',
      'a row without familyId',
      { ...ROW, familyId: undefined },
      syncBody(),
      true,
    ],
    [
      'refused-deleted',
      'a tombstone',
      { ...ROW, deletedAt: '2026-10-01T00:00:00.000Z' },
      syncBody(),
      true,
    ],
    [
      'refused-pre-split',
      'no writerMemberId key',
      ROW,
      (() => {
        const b = syncBody({ ownerMemberId: NEW_OWNER_ID });
        delete b.writerMemberId;
        return b;
      })(),
      true,
    ],
    [
      'refused-no-owner-id',
      'a legacy email-only row',
      { ...ROW, ownerMemberId: undefined },
      syncBody({ ownerMemberId: NEW_OWNER_ID }),
      true,
    ],
    [
      'refused-not-owner',
      'a member device',
      ROW,
      syncBody({ writerMemberId: NEW_OWNER_ID, ownerMemberId: NEW_OWNER_ID }),
      false,
    ],
    [
      'refused-off-canonical',
      'a different fileId',
      ROW,
      syncBody({ fileId: 'COPY', ownerMemberId: NEW_OWNER_ID }),
      true,
    ],
    [
      'refused-off-canonical',
      'a different provider',
      ROW,
      syncBody({ provider: 'local', ownerMemberId: NEW_OWNER_ID }),
      true,
    ],
    [
      'refused-invalid-target',
      'a non-UUID target',
      ROW,
      syncBody({ ownerMemberId: 'not-a-uuid' }),
      true,
    ],
    ['refused-invalid-target', 'a null target', ROW, syncBody({ ownerMemberId: null }), true],
    ['unchanged', 'the same id and email', ROW, syncBody(), true],
    [
      'unchanged',
      'the same email in another case',
      ROW,
      syncBody({ ownerEmail: ' OWNER@example.com ' }),
      true,
    ],
    [
      'unchanged',
      'the same id with a placeholder email',
      ROW,
      syncBody({ ownerEmail: '1@temp.beanies.family' }),
      true,
    ],
    ['unchanged', 'the same id with no email', ROW, syncBody({ ownerEmail: null }), true],
    [
      'unchanged',
      'only displayPath differs',
      ROW,
      syncBody({ displayPath: 'Renamed.beanpod' }),
      true,
    ],
  ])(
    '%s: %s writes nothing and keeps the stored owner',
    (outcome, _name, existing, body, isOwner) => {
      const r = resolveOwnerFields({ existing, body, isOwner });
      expect(r.write).toBe(false);
      expect(r.sync.outcome).toBe(outcome);
      if (outcome === 'refused-deleted') {
        // A missing or deleted row reports no owner, never a tombstone's stored one.
        expect(r.ownerMemberId).toBeNull();
        expect(r.ownerEmail).toBeNull();
        return;
      }
      if (existing.familyId && existing.ownerMemberId) expect(r).toMatchObject(stored);
      expect(r.ownerMemberId).toBe(existing.ownerMemberId ?? null);
      expect(r.ownerEmail).toBe(existing.ownerEmail ?? null);
    }
  );

  it('handover: a new UUID takes the id and its real email', () => {
    const r = resolveOwnerFields({
      existing: ROW,
      body: syncBody({ ownerMemberId: NEW_OWNER_ID, ownerEmail: ' new@example.com ' }),
      isOwner: true,
      now: NOW,
    });
    expect(r).toEqual({
      ownerMemberId: NEW_OWNER_ID,
      ownerEmail: 'new@example.com',
      ownerHandoverAt: NOW,
      write: true,
      sync: { outcome: 'handover', fromTail: OWNER_ID.slice(-6), toTail: NEW_OWNER_ID.slice(-6) },
    });
  });

  it('handover with no real email stores null, never the previous owner’s address', () => {
    for (const ownerEmail of [null, undefined, '', '9@temp.beanies.family']) {
      const r = resolveOwnerFields({
        existing: ROW,
        body: syncBody({ ownerMemberId: NEW_OWNER_ID, ownerEmail }),
        isOwner: true,
      });
      expect(r).toMatchObject({
        ownerMemberId: NEW_OWNER_ID,
        ownerEmail: null,
        write: true,
        sync: { outcome: 'handover' },
      });
    }
  });

  it('email-synced: same id, a different real email (trimmed)', () => {
    const r = resolveOwnerFields({
      existing: ROW,
      body: syncBody({ ownerEmail: ' Renamed@Example.com ' }),
      isOwner: true,
    });
    expect(r).toEqual({
      ownerMemberId: OWNER_ID,
      ownerEmail: 'Renamed@Example.com',
      ownerHandoverAt: null,
      write: true,
      sync: { outcome: 'email-synced', fromTail: OWNER_ID.slice(-6), toTail: OWNER_ID.slice(-6) },
    });
  });

  it('email-synced also fills a row that had no stored email', () => {
    const r = resolveOwnerFields({
      existing: { ...ROW, ownerEmail: null },
      body: syncBody(),
      isOwner: true,
    });
    expect(r).toMatchObject({ ownerEmail: 'owner@example.com', write: true });
    expect(r.sync.outcome).toBe('email-synced');
  });

  it('refusals are checked in order: deleted before not-owner before off-canonical', () => {
    const body = syncBody({ fileId: 'COPY', writerMemberId: NEW_OWNER_ID });
    const tomb = { ...ROW, deletedAt: '2026-10-01T00:00:00.000Z' };
    expect(resolveOwnerFields({ existing: tomb, body, isOwner: false }).sync.outcome).toBe(
      'refused-deleted'
    );
    expect(resolveOwnerFields({ existing: ROW, body, isOwner: false }).sync.outcome).toBe(
      'refused-not-owner'
    );
  });

  it('reports null tails when there is no id', () => {
    const r = resolveOwnerFields({
      existing: {},
      body: syncBody({ ownerMemberId: 7 }),
      isOwner: true,
    });
    expect(r.sync).toEqual({ outcome: 'refused-deleted', fromTail: null, toTail: null });
  });
});

describe('resolveOwnerFields — the handover lock (ownerHandoverAt, ownerSyncReason)', () => {
  const LOCKED = Object.freeze({ ...ROW, ownerHandoverAt: EARLIER });
  const handoverBody = (over = {}) =>
    syncBody({ ownerMemberId: NEW_OWNER_ID, ownerEmail: 'new@example.com', ...over });

  it('a transfer hands over even when the row is locked, and re-stamps the lock', () => {
    const r = resolveOwnerFields({
      existing: LOCKED,
      body: handoverBody({ ownerSyncReason: 'transfer' }),
      isOwner: true,
      now: NOW,
    });
    expect(r).toMatchObject({
      ownerMemberId: NEW_OWNER_ID,
      ownerEmail: 'new@example.com',
      ownerHandoverAt: NOW,
      write: true,
      sync: { outcome: 'handover' },
    });
  });

  it.each([['drift'], [undefined], ['other'], [null]])(
    'a drift handover (reason %s) is allowed once on a never-handed-over row and stamps it',
    (ownerSyncReason) => {
      const r = resolveOwnerFields({
        existing: ROW,
        body: handoverBody({ ownerSyncReason }),
        isOwner: true,
        now: NOW,
      });
      expect(r).toMatchObject({
        ownerMemberId: NEW_OWNER_ID,
        ownerHandoverAt: NOW,
        write: true,
        sync: { outcome: 'handover' },
      });
    }
  );

  it.each([['drift'], [undefined], ['other']])(
    'a drift handover (reason %s) is refused once the row has been handed over',
    (ownerSyncReason) => {
      const r = resolveOwnerFields({
        existing: LOCKED,
        body: handoverBody({ ownerSyncReason }),
        isOwner: true,
        now: NOW,
      });
      expect(r).toEqual({
        ownerMemberId: OWNER_ID,
        ownerEmail: 'owner@example.com',
        ownerHandoverAt: EARLIER,
        write: false,
        sync: {
          outcome: 'refused-handover-locked',
          fromTail: OWNER_ID.slice(-6),
          toTail: NEW_OWNER_ID.slice(-6),
        },
      });
    }
  );

  it('the lock is checked after refused-invalid-target (and after every authority refusal)', () => {
    expect(
      resolveOwnerFields({
        existing: LOCKED,
        body: syncBody({ ownerMemberId: 'not-a-uuid' }),
        isOwner: true,
        now: NOW,
      }).sync.outcome
    ).toBe('refused-invalid-target');
    expect(
      resolveOwnerFields({
        existing: LOCKED,
        body: handoverBody({ ownerSyncReason: 'transfer', writerMemberId: NEW_OWNER_ID }),
        isOwner: false,
        now: NOW,
      }).sync.outcome
    ).toBe('refused-not-owner');
  });

  it('email sync is unaffected by the lock and keeps the stored stamp', () => {
    const r = resolveOwnerFields({
      existing: LOCKED,
      body: syncBody({ ownerEmail: 'renamed@example.com', ownerSyncReason: 'drift' }),
      isOwner: true,
      now: NOW,
    });
    expect(r).toMatchObject({
      ownerMemberId: OWNER_ID,
      ownerEmail: 'renamed@example.com',
      ownerHandoverAt: EARLIER,
      write: true,
      sync: { outcome: 'email-synced' },
    });
  });

  it('every non-handover outcome and every ambient PUT keeps the stored stamp', () => {
    const ambient = resolveOwnerFields({
      existing: LOCKED,
      body: { ownerMemberId: NEW_OWNER_ID },
      isOwner: true,
      now: NOW,
    });
    expect(ambient.ownerHandoverAt).toBe(EARLIER);
    const unchanged = resolveOwnerFields({
      existing: LOCKED,
      body: syncBody(),
      isOwner: true,
      now: NOW,
    });
    expect(unchanged).toMatchObject({ ownerHandoverAt: EARLIER, write: false });
    expect(
      resolveOwnerFields({ existing: ROW, body: {}, isOwner: true, now: NOW }).ownerHandoverAt
    ).toBeNull();
  });
});

describe('ownerVersionCondition (every PUT is optimistic on the owner version)', () => {
  it('a stored ownerHandoverAt must still be that value', () => {
    expect(ownerVersionCondition({ ...ROW, ownerHandoverAt: EARLIER })).toEqual({
      expression: 'ownerHandoverAt = :ownerVersion',
      values: { ':ownerVersion': EARLIER },
    });
  });

  it.each([
    ['absent (written before the lock shipped)', ROW],
    ['stored NULL (never handed over)', { ...ROW, ownerHandoverAt: null }],
    ['a tombstone that was never handed over', { ...ROW, deletedAt: EARLIER }],
  ])('%s: must still be absent or NULL', (_label, existing) => {
    expect(ownerVersionCondition(existing)).toEqual({
      expression:
        'attribute_not_exists(ownerHandoverAt) OR attribute_type(ownerHandoverAt, :nullType)',
      values: { ':nullType': 'NULL' },
    });
  });

  it('no row read: the row must still not exist (a create on an empty key is unchanged)', () => {
    expect(ownerVersionCondition(null)).toEqual({
      expression: 'attribute_not_exists(familyId)',
      values: null,
    });
  });
});
