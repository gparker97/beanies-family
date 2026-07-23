import { describe, it, expect, vi } from 'vitest';

// The module imports the plugin at top level; stub it so importing the pure
// helpers has no native side effects. (The helpers under test don't touch it.)
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));

import { stableNotificationId, buildScheduledNotifications } from '../useLocalNotifications';
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
      channelId: 'reminders',
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
});
