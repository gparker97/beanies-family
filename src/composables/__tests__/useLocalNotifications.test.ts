import { describe, it, expect, vi } from 'vitest';

// The module imports the plugin at top level; stub it so importing the pure
// helpers has no native side effects. (The helpers under test don't touch it.)
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));

import { stableNotificationId, buildScheduledNotifications } from '../useLocalNotifications';
import type { CriticalItem } from '../useCriticalItems';

function item(over: Partial<CriticalItem>): CriticalItem {
  return {
    id: 'id-1',
    type: 'activity',
    message: 'pick up Neil from football',
    icon: '🚗',
    time: '15:00',
    ...over,
  };
}

const TODAY = '2026-05-22';
const NOW = new Date('2026-05-22T10:00:00').getTime(); // local 10am

describe('stableNotificationId', () => {
  it('is deterministic, positive, and non-zero', () => {
    const a = stableNotificationId('some-uuid-123');
    expect(a).toBe(stableNotificationId('some-uuid-123'));
    expect(a).toBeGreaterThan(0);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('differs for different ids (incl. synthesized holiday ids)', () => {
    expect(stableNotificationId('a')).not.toBe(stableNotificationId('b'));
    expect(stableNotificationId('holiday-2026-05-23')).not.toBe(
      stableNotificationId('holiday-2026-05-24')
    );
  });
});

describe('buildScheduledNotifications (ADR-029 A4)', () => {
  it('schedules a timed, not-completed item whose time is still in the future', () => {
    const out = buildScheduledNotifications([item({ time: '15:00' })], TODAY, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: stableNotificationId('id-1'),
      title: 'beanies.family',
      body: 'pick up Neil from football',
    });
    expect(out[0].schedule).toEqual({ at: new Date('2026-05-22T15:00:00') });
  });

  it('skips items whose time has already passed today', () => {
    expect(buildScheduledNotifications([item({ time: '08:00' })], TODAY, NOW)).toHaveLength(0);
  });

  it('skips untimed items (no specific fire time)', () => {
    expect(buildScheduledNotifications([item({ time: '' })], TODAY, NOW)).toHaveLength(0);
  });

  it('skips completed items', () => {
    expect(
      buildScheduledNotifications([item({ time: '15:00', completed: true })], TODAY, NOW)
    ).toHaveLength(0);
  });

  it('skips items with an invalid time', () => {
    expect(buildScheduledNotifications([item({ time: 'not-a-time' })], TODAY, NOW)).toHaveLength(0);
  });

  it('keeps only the qualifying items from a mixed list', () => {
    const out = buildScheduledNotifications(
      [
        item({ id: 'past', time: '08:00' }),
        item({ id: 'future', time: '18:30' }),
        item({ id: 'untimed', time: '' }),
        item({ id: 'done', time: '20:00', completed: true }),
      ],
      TODAY,
      NOW
    );
    expect(out.map((n) => n.id)).toEqual([stableNotificationId('future')]);
  });
});
