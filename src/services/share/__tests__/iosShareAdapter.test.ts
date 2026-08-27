/**
 * The iOS adapter's DIAGNOSTIC contract (#64).
 *
 * The extension is a separate process with no WebView, so it cannot log. Everything we will
 * ever know about why an iPhone share appeared to do nothing arrives through this one
 * `consume()` result. The case worth pinning is `declined` with zero files: on device that
 * is indistinguishable from the app ignoring the share entirely, and it was exactly the
 * report that started this ("the app doesn't open, no other errors or info").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const consume = vi.fn();
const logEvent = vi.fn();
const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });

vi.mock('@capacitor/app', () => ({ App: { addListener: (...a: unknown[]) => addListener(...a) } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: () => true,
  },
}));
vi.mock('../shareIntentPlugin', () => ({ ShareIntent: { consume: () => consume() } }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/base64ToFile', () => ({
  base64ToFile: (_d: string, name: string, type: string) => new File(['x'], name, { type }),
}));

import { iosShareAdapter } from '../iosShareAdapter';

/** Run one drain and return the payloads handed to the orchestrator. */
async function drainOnce(result: unknown) {
  consume.mockResolvedValue(result);
  const onShare = vi.fn();
  const stop = iosShareAdapter.start(onShare);
  await vi.waitFor(() => expect(consume).toHaveBeenCalled());
  await Promise.resolve();
  stop();
  return onShare;
}

describe('iosShareAdapter — open-outcome reporting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('REPORTS a trace that arrived with NOTHING staged — the case that hid the bug', async () => {
    // The whole point. An early return on `files.length === 0` above the logging would
    // discard exactly this, which is the state the user actually hit: the extension ran,
    // staged nothing, and CloudWatch showed complete silence. The `offered=` types are the
    // payload that says WHY, so they must survive into the event verbatim.
    const trace = 'items=1;offered=public.plain-text,public.url;staged=0;stage=nothing_staged';
    const onShare = await drainOnce({ files: [], openOutcome: trace });

    expect(onShare).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = logEvent.mock.calls[0][0];
    expect(event.level).toBe('warn');
    expect(event.surface).toBe('share-target-ingest');
    expect(event.context).toMatchObject({ os: 'ios', detail: trace, file_count: 0 });
  });

  it('reports a successful open at info, alongside the files it carried', async () => {
    const onShare = await drainOnce({
      files: [{ data: 'eA==', name: 'a.txt', type: 'text/plain' }],
      openOutcome: 'items=1;offered=public.url;staged=1;stage=staged',
    });

    expect(logEvent.mock.calls[0][0].level).toBe('info');
    expect(logEvent.mock.calls[0][0].context).toMatchObject({ file_count: 1 });
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('treats an UNHEALTHY stage as a warning, so it stands out from the normal path', async () => {
    await drainOnce({
      files: [],
      openOutcome: 'items=1;offered=public.vcard;staged=0;stage=nothing_staged',
    });
    expect(logEvent.mock.calls[0][0].level).toBe('warn');
  });

  it("still reads an OLD build's `opened` trace as healthy, not as a failure", async () => {
    // The extension stopped trying to open the app once Apple's position was confirmed.
    // A phone that has not updated yet keeps sending the old stage; it was never a fault.
    await drainOnce({
      files: [{ data: 'eA==', name: 'a.txt', type: 'text/plain' }],
      openOutcome: 'items=1;offered=public.url;staged=1;stage=opened',
    });
    expect(logEvent.mock.calls[0][0].level).toBe('info');
  });

  it('stays SILENT when there is no marker, so old builds do not spam the firehose', async () => {
    // `none` means the extension left nothing: every build before this shipped, and any
    // share that staged no supported item. Logging it would drown the real signal.
    await drainOnce({ files: [], openOutcome: 'none' });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('tolerates a plugin that does not report an outcome at all', async () => {
    await drainOnce({ files: [] });
    expect(logEvent).not.toHaveBeenCalled();
  });
});
