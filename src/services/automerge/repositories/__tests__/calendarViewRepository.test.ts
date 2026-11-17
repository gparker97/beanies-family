// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { list as projectionList } from '@/services/automerge/projection';
import {
  createCalendarViewAccount,
  getAllCalendarViewAccounts,
  getCalendarViewAccountById,
  updateCalendarViewAccount,
  removeCalendarViewAccount,
  createViewedCalendar,
  getAllViewedCalendars,
  getViewedCalendarById,
  updateViewedCalendar,
  removeViewedCalendar,
} from '@/services/automerge/repositories/calendarViewRepository';
import { getAllCalendarConnections } from '@/services/automerge/repositories/calendarRepository';
import type { CreateCalendarViewAccountInput, CreateViewedCalendarInput } from '@/types/models';

const READONLY = 'https://www.googleapis.com/auth/calendar.events.readonly';

const accountInput = (): CreateCalendarViewAccountInput => ({
  provider: 'google',
  accountEmail: 'mum.work@example.com',
  refreshToken: 'rt-1',
  grantedScopes: [READONLY],
  connectedBy: 'm1',
});

const calendarInput = (viewAccountId: string): CreateViewedCalendarInput => ({
  viewAccountId,
  calendarId: 'boss@example.com',
  name: 'Work',
  accessRole: 'reader',
  detailLevel: 'details',
  color: '#94A3B8',
  inBriefing: false,
  inWidgets: false,
  addedBy: 'm1',
});

describe('calendarViewRepository', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  it('view accounts: create, read back, update the token, remove', async () => {
    const created = await createCalendarViewAccount(accountInput());
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);

    expect(await getCalendarViewAccountById(created.id)).toEqual(created);
    expect(await getAllCalendarViewAccounts()).toEqual([created]);
    expect(projectionList('calendarViewAccounts')).toEqual([created]);

    const updated = await updateCalendarViewAccount(created.id, { refreshToken: 'rt-rotated' });
    expect(updated?.refreshToken).toBe('rt-rotated');
    expect((await getCalendarViewAccountById(created.id))?.refreshToken).toBe('rt-rotated');
    expect((await getCalendarViewAccountById(created.id))?.grantedScopes).toEqual([READONLY]);

    expect(await removeCalendarViewAccount(created.id)).toBe(true);
    expect(await getCalendarViewAccountById(created.id)).toBeUndefined();
    expect(await getAllCalendarViewAccounts()).toEqual([]);
  });

  it('viewed calendars: create, read back, update the settings, remove', async () => {
    const account = await createCalendarViewAccount(accountInput());
    const created = await createViewedCalendar(calendarInput(account.id));
    expect(created).toMatchObject({ ...calendarInput(account.id), id: expect.any(String) });

    expect(await getViewedCalendarById(created.id)).toEqual(created);
    expect(await getAllViewedCalendars()).toEqual([created]);
    expect(projectionList('viewedCalendars')).toEqual([created]);

    await updateViewedCalendar(created.id, { detailLevel: 'busy', inWidgets: true });
    expect(await getViewedCalendarById(created.id)).toMatchObject({
      detailLevel: 'busy',
      inWidgets: true,
      inBriefing: false,
      name: 'Work',
    });

    expect(await removeViewedCalendar(created.id)).toBe(true);
    expect(await getViewedCalendarById(created.id)).toBeUndefined();
    // Removing the calendar leaves its account alone (the store decides that, not the repo).
    expect(await getCalendarViewAccountById(account.id)).toBeDefined();
  });

  it('a view account is never a calendar connection (older builds push to every connection)', async () => {
    await createCalendarViewAccount(accountInput());
    expect(await getAllCalendarConnections()).toEqual([]);
  });
});
