import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted shared state + mock fns so the vi.mock factories can reference them.
const h = vi.hoisted(() => ({
  driveReconnect: vi.fn(async () => true),
  calReconnect: vi.fn(async () => ({ status: 'connected' as const })),
  startUnified: vi.fn(async () => 'connected' as const),
  showToast: vi.fn(),
  syncState: {
    showGoogleReconnect: false,
    isGoogleDriveAvailable: true,
    storageProviderType: 'google_drive' as string,
    sessionAccountEmail: null as string | null,
    providerAccountEmail: null as string | null,
  },
  calState: {
    connections: [] as Array<{ id: string; status: string; accountEmail: string }>,
    reconnect: vi.fn(async () => ({ status: 'connected' as const })),
  },
}));

vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => h.syncState }));
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => h.calState }));
vi.mock('@/composables/useGoogleReconnect', () => ({
  useGoogleReconnect: () => ({
    reconnect: h.driveReconnect,
    reconnectError: { value: null },
    isReconnecting: { value: false },
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/config/flags', () => ({ isFlagEnabled: vi.fn(() => true) }));
vi.mock('@/services/google/googleAuth', () => ({ shouldUseRedirectAuth: vi.fn(() => false) }));
vi.mock('@/services/google/unifiedReconnect', () => ({ startUnifiedReconnect: h.startUnified }));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useReconnectCoordinator } from '../useReconnectCoordinator';

function setDrive(down: boolean, email: string | null = null) {
  h.syncState.showGoogleReconnect = down;
  h.syncState.sessionAccountEmail = email;
  h.syncState.providerAccountEmail = null;
}
function setCalendar(conns: Array<{ id: string; accountEmail: string }>) {
  h.calState.connections = conns.map((c) => ({ ...c, status: 'needs_reconnect' }));
}

describe('useReconnectCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDrive(false);
    setCalendar([]);
    h.calState.reconnect = vi.fn(async () => ({ status: 'connected' as const }));
  });

  it('nothing down → no prompt, empty down set', () => {
    const c = useReconnectCoordinator();
    expect(c.downFeatures.value).toEqual([]);
    expect(c.activeReconnectPrompt.value).toBeNull();
  });

  it('Drive-only down → drive variant; delegates to the Drive primitive (no unified)', async () => {
    setDrive(true, 'a@example.com');
    const c = useReconnectCoordinator();
    expect(c.activeReconnectPrompt.value?.variant).toBe('drive');
    expect(c.buildReconnectPlan()).toHaveLength(1);

    await c.reconnectAll();
    expect(h.driveReconnect).toHaveBeenCalledWith('a@example.com');
    expect(h.startUnified).not.toHaveBeenCalled();
    expect(h.calState.reconnect).not.toHaveBeenCalled();
  });

  it('Calendar-only down → calendar variant; delegates to the calendar primitive', async () => {
    setCalendar([{ id: 'c1', accountEmail: 'a@example.com' }]);
    const c = useReconnectCoordinator();
    expect(c.activeReconnectPrompt.value?.variant).toBe('calendar');

    await c.reconnectAll();
    expect(h.calState.reconnect).toHaveBeenCalledWith('c1');
    expect(h.startUnified).not.toHaveBeenCalled();
    expect(h.driveReconnect).not.toHaveBeenCalled();
  });

  it('both down, SAME account → both variant; ONE unified consent (no per-feature)', async () => {
    setDrive(true, 'a@example.com');
    setCalendar([{ id: 'c1', accountEmail: 'a@example.com' }]);
    const c = useReconnectCoordinator();
    expect(c.activeReconnectPrompt.value?.variant).toBe('both');

    const plan = c.buildReconnectPlan();
    expect(plan).toHaveLength(1);
    expect(plan[0]!.features).toHaveLength(2);

    await c.reconnectAll();
    expect(h.startUnified).toHaveBeenCalledWith('a@example.com');
    expect(h.driveReconnect).not.toHaveBeenCalled();
    expect(h.calState.reconnect).not.toHaveBeenCalled();
  });

  it('both down, DIFFERENT accounts → two single-feature groups; no unified consent', async () => {
    setDrive(true, 'a@example.com');
    setCalendar([{ id: 'c1', accountEmail: 'b@example.com' }]);
    const c = useReconnectCoordinator();

    const plan = c.buildReconnectPlan();
    expect(plan).toHaveLength(2);
    expect(plan.every((g) => g.features.length === 1)).toBe(true);

    await c.reconnectAll();
    expect(h.startUnified).not.toHaveBeenCalled();
    expect(h.driveReconnect).toHaveBeenCalledWith('a@example.com');
    expect(h.calState.reconnect).toHaveBeenCalledWith('c1');
  });

  it("Pass 4: an 'unknown'-account calendar connection is NEVER folded onto the Drive group", async () => {
    setDrive(true, 'a@example.com');
    setCalendar([{ id: 'c1', accountEmail: 'unknown' }]);
    const c = useReconnectCoordinator();

    const plan = c.buildReconnectPlan();
    // Drive alone + the unknown calendar alone — the token is never cross-written.
    expect(plan).toHaveLength(2);
    expect(plan.every((g) => g.features.length === 1)).toBe(true);

    await c.reconnectAll();
    expect(h.startUnified).not.toHaveBeenCalled();
  });

  it('multi calendar connections on the Drive account all fold into one unified group', () => {
    setDrive(true, 'a@example.com');
    setCalendar([
      { id: 'c1', accountEmail: 'a@example.com' },
      { id: 'c2', accountEmail: 'a@example.com' },
    ]);
    const c = useReconnectCoordinator();
    const plan = c.buildReconnectPlan();
    expect(plan).toHaveLength(1);
    expect(plan[0]!.features).toHaveLength(3); // drive + 2 calendar
  });

  it('folds a same-account calendar connection even when the email case differs', () => {
    setDrive(true, 'Greg@Example.com');
    setCalendar([{ id: 'c1', accountEmail: 'greg@example.com' }]);
    const c = useReconnectCoordinator();
    const plan = c.buildReconnectPlan();
    expect(plan).toHaveLength(1); // one unified group, not two
    expect(plan[0]!.features).toHaveLength(2);
  });

  it("uses the 'once' body for a same-account both-down, and the multi body for different accounts", () => {
    setDrive(true, 'a@example.com');
    setCalendar([{ id: 'c1', accountEmail: 'a@example.com' }]);
    expect(useReconnectCoordinator().activeReconnectPrompt.value?.bodyKey).toBe(
      'reconnectPrompt.both.body'
    );

    setCalendar([{ id: 'c2', accountEmail: 'b@example.com' }]);
    expect(useReconnectCoordinator().activeReconnectPrompt.value?.bodyKey).toBe(
      'reconnectPrompt.both.bodyMulti'
    );
  });

  it('does NOT toast success when the plan is empty (stores self-healed before the click)', async () => {
    setDrive(false);
    setCalendar([]);
    const c = useReconnectCoordinator();
    await c.reconnectAll();
    expect(h.showToast).not.toHaveBeenCalled();
    expect(h.startUnified).not.toHaveBeenCalled();
  });
});
