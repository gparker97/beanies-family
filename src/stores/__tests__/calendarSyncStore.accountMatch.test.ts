/**
 * A reconnect must never REPOINT the family's calendar at a different Google
 * account.
 *
 * `reconnect()` passes the connection's `accountEmail` to Google as a `loginHint`,
 * and a hint is all it is: the account chooser lets the user pick any account they
 * are signed in to. Before this guard, `finalizeConnected` wrote whatever came
 * back straight over `accountEmail` AND `refreshToken` — so anyone who reached the
 * button could silently take over the family's calendar connection, and because
 * the old grant is revoked BEFORE the consent (revoke-before-mint) there was no
 * way back to the original.
 *
 * The two neighbouring paths already guard this (`useReconnectCoordinator`'s
 * same-account grouping, and the unified fan-out's positive-match requirement).
 * The single-feature reconnect never got it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  createCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';

// Same seam the sibling store test stubs: `reconnect()` drives a real OAuth
// consent, and what is under test here is the bookkeeping that follows it.
vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar: vi.fn(),
  isCalendarConnectSupported: vi.fn(() => true),
}));

import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { connectGoogleCalendar } from '@/services/calendar/calendarAuth';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events.owned'];

async function brokenConnection(accountEmail = 'mum@gmail.com') {
  return createCalendarConnection({
    provider: 'google',
    accountEmail,
    destinationCalendarId: 'primary',
    refreshToken: 'original-token',
    grantedScopes: SCOPES,
    status: 'needs_reconnect',
  });
}

function consentAs(email: string | undefined) {
  vi.mocked(connectGoogleCalendar).mockResolvedValue({
    status: 'connected',
    email,
    refreshToken: 'intruder-token',
    grantedScopes: SCOPES,
  } as never);
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await installInlineBackend();
  localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  vi.clearAllMocks();
});

describe('reconnect refuses a different Google account', () => {
  it('🔴 does NOT overwrite accountEmail or refreshToken', async () => {
    const conn = await brokenConnection('mum@gmail.com');
    consentAs('someone-else@gmail.com');

    await useCalendarSyncStore().reconnect(conn.id);

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.accountEmail).toBe('mum@gmail.com');
    expect(after?.refreshToken).toBe('original-token');
  });

  it('leaves the connection repairable, and says which account is needed', async () => {
    const conn = await brokenConnection('mum@gmail.com');
    consentAs('someone-else@gmail.com');

    await useCalendarSyncStore().reconnect(conn.id);

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('needs_reconnect');
    expect(after?.lastError).toContain('mum@gmail.com');
  });

  it('returns a typed failure carrying the bound account, so the UI can name it', async () => {
    const conn = await brokenConnection('mum@gmail.com');
    consentAs('someone-else@gmail.com');

    const result = await useCalendarSyncStore().reconnect(conn.id);

    expect(result).toMatchObject({
      status: 'failed',
      code: 'account_mismatch',
      message: 'mum@gmail.com',
    });
  });
});

describe('reconnect still succeeds where it should', () => {
  it('the SAME account reconnects normally', async () => {
    const conn = await brokenConnection('mum@gmail.com');
    consentAs('mum@gmail.com');

    await useCalendarSyncStore().reconnect(conn.id);

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('ok');
    expect(after?.refreshToken).toBe('intruder-token'); // i.e. the freshly minted one
  });

  it('matches case-insensitively, because Google emails are', async () => {
    const conn = await brokenConnection('Mum@Gmail.com');
    consentAs('mum@gmail.com');

    await useCalendarSyncStore().reconnect(conn.id);

    expect((await getCalendarConnectionById(conn.id))?.status).toBe('ok');
  });

  it("🔴 FAILS SAFE: a stored 'unknown' sentinel is not treated as a mismatch", async () => {
    // Refusing on uncertainty would brick a connection whose email we never
    // learned — it could then never be repaired at all. Same fail-safe shape the
    // revoke side already uses.
    const conn = await brokenConnection('unknown');
    consentAs('mum@gmail.com');

    await useCalendarSyncStore().reconnect(conn.id);

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('ok');
    expect(after?.accountEmail).toBe('mum@gmail.com');
  });

  it('🔴 FAILS SAFE: a consent that returns no email at all is not a mismatch', async () => {
    const conn = await brokenConnection('mum@gmail.com');
    consentAs(undefined);

    await useCalendarSyncStore().reconnect(conn.id);

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('ok');
    expect(after?.accountEmail).toBe('mum@gmail.com'); // kept, not clobbered to 'unknown'
  });
});
