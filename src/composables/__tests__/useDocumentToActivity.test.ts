/**
 * `useDocumentToActivity` is now DELIVERY ONLY.
 *
 * Its capture half — offline guard, busy guard, the extract call, the error toasts — moved to
 * `useSharedDocumentIngest` when the magic-beans doors were unified, and is covered there. The
 * tests that drove `processFile` went with it; what remains are the guarantees `deliverEvent`
 * still owns, which are exactly the ones a shared capture cannot make for it:
 *
 *   · the extraction result becomes an activity prefill, with its confidence carried through
 *   · a compressed blob comes back as a File the form can attach
 *   · a non-event still OPENS the form rather than being silently dropped
 *   · a truncated PDF says so
 *   · a throw inside delivery is reported and toasted, never swallowed
 *
 * The `deliverX` split exists so a SHARED document can be delivered without a second AI call,
 * so testing it directly is also testing the share path's last mile.
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentToActivity } from '../useDocumentToActivity';
import type { ExtractionResult } from '@/services/ai/types';
import type { ResultEnvelope } from '@/types/magicPayload';

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

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

const env = (over: Partial<ResultEnvelope> = {}): ResultEnvelope => ({
  sourceFile: null,
  ...over,
});

function setup() {
  const onActivityReady = vi.fn();
  const { deliverEvent } = useDocumentToActivity({ onActivityReady });
  return { deliverEvent, onActivityReady };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

describe('useDocumentToActivity — delivery', () => {
  it('turns an extraction into a prefill, carrying confidence through', () => {
    const { deliverEvent, onActivityReady } = setup();

    deliverEvent(SAMPLE, env());

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
      sourcePhoto: undefined,
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('hands a compressed blob back as a File the form can attach', () => {
    const { deliverEvent, onActivityReady } = setup();
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });

    deliverEvent(
      SAMPLE,
      env({
        sourceFile: new File(['x'], 'invite.jpg', { type: 'image/jpeg' }),
        compressedBlob: blob,
      })
    );

    const photo = onActivityReady.mock.calls[0][0].sourcePhoto as File;
    expect(photo).toBeInstanceOf(File);
    expect(photo.type).toBe('image/jpeg');
  });

  it('OPENS the form for a non-event too, with an info toast — never a silent drop', () => {
    const { deliverEvent, onActivityReady } = setup();

    deliverEvent({ ...SAMPLE, isEvent: false }, env());

    // The user handed something over; dropping it with no form and no explanation is the one
    // outcome that reads as "beanies lost it".
    expect(onActivityReady).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('info', 'ai.notEvent.title', 'ai.notEvent.message');
  });

  it('says so when only the first pages of a PDF were read', () => {
    const { deliverEvent, onActivityReady } = setup();

    deliverEvent(SAMPLE, env({ truncated: true }));

    expect(showToast).toHaveBeenCalledWith(
      'info',
      'ai.pdfTruncated.title',
      'ai.pdfTruncated.message'
    );
    expect(onActivityReady).toHaveBeenCalledTimes(1);
  });

  it('reports and toasts if delivery throws, rather than swallowing it', () => {
    const onActivityReady = vi.fn(() => {
      throw new Error('boom');
    });
    const { deliverEvent } = useDocumentToActivity({ onActivityReady });

    expect(() => deliverEvent(SAMPLE, env())).not.toThrow();

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'ai-activity-capture', severity: 'error' })
    );
    expect(showToast).toHaveBeenCalledWith('error', 'ai.error.title', 'ai.error.generic');
  });
});
