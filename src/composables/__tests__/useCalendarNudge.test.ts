/**
 * useCalendarNudge — the gating + dismissal for the activities-page
 * "connect Google Calendar" banner. Each assertion reads a fresh
 * `useCalendarNudge()` so the `showNudge` computed evaluates current mock state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plain hoisted holders so the (hoisted) mock factories can reference them.
const h = vi.hoisted(() => ({
  state: { value: { schemaVersion: 1, status: 'pending' as 'pending' | 'dismissed' } },
  save: vi.fn(),
  flagOn: { value: true },
  docLoaded: { value: true },
  connections: { value: [] as unknown[] },
}));

vi.mock('@/composables/perMemberStore', () => ({
  createPerMemberStore: () => ({
    state: h.state,
    save: h.save,
    useMemberSync: vi.fn(),
    memberId: () => 'm1',
  }),
}));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => h.flagOn.value }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => h.docLoaded.value }));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({
    get connections() {
      return h.connections.value;
    },
  }),
}));

import { useCalendarNudge } from '@/composables/useCalendarNudge';

beforeEach(() => {
  h.state.value = { schemaVersion: 1, status: 'pending' };
  h.flagOn.value = true;
  h.docLoaded.value = true;
  h.connections.value = [];
  h.save.mockClear();
});

describe('useCalendarNudge', () => {
  it('shows when flag on, doc loaded, no connections, and pending', () => {
    expect(useCalendarNudge().showNudge.value).toBe(true);
  });

  it('hides when the calendar flag is off', () => {
    h.flagOn.value = false;
    expect(useCalendarNudge().showNudge.value).toBe(false);
  });

  it('hides while the doc is not yet loaded (no cold-load flash)', () => {
    h.docLoaded.value = false;
    expect(useCalendarNudge().showNudge.value).toBe(false);
  });

  it('hides once a calendar is connected', () => {
    h.connections.value = [{ id: 'c1' }];
    expect(useCalendarNudge().showNudge.value).toBe(false);
  });

  it('dismiss flips status to dismissed (in memory + persisted) and hides', () => {
    useCalendarNudge().dismiss();
    expect(h.state.value.status).toBe('dismissed');
    expect(h.save).toHaveBeenCalledWith({ schemaVersion: 1, status: 'dismissed' });
    // A fresh read reflects the dismissed status → hidden.
    expect(useCalendarNudge().showNudge.value).toBe(false);
  });
});
