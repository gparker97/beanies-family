/**
 * ✨ Find Duplicates' orchestration (#116): the gate order, the consent variant, stale results,
 * and the telemetry that makes a hit rate and a failure rate measurable.
 *
 * The extraction funnel is mocked at its boundary (`findDuplicatesInText`), so these pin what
 * THIS composable decides: what is sent, when nothing is sent, and what is reported.
 */
import { __testConsentGrant } from '@/test/consentGrant';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const isOnline = ref(true);
vi.mock('../useOnline', () => ({ useOnline: () => ({ isOnline }) }));

const showToast = vi.fn();
vi.mock('../useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const reportExtractionFailure = vi.fn();
vi.mock('../useExtractionErrorToast', () => ({
  useExtractionErrorToast: () => ({ reportExtractionFailure }),
}));

const extractOptions = vi.fn((args: Record<string, unknown>) => ({ tier: 'managed', ...args }));
vi.mock('../useAiCapability', () => ({ useAiCapability: () => ({ extractOptions }) }));

const resolveBillableFamilyId = vi.fn<(env: unknown) => string | null>(() => 'fam-1');
vi.mock('../useMagicBeanScope', () => ({
  resolveBillableFamilyId: (env: unknown) => resolveBillableFamilyId(env),
}));

const requestConsent = vi.fn();
vi.mock('../useDocumentConsent', () => ({
  requestConsent: (...a: unknown[]) => requestConsent(...a),
}));

const findDuplicatesInText = vi.fn();
vi.mock('@/services/ai/documentExtractionService', () => ({
  findDuplicatesInText: (...a: unknown[]) => findDuplicatesInText(...a),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
import { logEvent } from '@/services/telemetry/logEvent';

import { useFindDuplicates } from '../useFindDuplicates';
import type { DedupeLine } from '@/utils/dedupePayload';

const LINES: DedupeLine[] = [
  { id: 'L1', text: '500 g ground beef' },
  { id: 'L2', text: '250g lean ground beef' },
  { id: 'L3', text: '1 onion' },
];
const GROUPS = [{ name: 'ground beef', lineIds: ['L1', 'L2'] }];

/** The `action` of every event this surface logged, in order. */
const actions = () =>
  vi
    .mocked(logEvent)
    .mock.calls.map(([e]) => e)
    .filter((e) => e.surface === 'meal-shopping-dupes')
    .map((e) => (e.context as { action?: string } | undefined)?.action);

describe('useFindDuplicates (#116)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOnline.value = true;
    resolveBillableFamilyId.mockReturnValue('fam-1');
    requestConsent.mockResolvedValue(__testConsentGrant);
    findDuplicatesInText.mockResolvedValue({ success: true, data: { groups: GROUPS } });
  });

  it('sends only the { id, text } payload under the ingredients consent and returns the groups', async () => {
    const { find, running } = useFindDuplicates();
    const controller = new AbortController();
    // Extra fields on a caller's line object must never reach the wire.
    const lines = LINES.map((l) => ({ ...l, recipeName: 'Tacos' }));

    const pending = find(lines, controller);
    expect(running.value).toBe(true);
    const result = await pending;

    expect(result).toEqual({ status: 'done', groups: GROUPS });
    expect(running.value).toBe(false);
    expect(requestConsent).toHaveBeenCalledWith({ kind: 'ingredients' });
    const [text, opts] = findDuplicatesInText.mock.calls[0]!;
    expect(JSON.parse(text as string)).toEqual(LINES);
    expect(text).not.toContain('Tacos');
    expect(opts).toMatchObject({ familyId: 'fam-1', signal: controller.signal });
    expect(actions()).toEqual(['find_started', 'find_done']);
    const started = vi.mocked(logEvent).mock.calls[0]![0];
    const done = vi.mocked(logEvent).mock.calls[1]![0];
    expect(started.context).toEqual({ action: 'find_started', count: 3, inferred_count: 0 });
    expect(done.context).toEqual({ action: 'find_done', count: 1 });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('find_started carries the lines left out for the byte bound as inferred_count', async () => {
    const { find } = useFindDuplicates();
    await find(LINES, new AbortController(), { skipped: 4 });
    const started = vi.mocked(logEvent).mock.calls[0]![0];
    expect(started.context).toEqual({ action: 'find_started', count: 3, inferred_count: 4 });
  });

  it('offline: toasts and never prompts or sends', async () => {
    isOnline.value = false;
    const { find } = useFindDuplicates();

    const result = await find(LINES, new AbortController());

    expect(result.status).toBe('offline');
    expect(showToast).toHaveBeenCalledWith('info', 'ai.offline.title', 'ai.offline.message');
    expect(resolveBillableFamilyId).not.toHaveBeenCalled();
    expect(requestConsent).not.toHaveBeenCalled();
    expect(findDuplicatesInText).not.toHaveBeenCalled();
  });

  it('no billable family: fails before consent (the resolver already toasted)', async () => {
    resolveBillableFamilyId.mockReturnValue(null);
    const { find } = useFindDuplicates();

    const result = await find(LINES, new AbortController());

    expect(result.status).toBe('failed');
    expect(resolveBillableFamilyId).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'meal-shopping-dupes' })
    );
    expect(requestConsent).not.toHaveBeenCalled();
    expect(findDuplicatesInText).not.toHaveBeenCalled();
  });

  it('declined: sends nothing and logs find_declined', async () => {
    requestConsent.mockResolvedValue(null);
    const { find, running } = useFindDuplicates();

    const result = await find(LINES, new AbortController());

    expect(result).toEqual({ status: 'declined', groups: [] });
    expect(findDuplicatesInText).not.toHaveBeenCalled();
    expect(actions()).toEqual(['find_declined']);
    expect(running.value).toBe(false);
  });

  it('a provider failure logs find_failed with the code and toasts once via the shared mapper', async () => {
    findDuplicatesInText.mockResolvedValue({
      success: false,
      errorCode: 'upstream_busy',
      error: 'enclave 503',
    });
    const { find } = useFindDuplicates();

    const result = await find(LINES, new AbortController());

    expect(result).toEqual({ status: 'failed', groups: [] });
    expect(actions()).toEqual(['find_started', 'find_failed']);
    const failed = vi.mocked(logEvent).mock.calls[1]![0];
    expect(failed.level).toBe('error');
    expect(failed.context).toEqual({ action: 'find_failed', error_code: 'upstream_busy' });
    expect(reportExtractionFailure).toHaveBeenCalledWith('upstream_busy', 'enclave 503');
  });

  it('malformed model output is a failure, reported through the same path', async () => {
    findDuplicatesInText.mockResolvedValue({ success: false, errorCode: 'malformed_output' });
    const { find } = useFindDuplicates();

    const result = await find(LINES, new AbortController());

    expect(result.status).toBe('failed');
    expect(reportExtractionFailure).toHaveBeenCalledWith('malformed_output', undefined);
  });

  it('stale: the drawer closed during the read, so no toast, no outcome event', async () => {
    const controller = new AbortController();
    findDuplicatesInText.mockImplementation(async () => {
      controller.abort();
      return { success: false, errorCode: 'timeout' };
    });
    const { find } = useFindDuplicates();

    const result = await find(LINES, controller);

    expect(result).toEqual({ status: 'stale', groups: [] });
    expect(reportExtractionFailure).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(actions()).toEqual(['find_started']);
  });

  it('stale: the drawer closed while the consent prompt was up, so nothing is sent', async () => {
    const controller = new AbortController();
    requestConsent.mockImplementation(async () => {
      controller.abort();
      return __testConsentGrant;
    });
    const { find } = useFindDuplicates();

    const result = await find(LINES, controller);

    expect(result.status).toBe('stale');
    expect(findDuplicatesInText).not.toHaveBeenCalled();
    expect(actions()).toEqual([]);
  });

  it('an already-aborted controller does nothing at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const { find } = useFindDuplicates();

    expect((await find(LINES, controller)).status).toBe('stale');
    expect(requestConsent).not.toHaveBeenCalled();
  });

  it('a second tap while a run is in flight starts nothing', async () => {
    let release!: (v: unknown) => void;
    findDuplicatesInText.mockImplementation(() => new Promise((r) => (release = r)));
    const { find } = useFindDuplicates();
    const controller = new AbortController();

    const first = find(LINES, controller);
    const second = await find(LINES, controller);
    expect(second.status).toBe('stale');

    await vi.waitFor(() => expect(findDuplicatesInText).toHaveBeenCalledTimes(1));
    release({ success: true, data: { groups: [] } });
    expect((await first).status).toBe('done');
  });
});
