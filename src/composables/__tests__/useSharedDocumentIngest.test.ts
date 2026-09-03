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
let aiTier = 'managed';
vi.mock('../useAiCapability', () => ({
  useAiCapability: () => ({
    get tier() {
      return { value: aiTier };
    },
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

// The family id scopes the text budget and is sent to the proxy so it can rate-limit per
// family (#83). Mocked rather than swallowed in the orchestrator on purpose: in production
// Pinia is always up by the time a share is triaged (`awaitReadiness` has already confirmed
// `currentMember`), so a try/catch there would only hide a real regression — the family
// limit silently ceasing to apply.
let activeFamilyId: string | null = 'fam-1';
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    get activeFamilyId() {
      return activeFamilyId;
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

// The real `routeUrl`, wrapped so its calls can be COUNTED. The suite depends on its actual
// verdicts (which URLs are usable), so this delegates rather than stubbing.
//
// ⚠️ A plain closure counter, NOT a `vi.fn()`: `vi.clearAllMocks()` in `beforeEach` wipes a
// mock's implementation, which would leave `routeUrl` returning `undefined` and break every
// link test in the file. This exists only so "the link-router chunk is never loaded when the
// body wins" is assertable rather than asserted by inspection.
const routerCalls = { count: 0 };
vi.mock('@/utils/recipeSourceUrl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/recipeSourceUrl')>();
  return {
    ...actual,
    routeUrl: (u: string) => {
      routerCalls.count += 1;
      return actual.routeUrl(u);
    },
  };
});

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

import {
  ingestInAppSource,
  ingestSharedContent,
  isReadingSharedDocument,
} from '../useSharedDocumentIngest';
import { __resetAttemptBudgetForTests } from '@/utils/attemptBudget';
import { MAX_LINK_NOTE_CHARS, MAX_SHARE_TEXT_CHARS } from '@/services/share/types';

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
  // The text budget is MODULE-level and persisted, exactly so it survives a reload. That
  // makes it survive a test too, so one case's spend would otherwise leak into the next.
  __resetAttemptBudgetForTests();
  activeFamilyId = 'fam-1';
  routerCalls.count = 0;
  aiTier = 'managed';
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
    //
    // The share is essentially just the link (the note around it is under the text minimum),
    // so it is refused AS A LINK rather than handed to the model as prose — the model cannot
    // fetch, so that call could only ever return `none`.
    await link('have a look at this one https://youtu.be/short');

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(extractShareFromText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipeExtract.badLink.title',
      expect.anything()
    );
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

  it('reads the text itself when the share carries no link at all (#83)', async () => {
    // This used to be the "No Link Found" dead end. The text IS the share now.
    await link('Sports day is on Tuesday the 4th at 9am, meet at the school gate');

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(extractShareFromText).toHaveBeenCalled();
    expect(actions()).toEqual(['received', 'triaged', 'classified', 'ready']);
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

  it('bounds what is READ at the cap, so a URL past it is never seen', async () => {
    // The cap lives in the orchestrator so every platform is bounded identically. A URL
    // sitting past it is unfindable — accepted, and unchanged.
    //
    // ⚠️ Derived from the constant, not a literal. Written against a 4,000 cap this buried the
    // URL at offset 6,000; at 10,000 that URL became visible AND the prose won the arm, so the
    // test failed for a reason unrelated to what it was pinning.
    const buried = `${'x '.repeat(MAX_SHARE_TEXT_CHARS)}https://example.com/cake`;
    await link(buried);

    expect(resolveRecipeSource).not.toHaveBeenCalled();
    // Over the read cap but under the ceiling, so it is read TRUNCATED, with the user told
    // once — not silently, and not refused.
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'shareTarget.text.truncated.title',
      expect.anything()
    );
    const sent = extractShareFromText.mock.calls[0][0] as string;
    expect(sent.length).toBe(MAX_SHARE_TEXT_CHARS);
    expect(sent).not.toContain('https://example.com/cake');
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

// ─── #83: shared plain text ──────────────────────────────────────────────────
//
// The precedence matrix lives HERE, in the existing file, because every row is a statement
// about `prepare()`'s ordering and the rest of that ordering is already tested above. Each
// row asserts a DIFFERENT outcome, so no case can pass vacuously — the failure this guards
// against is the new branch quietly capturing a share that used to take another path.

describe('share ingest — shared text (#83)', () => {
  const share = (text: string) => ingestSharedContent({ files: [], text }, meta);
  /** Long enough to clear MIN_SHARE_TEXT_CHARS, with no URL in it. */
  const REAL = 'Sports day Tuesday the 4th at 9am, meet at the school gate';

  /** A shared `.txt`, which is how EVERY iOS text share arrives. */
  function txt(content: string, sizeOverride?: number) {
    const file = new File([content], 'shared.txt', { type: 'text/plain' });
    if (sizeOverride !== undefined) {
      // A real 200 KB File would allocate 200 KB per test run; the byte gate reads `size`
      // and nothing else, so overriding it tests the gate honestly and cheaply.
      Object.defineProperty(file, 'size', { value: sizeOverride });
    }
    return file;
  }

  describe('precedence — the new branch is strictly downstream of every existing one', () => {
    it('files only → documents', async () => {
      await ingestSharedContent({ files: [img()] }, meta);
      expect(extractShareFromDocuments).toHaveBeenCalled();
      expect(extractShareFromText).not.toHaveBeenCalled();
    });

    it('files + a readable caption → documents, never the caption', async () => {
      await ingestSharedContent({ files: [img()], text: REAL }, meta);
      expect(extractShareFromDocuments).toHaveBeenCalled();
      expect(extractShareFromText).not.toHaveBeenCalled();
    });

    it('an UNREADABLE file beside a caption is still a FILE problem', async () => {
      // The silent substitution this guards against: reading the caption instead and never
      // telling the user their photo was too big. Senders routinely set both extras.
      await ingestSharedContent(
        {
          files: [new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' })],
          text: REAL,
        },
        meta
      );
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(extractShareFromDocuments).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.unsupported.title',
        expect.anything()
      );
    });

    it('text containing a link still takes the LINK path', async () => {
      await share(`Have a look at this https://example.com/cake ${REAL}`);
      expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
    });

    it('a shared .txt IS the share, and reaches the text path', async () => {
      await ingestSharedContent({ files: [txt(REAL)] }, meta);
      expect(extractShareFromText).toHaveBeenCalledWith(REAL, expect.anything());
    });
  });

  describe('size bands', () => {
    it('refuses text under the minimum WITHOUT an AI call', async () => {
      await share('Soccer 4pm');
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooShort.title',
        expect.anything()
      );
      expect(actions()).toEqual(['received', 'rejected_type']);
    });

    it('counts the minimum AFTER trimming, so whitespace cannot pass it', async () => {
      await share(`   ${' '.repeat(60)}   `);
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooShort.title',
        expect.anything()
      );
    });

    it('refuses text over the ceiling WITHOUT an AI call', async () => {
      await share('a'.repeat(40_000));
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooLong.title',
        expect.anything()
      );
    });

    it('truncates between the cap and the ceiling, with exactly ONE notice', async () => {
      await share('a'.repeat(MAX_SHARE_TEXT_CHARS + 2_000));
      const sent = extractShareFromText.mock.calls[0][0] as string;
      expect(sent).toHaveLength(MAX_SHARE_TEXT_CHARS);

      const truncationToasts = showToast.mock.calls.filter(
        (c) => c[1] === 'shareTarget.text.truncated.title'
      );
      expect(truncationToasts).toHaveLength(1);
      // ⚠️ And NOT on the envelope: every review surface renders `ai.pdfTruncated.*` from
      // `env.truncated` — copy about PAGES, which a text share does not have. Setting it
      // would show a second notice about pages that do not exist.
      expect(dispatchSharePayload.mock.calls[0][0].env.truncated).toBeUndefined();
    });

    it('does not truncate, or say it did, at the cap exactly', async () => {
      await share('a'.repeat(MAX_SHARE_TEXT_CHARS));
      expect(extractShareFromText.mock.calls[0][0]).toHaveLength(MAX_SHARE_TEXT_CHARS);
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.truncated.title',
        expect.anything()
      );
    });

    it('never splits a surrogate pair when it truncates', async () => {
      // '🎉' is a surrogate PAIR, so a naive slice at the cap lands mid-character and yields a
      // lone surrogate that renders as U+FFFD. Derived from the constant: at a literal 3,999
      // this input fell UNDER the raised cap and stopped truncating at all.
      await share('a'.repeat(MAX_SHARE_TEXT_CHARS - 1) + '🎉'.repeat(50));
      const sent = extractShareFromText.mock.calls[0][0] as string;
      expect(sent).toHaveLength(MAX_SHARE_TEXT_CHARS - 1);
      expect(sent).not.toMatch(/[\uD800-\uDFFF]/);
    });
  });

  describe('the byte gate — bounding the DECODE, not just its result', () => {
    it('refuses an over-ceiling .txt without decoding it', async () => {
      const file = txt(REAL, 200_000);
      const spy = vi.spyOn(file, 'text');
      const sliceSpy = vi.spyOn(file, 'slice');
      await ingestSharedContent({ files: [file] }, meta);

      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooLong.title',
        expect.anything()
      );
      expect(extractShareFromText).not.toHaveBeenCalled();
      // `text()` is called on the SLICE, never on the file — so this alone only catches an
      // unbounded whole-file decode.
      expect(spy).not.toHaveBeenCalled();
      // ⚠️ And the bound itself. Without this, widening the slice to any value at all was
      // undetectable, which makes "bounds the decode" an untested claim.
      expect(sliceSpy).toHaveBeenCalledWith(0, MAX_SHARE_TEXT_CHARS * 4);
    });

    it('still takes the LINK path for an over-ceiling .txt that begins with a link', async () => {
      // iOS delivers a shared URL as a .txt. Returning `over_ceiling` from the byte gate
      // would refuse a link share that works today — which is why the gate sets a flag and
      // the verdict is applied only in the no-URL fallback.
      const file = txt(`https://example.com/cake ${'x'.repeat(500)}`, 200_000);
      await ingestSharedContent({ files: [file] }, meta);

      expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooLong.title',
        expect.anything()
      );
    });
  });

  describe('the budget', () => {
    /** Spend the whole hourly budget. */
    async function exhaust() {
      for (let i = 0; i < 20; i += 1) await share(REAL);
    }

    it('refuses once spent, naming when it resets, and makes NO AI call', async () => {
      await exhaust();
      expect(extractShareFromText).toHaveBeenCalledTimes(20);
      extractShareFromText.mockClear();

      await share(REAL);
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.quota.title',
        // `fillTemplate` has substituted a real time, so the user is told when to come back.
        expect.not.stringContaining('{resetsAt}')
      );
    });

    it('refuses BEFORE the consent prompt, so a refusal is cheap', async () => {
      await exhaust();
      requestConsent.mockClear();
      await share(REAL);
      expect(requestConsent).not.toHaveBeenCalled();
    });

    it('does NOT consume budget when consent is declined', async () => {
      // Peek in `prepare`, consume in `read`. Consuming at the peek would burn a share every
      // time somebody looked at the consent prompt and thought better of it.
      requestConsent.mockResolvedValue(null);
      for (let i = 0; i < 25; i += 1) await share(REAL);

      requestConsent.mockResolvedValue({});
      await share(REAL);
      expect(extractShareFromText).toHaveBeenCalledTimes(1);
    });

    it('does not apply to a BYOK family — we do not ration someone else’s key', async () => {
      aiTier = 'byok';
      for (let i = 0; i < 25; i += 1) await share(REAL);
      expect(extractShareFromText).toHaveBeenCalledTimes(25);
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.quota.title',
        expect.anything()
      );
    });

    it('scopes the budget to the family, so switching families does not inherit one', async () => {
      await exhaust();
      activeFamilyId = 'fam-2';
      extractShareFromText.mockClear();
      await share(REAL);
      expect(extractShareFromText).toHaveBeenCalledTimes(1);
    });
  });

  describe('observability', () => {
    it('tags the whole funnel with detail=text, so it is separable from file and link', async () => {
      await share(REAL);
      const byAction = Object.fromEntries(
        logEvent.mock.calls.map((c) => [c[0].context?.action, c[0].context])
      );
      expect(byAction.triaged.detail).toBe('text');
      expect(byAction.ready.detail).toBe('text');
    });

    it('tags a link share detail=link, so the two funnels never share a counter', async () => {
      await share('https://example.com/cake');
      const byAction = Object.fromEntries(
        logEvent.mock.calls.map((c) => [c[0].context?.action, c[0].context])
      );
      expect(byAction.triaged.detail).toBe('link');
      expect(byAction.ready.detail).toBe('link');
    });

    it('never logs the shared text, a substring of it, or its exact length', async () => {
      const secret = `${REAL} — the passcode is hunter2`;
      await share(secret);
      const serialised = JSON.stringify(logEvent.mock.calls);
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('school gate');
      // Deliberately NOT `not.toContain(String(secret.length))` — that length is two digits,
      // so the check both false-passes and false-fails on any coincidental "84" in a payload.
      // Assert the actual rule instead: band membership is the granularity, so no context
      // field may carry a character count at all.
      const contexts = logEvent.mock.calls.map((c) => c[0].context ?? {});
      for (const ctx of contexts) {
        expect(Object.keys(ctx)).not.toContain('length');
        expect(Object.keys(ctx)).not.toContain('char_count');
      }
    });
  });

  it('sends the family id so the proxy can rate-limit per family', async () => {
    await share(REAL);
    expect(extractShareFromText).toHaveBeenCalledWith(
      REAL,
      expect.objectContaining({ familyId: 'fam-1' })
    );
  });
});

// ─── #84: the IN-APP entry point ─────────────────────────────────────────────
//
// Additive. The share cases above are untouched, which is the point: `ingestInAppSource`
// reaches the same `runIngest` tail, so if adding it changed any of them the split was not
// behaviour-preserving.

describe('ingestInAppSource (#84)', () => {
  /** Long enough to clear MIN_SHARE_TEXT_CHARS, with no URL in it. */
  const REAL = 'Sports day Tuesday the 4th at 9am, meet at the school gate';

  const paste = (text: string) => ingestInAppSource({ kind: 'paste', text });
  const pick = (file: File) => ingestInAppSource({ kind: 'file', file });

  describe('a picked file', () => {
    it('reads it through the same documents path a share uses', async () => {
      await pick(img());
      expect(extractShareFromDocuments).toHaveBeenCalledTimes(1);
      expect(extractShareFromDocuments.mock.calls[0][0]).toHaveLength(1);
      expect(dispatchSharePayload).toHaveBeenCalledTimes(1);
    });

    it('re-stamps it with the type its BYTES say, exactly as the share path does', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
      await pick(new File([pdfBytes], 'booking', { type: 'application/octet-stream' }));

      const sent = extractShareFromDocuments.mock.calls[0][0][0] as File;
      expect(sent.type).toBe('application/pdf');
    });

    it('refuses an over-size file with the SIZE message, and makes no AI call', async () => {
      // ⚠️ A DIFFERENT message from "can't read that". At the share boundary the user did not
      // choose the file, so one message for both was right. In-app they did choose it, and
      // "too big, here is the limit" is actionable where "can't read that" is not.
      const big = img();
      Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
      await pick(big);

      expect(showToast).toHaveBeenCalledWith('info', 'ai.picker.tooLarge.title', expect.anything());
      expect(extractShareFromDocuments).not.toHaveBeenCalled();
    });

    it('refuses an unreadable TYPE with the type message, not the size one', async () => {
      await pick(new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' }));

      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.unsupported.title',
        expect.anything()
      );
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'ai.picker.tooLarge.title',
        expect.anything()
      );
      expect(extractShareFromDocuments).not.toHaveBeenCalled();
    });
  });

  describe('pasted text', () => {
    it('reads prose with no link as text', async () => {
      await paste(REAL);
      expect(extractShareFromText).toHaveBeenCalledWith(REAL, expect.anything());
    });

    it('routes a pasted LINK to the resolver, not to the model as text', async () => {
      await paste('https://example.com/cake');
      expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
    });

    it('inherits the share path length bands rather than re-deciding them', async () => {
      // ONE text policy, in `sourceFromText`. If these ever pass in-app but fail on a share
      // (or the reverse), the two doors have diverged.
      await paste('Soccer 4pm');
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooShort.title',
        expect.anything()
      );
      expect(extractShareFromText).not.toHaveBeenCalled();

      showToast.mockClear();
      await paste('a'.repeat(40_000));
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooLong.title',
        expect.anything()
      );
      expect(extractShareFromText).not.toHaveBeenCalled();
    });

    it('shares ONE budget with the share path — not a second allowance', async () => {
      // The whole point of routing both doors through `sourceFromText`. A separate in-app
      // budget would double what a family can spend just by using a different button.
      for (let i = 0; i < 20; i += 1) await paste(REAL);
      expect(extractShareFromText).toHaveBeenCalledTimes(20);
      extractShareFromText.mockClear();

      // A SHARE now, against the budget the in-app captures already spent.
      await ingestSharedContent({ files: [], text: REAL }, meta);
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'info',
        'shareTarget.text.quota.title',
        expect.anything()
      );
    });
  });

  describe('preconditions', () => {
    it('refuses a BYOK member with no key BEFORE prompting for consent', async () => {
      // `awaitReadiness` is skipped in-app (auth and family are settled), but one of its four
      // preconditions still applies. Without this the user pays a consent prompt for a call
      // guaranteed to fail at extraction.
      aiConfigured = false;
      await paste(REAL);

      expect(requestConsent).not.toHaveBeenCalled();
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('info', 'ai.unavailable.title', expect.anything());
    });

    it('prompts for consent exactly ONCE per capture', async () => {
      await paste(REAL);
      expect(requestConsent).toHaveBeenCalledTimes(1);
    });

    it('saves nothing when consent is declined', async () => {
      requestConsent.mockResolvedValue(null);
      await paste(REAL);
      expect(extractShareFromText).not.toHaveBeenCalled();
      expect(dispatchSharePayload).not.toHaveBeenCalled();
    });

    it('reports being offline instead of calling the model', async () => {
      online = false;
      await paste(REAL);
      expect(reportExtractionFailure).toHaveBeenCalledWith('offline');
      expect(extractShareFromText).not.toHaveBeenCalled();
    });
  });

  describe('the shared lock', () => {
    it('contends with a share for the SAME lock, and says so', async () => {
      // `isIngesting` means "one AI read at a time, app-wide". A separate in-app lock would
      // let a share arriving mid-capture double the AI spend.
      let releaseShare: (v: unknown) => void = () => {};
      extractShareFromDocuments.mockReturnValueOnce(
        new Promise((r) => {
          releaseShare = r;
        })
      );
      const inFlight = ingestSharedContent({ files: [img()] }, meta);
      await Promise.resolve();

      await paste(REAL);
      expect(showToast).toHaveBeenCalledWith('info', 'shareTarget.busy.title', expect.anything());
      expect(extractShareFromText).not.toHaveBeenCalled();

      releaseShare(EVENT_RESULT);
      await inFlight;
    });

    it('frees the lock after a throw, so one bad capture does not wedge every later one', async () => {
      extractShareFromText.mockRejectedValueOnce(new Error('boom'));
      await paste(REAL);
      expect(reportError).toHaveBeenCalled();

      extractShareFromText.mockResolvedValue(EVENT_RESULT);
      await paste(REAL);
      expect(dispatchSharePayload).toHaveBeenCalled();
    });
  });

  describe('observability — the two funnels must never share a counter', () => {
    it('emits EVERY event on the in-app surface, and none on the share one', async () => {
      // ⚠️ The invariant that keeps the threaded sites honest. One missed `env` is a red test
      // here rather than a dashboard somebody notices is wrong in three months — and it is
      // what makes the exact number of threaded sites irrelevant.
      await paste(REAL);
      const surfaces = new Set(logEvent.mock.calls.map((c) => c[0].surface));
      expect([...surfaces]).toEqual(['magic-beans-capture']);
    });

    it('emits EVERY event on the share surface for a share, and none on the in-app one', async () => {
      await ingestSharedContent({ files: [], text: REAL }, meta);
      const surfaces = new Set(logEvent.mock.calls.map((c) => c[0].surface));
      expect([...surfaces]).toEqual(['share-target-ingest']);
    });

    // NOTE: the `opened` denominator is emitted by `MagicReaderCard` when the sheet opens,
    // not by this function — firing it here would make the rate equal its own numerator, so
    // abandonment would be invisible. Covered in `MagicReaderCard.test.ts`.

    it('marks the envelope in-app, so the review surfaces can tell the doors apart', async () => {
      await paste(REAL);
      expect(dispatchSharePayload.mock.calls[0][0].env.origin).toBe('in-app');
    });

    it('still marks a share as share', async () => {
      await ingestSharedContent({ files: [img()] }, meta);
      expect(dispatchSharePayload.mock.calls[0][0].env.origin).toBe('share');
    });

    it('marks the envelope in-app on the jsonld and titleOnly branches too', async () => {
      // Two of the five `origin` literals a classify-only test would never reach.
      resolveRecipeSource.mockResolvedValue({
        kind: 'jsonld',
        recipe: { name: 'Cake', imageUrl: 'https://example.com/cake.jpg' },
        path: 'jsonld',
        sourceUrl: 'https://example.com/cake',
        imageUrl: 'https://example.com/cake.jpg',
      });
      await paste('https://example.com/cake');
      expect(dispatchSharePayload.mock.calls[0][0].env.origin).toBe('in-app');

      dispatchSharePayload.mockClear();
      resolveRecipeSource.mockResolvedValue({
        kind: 'titleOnly',
        title: 'Cake',
        path: 'youtube',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
      });
      await paste('https://youtu.be/dQw4w9WgXcQ');
      expect(dispatchSharePayload.mock.calls[0][0].env.origin).toBe('in-app');
    });

    it('never logs the pasted text or a substring of it', async () => {
      await paste(`${REAL} — the passcode is hunter2`);
      const serialised = JSON.stringify(logEvent.mock.calls);
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('school gate');
    });
  });
});

// ─── Review follow-ups (#83 / #84) ───────────────────────────────────────────
//
// Each test below exists because a mutation proved the previous coverage could not see the
// behaviour. They are grouped by what the mutation was.

describe('the in-app surface invariant holds on EVERY path, not just the happy one', () => {
  const REAL = 'Sports day Tuesday the 4th at 9am, meet at the school gate';
  const surfaces = () => new Set(logEvent.mock.calls.map((c) => c[0].surface));

  it('a picked FILE files every event in-app', async () => {
    // Mutation this catches: `logReceivedKind(SHARE_ENV, 'file', 1)` in `inAppSource`.
    await ingestInAppSource({ kind: 'file', file: img() });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('an over-size file refusal files in-app', async () => {
    const big = img();
    Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
    await ingestInAppSource({ kind: 'file', file: big });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('an unreadable-type refusal files in-app', async () => {
    await ingestInAppSource({
      kind: 'file',
      file: new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' }),
    });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('the AI-not-configured refusal files in-app', async () => {
    // Mutation this catches: `notReady(SHARE_ENV, …)` in `ingestInAppSource`. The BYOK test
    // asserts only the toast, so the surface was free to be wrong.
    aiConfigured = false;
    await ingestInAppSource({ kind: 'paste', text: REAL });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('a text-band refusal files in-app', async () => {
    await ingestInAppSource({ kind: 'paste', text: 'Soccer 4pm' });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('a budget refusal files in-app', async () => {
    for (let i = 0; i < 20; i += 1) await ingestInAppSource({ kind: 'paste', text: REAL });
    logEvent.mockClear();
    await ingestInAppSource({ kind: 'paste', text: REAL });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);
  });

  it('a busy refusal files in-app', async () => {
    let release: (v: unknown) => void = () => {};
    extractShareFromDocuments.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      })
    );
    const inFlight = ingestSharedContent({ files: [img()] }, meta);
    await Promise.resolve();
    logEvent.mockClear();

    await ingestInAppSource({ kind: 'paste', text: REAL });
    expect([...surfaces()]).toEqual(['magic-beans-capture']);

    release(EVENT_RESULT);
    await inFlight;
  });

  it('a throw files in-app, on reportError as well as logEvent', async () => {
    extractShareFromText.mockRejectedValueOnce(new Error('boom'));
    await ingestInAppSource({ kind: 'paste', text: REAL });
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'magic-beans-capture' })
    );
  });
});

describe('an unreadable link is refused as a LINK, not read as prose', () => {
  const share = (text: string) => ingestSharedContent({ files: [], text }, meta);

  it('refuses a bare YouTube playlist without an AI call', async () => {
    // 46 characters, so it clears MIN_SHARE_TEXT_CHARS and would otherwise be sent to the
    // model as text — one billed call for an answer that can only be `none`, replacing a
    // refusal that used to be free.
    await share('https://www.youtube.com/playlist?list=PLabc123');

    expect(extractShareFromText).not.toHaveBeenCalled();
    expect(resolveRecipeSource).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipeExtract.badLink.title',
      expect.anything()
    );
  });

  it('does not spend budget on one', async () => {
    for (let i = 0; i < 25; i += 1) await share('https://www.youtube.com/playlist?list=PLabc123');
    // The budget is untouched, so a real share still works.
    await share('Sports day Tuesday the 4th at 9am, meet at the school gate');
    expect(extractShareFromText).toHaveBeenCalledTimes(1);
  });

  it('gives a SHORT unreadable link link-shaped copy, not "not enough to read"', async () => {
    // 20 chars — under the minimum. Telling someone who shared a link to "include the date,
    // the time and where it is" is advice about an event.
    await share('https://youtu.be/xyz');
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipeExtract.badLink.title',
      expect.anything()
    );
    expect(showToast).not.toHaveBeenCalledWith(
      'info',
      'shareTarget.text.tooShort.title',
      expect.anything()
    );
  });

  it('still reads prose that merely CONTAINS an unreadable link', async () => {
    // The guard must not swallow a real text share that happens to cite a channel.
    await share('Sports day is Tuesday at 9am, details https://www.youtube.com/@school here');
    expect(extractShareFromText).toHaveBeenCalled();
  });
});

describe('the truncation notice is only made once it is TRUE', () => {
  const share = (text: string) => ingestSharedContent({ files: [], text }, meta);
  // ⚠️ Derived from the constant. A literal 10_000 equals the cap exactly, so `> cap` is
  // false: the "IS shown" test below hard-fails AND the three above it silently stop asserting
  // anything, because they check "no truncation notice" about a share that no longer truncates.
  const LONG = 'a'.repeat(MAX_SHARE_TEXT_CHARS + 2_000);
  const truncationToasts = () =>
    showToast.mock.calls.filter((c) => c[1] === 'shareTarget.text.truncated.title');

  it('is not shown when the share never runs because we are offline', async () => {
    // "beanies read the beginning of it — check the details before you save" is a straight
    // falsehood next to an offline error: nothing was read and there is nothing to save.
    online = false;
    await share(LONG);
    expect(truncationToasts()).toHaveLength(0);
  });

  it('is not shown when consent is declined', async () => {
    requestConsent.mockResolvedValue(null);
    await share(LONG);
    expect(truncationToasts()).toHaveLength(0);
  });

  it('is not counted as an attempt, so its rate against `ready` stays honest', async () => {
    online = false;
    await share(LONG);
    expect(actions()).not.toContain('truncated');
  });

  it('IS shown, exactly once, when the read actually happens', async () => {
    await share(LONG);
    expect(truncationToasts()).toHaveLength(1);
    expect(actions()).toContain('truncated');
  });
});

// ─── Link-vs-text precedence (#85) ───────────────────────────────────────────
//
// Before this rule, the FIRST usable URL won unconditionally — so a school email whose details
// are in the body was routed to its own signature URL, and beanies read the school's homepage
// instead of the field trip. Reproduced against production before the fix.

describe('link-vs-text precedence (#85)', () => {
  const share = (text: string) => ingestSharedContent({ files: [], text }, meta);

  /** A realistic school email: details in the body, links incidental. */
  const SCHOOL_EMAIL = [
    'Dear Grade 5 Families,',
    '',
    'We are excited to share details of an upcoming Grade 5 field trip to the Lee Kong Chian',
    'Natural History Museum at the National University of Singapore on Tuesday 14 October,',
    'leaving school at 9am and returning by 3pm.',
    '',
    'https://lkcnhm.nus.edu.sg/',
    '',
    'To make this possible we are asking families for a co-payment of $42 per student, which',
    'covers return transport, museum admission, a guided tour and the hands-on workshop.',
    '',
    'Warm regards,',
    'The Grade 5 Team',
    'www.smmis.edu.sg',
  ].join('\n');

  describe('a body outweighs the links inside it', () => {
    it('reads a school email as TEXT, never fetching the link in it', async () => {
      // ⚠️ THE case this rule exists for. `https://lkcnhm.nus.edu.sg/` sits in the body and
      // `routeUrl` calls it valid, so before #85 the museum's HOMEPAGE was fetched and read —
      // a page with no field trip, no date and no $42.
      await share(SCHOOL_EMAIL);

      expect(resolveRecipeSource).not.toHaveBeenCalled();
      expect(extractShareFromText).toHaveBeenCalledTimes(1);
      expect(extractShareFromText.mock.calls[0][0]).toContain('co-payment of $42');
    });

    it('says in the log that the body won, so a mis-tuned threshold is diagnosable', async () => {
      await share(SCHOOL_EMAIL);
      const triaged = logEvent.mock.calls.find((c) => c[0].context?.action === 'triaged')![0];

      expect(triaged.message).toBe('share triaged — the message outweighed the links in it');
      // The prefix is stable so a saved query keyed on it keeps working.
      expect(triaged.message.startsWith('share triaged')).toBe(true);
      expect(triaged.context.detail).toBe('text');
      // `file_count` keeps its documented meaning — it is not carrying the reason.
      expect(triaged.context.file_count).toBe(0);
    });

    it('does NOT add the note when the text had no links at all', async () => {
      await share('Sports day is Tuesday the 4th at 9am, meet at the school gate please');
      const triaged = logEvent.mock.calls.find((c) => c[0].context?.action === 'triaged')![0];
      expect(triaged.message).toBe('share triaged');
    });
  });

  describe('a note around a link is still a LINK share', () => {
    it.each([
      ['a bare link', 'https://example.com/cake'],
      ['a 20-char note', 'Made this last night https://example.com/cake'],
      [
        'a 49-char note',
        'Have a look at this recipe I found, looks amazing https://example.com/cake',
      ],
    ])('%s → link', async (_label, text) => {
      await share(text);
      expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
      expect(extractShareFromText).toHaveBeenCalledWith('page text', expect.anything());
    });

    it('holds at exactly the threshold, and flips one character past it', async () => {
      // The boundary itself, from the constant — the one place the number is doing real work.
      const url = ' https://example.com/cake';
      await share('a'.repeat(MAX_LINK_NOTE_CHARS) + url);
      expect(resolveRecipeSource).toHaveBeenCalledOnce();

      vi.clearAllMocks();
      resolveRecipeSource.mockResolvedValue({
        kind: 'text',
        text: 'page text',
        path: 'page_text',
        sourceUrl: 'https://example.com/cake',
        imageUrl: '',
      });
      await share('a'.repeat(MAX_LINK_NOTE_CHARS + 1) + url);
      expect(resolveRecipeSource).not.toHaveBeenCalled();
    });
  });

  describe('the prose measurement strips BOTH forms of a candidate', () => {
    it('excludes a bare-domain signature from the count', async () => {
      // ⚠️ The fixture is chosen to STRADDLE the threshold, which is the only way this test
      // can fail against the pre-fix strip. `extractUrls` returns bare domains
      // scheme-prefixed, so splitting on the candidate alone leaves `www.someschool.edu.sg`
      // (21 chars) in the prose: one-form measures 212 (> 200 → text), two-form measures 190
      // (≤ 200 → link). A fixture like `Regards\nwww.school.edu.sg` proves nothing — both
      // strips land under MIN_SHARE_TEXT_CHARS and both refuse.
      await share('a'.repeat(190) + ' www.someschool.edu.sg');
      expect(resolveRecipeSource).toHaveBeenCalledWith('https://www.someschool.edu.sg');
    });
  });

  describe('the prose measurement handles two candidates where one is a prefix', () => {
    it('does not strand a URL path as prose when the same domain appears twice', async () => {
      // ⚠️ `split` removes EVERY literal occurrence, so stripping the shorter candidate first
      // chews the front off the longer one and strands its path — which the longer candidate
      // then never matches. This exact text left `/recipe/pumpkin-pie` (19 chars) counted as
      // prose, inflating the measurement enough to tip an ordinary recipe share into the text
      // arm and lose the schema.org quantities. Fixed by stripping longest-first.
      //
      // ⚠️ Tuned to STRADDLE the threshold, which is the only way this test can fail against
      // the unsorted strip: measured correctly the prose is 199 (≤ 200 → LINK); with the
      // fragment stranded it is 220 (> 200 → TEXT). Both computed by running the real
      // `extractUrls` over this exact fixture.
      const note = 'Check out this site, '.padEnd(180, 'x');
      await share(
        `${note} https://example.com or the recipe at https://example.com/recipe/pumpkin-pie`
      );

      expect(resolveRecipeSource).toHaveBeenCalled();
      expect(extractShareFromText).toHaveBeenCalledWith('page text', expect.anything());
    });
  });

  describe('the text arm must be able to READ it — never turn a working share into a refusal', () => {
    it('keeps the link path for an over-ceiling .txt that begins with a link', async () => {
      // iOS delivers EVERY shared URL as a .txt, and `prepare` sets `overCeilingByBytes` as a
      // flag rather than returning precisely so this keeps working. Prose here is 500 — over
      // the threshold — so only `textArmUsable` stops it becoming a "too long" refusal.
      const file = new File([`https://example.com/cake ${'x'.repeat(500)}`], 'shared.txt', {
        type: 'text/plain',
      });
      Object.defineProperty(file, 'size', { value: 200_000 });
      await ingestSharedContent({ files: [file] }, meta);

      expect(resolveRecipeSource).toHaveBeenCalledWith('https://example.com/cake');
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.tooLong.title',
        expect.anything()
      );
    });

    it('keeps the link path once the text budget is spent', async () => {
      // A link share has NEVER consumed the text budget and must not start refusing because of
      // it — the budget is a text-arm cost control, not a share-wide one.
      const REAL = 'Sports day Tuesday the 4th at 9am, meet at the school gate';
      for (let i = 0; i < 20; i += 1) await share(REAL);
      vi.clearAllMocks();
      resolveRecipeSource.mockResolvedValue({
        kind: 'text',
        text: 'page text',
        path: 'page_text',
        sourceUrl: 'https://example.com/cake',
        imageUrl: '',
      });

      await share(`${'a'.repeat(250)} https://example.com/cake`);

      expect(resolveRecipeSource).toHaveBeenCalledOnce();
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.quota.title',
        expect.anything()
      );
    });
  });

  describe('the hoisted budget peek costs nothing', () => {
    // That peeking neither consumes nor persists is asserted at its own module
    // (`attemptBudget.test.ts` — "peek does not PERSIST"), where a storage spy can actually
    // isolate it. What matters HERE is the observable consequence.
    it('leaves a later text share its full budget', async () => {
      // The observable consequence of the above: 20 link shares must not eat into the text
      // allowance, because the budget is a text-arm cost control and never was share-wide.
      for (let i = 0; i < 20; i += 1) await share('Made this https://example.com/cake');
      vi.clearAllMocks();

      const REAL = 'Sports day Tuesday the 4th at 9am, meet at the school gate';
      for (let i = 0; i < 20; i += 1) await share(REAL);
      expect(extractShareFromText).toHaveBeenCalledTimes(20);
      expect(showToast).not.toHaveBeenCalledWith(
        'info',
        'shareTarget.text.quota.title',
        expect.anything()
      );
    });
  });

  describe('efficiency and failure', () => {
    it('never loads the link-router chunk when the body wins', async () => {
      // The dominant new case. The import comment exists to keep ~22 KB of recipe graph out of
      // the eager chunk; this stops paying for it on the path with no use for it.
      await share(SCHOOL_EMAIL);
      expect(routerCalls.count).toBe(0);
    });

    // ⚠️ NOT unit-tested, deliberately, and said out loud rather than faked: the `.catch` on
    // the dynamic import only fires when `import()` REJECTS, and `vi.mock` resolves the module
    // — so any test here would be exercising a thrown `routeUrl`, not a failed chunk load, and
    // would pass with the `.catch` deleted. The guard is still correct and cheap (offline or a
    // stale deploy reads the message instead of erroring), and its `link_router_unavailable`
    // event is the signal that says whether it ever fires in production.
  });
});
