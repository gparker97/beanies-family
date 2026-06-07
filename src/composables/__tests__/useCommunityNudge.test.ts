import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decideIssue } from '../useCommunityNudge';
import { COMMUNITY_NUDGE_COUNT } from '@/content/communityNudges';

// `openDiscord` is the single tracked open-path; mock the navigation primitive
// so we can assert ordering + analytics without a real anchor click.
const openExternalMock = vi.fn();
vi.mock('@/utils/openExternal', () => ({ openExternal: (url: string) => openExternalMock(url) }));

import { openDiscord, DISCORD_URL } from '@/utils/discord';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

type NudgeState = Parameters<typeof decideIssue>[0];
function state(over: Partial<NudgeState> = {}): NudgeState {
  return {
    schemaVersion: 1,
    activeNudge: null,
    nextDueAt: 0,
    shownCount: 0,
    joined: false,
    ...over,
  };
}

describe('decideIssue (pure cadence core)', () => {
  it('first run seeds nextDueAt one interval out and defers (no nudge yet)', () => {
    const { state: next, shown } = decideIssue(state({ nextDueAt: 0 }), NOW, 8 * DAY);
    expect(shown).toBe(false);
    expect(next.nextDueAt).toBe(NOW + 8 * DAY);
    expect(next.activeNudge).toBeNull();
  });

  it('does not issue before nextDueAt', () => {
    const s = state({ nextDueAt: NOW + DAY, shownCount: 0 });
    const { state: next, shown } = decideIssue(s, NOW, 8 * DAY);
    expect(shown).toBe(false);
    expect(next).toBe(s); // unchanged ref → caller skips the save
  });

  it('issues when due, rolls nextDueAt forward, increments count, rotates message', () => {
    const { state: next, shown } = decideIssue(
      state({ nextDueAt: NOW - 1, shownCount: 3 }),
      NOW,
      9 * DAY
    );
    expect(shown).toBe(true);
    expect(next.activeNudge).toEqual({ messageIndex: 3 % COMMUNITY_NUDGE_COUNT, issuedAt: NOW });
    expect(next.nextDueAt).toBe(NOW + 9 * DAY);
    expect(next.shownCount).toBe(4);
  });

  it('stops at the cap (5 shows)', () => {
    const { shown } = decideIssue(state({ nextDueAt: NOW - 1, shownCount: 5 }), NOW, 8 * DAY);
    expect(shown).toBe(false);
  });

  it('never issues once joined', () => {
    const { shown } = decideIssue(state({ joined: true, nextDueAt: NOW - 1 }), NOW, 8 * DAY);
    expect(shown).toBe(false);
  });

  it('never stacks a second nudge while one is active', () => {
    const s = state({ activeNudge: { messageIndex: 0, issuedAt: NOW - DAY }, nextDueAt: NOW - 1 });
    const { shown } = decideIssue(s, NOW, 8 * DAY);
    expect(shown).toBe(false);
  });
});

describe('openDiscord', () => {
  beforeEach(() => {
    openExternalMock.mockClear();
    (window as unknown as { plausible?: unknown }).plausible = vi.fn();
  });
  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('opens the stable DISCORD_URL and fires a surface-tagged event', () => {
    openDiscord('settings');
    expect(openExternalMock).toHaveBeenCalledWith(DISCORD_URL);
    const plausible = (window as unknown as { plausible: ReturnType<typeof vi.fn> }).plausible;
    expect(plausible).toHaveBeenCalledWith('discord_join_click', {
      props: { surface: 'settings' },
    });
  });

  it('navigates before firing analytics (gesture-sync contract)', () => {
    openDiscord('nudge');
    const plausible = (window as unknown as { plausible: ReturnType<typeof vi.fn> }).plausible;
    expect(openExternalMock.mock.invocationCallOrder[0]).toBeLessThan(
      plausible.mock.invocationCallOrder[0]
    );
  });
});
