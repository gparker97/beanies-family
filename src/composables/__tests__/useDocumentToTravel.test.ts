import { __testConsentGrant } from '@/test/consentGrant';
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

import { useDocumentToTravel } from '../useDocumentToTravel';
import type { TravelExtractionResult } from '@/services/ai/types';

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

/**
 * DELIVERY ONLY since the magic-beans doors were unified.
 *
 * The offline guard, the busy guard, the extract call and the error toasts moved to
 * `useSharedDocumentIngest` and are covered there. What `deliverTravel` still owns — and what a
 * shared capture cannot do for it — is turning a travel extraction into buckets, resolving
 * which trip it attaches to, and refusing to emit something that is not travel at all.
 */
describe('useDocumentToTravel — delivery', () => {
  it('success (no overlapping trip): emits buckets + a create target', async () => {
    const { deliverTravel, onTravelReady } = setup();
    deliverTravel(TRAVEL, { sourceFile: imageFile() });

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

  it('PDF: attaches the ORIGINAL pdf as the trip source', async () => {
    const { deliverTravel, onTravelReady } = setup();

    deliverTravel(TRAVEL, { sourceFile: pdfFile() });

    // The ORIGINAL pdf is what gets attached to the trip — rasterization was the service's
    // concern and the full document must survive it.
    const arg = onTravelReady.mock.calls[0][0] as { sourceFile: File };
    expect(arg.sourceFile.type).toBe('application/pdf');
  });

  it('truncated PDF: info toast that only the first pages were read, still emits the trip', async () => {
    const { deliverTravel, onTravelReady } = setup();

    deliverTravel(TRAVEL, { sourceFile: pdfFile(), truncated: true });

    expect(showToast).toHaveBeenCalledWith(
      'info',
      'ai.pdfTruncated.title',
      'ai.pdfTruncated.message'
    );
    expect(onTravelReady).toHaveBeenCalled();
  });

  it('not a travel document → friendly info toast, nothing emitted', async () => {
    const { deliverTravel, onTravelReady } = setup();

    deliverTravel(
      { isTravel: false, tripName: '', tripTypeHint: '', segments: [] },
      { sourceFile: imageFile() }
    );
    expect(showToast).toHaveBeenCalledWith('info', 'ai.notTravel.title', 'ai.notTravel.message');
    expect(onTravelReady).not.toHaveBeenCalled();
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
    const { deliverTravel, onTravelReady } = setup();
    deliverTravel(TRAVEL, { sourceFile: imageFile() });
    const arg = onTravelReady.mock.calls[0][0] as { target: { kind: string; vacationId?: string } };
    expect(arg.target).toEqual({ kind: 'attach', vacationId: 'trip-1' });
  });
});
