import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('../useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const vacations = ref<unknown[]>([]);
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({ vacations: vacations.value }),
}));

const sortedHumans = ref<unknown[]>([]);
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ sortedHumans: sortedHumans.value }),
}));

// The service now owns document preparation (PDF rasterization + compression); the composable
// just hands it the original File and attaches that original as the trip source.
vi.mock('@/services/ai/documentExtractionService', () => ({
  extractTravelFromDocument: vi.fn(),
}));

import { useDocumentToTravel } from '../useDocumentToTravel';
import { extractTravelFromDocument } from '@/services/ai/documentExtractionService';
import type { TravelExtractionResult } from '@/services/ai/types';

const mockExtract = vi.mocked(extractTravelFromDocument);

const TRAVEL: TravelExtractionResult = {
  isTravel: true,
  tripName: 'Tokyo Trip',
  tripTypeHint: 'fly_and_stay',
  segments: [
    {
      kind: 'travel',
      type: 'flight_outbound',
      title: '',
      status: 'booked',
      bookingReference: 'ABC',
      notes: '',
      arrivesNextDay: false,
      breakfastIncluded: false,
      fields: { departureAirport: 'SIN', arrivalAirport: 'HND', departureDate: '2026-08-12' },
      travellers: [],
      confidence: 0.9,
    },
  ],
};

function imageFile(): File {
  return new File(['x'], 'ticket.jpg', { type: 'image/jpeg' });
}
function pdfFile(): File {
  return new File(['x'], 'ticket.pdf', { type: 'application/pdf' });
}

function setup() {
  const onTravelReady = vi.fn();
  const wedge = useDocumentToTravel({ onTravelReady });
  return { ...wedge, onTravelReady };
}

beforeEach(() => {
  vi.resetAllMocks();
  tier.value = 'managed';
  byokConfig.value = null;
  isOnline.value = true;
  vacations.value = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDocumentToTravel', () => {
  it('offline: info toast, no extraction', async () => {
    isOnline.value = false;
    const { processFile } = setup();
    await processFile(imageFile());
    expect(showToast).toHaveBeenCalledWith('info', 'ai.offline.title', 'ai.offline.message');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('success (no overlapping trip): emits buckets + a create target', async () => {
    mockExtract.mockResolvedValue({ success: true, data: TRAVEL });
    const { processFile, onTravelReady } = setup();
    await processFile(imageFile());

    const arg = onTravelReady.mock.calls[0][0] as {
      buckets: { travelSegments: unknown[] };
      target: { kind: string };
      tripType: string;
      suggestedTripName: string;
      sourceFile: File;
    };
    expect(arg.buckets.travelSegments).toHaveLength(1);
    expect(arg.target).toEqual({ kind: 'create' });
    expect(arg.tripType).toBe('fly_and_stay');
    expect(arg.suggestedTripName).toBe('Tokyo Trip');
    expect(arg.sourceFile.name).toBe('ticket.jpg');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('PDF: hands the ORIGINAL pdf to the service and attaches it as the trip source', async () => {
    mockExtract.mockResolvedValue({ success: true, data: TRAVEL });
    const { processFile, onTravelReady } = setup();

    await processFile(pdfFile());

    // The service (mocked) receives the original PDF — rasterization is its concern now.
    expect((mockExtract.mock.calls[0][0] as File).type).toBe('application/pdf');
    // And the source attached to the trip is that same original PDF.
    const arg = onTravelReady.mock.calls[0][0] as { sourceFile: File };
    expect(arg.sourceFile.type).toBe('application/pdf');
  });

  it('truncated PDF: info toast that only the first pages were read, still emits the trip', async () => {
    mockExtract.mockResolvedValue({ success: true, data: TRAVEL, truncated: true });
    const { processFile, onTravelReady } = setup();

    await processFile(pdfFile());

    expect(showToast).toHaveBeenCalledWith(
      'info',
      'ai.pdfTruncated.title',
      'ai.pdfTruncated.message'
    );
    expect(onTravelReady).toHaveBeenCalled();
  });

  it('not a travel document → friendly info toast, nothing emitted', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      data: { isTravel: false, tripName: '', tripTypeHint: '', segments: [] },
    });
    const { processFile, onTravelReady } = setup();
    await processFile(imageFile());
    expect(showToast).toHaveBeenCalledWith('info', 'ai.notTravel.title', 'ai.notTravel.message');
    expect(onTravelReady).not.toHaveBeenCalled();
  });

  it('provider error → error toast via shared mapping', async () => {
    mockExtract.mockResolvedValue({ success: false, errorCode: 'provider_error' });
    const { processFile } = setup();
    await processFile(imageFile());
    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', 'ai.error.generic', {
      surface: 'ai-extract',
    });
  });

  it('attaches to the single overlapping trip', async () => {
    // Overlap detection ignores trips already in the past (tripPhase === 'past'), so this
    // test must pin "today" to a date inside the trip window — otherwise the fixed dates
    // below drift into the past and the trip is filtered out (attach → create). Fake only
    // Date so awaited promises in processFile still resolve normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
    vacations.value = [
      {
        id: 'trip-1',
        startDate: '2026-08-10',
        endDate: '2026-08-20',
        travelSegments: [],
        accommodations: [],
        transportation: [],
      },
    ];
    mockExtract.mockResolvedValue({ success: true, data: TRAVEL });
    const { processFile, onTravelReady } = setup();
    await processFile(imageFile());
    const arg = onTravelReady.mock.calls[0][0] as { target: { kind: string; vacationId?: string } };
    expect(arg.target).toEqual({ kind: 'attach', vacationId: 'trip-1' });
  });
});
