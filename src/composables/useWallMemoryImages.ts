/**
 * The overnight photo loader for the sleep slideshow (#140): which deck photos have
 * loaded, and when a failed one tries again.
 *
 * There is no detached `new Image()` preload, so nothing is ever fetched twice. The stage
 * mounts one `<img>` per deck photo (`v-show`, no lazy loading) keyed on `renderKey`, and
 * that element's own `load` and `error` call `onLoad` and `onError` here. The mounted
 * element is the only holder of the decoded photo; rotating only changes opacity, so a
 * night that loses the network keeps every photo it already has.
 *
 * The deck is chosen here, from the night's candidates (`slideshowDeck`): a photo that fails
 * `WALL_IMAGE_GIVE_UP_AFTER` times is given up for the night, and its slot goes to the next
 * candidate. A failure only counts as evidence against the PHOTO: the device was online, and
 * some other photo has loaded since this one first failed (the network works, this photo
 * does not). A whole-network outage with Wi-Fi still up therefore gives nothing up and stays
 * on the backoff ladder. With no candidate left to take the slot, it stays and retries.
 *
 * A photo that errors after it was ready (its URL changed and the reload failed) stops being
 * ready at once, so the slideshow takes it off the screen rather than show a broken frame.
 *
 * Failure policy: one quick retry, then the app's shared backoff ladder. Retries wait
 * while the device is offline, and coming back online retries at once (the ladder starts
 * at 5 minutes, which would otherwise delay recovery). URLs are read with
 * `ignoreUnresolved` and this loader NEVER marks a photo unresolved: a wall session lasts
 * weeks, and that flag would blank the photo everywhere for all of it.
 */
import {
  computed,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import { useOnline } from '@/composables/useOnline';
import { logEvent } from '@/services/telemetry/logEvent';
import { usePhotoStore } from '@/stores/photoStore';
import { nextBackoffMs } from '@/utils/backoff';
import { tail } from '@/utils/diagnostics';
import { slideshowDeck, type SlidePhoto } from '@/utils/wallSlideshow';
import type { UUID } from '@/types/models';

/** The one quick retry after a first failure, before the backoff ladder takes over. */
export const WALL_IMAGE_QUICK_RETRY_MS = 5_000;

/** Counted failures (see the file comment) after which a photo is given up for the night. */
export const WALL_IMAGE_GIVE_UP_AFTER = 2;

/** One deck photo to mount: remount it (`:key`) whenever `renderKey` changes. */
export interface WallMemoryImage {
  photoId: UUID;
  source: SlidePhoto['source'];
  url: string;
  renderKey: number;
}

interface PassFailure {
  photoId: UUID;
  stage: 'load' | 'decode';
}

/** `candidates`: every photo the night could show, in the night's order. */
export function useWallMemoryImages(candidates: MaybeRefOrGetter<readonly SlidePhoto[]>) {
  const photoStore = usePhotoStore();
  const { isOnline } = useOnline();

  const renderKeys = reactive(new Map<UUID, number>());
  const failures = reactive(new Map<UUID, number>());
  const timers = new Map<UUID, ReturnType<typeof setTimeout>>();
  const ready = shallowRef<ReadonlySet<UUID>>(new Set());
  const settled = ref(false);
  const retries = ref(0);
  // Kept for the whole night: a photo leaving the deck must not come back with a clean slate.
  const countedFailures = new Map<UUID, number>();
  /** Successful loads so far tonight, and the count when each photo first failed. */
  let goodLoads = 0;
  const goodLoadsAtFirstFailure = new Map<UUID, number>();
  const givenUp = shallowRef<ReadonlySet<UUID>>(new Set());

  // A pass is every photo waiting for an outcome; it settles when none is left waiting.
  const pending = new Set<UUID>();
  let passFailures: PassFailure[] = [];

  const deck = computed<SlidePhoto[]>(() => slideshowDeck(toValue(candidates), givenUp.value));

  const mounted = computed<WallMemoryImage[]>(() =>
    deck.value.flatMap((photo) => {
      const url = photoStore.getPublicUrl(photo.photoId, 'screen', { ignoreUnresolved: true });
      if (!url) return [];
      const renderKey = renderKeys.get(photo.photoId) ?? 0;
      return [{ photoId: photo.photoId, source: photo.source, url, renderKey }];
    })
  );

  const failedCount = computed(
    () =>
      mounted.value.filter((m) => (failures.get(m.photoId) ?? 0) > 0 && !ready.value.has(m.photoId))
        .length
  );

  function setReady(photoId: UUID, on: boolean): void {
    if (ready.value.has(photoId) === on) return;
    const next = new Set(ready.value);
    if (on) next.add(photoId);
    else next.delete(photoId);
    ready.value = next;
  }

  function clearTimer(photoId: UUID): void {
    const timer = timers.get(photoId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(photoId);
  }

  function summarisePass(): void {
    const first = passFailures[0];
    if (!first) return;
    logEvent({
      level: 'warn',
      surface: 'wall-slideshow',
      message: 'wall_slideshow_image_failed',
      context: {
        file_count: passFailures.length,
        stage: first.stage,
        kind: sourceOf(first.photoId),
        file_id_tail: tail(photoStore.photos[first.photoId]?.driveFileId),
        online: isOnline.value,
      },
    });
  }

  function sourceOf(photoId: UUID): SlidePhoto['source'] | null {
    return toValue(candidates).find((p) => p.photoId === photoId)?.source ?? null;
  }

  /**
   * Count a failure against the photo only with evidence the network is fine: online, and
   * another photo loaded since this one's first failure. The second such failure gives it up.
   */
  function countFailure(photoId: UUID): void {
    const since = goodLoadsAtFirstFailure.get(photoId);
    if (since === undefined) goodLoadsAtFirstFailure.set(photoId, goodLoads);
    if (since === undefined || goodLoads <= since) return;
    if (!isOnline.value || givenUp.value.has(photoId)) return;
    const count = (countedFailures.get(photoId) ?? 0) + 1;
    countedFailures.set(photoId, count);
    if (count < WALL_IMAGE_GIVE_UP_AFTER) return;
    givenUp.value = new Set([...givenUp.value, photoId]);
    logEvent({
      level: 'warn',
      surface: 'wall-slideshow',
      message: 'wall_slideshow_image_given_up',
      context: {
        kind: sourceOf(photoId),
        // eslint-disable-next-line security/detect-object-injection -- photoId is a UUID from the doc
        file_id_tail: tail(photoStore.photos[photoId]?.driveFileId),
      },
    });
  }

  function checkSettled(): void {
    if (pending.size > 0) return;
    const hadPass = settled.value === false || passFailures.length > 0;
    if (!hadPass) return;
    summarisePass();
    passFailures = [];
    settled.value = true;
  }

  function retry(photoId: UUID): void {
    if (!renderKeys.has(photoId)) return;
    retries.value += 1;
    pending.add(photoId);
    renderKeys.set(photoId, (renderKeys.get(photoId) ?? 0) + 1);
  }

  function schedule(photoId: UUID): void {
    clearTimer(photoId);
    // Offline: wait for the online transition, which retries every failed photo at once.
    if (!isOnline.value) return;
    const count = failures.get(photoId) ?? 1;
    const delay = count <= 1 ? WALL_IMAGE_QUICK_RETRY_MS : nextBackoffMs(count - 1);
    timers.set(
      photoId,
      setTimeout(() => {
        timers.delete(photoId);
        if (isOnline.value) retry(photoId);
      }, delay)
    );
  }

  /** Track the deck: new photos start waiting, departed ones are forgotten entirely. */
  function syncDeck(list: readonly WallMemoryImage[]): void {
    const ids = new Set(list.map((m) => m.photoId));
    for (const photoId of [...renderKeys.keys()]) {
      if (ids.has(photoId)) continue;
      clearTimer(photoId);
      renderKeys.delete(photoId);
      failures.delete(photoId);
      pending.delete(photoId);
      setReady(photoId, false);
    }
    for (const photoId of ids) {
      if (renderKeys.has(photoId)) continue;
      renderKeys.set(photoId, 0);
      pending.add(photoId);
    }
    // A removal can finish a pass, but an empty deck never counts as a finished one.
    if (renderKeys.size > 0 || passFailures.length > 0) checkSettled();
  }

  /** The `<img>` loaded: decode it, then it is ready (a decode rejection still is). */
  async function onLoad(photoId: UUID, img: HTMLImageElement): Promise<void> {
    if (!renderKeys.has(photoId)) return;
    let decodeFailed = false;
    try {
      if (typeof img.decode === 'function') await img.decode();
    } catch {
      // The bytes arrived and the browser painted them; only the early decode failed.
      decodeFailed = true;
    }
    if (!renderKeys.has(photoId)) return;
    goodLoads += 1;
    // Its own load is no evidence against it: a later failure needs ANOTHER photo's load.
    if (goodLoadsAtFirstFailure.has(photoId)) goodLoadsAtFirstFailure.set(photoId, goodLoads);
    if (decodeFailed) passFailures.push({ photoId, stage: 'decode' });
    clearTimer(photoId);
    failures.delete(photoId);
    setReady(photoId, true);
    pending.delete(photoId);
    checkSettled();
  }

  /** The `<img>` failed (even after it was ready): off the screen, counted, retried later. */
  function onError(photoId: UUID): void {
    if (!renderKeys.has(photoId)) return;
    setReady(photoId, false);
    failures.set(photoId, (failures.get(photoId) ?? 0) + 1);
    countFailure(photoId);
    passFailures.push({ photoId, stage: 'load' });
    pending.delete(photoId);
    schedule(photoId);
    checkSettled();
  }

  watch(mounted, syncDeck, { immediate: true });

  watch(isOnline, (online, was) => {
    if (!online || was !== false) return;
    for (const photoId of [...failures.keys()]) {
      clearTimer(photoId);
      failures.delete(photoId);
      retry(photoId);
    }
  });

  onScopeDispose(() => {
    for (const photoId of [...timers.keys()]) clearTimer(photoId);
  });

  return {
    /** Tonight's deck, in order: what a frame walks. */
    deck,
    /** The deck photos to mount, one `<img>` each. */
    mounted,
    /** Photos loaded and decoded: the only ones a frame may show. */
    ready: computed<ReadonlySet<UUID>>(() => ready.value),
    /** The first loading pass that had photos in it has finished. */
    settled: readonly(settled),
    /** Deck photos currently failed (waiting for a retry). */
    failedCount,
    /** Remounts so far tonight. */
    retries: readonly(retries),
    /** Photos given up for the night. */
    givenUp: computed<ReadonlySet<UUID>>(() => givenUp.value),
    onLoad,
    onError,
  };
}

export type WallMemoryImages = ReturnType<typeof useWallMemoryImages>;
