import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above the module body, so everything they
// close over must come from `vi.hoisted`.
const { plugin, reportError, logEvent, showToast } = vi.hoisted(() => ({
  plugin: {
    schedule: vi.fn(),
    cancel: vi.fn(),
    getPending: vi.fn(),
    createChannel: vi.fn(),
    deleteChannel: vi.fn(),
    checkExactNotificationSetting: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    addListener: vi.fn(),
  },
  reportError: vi.fn(),
  logEvent: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: plugin }));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => true,
  getPlatform: () => 'android',
}));
vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/composables/useToast', () => ({ showToast }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import {
  runRescheduleFor,
  stableNotificationId,
  buildScheduledNotifications,
  latenessBucket,
  reconcileScheduled,
  __resetLocalNotificationsForTesting,
} from '../useLocalNotifications';
import type { ScheduledReminder } from '../useScheduledReminders';

function reminder(over: Partial<ScheduledReminder> = {}): ScheduledReminder {
  return {
    id: 'activity-reminder:id-1:2026-05-22',
    fireAt: new Date('2026-05-22T14:30:00'),
    title: 'Football',
    body: 'Time to drop off — Neil',
    kind: 'activity',
    ...over,
  };
}

const META = { truncated: false, skipped: 0, gated: 0, todoLead: 30, activityLead: 30 };
const PREFS = {
  remindersEnabled: true,
  todoReminderLead: 30,
  activityReminderLead: 30,
  travelReminderLeads: {},
  helpfulHintNotifyByType: {},
};

describe('stableNotificationId', () => {
  it('is deterministic, positive, and non-zero', () => {
    const a = stableNotificationId('some-uuid-123');
    expect(a).toBe(stableNotificationId('some-uuid-123'));
    expect(a).toBeGreaterThan(0);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('differs for different ids', () => {
    expect(stableNotificationId('a')).not.toBe(stableNotificationId('b'));
    expect(stableNotificationId('travel-reminder:seg-1:2026-05-23')).not.toBe(
      stableNotificationId('travel-reminder:seg-1:2026-05-24')
    );
  });
});

describe('buildScheduledNotifications (ADR-029 A4)', () => {
  it('maps a reminder to an exact, Doze-bypassing, channel-targeted payload', () => {
    const out = buildScheduledNotifications([reminder()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: stableNotificationId('activity-reminder:id-1:2026-05-22'),
      title: 'Football',
      body: 'Time to drop off — Neil',
      channelId: 'reminders_v2',
      extra: { kind: 'activity' },
    });
    // allowWhileIdle bypasses Doze batching; fires at the pre-computed lead time.
    expect(out[0].schedule).toEqual({
      at: new Date('2026-05-22T14:30:00'),
      allowWhileIdle: true,
    });
  });

  it('is a straight 1:1 mapping preserving order (the builder already sorted/capped)', () => {
    const reminders = [
      reminder({ id: 'a', kind: 'travel' }),
      reminder({ id: 'b', kind: 'todo' }),
      reminder({ id: 'c', kind: 'activity' }),
    ];
    const out = buildScheduledNotifications(reminders);
    expect(out.map((n) => n.id)).toEqual([
      stableNotificationId('a'),
      stableNotificationId('b'),
      stableNotificationId('c'),
    ]);
    expect(out.map((n) => (n.extra as { kind: string }).kind)).toEqual([
      'travel',
      'todo',
      'activity',
    ]);
  });

  it('returns [] for an empty schedule', () => {
    expect(buildScheduledNotifications([])).toEqual([]);
  });

  it('carries the intended fire time so delivery lateness is measurable', () => {
    const out = buildScheduledNotifications([reminder()]);
    expect((out[0].extra as { at: number }).at).toBe(new Date('2026-05-22T14:30:00').getTime());
  });
});

describe('latenessBucket', () => {
  const at = 1_000_000;
  it('buckets by how late delivery was', () => {
    expect(latenessBucket(at + 5_000, at)).toBe('on_time');
    expect(latenessBucket(at + 45_000, at)).toBe('lt_1m');
    expect(latenessBucket(at + 120_000, at)).toBe('lt_5m');
    expect(latenessBucket(at + 600_000, at)).toBe('lt_15m');
    // The original #55 defect class: Doze-batched, unboundedly late.
    expect(latenessBucket(at + 3_600_000, at)).toBe('gte_15m');
  });
});

describe('runRescheduleFor — the not-ready guard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetLocalNotificationsForTesting();
    plugin.getPending.mockResolvedValue({ notifications: [] });
    plugin.checkPermissions.mockResolvedValue({ display: 'granted' });
  });

  it('REGRESSION: a null input touches NOTHING and emits NOTHING', async () => {
    // The headline defect. `reminderInput` is null until the family doc loads, so
    // this runs on every cold start (lock screen, or killed before decryption).
    // Reconciling against the resulting empty desired set cancelled every armed
    // alarm on the device — silently, while telemetry logged a healthy-looking
    // `notif_count: 0`. Sign-out's cancel is explicit now, not a side effect of
    // an empty schedule, so this must be a total no-op.
    await runRescheduleFor(null, PREFS, new Date());
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.getPending).not.toHaveBeenCalled();
    expect(plugin.cancel).not.toHaveBeenCalled();
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('reconcileScheduled — the ordering that stops a failure wiping reminders', () => {
  const payload = buildScheduledNotifications([reminder({ id: 'keep' })]);

  beforeEach(() => {
    vi.resetAllMocks();
    __resetLocalNotificationsForTesting();
    plugin.getPending.mockResolvedValue({ notifications: [] });
    plugin.schedule.mockResolvedValue(undefined);
    plugin.cancel.mockResolvedValue(undefined);
    plugin.createChannel.mockResolvedValue(undefined);
    plugin.deleteChannel.mockResolvedValue(undefined);
    plugin.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
  });

  it('creates the channel with vibration ON and retires the frozen legacy channel', async () => {
    await reconcileScheduled(payload, true, META);
    // Capacitor disables vibration unless we ask for it; a HIGH channel gets the
    // default sound only when `sound` is left unset.
    expect(plugin.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reminders_v2', importance: 4, vibration: true })
    );
    expect(plugin.createChannel.mock.calls[0][0]).not.toHaveProperty('sound');
    // The old silent channel must be deleted, or a device that has it keeps it.
    expect(plugin.deleteChannel).toHaveBeenCalledWith({ id: 'reminders' });
  });

  it('a failing legacy-channel delete does not fail the arm', async () => {
    plugin.deleteChannel.mockRejectedValue(new Error('absent'));
    await reconcileScheduled(payload, true, META);
    expect(plugin.schedule).toHaveBeenCalled(); // reminders still armed
  });

  it('schedules BEFORE cancelling, so a schedule failure cannot destroy live alarms', async () => {
    const order: string[] = [];
    plugin.schedule.mockImplementation(async () => void order.push('schedule'));
    plugin.getPending.mockImplementation(async () => {
      order.push('getPending');
      return { notifications: [] };
    });
    await reconcileScheduled(payload, true, META);
    expect(order).toEqual(['schedule', 'getPending']);
  });

  it('cancels ONLY ids that are no longer desired', async () => {
    const keepId = stableNotificationId('keep');
    plugin.getPending.mockResolvedValue({
      notifications: [{ id: keepId }, { id: 999_111 }],
    });
    await reconcileScheduled(payload, true, META);
    expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 999_111 }] });
  });

  it('a rejecting schedule() leaves pending alarms untouched, pages, and toasts once', async () => {
    plugin.schedule.mockRejectedValue(new Error('bridge down'));
    await reconcileScheduled(payload, true, META);
    expect(plugin.cancel).not.toHaveBeenCalled(); // the user keeps what they had
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ notif_error_stage: 'schedule' }),
      })
    );
    expect(showToast).toHaveBeenCalledTimes(1);
    // Second failure in the same session must not re-toast.
    await reconcileScheduled(payload, true, META);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('CANCELS STALE EVEN WHEN PERMISSION IS DENIED — cancelling needs no permission', async () => {
    // Toggling reminders off, or a denied/failed permission check, must never
    // strand alarms on the device.
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 42 }] });
    await reconcileScheduled([], false, META);
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(plugin.cancel).toHaveBeenCalledWith({ notifications: [{ id: 42 }] });
  });

  it('a failing cancel is a warning, not a page — surplus reminders, not missing ones', async () => {
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 7 }] });
    plugin.cancel.mockRejectedValue(new Error('nope'));
    await reconcileScheduled(payload, true, META);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        context: expect.objectContaining({ notif_error_stage: 'cancel' }),
      })
    );
  });

  it('emits the outcome even at count 0, carrying the exact-alarm state', async () => {
    await reconcileScheduled([], true, META);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'reschedule',
        context: expect.objectContaining({ notif_count: 0, notif_exact_alarm: 'granted' }),
      })
    );
  });

  it('a failing createChannel is CRITICAL on Android — every reminder would vanish', async () => {
    plugin.createChannel.mockRejectedValue(new Error('no channel'));
    await reconcileScheduled(payload, true, META);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ notif_error_stage: 'channel' }),
      })
    );
  });
});
