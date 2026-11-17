/**
 * The `calResume` wire format (plan 2026-11-17, A2). The sync values must stay
 * byte-identical so a redirect started on an older build still resumes; the view
 * values must never be mistaken for a sync reconnect.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeCalendarResumeIntent,
  parseCalendarResumeIntent,
  isViewResumeIntent,
  calendarReturnPath,
  type CalendarResumeIntent,
} from '../resumeIntent';

const CONNECTION_ID = '5f0c1b2a-3d4e-4f60-8a9b-0c1d2e3f4a5b';
const ACCOUNT_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

describe('resumeIntent', () => {
  it.each<[CalendarResumeIntent, string]>([
    [{ kind: 'connect' }, 'connect'],
    [{ kind: 'reconnect', connectionId: CONNECTION_ID }, CONNECTION_ID],
    [{ kind: 'view-connect' }, 'view'],
    [{ kind: 'view-reconnect', accountId: ACCOUNT_ID }, `view:${ACCOUNT_ID}`],
  ])('round trips %o as %s', (intent, wire) => {
    expect(encodeCalendarResumeIntent(intent)).toBe(wire);
    expect(parseCalendarResumeIntent(wire)).toEqual(intent);
  });

  it('keeps the legacy sync values unchanged', () => {
    expect(parseCalendarResumeIntent('connect')).toEqual({ kind: 'connect' });
    expect(parseCalendarResumeIntent(CONNECTION_ID)).toEqual({
      kind: 'reconnect',
      connectionId: CONNECTION_ID,
    });
  });

  it('tells view intents from sync intents', () => {
    expect(isViewResumeIntent(parseCalendarResumeIntent('view'))).toBe(true);
    expect(isViewResumeIntent(parseCalendarResumeIntent(`view:${ACCOUNT_ID}`))).toBe(true);
    expect(isViewResumeIntent(parseCalendarResumeIntent('connect'))).toBe(false);
    expect(isViewResumeIntent(parseCalendarResumeIntent(CONNECTION_ID))).toBe(false);
  });

  it('builds the settings return path carrying the intent', () => {
    const path = calendarReturnPath({ kind: 'view-reconnect', accountId: ACCOUNT_ID });
    const url = new URL(path, 'https://app.example');
    expect(url.pathname).toBe('/settings');
    expect(url.searchParams.get('open')).toBe('calendar-sync');
    expect(url.searchParams.get('calResume')).toBe(`view:${ACCOUNT_ID}`);
  });
});
