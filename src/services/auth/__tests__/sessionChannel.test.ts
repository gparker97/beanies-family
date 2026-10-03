/**
 * C10 cross-tab sign-out: an untrusted sign-out announces the end of the family's session on
 * `BroadcastChannel('beanies-session:<familyId>')`, whether or not its cache delete ran, and
 * every OTHER tab bound to that family runs the cleared-elsewhere teardown. A raw channel of
 * the same name stands in for "another tab" here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import {
  __resetSessionChannelForTests,
  announceSessionEnded,
  bindSessionChannel,
  sessionChannelName,
  setSessionEndedHandler,
  SESSION_ENDED_MESSAGE,
} from '@/services/auth/sessionChannel';

const flush = () => new Promise((r) => setTimeout(r, 20));
const opened: BroadcastChannel[] = [];
function otherTab(familyId: string): BroadcastChannel {
  const ch = new BroadcastChannel(sessionChannelName(familyId));
  opened.push(ch);
  return ch;
}

beforeEach(() => __resetSessionChannelForTests());
afterEach(() => {
  for (const ch of opened.splice(0)) ch.close();
  __resetSessionChannelForTests();
});

describe('sessionChannel', () => {
  it('a bound tab runs the handler when another tab announces the end of its family', async () => {
    const handler = vi.fn();
    setSessionEndedHandler(handler);
    bindSessionChannel('fam-1');
    otherTab('fam-1').postMessage({ type: SESSION_ENDED_MESSAGE, familyId: 'fam-1', from: 'x' });
    await flush();
    expect(handler).toHaveBeenCalledWith('fam-1');
  });

  it('announceSessionEnded reaches the other tabs of that family', async () => {
    const received = vi.fn();
    otherTab('fam-1').onmessage = (e) => received(e.data);
    announceSessionEnded('fam-1');
    await flush();
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ type: SESSION_ENDED_MESSAGE, familyId: 'fam-1' })
    );
  });

  it('never answers its own announcement (no self-teardown, no ping-pong)', async () => {
    const handler = vi.fn();
    setSessionEndedHandler(handler);
    bindSessionChannel('fam-1');
    announceSessionEnded('fam-1');
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores another family, and stops listening once unbound', async () => {
    const handler = vi.fn();
    setSessionEndedHandler(handler);
    bindSessionChannel('fam-1');
    otherTab('fam-2').postMessage({ type: SESSION_ENDED_MESSAGE, familyId: 'fam-2', from: 'x' });
    await flush();
    expect(handler).not.toHaveBeenCalled();

    bindSessionChannel(null);
    otherTab('fam-1').postMessage({ type: SESSION_ENDED_MESSAGE, familyId: 'fam-1', from: 'x' });
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });
});
