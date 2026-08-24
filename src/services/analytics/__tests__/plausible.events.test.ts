import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENTS } from '../plausible';

/**
 * The passive-event regression guard (#71).
 *
 * Plausible counts ANY custom event as engagement unless it is sent with
 * `interactive: false`. Before #71 four app-fired events were sent as ordinary
 * events, which is why bounce rate read 1% at 1.7 pages/visit — every visitor
 * who was merely SHOWN an install nudge was counted as having engaged.
 *
 * These assertions pin the registry so that mislabelling an event is a failing
 * test rather than a silently corrupted metric nobody notices for a month. When
 * a new event is genuinely added, updating this test is the deliberate step that
 * forces the interactive/passive call to be made consciously.
 */
describe('analytics event registry', () => {
  const passive = Object.entries(ANALYTICS_EVENTS)
    .filter(([, kind]) => kind === 'passive')
    .map(([name]) => name)
    .sort();

  it('marks exactly the app-fired events passive', () => {
    expect(passive).toEqual([
      'community_nudge_shown',
      'install_nudge_shown',
      'pwa_stale_detected',
      'storage_persist_denied',
    ]);
  });

  it('keeps every *_dismissed event interactive — a dismissal is a real click', () => {
    const dismissals = Object.keys(ANALYTICS_EVENTS).filter((n) => n.endsWith('_dismissed'));
    expect(dismissals.length).toBeGreaterThan(0);
    for (const name of dismissals) {
      expect(ANALYTICS_EVENTS[name as keyof typeof ANALYTICS_EVENTS]).toBe('interactive');
    }
  });

  it('keeps the three dashboard-consumed events present and interactive', () => {
    // Renaming or removing one of these silently blanks a panel in
    // .claude/skills/early-adopter-metrics with no error anywhere.
    for (const name of ['signup', 'login', 'feature_used'] as const) {
      expect(ANALYTICS_EVENTS[name]).toBe('interactive');
    }
  });

  it('gives every event exactly one of the two kinds', () => {
    for (const kind of Object.values(ANALYTICS_EVENTS)) {
      expect(['interactive', 'passive']).toContain(kind);
    }
  });
});
