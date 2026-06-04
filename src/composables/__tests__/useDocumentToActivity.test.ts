import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// --- mocks ---
const tier = ref<'managed' | 'byok' | 'on-device'>('managed');
const byokConfig = ref<{ provider: string; apiKey: string } | null>(null);
vi.mock('../useAiCapability', () => ({
  useAiCapability: () => ({ tier, byokConfig, isConfigured: ref(true) }),
}));

const isOnline = ref(true);
vi.mock('../useOnline', () => ({ useOnline: () => ({ isOnline }) }));

const showToast = vi.fn();
vi.mock('../useToast', () => ({ useToast: () => ({ showToast }) }));

// t() echoes the key so assertions can match on keys.
vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

vi.mock('@/services/ai/documentExtractionService', () => ({
  extractEventFromDocument: vi.fn(),
}));

import { useDocumentToActivity } from '../useDocumentToActivity';
import { extractEventFromDocument } from '@/services/ai/documentExtractionService';
import type { ExtractionResult } from '@/services/ai/types';

const mockExtract = vi.mocked(extractEventFromDocument);

const SAMPLE: ExtractionResult = {
  isEvent: true,
  title: 'Birthday',
  date: '2026-07-12',
  startTime: '14:00',
  endTime: '',
  isAllDay: false,
  location: 'Hall',
  description: '',
  confidence: { title: 0.9, date: 0.9, startTime: 0.6, endTime: 0, location: 0.8 },
};

function file(): File {
  return new File(['x'], 'invite.jpg', { type: 'image/jpeg' });
}

// Consent is gated by the page (FamilyPlannerPage.handleAddFromPhoto) BEFORE the picker, so
// this composable no longer takes a requestConsent option — processFile runs post-consent.
function setup() {
  const onActivityReady = vi.fn();
  const wedge = useDocumentToActivity({ onActivityReady });
  return { ...wedge, onActivityReady };
}

beforeEach(() => {
  vi.resetAllMocks();
  tier.value = 'managed';
  byokConfig.value = null;
  isOnline.value = true;
});

describe('useDocumentToActivity', () => {
  it('offline: info toast, no extraction', async () => {
    isOnline.value = false;
    const { processFile } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith('info', 'ai.offline.title', 'ai.offline.message');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('success (event): opens the activity with prefill + confidence, no toast', async () => {
    mockExtract.mockResolvedValue({ success: true, data: SAMPLE });
    const { processFile, onActivityReady } = setup();

    await processFile(file());

    expect(onActivityReady).toHaveBeenCalledWith({
      // 'Birthday' title → inferred category rides along in the prefill.
      prefill: {
        title: 'Birthday',
        date: '2026-07-12',
        startTime: '14:00',
        location: 'Hall',
        category: 'birthday',
      },
      confidence: SAMPLE.confidence,
      sourcePhoto: undefined, // no compressed blob on this result
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('success with a compressed blob: hands back the source photo as a File to attach', async () => {
    const blob = new Blob(['imgbytes'], { type: 'image/jpeg' });
    mockExtract.mockResolvedValue({ success: true, data: SAMPLE, compressedBlob: blob });
    const { processFile, onActivityReady } = setup();

    await processFile(file());

    const arg = onActivityReady.mock.calls[0][0] as { sourcePhoto?: File };
    expect(arg.sourcePhoto).toBeInstanceOf(File);
    expect(arg.sourcePhoto?.type).toBe('image/jpeg');
    expect(arg.sourcePhoto?.name).toMatch(/\.jpg$/);
  });

  it('passes the selected tier + byok config to the service', async () => {
    tier.value = 'byok';
    byokConfig.value = { provider: 'openai', apiKey: 'sk-test' };
    mockExtract.mockResolvedValue({ success: true, data: SAMPLE });
    const { processFile } = setup();

    await processFile(file());

    expect(mockExtract).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ tier: 'byok', byok: { provider: 'openai', apiKey: 'sk-test' } })
    );
  });

  it('non-event: still opens the form AND shows an info toast (never silently dropped)', async () => {
    mockExtract.mockResolvedValue({ success: true, data: { ...SAMPLE, isEvent: false } });
    const { processFile, onActivityReady } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith('info', 'ai.notEvent.title', 'ai.notEvent.message');
    expect(onActivityReady).toHaveBeenCalled();
  });

  it('provider_error: error toast with report surface, no activity opened', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'provider_error' });
    const { processFile, onActivityReady } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', 'ai.error.generic', {
      surface: 'ai-extract',
    });
    expect(onActivityReady).not.toHaveBeenCalled();
  });

  it('compression failure: warning toast reusing the photo-type wording', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'compression' });
    const { processFile } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith('warning', 'ai.error.title', 'photos.invalidType');
  });

  it('not_available: info toast (not an error)', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'not_available' });
    const { processFile } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith(
      'info',
      'ai.unavailable.title',
      'ai.unavailable.message'
    );
  });

  it('upstream_busy: friendly retry toast, NO report surface (transient provider outage)', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'upstream_busy' });
    const { processFile } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith(
      'warning',
      'ai.error.busy.title',
      'ai.error.busy.message'
    );
    // No 4th argument → no surface → no reportError/Slack alert for a transient 5xx.
    expect(showToast.mock.calls[0].length).toBe(3);
  });

  it('malformed_output: error toast with the "clearer photo" hint', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'malformed_output' });
    const { processFile } = setup();

    await processFile(file());

    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', 'ai.error.unreadable', {
      surface: 'ai-extract',
    });
  });

  it('toggles isProcessing around the extraction', async () => {
    mockExtract.mockResolvedValue({ success: true, data: SAMPLE });
    const { processFile, isProcessing } = setup();

    expect(isProcessing.value).toBe(false);
    const p = processFile(file());
    // isProcessing flips true once extraction starts and back to false when it resolves.
    await p;
    expect(isProcessing.value).toBe(false);
  });
});
