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
import type { ExtractionResult, TodoExtractionResult } from '@/services/ai/types';
import type { ResultEnvelope, ShareLink } from '@/types/magicPayload';

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
    const envelope = env();

    deliverEvent(SAMPLE, envelope);

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
      // The WHOLE envelope, carried through rather than flattened — it is what lets the review
      // modal offer the free correction, and `sourcePhoto` above is already a derived copy of
      // one of its fields.
      env: envelope,
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

  describe('the link rule (#113)', () => {
    const shared = (provenanceUrl: string): ShareLink => ({
      pageUrl: provenanceUrl,
      provenanceUrl,
      imageCandidates: [],
      path: 'page_text',
      kind: 'page',
    });
    const prefillOf = (m: ReturnType<typeof vi.fn>) =>
      m.mock.calls[0][0].prefill as { link?: string; notes?: string };

    it("fills the link from the event's own address, leaving notes alone with no shared page", () => {
      const { deliverEvent, onActivityReady } = setup();
      deliverEvent({ ...SAMPLE, link: 'https://school.example.org/trip' }, env());
      expect(prefillOf(onActivityReady)).toMatchObject({ link: 'https://school.example.org/trip' });
      expect(prefillOf(onActivityReady).notes).toBeUndefined();
    });

    it('uses the shared page as the link when the read found none, without repeating it in notes', () => {
      const { deliverEvent, onActivityReady } = setup();
      deliverEvent(SAMPLE, env({ link: shared('https://events.example.org/fair') }));
      expect(prefillOf(onActivityReady).link).toBe('https://events.example.org/fair');
      expect(prefillOf(onActivityReady).notes).toBeUndefined();
    });

    it('keeps the shared page in notes when the link is a different address', () => {
      const { deliverEvent, onActivityReady } = setup();
      deliverEvent(
        { ...SAMPLE, description: 'Bring a hat', link: 'https://tickets.example.org/fair' },
        env({ link: shared('https://events.example.org/fair') })
      );
      expect(prefillOf(onActivityReady)).toMatchObject({
        link: 'https://tickets.example.org/fair',
        notes: 'Bring a hat\nhttps://events.example.org/fair',
      });
    });
  });

  it('passes the companion to-dos through, and only when there are some', () => {
    const todo: TodoExtractionResult = {
      items: [
        {
          title: 'Sign the slip',
          details: null,
          dueDate: null,
          dueTime: null,
          timing: null,
          assigneeName: null,
          ownerCard: null,
          links: [],
        },
      ],
    };
    const { deliverEvent, onActivityReady } = setup();
    deliverEvent(SAMPLE, env(), todo);
    deliverEvent(SAMPLE, env(), { items: [] });
    expect(onActivityReady.mock.calls[0][0].todo).toBe(todo);
    expect(onActivityReady.mock.calls[1][0]).not.toHaveProperty('todo');
  });
});
