/**
 * The "setup never completed" device marker (2026-11-16) and the two Slack lines it feeds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import {
  POD_SETUP_PENDING_MAX_AGE_MS,
  clearPodSetupPending,
  heardViaSlackLine,
  markPodSetupPending,
  notePodSetupStep,
  podSetupPendingKey,
  readPodSetupPending,
  setupSlackLine,
  type PodSetupStep,
  type SetupReturnVia,
} from '@/utils/podSetupPending';

const NOW = 1_800_000_000_000;

function markerLines() {
  return h.logEvent.mock.calls
    .map(([e]) => e as { level: string; message: string; context: Record<string, unknown> })
    .filter((e) => e.message === 'setup-marker')
    .map((e) => ({ level: e.level, ...e.context }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the marker', () => {
  it('is set with the kit step, the member and the attempt, under a per-family key', () => {
    markPodSetupPending('fam-1', 'mem-1', 'att-1', NOW);

    expect(JSON.parse(localStorage.getItem(podSetupPendingKey('fam-1'))!)).toEqual({
      memberId: 'mem-1',
      attemptId: 'att-1',
      step: 'kit',
      createdAt: NOW,
    });
    expect(readPodSetupPending('fam-1', NOW)).toEqual({
      kind: 'ok',
      value: { memberId: 'mem-1', attemptId: 'att-1', step: 'kit', createdAt: NOW },
    });
    expect(markerLines()).toEqual([{ level: 'info', action: 'set', detail: 'kit' }]);
  });

  it('records the last step shown, and logs nothing on success', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW);
    h.logEvent.mockClear();

    notePodSetupStep('fam-1', 'members');
    notePodSetupStep('fam-1', 'survey');

    const read = readPodSetupPending('fam-1', NOW);
    expect(read.kind === 'ok' && read.value.step).toBe('survey');
    expect(markerLines()).toEqual([]);
  });

  it('a step with no marker is a no-op', () => {
    notePodSetupStep('fam-1', 'members');

    expect(localStorage.getItem(podSetupPendingKey('fam-1'))).toBeNull();
  });

  it('is cleared, and a clear with none is silent', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW);
    h.logEvent.mockClear();

    clearPodSetupPending('fam-1', 'completed');
    clearPodSetupPending('fam-1', 'family-forgotten');

    expect(readPodSetupPending('fam-1', NOW)).toEqual({ kind: 'missing' });
    expect(markerLines()).toEqual([{ level: 'info', action: 'cleared', detail: 'completed' }]);
  });

  it('is per family: another family neither reads nor clears it', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW);

    expect(readPodSetupPending('fam-2', NOW)).toEqual({ kind: 'missing' });
    clearPodSetupPending('fam-2', 'family-forgotten');
    notePodSetupStep('fam-2', 'survey');

    const read = readPodSetupPending('fam-1', NOW);
    expect(read.kind === 'ok' && read.value.step).toBe('kit');
  });

  it('a corrupt record is removed and reported', () => {
    localStorage.setItem(podSetupPendingKey('fam-1'), JSON.stringify({ memberId: 'mem-1' }));

    expect(readPodSetupPending('fam-1', NOW)).toEqual({ kind: 'corrupt' });
    expect(localStorage.getItem(podSetupPendingKey('fam-1'))).toBeNull();
    expect(markerLines()).toEqual([{ level: 'info', action: 'cleared', detail: 'corrupt' }]);
  });

  it('an old record, or one from the future, is expired and removed', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW - POD_SETUP_PENDING_MAX_AGE_MS - 1);
    expect(readPodSetupPending('fam-1', NOW)).toEqual({ kind: 'expired' });
    expect(localStorage.getItem(podSetupPendingKey('fam-1'))).toBeNull();

    markPodSetupPending('fam-2', 'mem-1', null, NOW + 60_000);
    expect(readPodSetupPending('fam-2', NOW)).toEqual({ kind: 'expired' });
  });
});

describe('the marker with storage unavailable', () => {
  // happy-dom's localStorage methods live on the instance; each spy is restored explicitly.
  const spies: Array<{ mockRestore: () => void }> = [];
  function refuse(method: 'getItem' | 'setItem' | 'removeItem') {
    spies.push(
      vi.spyOn(localStorage, method).mockImplementation(() => {
        throw new Error('storage refused');
      })
    );
  }
  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  it('a refused write never throws and is logged at warn', () => {
    refuse('setItem');

    expect(() => markPodSetupPending('fam-1', 'mem-1', null, NOW)).not.toThrow();
    expect(markerLines()).toEqual([{ level: 'warn', action: 'storage-failed', stage: 'set' }]);
  });

  it('a refused step update never throws and is logged at warn', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW);
    h.logEvent.mockClear();
    refuse('setItem');

    expect(() => notePodSetupStep('fam-1', 'members')).not.toThrow();
    expect(markerLines()).toEqual([
      { level: 'warn', action: 'storage-failed', stage: 'step', detail: 'members' },
    ]);
  });

  it('a refused read is "missing", never a throw', () => {
    refuse('getItem');

    expect(readPodSetupPending('fam-1', NOW)).toEqual({ kind: 'missing' });
    expect(() => notePodSetupStep('fam-1', 'kit')).not.toThrow();
    expect(() => clearPodSetupPending('fam-1', 'completed')).not.toThrow();
  });

  it('a refused clear never throws and is logged at warn', () => {
    markPodSetupPending('fam-1', 'mem-1', null, NOW);
    h.logEvent.mockClear();
    refuse('removeItem');

    expect(() => clearPodSetupPending('fam-1', 'completed')).not.toThrow();
    expect(markerLines()).toEqual([
      { level: 'warn', action: 'storage-failed', stage: 'clear', detail: 'completed' },
    ]);
  });
});

describe('the Slack lines', () => {
  it('Heard via: an answer, a skip, and a survey never reached', () => {
    expect(
      heardViaSlackLine({ kind: 'answered', heardVia: { id: 'friend', label: 'A friend' } })
    ).toBe('\n*Heard via:* A friend');
    expect(heardViaSlackLine({ kind: 'skipped' })).toBe('\n*Heard via:* (skipped)');
    expect(heardViaSlackLine({ kind: 'not-seen' })).toBe('\n*Heard via:* (not seen)');
  });

  it('no Setup line when setup finished in the wizard', () => {
    expect(setupSlackLine(undefined)).toBe('');
  });

  it.each<[PodSetupStep, string]>([
    ['kit', 'recovery kit'],
    ['members', 'add members'],
    ['survey', 'survey'],
  ])('Setup: left at %s', (leftAt, words) => {
    expect(setupSlackLine({ leftAt, via: 'page-reloaded', attemptId: null })).toBe(
      `\n*Setup:* left at the ${words} step, finished on next open (page reloaded)`
    );
  });

  it.each<[SetupReturnVia, string]>([
    ['app-restarted', 'app restarted'],
    ['page-reloaded', 'page reloaded'],
    ['signed-in', 'signed in'],
    ['signed-in-pin', 'signed in with PIN'],
    ['signed-in-biometric', 'signed in with biometrics'],
    ['signed-in-tap-through', 'signed in with a tap on their name'],
    ['signed-in-password', 'signed in with password'],
    ['signed-in-passphrase', 'signed in with passphrase'],
    ['signed-in-recovery-kit', 'signed in with recovery kit'],
    ['signed-in-recovery-passphrase', 'signed in with recovery passphrase'],
  ])('Setup: came back by %s', (via, words) => {
    expect(setupSlackLine({ leftAt: 'kit', via, attemptId: null })).toBe(
      `\n*Setup:* left at the recovery kit step, finished on next open (${words})`
    );
  });
});

describe('the marker does not outlive the family on this device', () => {
  // Asserted against the source, as `deleteLocalFamilyRegistry.test.ts` does: `deleteLocalFamily`
  // touches IndexedDB, passkeys and file handles. It is the one forget path the "sign out and
  // clear all data" sweep, Start over and an eviction all run.
  it('deleteLocalFamily clears it for the forgotten family', () => {
    const source = readFileSync('src/services/familyContext.ts', 'utf8');
    expect(source).toMatch(/clearPodSetupPending\(familyId, 'family-forgotten'\)/);
  });
});
