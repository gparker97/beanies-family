/**
 * The bounded candidate loop (#86).
 *
 * Every assertion here is a failure that was previously SILENT, or that the plan's review
 * passes caught before it shipped. It is tested directly, with a fake photo sink, rather than
 * through the 175-line orchestrator it used to live inside.
 */
import { describe, it, expect, vi } from 'vitest';
import { attachDishImage, MAX_IMAGE_ATTEMPTS } from '../attachDishImage';
import type { DishPhotoSink } from '../attachDishImage';
import type { ImageCandidate } from '@/types/magicPayload';

const JPEG_PAYLOAD = '/9j/4AAQ';
const okImage = {
  success: true,
  data: { mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${JPEG_PAYLOAD}` },
};

const candidates = (...urls: string[]): ImageCandidate[] =>
  urls.map((url) => ({ url, source: 'og_image' as const }));

function sink(over: Partial<DishPhotoSink> = {}): DishPhotoSink {
  return {
    canAdd: { value: true },
    atCap: { value: false },
    add: vi.fn().mockResolvedValue(['photo-1']),
    ...over,
  };
}

describe('attachDishImage', () => {
  it('stops at the first candidate that fetches and stores', async () => {
    const photos = sink();
    const fetchImage = vi.fn().mockResolvedValue(okImage);
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      {
        photos,
        fetchImage,
      }
    );

    expect(out).toEqual({ ok: true, source: 'og_image', attempts: 1 });
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(photos.add).toHaveBeenCalledTimes(1);
  });

  it('falls through a failed fetch to the next rung', async () => {
    // The designed-for case: a YouTube `maxresdefault` 404 falling through to `hqdefault`.
    const fetchImage = vi
      .fn()
      .mockResolvedValueOnce({ success: false, errorCode: 'not_found' })
      .mockResolvedValueOnce(okImage);
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      {
        photos: sink(),
        fetchImage,
      }
    );

    expect(out).toEqual({ ok: true, source: 'og_image', attempts: 2 });
  });

  it('reports all_failed with the last error code when every candidate fails', async () => {
    const fetchImage = vi.fn().mockResolvedValue({ success: false, errorCode: 'site_refused' });
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      {
        photos: sink(),
        fetchImage,
      }
    );

    expect(out).toEqual({
      ok: false,
      reason: 'all_failed',
      errorCode: 'site_refused',
      attempts: 2,
    });
  });

  it('NEVER reports success when the store kept nothing', async () => {
    // THE POISONED-METRIC BUG. `photos.add` resolves to [] for a cloud-off refusal, a
    // rejected type or a decode failure, and the old code discarded the return entirely — so
    // `image_resolved` would have fired for a photo that does not exist, corrupting the exact
    // hit rate this work exists to create.
    const photos = sink({ add: vi.fn().mockResolvedValue([]) });
    const out = await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos,
      fetchImage: vi.fn().mockResolvedValue(okImage),
    });

    expect(out).toEqual({ ok: false, reason: 'store_rejected', attempts: 1 });
  });

  it('CONTINUES past a store rejection to the next candidate', async () => {
    // The two candidate-INDEPENDENT refusals (cloud off, at cap) are ruled out before the
    // loop, so a rejection here is per-FILE — a codec the engine could not decode — which is
    // exactly the class where the next rung works. Returning let one un-storable image kill
    // the whole ladder, removing the fallback this feature exists to add.
    const photos = sink({
      add: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['photo-2']),
    });
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.avif', 'https://a.test/2.jpg'),
      { photos, fetchImage: vi.fn().mockResolvedValue(okImage) }
    );

    expect(out).toEqual({ ok: true, source: 'og_image', attempts: 2 });
    expect(photos.add).toHaveBeenCalledTimes(2);
  });

  it('reports store_rejected only once the ladder is exhausted', async () => {
    const photos = sink({ add: vi.fn().mockResolvedValue([]) });
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      { photos, fetchImage: vi.fn().mockResolvedValue(okImage) }
    );

    expect(out).toEqual({ ok: false, reason: 'store_rejected', attempts: 2 });
  });

  it('REPORTS a throw rather than swallowing it', async () => {
    // A bare catch here deleted the only path by which a dish-attach stack trace reached
    // CloudWatch, so a deterministic decode bug on candidate 1 would hide behind a success
    // on candidate 2 — a 100% hit rate concealing a permanent extra round trip.
    const failed: unknown[] = [];
    const out = await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos: sink(),
      fetchImage: vi.fn().mockRejectedValue(new Error('boom')),
      onAttemptFailed: (a) => failed.push(a),
    });

    expect(failed).toEqual([{ source: 'og_image', errorCode: 'threw' }]);
    expect(out).toMatchObject({ ok: false, reason: 'all_failed', errorCode: 'threw' });
  });

  it('treats a data URL with no comma as a failed candidate, not an exception', async () => {
    const out = await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos: sink(),
      fetchImage: vi
        .fn()
        .mockResolvedValue({ success: true, data: { mime: 'image/jpeg', dataUrl: 'nonsense' } }),
    });

    expect(out).toMatchObject({ ok: false, errorCode: 'malformed_data_url' });
  });

  it('emits an attempt event per failed rung, so the LADDER is visible', async () => {
    const failed: unknown[] = [];
    await attachDishImage('r1', candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'), {
      photos: sink(),
      fetchImage: vi
        .fn()
        .mockResolvedValueOnce({ success: false, errorCode: 'site_refused' })
        .mockResolvedValueOnce(okImage),
      onAttemptFailed: (a) => failed.push(a),
    });

    expect(failed).toEqual([{ source: 'og_image', errorCode: 'site_refused' }]);
  });

  it('counts a QUEUED offline upload as success, and stops', async () => {
    // `add` returns completed and queued ids together. Without this an offline family would
    // queue one photo per candidate — three photos for one recipe.
    const photos = sink({ add: vi.fn().mockResolvedValue(['queued-1']) });
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      {
        photos,
        fetchImage: vi.fn().mockResolvedValue(okImage),
      }
    );

    expect(out.ok).toBe(true);
    expect(photos.add).toHaveBeenCalledTimes(1);
  });

  it('makes ZERO fetches when the photo store cannot accept anything', async () => {
    // Every byte fetched would be discarded, so this saves up to three 15s round trips — and,
    // more importantly, it turns a previously silent drop into a named reason.
    const fetchImage = vi.fn();
    const out = await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos: sink({ canAdd: { value: false } }),
      fetchImage,
    });

    expect(out).toEqual({ ok: false, reason: 'cloud_required', attempts: 0 });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('distinguishes at_cap from cloud_required, because the fix differs', async () => {
    const out = await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos: sink({ canAdd: { value: false }, atCap: { value: true } }),
      fetchImage: vi.fn(),
    });

    expect(out).toEqual({ ok: false, reason: 'at_cap', attempts: 0 });
  });

  it('reports no_candidates for an empty list, without touching the store', async () => {
    // Distinct from `all_failed`: the page declared nothing, versus everything it declared
    // failed. They point at completely different investigations.
    const photos = sink();
    const out = await attachDishImage('r1', [], { photos, fetchImage: vi.fn() });

    expect(out).toEqual({ ok: false, reason: 'no_candidates', attempts: 0 });
    expect(photos.add).not.toHaveBeenCalled();
  });

  it('honours the attempt cap even when more candidates were offered', async () => {
    const fetchImage = vi.fn().mockResolvedValue({ success: false, errorCode: 'timeout' });
    const many = candidates(
      'https://a.test/1.jpg',
      'https://a.test/2.jpg',
      'https://a.test/3.jpg',
      'https://a.test/4.jpg',
      'https://a.test/5.jpg'
    );
    const out = await attachDishImage('r1', many, { photos: sink(), fetchImage });

    expect(fetchImage).toHaveBeenCalledTimes(MAX_IMAGE_ATTEMPTS);
    expect(out).toMatchObject({ ok: false, reason: 'all_failed', attempts: MAX_IMAGE_ATTEMPTS });
  });

  it('survives a throw from one candidate and tries the next', async () => {
    const fetchImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okImage);
    const out = await attachDishImage(
      'r1',
      candidates('https://a.test/1.jpg', 'https://a.test/2.jpg'),
      {
        photos: sink(),
        fetchImage,
      }
    );

    expect(out).toEqual({ ok: true, source: 'og_image', attempts: 2 });
  });

  it('passes RAW BASE64 to the File, not the whole data URL', async () => {
    // `base64ToFile` calls `atob`, which throws on a `data:…;base64,` prefix — a throw the
    // loop would swallow into a generic failure, silently losing every photo.
    const photos = sink();
    await attachDishImage('r1', candidates('https://a.test/1.jpg'), {
      photos,
      fetchImage: vi.fn().mockResolvedValue(okImage),
    });

    const [[files]] = (photos.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].size).toBeGreaterThan(0);
  });

  it('names the file from the SNIFFED mime, so an AVIF is not called .jpg', async () => {
    const photos = sink();
    await attachDishImage('r1', candidates('https://a.test/1.avif'), {
      photos,
      fetchImage: vi.fn().mockResolvedValue({
        success: true,
        data: { mime: 'image/avif', dataUrl: `data:image/avif;base64,${JPEG_PAYLOAD}` },
      }),
    });

    const [[files]] = (photos.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(files[0].name).toBe('dish-r1.avif');
    expect(files[0].type).toBe('image/avif');
  });

  it('forwards the page URL as the Referer source', async () => {
    const fetchImage = vi.fn().mockResolvedValue(okImage);
    await attachDishImage('r1', candidates('https://cdn.test/1.jpg'), {
      photos: sink(),
      fetchImage,
      pageUrl: 'https://food.test/recipe',
    });

    expect(fetchImage).toHaveBeenCalledWith('https://cdn.test/1.jpg', {
      pageUrl: 'https://food.test/recipe',
    });
  });
});
