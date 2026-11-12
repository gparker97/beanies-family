<script setup lang="ts">
/**
 * One deck photo on the sleeping wall (#140), mounted ONCE for the whole night.
 *
 * The `<img>` is never remounted by rotation: the stage hands this tile a `place` (or `null`
 * when the photo is not in the frame) and the tile only changes opacity and its slot class.
 * A tile that must change slot while showing fades out first, so nothing ever jumps. Its
 * drift phase follows its slot (`SLOT_DRIFT_DELAY_S`), shared with a text in the same slot.
 * Rounded tile, thin light edge, soft shadow; a caption in the corner over a gradient
 * scrim only when there is one; a slow Ken Burns zoom and drift (none under reduced motion).
 * Transform and opacity only.
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import type { PhotoSlotId } from '@/utils/wallSlideshow';
import { SLOT_DRIFT_DELAY_S } from '@/utils/wallSlideshowSlots';

export type MemorySlot = PhotoSlotId;

const props = defineProps<{
  url: string;
  /** Where the photo sits in the current frame, or `null` when it is not in it. */
  place: MemorySlot | null;
  caption?: string;
  /** Cut instead of fade. */
  reduced: boolean;
}>();
const emit = defineEmits<{ load: [img: HTMLImageElement]; error: [] }>();

/** The crossfade length; matches the stage's layer fade. */
const FADE_MS = 1200;

const shownSlot = ref<MemorySlot | null>(props.place);
const shownCaption = ref(props.caption);
const visible = ref(props.place !== null);
let timer: ReturnType<typeof setTimeout> | null = null;
/** When the tile last started fading out, so a move never lands before the fade ends. */
let hiddenAt = Number.NEGATIVE_INFINITY;

function clear(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function show(slot: MemorySlot, caption: string | undefined): void {
  shownSlot.value = slot;
  shownCaption.value = caption;
  visible.value = true;
}

function hide(): void {
  if (!visible.value) return;
  visible.value = false;
  hiddenAt = Date.now();
}

watch(
  () => [props.place, props.caption] as const,
  ([slot, caption]) => {
    clear();
    if (slot === null) {
      hide();
      return;
    }
    if (props.reduced || slot === shownSlot.value) {
      show(slot, caption);
      return;
    }
    // Another slot: fade out where it is (or finish a fade already under way, which a second
    // move during it must not cut short), then come back in the new one.
    hide();
    const wait = FADE_MS - (Date.now() - hiddenAt);
    if (wait <= 0) show(slot, caption);
    else timer = setTimeout(() => show(slot, caption), wait);
  }
);

onBeforeUnmount(clear);

function onLoad(event: Event): void {
  emit('load', event.target as HTMLImageElement);
}
</script>

<template>
  <div
    class="mem-photo wall-fl"
    :class="[
      shownSlot ? `wall-mem-${shownSlot}` : '',
      { 'is-visible': visible, 'is-cut': reduced },
    ]"
    :style="{ animationDelay: `${shownSlot ? SLOT_DRIFT_DELAY_S[shownSlot] : 0}s` }"
  >
    <img
      :src="url"
      alt=""
      referrerpolicy="no-referrer"
      draggable="false"
      class="mem-img"
      :class="{ 'is-still': reduced || shownSlot === 'full' }"
      @load="onLoad"
      @error="emit('error')"
    />
    <p v-if="shownCaption && shownSlot !== 'full'" class="mem-cap font-caveat wall-memory-caption">
      {{ shownCaption }}
    </p>
  </div>
</template>

<style scoped>
.mem-photo {
  aspect-ratio: 4 / 3;
  background: #0d141d;
  border-radius: 1.1rem;
  box-shadow:
    0 0.8rem 2.4rem rgb(0 0 0 / 45%),
    0 0 0 0.14rem rgb(255 255 255 / 16%);

  /* A size container, so the caption can step down on a small tile (below). */
  container-type: inline-size;
  opacity: 0;
  overflow: hidden;
  position: absolute;
  transition: opacity 1.2s ease-in-out;
}

.mem-photo.is-visible {
  opacity: 1;
}

.mem-photo.is-cut {
  animation: none;
  transition: none;
}

.mem-img {
  animation: wall-mem-kb 26s ease-in-out infinite alternate;
  display: block;
  height: 100%;
  object-fit: cover;
  transform-origin: 60% 40%;
  width: 100%;
}

.mem-img.is-still {
  animation: none;
}

/* A hidden tile stays mounted all night (it holds the decoded photo) but must not animate. */
.mem-photo:not(.is-visible),
.mem-photo:not(.is-visible) .mem-img {
  animation-play-state: paused;
}

/* A caption never takes over its photo: two lines at most, one on a narrow tile, none on a
   tile too small to carry it (the container queries below). */
.mem-cap {
  background: linear-gradient(to top, rgb(9 14 20 / 70%), transparent);
  bottom: 0;
  -webkit-box-orient: vertical;
  color: #fff;
  display: -webkit-box;
  font-weight: 700;
  left: 0;
  -webkit-line-clamp: 2;
  line-height: 1.1;
  margin: 0;
  overflow: hidden;
  padding: 1.6rem 0.8rem 0.45rem;
  position: absolute;
  right: 0;
  text-align: left;
}

@container (width < 15rem) {
  .mem-cap {
    -webkit-line-clamp: 1;
  }
}

@container (width < 10rem) {
  .mem-cap {
    display: none;
  }
}

/* A portrait wall's tiles are tall enough that the landscape scrim reached ~40% of one. */
.wall-portrait .mem-cap {
  padding-top: 0.9rem;
}

.wall-mem-full {
  animation: none;
  aspect-ratio: auto;
  border-radius: 0;
  box-shadow: none;
  inset: 0;
  width: auto;
}

@keyframes wall-mem-kb {
  from {
    transform: scale(1);
  }

  to {
    transform: scale(1.16) translate(-2%, 1.5%);
  }
}
</style>
