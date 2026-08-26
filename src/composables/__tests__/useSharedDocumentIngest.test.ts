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
// `vi.hoisted` because the mock factory is lifted above ordinary top-level consts, and the
// module under test reads `consentOpen` at import time.
const { consentOpen } = vi.hoisted(() => ({ consentOpen: { value: false } }));
vi.mock('../useDocumentConsent', () => ({
  requestConsent: () => requestConsent(),
  consentOpen,
}));

const extractShareFromDocuments = vi.fn();
vi.mock('@/services/ai/documentExtractionService', () => ({
  extractShareFromDocuments: (f: unknown, o: unknown) => extractShareFromDocuments(f, o),
  extractShareFromText: (t: unknown, o: unknown) => extractShareFromText(t, o),
}));

const resolveRecipeSource = vi.fn();
vi.mock('@/services/ai/recipeSourceResolver', () => ({
  resolveRecipeSource: (url: string) => resolveRecipeSource(url),
}));

const extractShareFromText = vi.fn();

const dispatchSharePayload = vi.fn();
const clearPendingMagic = vi.fn();
let readerEnabled = true;
vi.mock('../useMagicReader', () => ({
  dispatchSharePayload: (p: unknown) => dispatchSharePayload(p),
  clearPendingMagic: () => clearPendingMagic(),
  isReaderEnabled: () => readerEnabled,
  readerForShareKind: (k: string) => ({ event: 'photo', travel: 'document', recipe: 'recipe' })[k],
}));

import { ingestSharedContent, isReadingSharedDocument } from '../useSharedDocumentIngest';

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
  consentOpen.value = false;
  requestConsent.mockReset().mockResolvedValue({});
  extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);
  extractShareFromText.mockResolvedValue(EVENT_RESULT);
  // Default: the link resolves to page text. Individual tests override for jsonld/refusal.
  resolveRecipeSource.mockResolvedValue({
    kind: 'text',
    text: 'page text',
    path: 'page_text',
    sourceUrl: 'https://example.com/cake',
    imageUrl: '',
  });
});

describe('share ingest — the happy path', () => {
  it('extracts once and hands the result to the owning page', async () => {
    await ingestSharedContent({ files: [img()] }, meta);

    expect(extractShareFromDocuments).toHaveBeenCalledTimes(1);
    expect(dispatchSharePayload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event' }));
    // `received` gives every later event a denominator; `ready` is the success signal that
    // makes a failure RATE computable.
    expect(actions()).toEqual(['received', 'triaged', 'classified', 'ready']);
  });

  it('reads SEVERAL documents as ONE item, in one call', async () => {
    await ingestSharedContent({ files: [img('a.jpg'), img('b.jpg'), img('c.jpg')] }, meta);

    expect(extractShareFromDocuments).toHaveBeenCalledTimes(1);
    expect(extractShareFromDocuments.mock.calls[0][0]).toHaveLength(3);
    expect(dispatchSharePayload).toHaveBeenCalledTimes(1);
  });

  it('attaches the FIRST document as the provenance artefact', async () => {
    const first = img('first.jpg');
    await ingestSharedContent({ files: [first, img('second.jpg')] }, meta);

    expect(dispatchSharePayload.mock.calls[0][0].env.sourceFile).toBe(first);
  });

  it('never clears the dispatch channel', async () => {
    // Two bugs in one assertion. Clearing after a successful hand-over would throw away the
    // payload the page is about to read. Clearing on a FAILED share would cancel a
    // magic-reader request the user had just made from the FAB — the orchestrator only ever
    // sets that ref by dispatching, so on every other path there is nothing of ours to clear.
    await ingestSharedContent({ files: [img()] }, meta);
    expect(clearPendingMagic).not.toHaveBeenCalled();
  });

  it('routes each kind to its own reader', async () => {
    for (const [kind, payload] of [
      ['travel', { kind: 'travel', travel: { isTravel: true } }],
      ['recipe', { kind: 'recipe', recipe: { isRecipe: true } }],
    ] as const) {
      vi.clearAllMocks();
      extractShareFromDocuments.mockResolvedValue({ success: true, data: payload });
      await ingestSharedContent({ files: [img()] }, meta);
      expect(dispatchSharePayload).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    }
  });
});

describe('share ingest — telling the user something is happening', () => {
  it('shows the reading overlay for the whole extraction, then clears it', async () => {
    // On a real device the app opened from a share and then sat there, visibly idle, for
    // four or five seconds before a form appeared. The in-app readers get their spinner from
    // the wedge's `isProcessing`, which `processFile` sets — and the share path bypasses
    // `processFile` entirely, so nothing ever set it.
    let release: (v: unknown) => void = () => undefined;
    extractShareFromDocuments.mockReturnValue(new Promise((r) => (release = r)));

    const pending = ingestSharedContent({ files: [img()] }, meta);
    await Promise.resolve();
    expect(isReadingSharedDocument.value).toBe(true);

    release(EVENT_RESULT);
    await pending;
    expect(isReadingSharedDocument.value).toBe(false);
  });

  it('hides the overlay while the consent prompt is up', async () => {
    // The consent modal IS the feedback at that moment, and the overlay sits above it.
    let release: (v: unknown) => void = () => undefined;
    requestConsent.mockReturnValue(new Promise((r) => (release = r)));

    const pending = ingestSharedContent({ files: [img()] }, meta);
    await Promise.resolve();
    consentOpen.value = true;
    expect(isReadingSharedDocument.value).toBe(false);

    consentOpen.value = false;
    release({});
    await pending;
  });

  it('clears the overlay even when the share fails', async () => {
    extractShareFromDocuments.mockRejectedValue(new Error('boom'));
    await ingestSharedContent({ files: [img()] }, meta);
    expect(isReadingSharedDocument.value).toBe(false);
  });
});

describe('share ingest — links', () => {
  const link = (text: string) => ingestSharedContent({ files: [], text }, meta);

  it('fetches the link and classifies the fetched TEXT, never the bare URL', async () => {
    await link('https://example.com/cake');

    expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
    // The model gets the page text. Sending the URL would be asking it to guess from a
    // string it cannot fetch.
    expect(extractShareFromText).toHaveBeenCalledWith('page text', expect.anything());
    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(dispatchSharePayload).toHaveBeenCalled();
  });

  it('finds a link inside prose', async () => {
    await link('Check this out! https://example.com/cake it looks great');
    expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
  });

  it('skips a URL the resolver would refuse and takes the next usable one', async () => {
    // A weaker predicate here than the resolver applies moments later would pick the
    // channel link and then die on it, with a readable link two words away.
    // The http:// URL is the POINT here: it must be skipped, not fetched.
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url
    await link('http://insecure.example.com and https://example.com/cake');
    expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
  });

  it('rejects a YouTube URL with no readable video id, rather than fetching it', async () => {
    // A channel or playlist page holds nothing we can read. `routeUrl` calls it invalid, and
    // the picker uses that same predicate — so it never reaches the fetcher.
    await link('https://youtu.be/short');

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.noLink.title', expect.anything());
  });

  it('finds a link at the END of a sentence', async () => {
    // Sentence-punctuated prose is the NORMAL input here. The trailing dot used to make the
    // video id 12 characters, which `routeUrl` rejects — so a perfectly readable video was
    // reported as "No Link Found".
    await link('Watch this https://youtu.be/dQw4w9WgXcQ.');
    expect(resolveRecipeSource).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });

  it('does not carry sentence punctuation into the fetched URL', async () => {
    await link('Great one https://example.com/cake!');
    // With the `!` left on, the fetch 404s and the user is told the link is dead.
    expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
  });

  it('says so when the shared text carries no link at all', async () => {
    await link('just some words I copied');

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(extractShareFromText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.noLink.title', expect.anything());
    expect(actions()).toEqual(['received', 'no_url']);
  });

  it('takes a schema.org Recipe page at its word — ZERO AI calls', async () => {
    resolveRecipeSource.mockResolvedValue({
      kind: 'jsonld',
      recipe: { name: 'Cake', imageUrl: 'https://example.com/cake.jpg' },
      path: 'jsonld',
      sourceUrl: 'https://example.com/cake',
      imageUrl: 'https://example.com/cake.jpg',
    });

    await link('https://example.com/cake');

    expect(extractShareFromText).not.toHaveBeenCalled();
    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    const payload = dispatchSharePayload.mock.calls[0][0];
    expect(payload.kind).toBe('recipe');
    expect(payload.source.via).toBe('jsonld');
  });

  it('carries the link on the envelope, with page and provenance URLs distinguished', async () => {
    await link('https://example.com/cake');
    const env = dispatchSharePayload.mock.calls[0][0].env;
    expect(env.sourceFile).toBeNull();
    expect(env.link.pageUrl).toBe('https://example.com/cake');
    expect(env.link.provenanceUrl).toBe('https://example.com/cake');
  });

  it('reports a fetch failure through the shared mapper', async () => {
    resolveRecipeSource.mockResolvedValue({ kind: 'failed', errorCode: 'fetch_blocked' });
    await link('https://example.com/cake');

    expect(reportExtractionFailure).toHaveBeenCalledWith('fetch_blocked');
    expect(dispatchSharePayload).not.toHaveBeenCalled();
  });

  it('a video with only a title still delivers a NAMED, LINKED recipe — no AI call', async () => {
    // The whole point of the fallback: the capture the user deliberately made is not lost.
    // The title becomes the name; the ingredients and steps stay empty for them to fill.
    resolveRecipeSource.mockResolvedValue({
      kind: 'titleOnly',
      title: 'Pumpkin Pie',
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      path: 'youtube_description',
    });

    await link('https://youtu.be/dQw4w9WgXcQ');

    expect(extractShareFromText).not.toHaveBeenCalled();
    const payload = dispatchSharePayload.mock.calls[0][0];
    expect(payload.kind).toBe('recipe');
    expect(payload.source).toEqual({ via: 'titleOnly', title: 'Pumpkin Pie' });
    // The video itself is the provenance, and the origin flag keeps the start/ready pair
    // balanced for the share path.
    expect(payload.env.link.provenanceUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(payload.env.origin).toBe('share');
    // A mostly-empty form must arrive WITH its explanation, or it reads as a failure.
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipeExtract.titleOnly.title',
      expect.anything()
    );
  });

  it('tells the user when a video has nothing to read', async () => {
    resolveRecipeSource.mockResolvedValue({ kind: 'refusal', reason: 'no_text_no_link' });
    await link('https://youtu.be/dQw4w9WgXcQ');

    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipeExtract.noTranscript.title',
      expect.anything()
    );
  });

  it('asks for consent BEFORE fetching the page, not just before extracting', async () => {
    requestConsent.mockResolvedValue(null);
    await link('https://example.com/cake');

    expect(resolveRecipeSource).not.toHaveBeenCalled();
  });

  it('reports an UNREADABLE file as a file problem, not as a missing link', async () => {
    // Senders routinely set both extras — Google Photos attaches an album link beside the
    // image. Falling through to the text branch would quietly read the album page instead
    // and never tell the user their photo was too big.
    await ingestSharedContent(
      {
        files: [new File(['PK'], 'huge.zip', { type: 'application/zip' })],
        text: 'https://photos.example.com/album/123',
      },
      meta
    );

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.unsupported.title',
      expect.anything()
    );
  });

  it('FILES WIN over a caption, so one share is one item', async () => {
    await ingestSharedContent({ files: [img()], text: 'https://example.com/cake' }, meta);

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(extractShareFromDocuments).toHaveBeenCalled();
    expect(dispatchSharePayload).toHaveBeenCalledTimes(1);
  });

  it('caps sender-supplied text before anything parses it', async () => {
    // The cap lives in the orchestrator so every platform is bounded identically.
    const buried = `${'x '.repeat(3000)}https://example.com/cake`;
    await link(buried);

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.noLink.title', expect.anything());
  });
});

describe('share ingest — readiness', () => {
  it('answers a share that arrives while signed out, and makes NO network call', async () => {
    authenticated = false;
    await ingestSharedContent({ files: [img()] }, meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.signIn.title', expect.anything());
    expect(actions()).toEqual(['received', 'not_ready']);
  });

  it('WAITS for the family to finish loading rather than refusing immediately', async () => {
    // The bug this replaces: readiness waited only on `isInitialized`, which flips long
    // before `currentMember` exists — so almost every cold-start share was refused with
    // "still counting your beans" AFTER the native side had already cleared it.
    currentMember = null;
    const pending = ingestSharedContent({ files: [img()] }, meta);

    // Nothing refused yet: it is still waiting.
    await Promise.resolve();
    expect(showToast).not.toHaveBeenCalled();

    currentMember = { id: 'm1' };
    await pending;

    expect(extractShareFromDocuments).toHaveBeenCalled();
  });

  it('gives up with a message if the family never arrives', async () => {
    vi.useFakeTimers();
    currentMember = null;
    try {
      const pending = ingestSharedContent({ files: [img()] }, meta);
      await vi.advanceTimersByTimeAsync(11_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.notReady.title', expect.anything());
  });

  it('answers a share when the AI tier is not configured', async () => {
    aiConfigured = false;
    await ingestSharedContent({ files: [img()] }, meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('info', 'ai.unavailable.title', expect.anything());
  });

  it('records WHICH readiness gap it was, so it is diagnosable from the logs alone', async () => {
    authenticated = false;
    await ingestSharedContent({ files: [img()] }, meta);
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({
      action: 'not_ready',
      detail: 'signed_out',
    });
  });
});

describe('share ingest — what it will and will not read', () => {
  it('rejects an unsupported type with its own message', async () => {
    await ingestSharedContent(
      { files: [new File(['PK'], 'archive.zip', { type: 'application/zip' })] },
      meta
    );

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.unsupported.title',
      expect.anything()
    );
    expect(actions()).toEqual(['received', 'rejected_type']);
  });

  it('reads a shared .txt as TEXT rather than calling it unreadable', async () => {
    // iOS hands a shared URL over as a .txt in the app group, so this normalisation exists
    // for that — but doing it in the orchestrator means a .txt from ANY platform works.
    await ingestSharedContent(
      { files: [new File(['see https://example.com/cake'], 'link.txt', { type: 'text/plain' })] },
      meta
    );

    expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
  });

  it('keeps the readable files when a share mixes readable and unreadable', async () => {
    await ingestSharedContent(
      { files: [img('good.jpg'), new File(['x'], 'bad.txt', { type: 'text/plain' })] },
      meta
    );
    expect(extractShareFromDocuments.mock.calls[0][0]).toHaveLength(1);
  });

  it('accepts a file whose BYTES are a JPEG even when the sender declares nothing', async () => {
    // Android reports whatever the sender's own provider says, including "". Rejecting on
    // that alone would refuse perfectly good photos.
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    await ingestSharedContent({ files: [new File([jpegBytes], 'photo', { type: '' })] }, meta);
    expect(extractShareFromDocuments).toHaveBeenCalled();
  });

  it('answers an empty share rather than returning silently', async () => {
    await ingestSharedContent({ files: [] }, meta);
    expect(showToast).toHaveBeenCalled();
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({ detail: 'empty' });
  });

  it('never logs a filename or a sender-supplied MIME string', async () => {
    await ingestSharedContent(
      { files: [new File(['x'], 'my-tax-return-2026.txt', { type: 'application/x-secret' })] },
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

    const first = ingestSharedContent({ files: [img()] }, meta);
    await ingestSharedContent({ files: [img()] }, meta); // arrives while the first is in flight

    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.busy.title', expect.anything());
    expect(actions()).toContain('busy');

    release(EVENT_RESULT);
    await first;
  });

  it('frees the guard after a share finishes, so the next one is accepted', async () => {
    await ingestSharedContent({ files: [img()] }, meta);
    vi.clearAllMocks();
    extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);

    await ingestSharedContent({ files: [img()] }, meta);
    expect(extractShareFromDocuments).toHaveBeenCalled();
    expect(actions()).not.toContain('busy');
  });

  it('uses the shared offline branch rather than a second guard', async () => {
    online = false;
    await ingestSharedContent({ files: [img()] }, meta);

    expect(reportExtractionFailure).toHaveBeenCalledWith('offline');
    expect(extractShareFromDocuments).not.toHaveBeenCalled();
  });

  it('stops at a declined consent, before anything leaves the device', async () => {
    requestConsent.mockResolvedValue(null);
    await ingestSharedContent({ files: [img()] }, meta);

    expect(extractShareFromDocuments).not.toHaveBeenCalled();
    expect(actions()).toEqual(['received', 'triaged', 'consent_declined']);
  });

  it('reports an extraction failure through the shared mapper', async () => {
    extractShareFromDocuments.mockResolvedValue({ success: false, errorCode: 'timeout' });
    await ingestSharedContent({ files: [img()] }, meta);

    expect(reportExtractionFailure).toHaveBeenCalledWith('timeout');
    expect(logEvent.mock.calls.at(-1)?.[0].context).toMatchObject({
      action: 'failed',
      error_code: 'timeout',
    });
  });

  it('says so when the document is none of the three', async () => {
    extractShareFromDocuments.mockResolvedValue({ success: true, data: { kind: 'none' } });
    await ingestSharedContent({ files: [img()] }, meta);

    expect(dispatchSharePayload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.unrecognised.title',
      expect.anything()
    );
    expect(actions()).toEqual(['received', 'triaged', 'classified']);
  });

  it('says so when the destination reader is off or unavailable to this member', async () => {
    readerEnabled = false;
    await ingestSharedContent({ files: [img()] }, meta);

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
    await ingestSharedContent({ files: [img()] }, meta);

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'share-target-ingest', severity: 'error' })
    );
    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', expect.anything());
  });

  it('frees the guard after a throw, so one bad share does not wedge every later one', async () => {
    extractShareFromDocuments.mockRejectedValue(new Error('boom'));
    await ingestSharedContent({ files: [img()] }, meta);

    vi.clearAllMocks();
    extractShareFromDocuments.mockResolvedValue(EVENT_RESULT);
    await ingestSharedContent({ files: [img()] }, meta);
    expect(dispatchSharePayload).toHaveBeenCalled();
  });

  it('leaves a pending magic-reader request alone when a share fails', async () => {
    // The FAB sets `pendingMagic` and navigates; a share failing in that window must not
    // cancel it, or the picker never opens and the user is told nothing.
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
      await ingestSharedContent({ files: [img()] }, meta);
      expect(clearPendingMagic).not.toHaveBeenCalled();
    }
  });

  it('says so when the platform could only hand over part of the share', async () => {
    await ingestSharedContent({ files: [img()] }, { ...meta, unreadable: 2 });
    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.partial.title', expect.anything());
  });

  it('blames the PLATFORM, not the file, when nothing could be read at all', async () => {
    // The worst case used to fall through to "beanies can't read that kind of file", which
    // blames the user's perfectly good photo for a provider failure.
    await ingestSharedContent({ files: [] }, { ...meta, unreadable: 3 });

    expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.partial.title', expect.anything());
    expect(showToast).not.toHaveBeenCalledWith(
      'info',
      'shareTarget.unsupported.title',
      expect.anything()
    );
  });

  it('re-stamps a file with the type its BYTES say, so downstream agrees', async () => {
    // A real PDF an Android provider declared as octet-stream: accepted on the bytes, then
    // handed downstream where `isPdfFile` reads `file.type` — which used to still say
    // octet-stream, so the PDF went into the image compressor and failed as a "photo".
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    await ingestSharedContent(
      { files: [new File([pdfBytes], 'booking', { type: 'application/octet-stream' })] },
      meta
    );

    const sent = extractShareFromDocuments.mock.calls[0][0][0] as File;
    expect(sent.type).toBe('application/pdf');
    expect(sent.name).toMatch(/\.pdf$/);
  });

  it('says only the first document is attached when several are shared', async () => {
    // Below the page cap `truncated` is false, so without this a 2-4 file share silently
    // keeps just one photo.
    await ingestSharedContent({ files: [img('a.jpg'), img('b.jpg')] }, meta);
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.firstAttached.title',
      expect.anything()
    );
  });
});
