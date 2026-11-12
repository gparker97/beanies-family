/**
 * The sleep slideshow's state (#140): the family's stores in, one frame out.
 *
 * Runs only while the night face is up (the stage mounts inside `nightNow`), so nothing
 * here is computed while the wall is awake. The pool stays reactive to the stores, so a
 * photo deleted elsewhere leaves on the next recompute, but the seed is captured ONCE at
 * creation: midnight neither reshuffles the deck nor refetches it.
 *
 * What sits in which slot is state (`wallSlideshowSlots.ts`): the rotation calls `tickSlides`,
 * and any change between rotations (a photo becoming ready, the pool recomputing) calls
 * `fillSlides`, which only fills empty slots. The frame is read from that state.
 *
 * Telemetry (surface `wall-slideshow`) lets "the wall showed no photos last night" be
 * answered from the logs: start, ready (once the first pass settles), fallback (only when
 * its layout and reason change), an hourly progress beat, and end. A pool, slot step or frame
 * that throws is reported once per night per site; they re-run every rotation.
 */
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import { useOnline } from '@/composables/useOnline';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useFamilyScrapbookFeed } from '@/composables/useFamilyScrapbookFeed';
import { useWallMemoryImages } from '@/composables/useWallMemoryImages';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';
import { usePhotoStore } from '@/stores/photoStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { attachmentKind } from '@/utils/attachmentKind';
import { toDateInputValue } from '@/utils/date';
import { reportError } from '@/utils/errorReporter';
import { record as recordPerf } from '@/utils/perfTiming';
import { WALL_MEMORY_BRIGHTNESS, WALL_SLIDESHOW_ROTATE_MS } from '@/utils/wallMemories';
import {
  EMPTY_SLIDES,
  fillSlides,
  slideshowFrame,
  tickSlides,
  type SlideInputs,
  type SlideshowSlots,
} from '@/utils/wallSlideshowSlots';
import {
  buildSlideshowPool,
  EMPTY_SLIDESHOW_POOL,
  PLAIN_FRAME,
  slideshowFallback,
  type SlidePhotoCandidate,
  type SlideshowFrame,
  type SlideshowPool,
  type SlideshowShape,
} from '@/utils/wallSlideshow';
import type { UUID } from '@/types/models';

const SURFACE = 'wall-slideshow';
/** The progress beat comes about hourly, at every speed. */
const PROGRESS_MS = 3_600_000;

export interface UseWallSlideshowOptions {
  /** The wall's orientation (the page's `.wall-portrait` signal). Landscape when unset. */
  shape?: MaybeRefOrGetter<SlideshowShape>;
}

export function useWallSlideshow(options: UseWallSlideshowOptions = {}) {
  const familyStore = useFamilyStore();
  const recipesStore = useRecipesStore();
  const photoStore = usePhotoStore();
  const settingsStore = useSettingsStore();
  const { isOnline } = useOnline();

  const seed = toDateInputValue(new Date());
  const startedAt = performance.now();

  const settings = computed(() => settingsStore.wallMemories);
  const mode = computed(() => settings.value.slideshow);
  const brightness = computed(() => WALL_MEMORY_BRIGHTNESS[settings.value.brightness]);
  // Read once: the speed is set on the Settings page, never while the wall sleeps.
  const speed = settings.value.speed;
  // eslint-disable-next-line security/detect-object-injection -- speed is validated by resolveWallMemories
  const rotateMs = WALL_SLIDESHOW_ROTATE_MS[speed];
  const progressEvery = Math.round(PROGRESS_MS / rotateMs);

  // Every type: the pool applies the switches.
  const { entries } = useFamilyScrapbookFeed();

  // One report per failure site per night: the pool and the frame recompute every rotation.
  const reported = new Set<string>();
  function reportSlideshowError(message: string, error: unknown): void {
    if (reported.has(message)) return;
    reported.add(message);
    reportError({ surface: SURFACE, message, error, severity: 'error' });
  }

  function isImage(photoId: UUID): boolean {
    // eslint-disable-next-line security/detect-object-injection -- photoId is a UUID from the doc
    const photo = photoStore.photos[photoId];
    return !!photo && !photo.deletedAt && attachmentKind(photo) === 'image';
  }

  function avatars(): SlidePhotoCandidate[] {
    return familyStore.members.flatMap((m) =>
      m.avatarPhotoId ? [{ photoId: m.avatarPhotoId, memberId: m.id }] : []
    );
  }

  function dishes(): SlidePhotoCandidate[] {
    return recipesStore.recipes.flatMap((r) => {
      const photoId = r.photoIds?.[0];
      return photoId ? [{ photoId, memberId: null, caption: r.name }] : [];
    });
  }

  const built = computed<{ pool: SlideshowPool; error: boolean }>(() => {
    try {
      const pool = buildSlideshowPool({
        settings: settings.value,
        entries: entries.value,
        avatars: avatars(),
        dishes: dishes(),
        isImage,
        seed,
      });
      return { pool, error: false };
    } catch (e) {
      reportSlideshowError('slideshow pool failed', e);
      return { pool: EMPTY_SLIDESHOW_POOL, error: true };
    }
  });

  const candidates = computed(() => (mode.value === 'off' ? [] : built.value.pool.photos));
  const images = useWallMemoryImages(candidates);
  const inputs = computed<SlideInputs>(() => ({
    mode: mode.value,
    shape: toValue(options.shape) ?? 'landscape',
    seed,
    deck: images.deck.value,
    ready: images.ready.value,
    texts: built.value.pool.texts,
    // The first pass has photos on the way: tiles wait for them rather than open on notes.
    photosPending: !images.settled.value && images.mounted.value.length > 0,
  }));

  const slides = shallowRef<SlideshowSlots>(EMPTY_SLIDES);
  // A slot step that throws leaves the slots as they were and the face plain until one works.
  const stepFailed = ref(false);
  function step(run: typeof fillSlides, message: string): void {
    try {
      slides.value = run(slides.value, inputs.value);
      stepFailed.value = false;
    } catch (e) {
      reportSlideshowError(message, e);
      stepFailed.value = true;
    }
  }

  // `sync`, so no frame is read with an input changed but the empty slots not yet filled.
  watch(inputs, () => step(fillSlides, 'slideshow fill failed'), {
    immediate: true,
    flush: 'sync',
  });

  const picked = computed<{ frame: SlideshowFrame; error: boolean }>(() => {
    if (built.value.error || stepFailed.value) return { frame: PLAIN_FRAME, error: true };
    try {
      return { frame: slideshowFrame(slides.value, images.ready.value), error: false };
    } catch (e) {
      reportSlideshowError('slideshow frame failed', e);
      return { frame: PLAIN_FRAME, error: true };
    }
  });

  const frame = computed(() => picked.value.frame);

  let rotations = 0;

  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'wall_slideshow_start',
    context: {
      kind: mode.value,
      format: settings.value.brightness,
      file_count: images.mounted.value.length,
      detail: `speed=${speed}`,
    },
  });

  // `settled` turns true once, when the first pass with photos finishes; later passes are
  // retries, which the loader summarises itself.
  watch(
    images.settled,
    (done) => {
      if (!done) return;
      recordPerf('wall_slideshow_preload', performance.now() - startedAt);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_slideshow_ready',
        context: {
          file_count: images.ready.value.size,
          detail: `failed=${images.failedCount.value}`,
        },
      });
    },
    { immediate: true }
  );

  const fallback = computed(() =>
    slideshowFallback({
      mode: mode.value,
      frame: picked.value.frame,
      pool: built.value.pool,
      settings: settings.value,
      error: picked.value.error,
      settled: images.settled.value,
    })
  );

  let lastFallback: string | null = null;
  watch(
    fallback,
    (now) => {
      const key = now ? `${now.kind}:${now.reason}` : null;
      if (key === lastFallback) return;
      lastFallback = key;
      if (!now) return;
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'wall_slideshow_fallback',
        context: { kind: now.kind, detail: now.reason, online: isOnline.value },
      });
    },
    { immediate: true }
  );

  usePollWhileVisible(
    () => {
      rotations += 1;
      step(tickSlides, 'slideshow rotation failed');
      if (rotations % progressEvery !== 0) return;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_slideshow_progress',
        context: { file_count: images.ready.value.size, detail: `rotations=${rotations}` },
      });
    },
    rotateMs,
    { surface: SURFACE }
  );

  onScopeDispose(() => {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_slideshow_end',
      context: {
        detail: `rotations=${rotations};retries=${images.retries.value};given_up=${images.givenUp.value.size}`,
      },
    });
  });

  return {
    /** What the night face shows this rotation. */
    frame,
    /** Every deck photo to mount as an `<img>` (call `images.onLoad` / `onError` from it). */
    deck: images.mounted,
    images,
    /** Opacity and saturation for the memories only. */
    brightness,
    mode,
  };
}
