/**
 * The share-target ingest orchestrator (#64).
 *
 * Every branch here is a way a share can end WITHOUT a review modal opening, and the point
 * of each test is that the user is told and the event is recorded — a share that vanishes
 * silently is the failure mode this whole surface has to avoid, because the user has just
 * left another app and has no other feedback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mocks ──────────────────────────────────────────────────────────────────

const showToast = vi.fn();
vi.mock('../useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (e: unknown) => reportError(e) }));

const reportExtractionFailure = vi.fn();
vi.mock('../useExtractionErrorToast', () => ({
  useExtractionErrorToast: () => ({ reportExtractionFailure }),
}));

let online = true;
vi.mock('../useOnline', () => ({ useOnline: () => ({ isOnline: { value: online } }) }));

let aiConfigured = true;
vi.mock('../useAiCapability', () => ({
  useAiCapability: () => ({
    tier: { value: 'managed' },
    byokConfig: { value: null },
    isConfigured: { value: aiConfigured },
  }),
}));

let authInitialized = true;
let authenticated = true;
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    get isInitialized() {
      return authInitialized;
    },
    get isAuthenticated() {
      return authenticated;
    },
  }),
}));

let currentMember: object | null = { id: 'm1' };
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return currentMember;
    },
  }),
}));

const requestConsent = vi.fn();
vi.mock('../useDocumentConsent', () => ({ requestConsent: () => requestConsent() }));

const extractShareFromDocuments = vi.fn();
vi.mock('@/services/ai/documentExtractionService', () => ({
  extractShareFromDocuments: (f: unknown, o: unknown) => extractShareFromDocuments(f, o),
}));

const dispatchSharePayload = vi.fn();
const clearPendingMagic = vi.fn();
let readerEnabled = true;
vi.mock('../useMagicReader', () => ({
  dispatchSharePayload: (p: unknown) => dispatchSharePayload(p),
  clearPendingMagic: () => clearPendingMagic(),
  isReaderEnabled: () => readerEnabled,
  readerForShareKind: (k: string) => ({ event: 'photo', travel: 'document', recipe: 'recipe' })[k],
}));

import { ingestSharedDocuments } from '../useSharedDocumentIngest';

// ─── helpers ────────────────────────────────────────────────────────────────

const img = (name = 'a.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const meta = { platform: 'android' as const, coldStart: false };

const EVENT_RESULT = {
  success: true,
  data: { kind: 'event', event: { isEvent: true, title: 'Sports Day' } },
  compressedBlob: new Blob(['c']),
  truncated: false,
};

/** Every `logEvent` action emitted, in order. */
const actions = () => logEvent.mock.calls.map((c) => c[0].context?.action);

beforeEach(() => {
  vi.clearAllMocks();
  online = true;
  aiConfigured = true;
  authInitialized = true;
  authenticated = true;
  currentMember = { id: 'm1' };
  readerEnabled = true;
  requestConsent.mockResolvedValue({});
  extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);
});

describe('share ingest — the happy path', () => {
  it('extracts once and hands the result to the owning page', async () => {
    await ingestSharedDocuments([img()], meta);

    expect(extractShareFromDocuments).toHaveBeenCalledTimes(1);
    expect(dispatchSharePayload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event' }));
    // `received` gives every later event a denominator; `ready` is the success signal that
    // makes a failure RATE computable.
    expect(actions()).toEqual(['received', 'classified', 'ready']);
  });

  it('reads SEVERAL documents as ONE item, in one call', async () => {
    await ingestSharedDocuments([img('a.jpg'), img('b.jpg'), img('c.jpg')], meta);

    expect(extractShareFromDocuments).toHaveBeenCalledTimes(1);
    expect(extractShareFromDocuments.mock.calls[0][0]).toHaveLength(3);
    expect(dispatchSharePayload).toHaveBeenCalledTimes(1);
  });

  it('attaches the FIRST document as the provenance artefact', async () => {
    const first = img('first.jpg');
    await ingestSharedDocuments([first, img('second.jpg')], meta);

    expect(dispatchSharePayload.mock.calls[0][0].env.sourceFile).toBe(first);
  });

  it('does NOT clear the dispatch channel after a successful hand-over', async () => {
    // Clearing here would throw away the payload the page is about to read — i.e. the
    // whole feature would silently do nothing.
    await ingestSharedDocuments([img()], meta);
    expect(clearPendingMagic).not.toHaveBeenCalled();
  });

  it('routes each kind to its own reader', async () => {
    for (const [kind, payload] of [
      ['travel', { kind: 'travel', travel: { isTravel: true } }],
      ['recipe', { kind: 'recipe', recipe: { isRecipe: true } }],
    ] as const) {
      vi.clearAllMocks();
      extractShareFromDocuments.mockResolvedValue({ success: true, data: payload });
      await ingestSharedDocuments([img()], meta);
      expect(dispatchSharePayload).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    }
  });
});

describe('share ingest — readiness', () => {
  it('answers a share that arrives while signed out, and makes NO network call', async () => {
    authenticated = false;
    await ingestSharedDocuments([img()], meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.signIn.title', expect.anything());
    expect(actions()).toEqual(['received', 'not_ready']);
  });

  it('answers a share that arrives while the family is still loading', async () => {
    currentMember = null;
    await ingestSharedDocuments([img()], meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.notReady.title', expect.anything());
  });

  it('answers a share when the AI tier is not configured', async () => {
    aiConfigured = false;
    await ingestSharedDocuments([img()], meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'ai.unavailable.title', expect.anything());
  });

  it('records WHICH readiness gap it was, so it is diagnosable from the logs alone', async () => {
    authenticated = false;
    await ingestSharedDocuments([img()], meta);
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({
      action: 'not_ready',
      detail: 'signed_out',
    });
  });
});

describe('share ingest — what it will and will not read', () => {
  it('rejects an unsupported type with its own message', async () => {
    await ingestSharedDocuments([new File(['x'], 'notes.txt', { type: 'text/plain' })], meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.unsupported.title',
      expect.anything()
    );
    expect(actions()).toEqual(['received', 'rejected_type']);
  });

  it('keeps the readable files when a share mixes readable and unreadable', async () => {
    await ingestSharedDocuments(
      [img('good.jpg'), new File(['x'], 'bad.txt', { type: 'text/plain' })],
      meta
    );
    expect(extractShareFromDocuments.mock.calls[0][0]).toHaveLength(1);
  });

  it('answers an empty share rather than returning silently', async () => {
    await ingestSharedDocuments([], meta);
    expect(showToast).toHaveBeenCalled();
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({ detail: 'empty' });
  });

  it('never logs a filename or a sender-supplied MIME string', async () => {
    await ingestSharedDocuments(
      [new File(['x'], 'my-tax-return-2026.txt', { type: 'application/x-secret' })],
      meta
    );
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('my-tax-return-2026');
    expect(logged).not.toContain('x-secret');
  });
});

describe('share ingest — refusals and failures', () => {
  it('refuses a second share arriving mid-ingest AUDIBLY, not silently', async () => {
    let release: (v: unknown) => void = () => undefined;
    extractShareFromDocuments.mockReturnValue(new Promise((r) => (release = r)));

    const first = ingestSharedDocuments([img()], meta);
    await ingestSharedDocuments([img()], meta); // arrives while the first is in flight

    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.busy.title', expect.anything());
    expect(actions()).toContain('busy');

    release(EVENT_RESULT);
    await first;
  });

  it('frees the guard after a share finishes, so the next one is accepted', async () => {
    await ingestSharedDocuments([img()], meta);
    vi.clearAllMocks();
    extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);

    await ingestSharedDocuments([img()], meta);
    expect(extractShareFromDocuments).toHaveBeenCalled();
    expect(actions()).not.toContain('busy');
  });

  it('uses the shared offline branch rather than a second guard', async () => {
    online = false;
    await ingestSharedDocuments([img()], meta);

    expect(reportExtractionFailure).toHaveBeenCalledWith('offline');
    expect(extractShareFromDocuments).not.toHaveBeenCalled();
  });

  it('stops at a declined consent, before anything leaves the device', async () => {
    requestConsent.mockResolvedValue(null);
    await ingestSharedDocuments([img()], meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(actions()).toEqual(['received', 'consent_declined']);
  });

  it('reports an extraction failure through the shared mapper', async () => {
    extractShareFromDocuments.mockResolvedValue({ success: false, errorCode: 'timeout' });
    await ingestSharedDocuments([img()], meta);

    expect(reportExtractionFailure).toHaveBeenCalledWith('timeout');
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({
      action: 'failed',
      error_code: 'timeout',
    });
  });

  it('says so when the document is none of the three', async () => {
    extractShareFromDocuments.mockResolvedValue({ success: true, data: { kind: 'none' } });
    await ingestSharedDocuments([img()], meta);

    expect(dispatchSharePayload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.unrecognised.title',
      expect.anything()
    );
    expect(actions()).toEqual(['received', 'classified']);
  });

  it('says so when the destination reader is off or unavailable to this member', async () => {
    readerEnabled = false;
    await ingestSharedDocuments([img()], meta);

    expect(dispatchSharePayload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.readerOff.title',
      expect.anything()
    );
    expect(actions()).toContain('reader_disabled');
  });

  it('reports a throw and still tells the user', async () => {
    extractShareFromDocuments.mockRejectedValue(new Error('boom'));
    await ingestSharedDocuments([img()], meta);

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'share-target-ingest', severity: 'error' })
    );
    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', expect.anything());
  });

  it('clears the guard and the dispatch channel after a throw', async () => {
    extractShareFromDocuments.mockRejectedValue(new Error('boom'));
    await ingestSharedDocuments([img()], meta);

    // The channel is cleared so a dead-ended share cannot pin a File in memory…
    expect(clearPendingMagic).toHaveBeenCalled();

    // …and the guard is freed, so a throw does not wedge every future share.
    vi.clearAllMocks();
    extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);
    await ingestSharedDocuments([img()], meta);
    expect(dispatchSharePayload).toHaveBeenCalled();
  });

  it('clears the dispatch channel on every non-dispatching path', async () => {
    for (const setup of [
      () => (readerEnabled = false),
      () => (online = false),
      () => requestConsent.mockResolvedValue(null),
    ]) {
      vi.clearAllMocks();
      requestConsent.mockResolvedValue({});
      online = true;
      readerEnabled = true;
      setup();
      await ingestSharedDocuments([img()], meta);
      expect(clearPendingMagic).toHaveBeenCalled();
    }
  });
});
