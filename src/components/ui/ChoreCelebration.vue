<script setup lang="ts">
/**
 * The choreboard's all-done celebration (#146): no box. It plays over the board, anchored to the
 * block that was just finished, then settles into that block's everyday all-done banner.
 *
 * Mounted by `CelebrationOverlay` (lazily, `choreCelebrationLoader`) while a chore celebration is
 * active. `useCelebration` owns WHAT plays (move, sound, praise) and WHEN (the burst → banner
 * phase flip and the end); this component only draws, through `choreCelebrationPlayer`:
 *
 *  - anchored: measured at play time from the anchor the tick surface built. The stage is
 *    clipped to the page (or, on the wall, the bean's lane), so nothing crosses into a sibling's
 *    lane or out over the app header. The stars burst from the tick; when the banner arrives
 *    (in its celebrating form, drawn by the surface itself) the move plays above it.
 *  - a surface with no banner (the home card's Now block, which folds to a summary row): the
 *    same move over this component's own banner, laid over the block, fading out at the end.
 *  - no anchor (the tick came from a surface with no board on screen): a centered version of
 *    the same move over this component's own banner.
 *  - reduced motion: nothing moves; the banner, stars and praise simply appear.
 *
 * It ends at once when its premise goes: another page (any route change), or the anchoring block
 * leaving the screen (watched each frame); it never lays out against a block that is gone. A
 * block unticked during the burst ends quietly at the phase flip (`useCelebration`).
 *
 * Every animation and timer belongs to the player and is cancelled when the next celebration
 * starts or this unmounts. Dark mode: the glow and the canopy strings switch with the theme
 * (`html.dark` rules below); the banner is the fixed brand gradient in both themes.
 */
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { routeLocationKey } from 'vue-router';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import {
  CHORE_CELEBRATION_SURFACE,
  dismissChoreCelebration,
  useCelebration,
  type ActiveChoreCelebration,
} from '@/composables/useCelebration';
import { useTranslation } from '@/composables/useTranslation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { logEvent } from '@/services/telemetry/logEvent';
import { choreDoneBannerText } from '@/constants/choreBlocks';
import { rectOf, type RectLike } from '@/utils/choreCelebration';
import {
  createChoreCelebrationPlayer,
  type ChoreCelebrationPlayer,
} from '@/components/ui/choreCelebrationPlayer';

const { activeChore } = useCelebration();
const { t } = useTranslation();
const { isMobile } = useBreakpoint();
/**
 * The app's banner is the short strip from 768px, and the ghost matches it where it has the
 * room. Laid over a narrow home card (3 across), a strip wraps its words to three lines, so
 * there the ghost keeps the tall form. The wall keeps the tall form always.
 */
const STRIP_MIN_WIDTH_REM = 28;
const ghostStrip = computed(() => {
  const g = ghost.value;
  if (!g || g.compact || isMobile.value) return false;
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return g.w >= STRIP_MIN_WIDTH_REM * rootPx;
});

/** The fixed, clipping box (viewport px), or null before the first measure. */
const box = ref<RectLike | null>(null);
const content = ref<HTMLElement | null>(null);

interface Ghost {
  x: number;
  y: number;
  w: number;
  compact: boolean;
  title: string;
  body: string;
  count: number;
}
/** This component's own banner, when the surface has none (or there is no surface). */
const ghost = shallowRef<Ghost | null>(null);
const ghostEl = ref<HTMLElement | null>(null);

const ghostCelebration = computed(() => {
  const c = activeChore.value;
  return c ? { words: c.praiseWords, calm: c.calm } : null;
});

let player: ChoreCelebrationPlayer | null = null;
/** The celebration being drawn (its anchor never changes between phases). */
let playing: ActiveChoreCelebration | null = null;
const isPlaying = (c: ActiveChoreCelebration) => playing?.id === c.id;
/** The anchor is on screen: draw on the board. False: centered. */
let anchored = false;
let followBase: RectLike | null = null;
let followFrame = 0;
let anchorFrame = 0;
/** The stars have burst for the celebration being drawn. */
let burstDone = false;

function intersect(a: RectLike, b: RectLike): RectLike {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
}

/**
 * The clip element (the page, or the wall's lane) bounds the SIDES, so nothing crosses into a
 * sibling's lane; `<main>` (the app's scroller, or the wall's board) bounds the top and bottom, so
 * the beanies can rise above a lane as in the mockup but never over the app header.
 */
function clipBox(c: ActiveChoreCelebration): RectLike {
  const view: RectLike = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const clip = anchored ? c.anchor?.clip : null;
  if (!clip) return view;
  const sides = rectOf(clip);
  const main = clip.closest('main');
  const band = main ? intersect(view, rectOf(main)) : view;
  return intersect(band, { x: sides.x, y: band.y, w: sides.w, h: band.h });
}

/**
 * The celebration's premise went away (the bean's block left the screen: another page, or the
 * surface unmounted): end it now, visuals and timers. A sound already playing finishes its short
 * tail (at most about two seconds); nothing new starts.
 */
function endGone(c: ActiveChoreCelebration, detail: string): void {
  logEvent({
    level: 'info',
    surface: CHORE_CELEBRATION_SURFACE,
    message: 'chore celebration ended: its block is no longer on screen',
    context: { action: 'ended-gone', detail, kind: c.move, slot: c.block },
  });
  dismissChoreCelebration(c.id);
}

/** Watch the anchor's block every frame (a property read, no layout): gone means end. */
function watchAnchor(c: ActiveChoreCelebration): void {
  anchorFrame = requestAnimationFrame(() => {
    anchorFrame = 0;
    if (!isPlaying(c)) return;
    if (!c.anchor?.block.isConnected) endGone(c, 'surface-unmounted');
    else watchAnchor(c);
  });
}

function onScroll(): void {
  if (followFrame) return;
  followFrame = requestAnimationFrame(() => {
    followFrame = 0;
    const block = playing?.anchor?.block;
    if (!player || !followBase || !block?.isConnected) return;
    const r = rectOf(block);
    player.follow(r.x - followBase.x, r.y - followBase.y);
  });
}

function stop(): void {
  burstDone = false;
  player?.cancel();
  player = null;
  playing = null;
  followBase = null;
  if (followFrame) cancelAnimationFrame(followFrame);
  followFrame = 0;
  if (anchorFrame) cancelAnimationFrame(anchorFrame);
  anchorFrame = 0;
  window.removeEventListener('scroll', onScroll, true);
  ghost.value = null;
  box.value = null;
}

async function start(c: ActiveChoreCelebration): Promise<void> {
  stop();
  playing = c;
  anchored = !!c.anchor;
  // Never lay out against a block that is no longer on screen (a zero rect): end instead.
  if (c.anchor && !c.anchor.block.isConnected) {
    endGone(c, 'anchor-gone');
    return;
  }
  if (anchored) watchAnchor(c);
  const b = clipBox(c);
  box.value = b;
  await nextTick();
  if (!isPlaying(c) || !content.value) return;
  player = createChoreCelebrationPlayer({
    stage: content.value,
    origin: { x: b.x, y: b.y },
    move: c.move,
    count: c.count,
    startedAt: c.startedAt,
    compact: !!c.anchor?.compact,
  });
  if (anchored && c.anchor) {
    followBase = rectOf(c.anchor.block);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }
  // The banner is already here (calm; a block found done only after its write; or this code
  // loaded late): there is no tick to burst from any more. `arrive` bursts from the banner.
  if (c.phase === 'banner') return;
  if (anchored && c.anchor && followBase) {
    // Correct the tap-time rects for any scroll since the tap.
    const now = followBase;
    const dx = now.x - c.anchor.blockAt.x - b.x;
    const dy = now.y - c.anchor.blockAt.y - b.y;
    player.burst({
      tick: { ...c.anchor.tick, x: c.anchor.tick.x + dx, y: c.anchor.tick.y + dy },
      area: { ...now, x: now.x - b.x, y: now.y - b.y },
      tickEl: c.anchor.tickEl,
      blockEl: c.anchor.block,
    });
    burstDone = true;
  } else {
    // Centered: the stars burst from where the banner is about to appear.
    const w = Math.min(b.w - 32, 400);
    const area = { x: (b.w - w) / 2, y: b.h * 0.3, w, h: b.h * 0.4 };
    player.burst({
      tick: { x: b.w / 2 - 22, y: b.h * 0.62, w: 44, h: 44 },
      area,
      tickEl: null,
      blockEl: null,
    });
    burstDone = true;
  }
}

/** Play on the banner; without a burst yet, the stars burst from the banner's foot first. */
function playOn(c: ActiveChoreCelebration, banner: HTMLElement): void {
  if (!player) return;
  if (c.calm) {
    player.calm(banner);
    return;
  }
  if (!burstDone) {
    const o = box.value ?? { x: 0, y: 0 };
    const r = rectOf(banner);
    const area = { x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h };
    player.burst({
      tick: { x: area.x + area.w / 2 - 22, y: area.y + area.h - 44, w: 44, h: 44 },
      area,
      tickEl: null,
      blockEl: null,
      late: true,
    });
    burstDone = true;
  }
  player.arrive(banner);
}

/** The banner has arrived (or, calm, is there from the start): play on it. */
async function arrive(c: ActiveChoreCelebration): Promise<void> {
  // Not drawing yet (still measuring): `start` calls back here once it is.
  if (!isPlaying(c) || !player) return;
  if (anchored && !c.anchor?.block.isConnected) {
    endGone(c, 'anchor-gone');
    return;
  }
  const banner = anchored
    ? c.anchor?.block.querySelector<HTMLElement>('[data-celebration-banner]')
    : null;
  if (banner) {
    playOn(c, banner);
    return;
  }
  const b = box.value ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const compact = !!c.anchor?.compact;
  let x: number;
  let y: number;
  let w: number;
  if (anchored && c.anchor) {
    // Over the block (the home card's Now row), as wide as it.
    const r = rectOf(c.anchor.block);
    w = Math.min(r.w, b.w);
    x = Math.max(0, r.x - b.x);
    y = r.y - b.y;
  } else {
    w = Math.min(b.w - 32, compact ? 360 : 400);
    x = (b.w - w) / 2;
    y = Math.max(16, b.h * 0.3);
  }
  ghost.value = {
    x,
    y,
    w,
    compact,
    count: c.count,
    ...choreDoneBannerText(c.block, c.count, c.beanName, t),
  };
  await nextTick();
  const el = ghostEl.value;
  if (!isPlaying(c) || !player || !el) return;
  playOn(c, el);
  player.fadeOutBy(el, c.endsAt);
}

watch(
  () => activeChore.value?.id,
  (id) => {
    const c = activeChore.value;
    if (id === undefined || !c) {
      stop();
      return;
    }
    void start(c).then(() => {
      // Calm starts with its banner; a late-loading component may find it already there too.
      const cur = activeChore.value;
      if (cur?.id === c.id && cur.phase === 'banner') void arrive(cur);
    });
  },
  { immediate: true, flush: 'post' }
);

watch(
  () => activeChore.value?.phase,
  (phase, was) => {
    const c = activeChore.value;
    if (c && phase === 'banner' && was === 'burst') void arrive(c);
  },
  { flush: 'post' }
);

// Another page (or another bean's day: the query changes too) ends the celebration at once.
const route = inject(routeLocationKey, null);
watch(
  () => route?.fullPath,
  () => {
    const c = activeChore.value;
    if (c) endGone(c, 'route-change');
  }
);

onBeforeUnmount(stop);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="box"
      class="pointer-events-none fixed z-[180] overflow-hidden"
      :style="{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
      }"
      aria-hidden="true"
      data-testid="chore-celebration"
      :data-move="activeChore?.move"
    >
      <div ref="content" class="absolute inset-0">
        <div
          v-if="ghost"
          ref="ghostEl"
          class="absolute"
          :style="{ left: `${ghost.x}px`, top: `${ghost.y}px`, width: `${ghost.w}px` }"
          data-testid="chore-celebration-ghost"
        >
          <CelebrationBanner
            :title="ghost.title"
            :body="ghost.body"
            :image-alt="t('choreboard.done.imageAlt')"
            :compact="ghost.compact"
            :strip="ghostStrip"
            :stars="ghost.count"
            :celebration="ghostCelebration"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* The player's elements are made in script, so these rules are global, namespaced `cc-`. */
.cc-layer {
  --cc-glow-core: rgb(248 249 250 / 94%);
  --cc-glow-mid: rgb(248 249 250 / 70%);
  --cc-glow-warm: rgb(241 93 34 / 4%);
  --cc-string: #4d5d6c;

  inset: 0;
  position: absolute;
}

html.dark .cc-layer {
  --cc-glow-core: rgb(21 30 39 / 92%);
  --cc-glow-mid: rgb(21 30 39 / 66%);
  --cc-glow-warm: rgb(255 139 94 / 4%);
  --cc-string: #9aa9b4;
}

.cc-actor,
.cc-canopy {
  position: absolute;
  will-change: transform, opacity;
}

.cc-actor,
.cc-actor-inner,
.cc-actor img {
  transform-origin: 50% 100%;
}

.cc-actor-inner {
  height: 100%;
  position: relative;
  width: 100%;
  will-change: transform;
}

.cc-actor img {
  display: block;
  height: 100%;
  user-select: none;
  width: 100%;
}

.cc-clip {
  left: 0;
  overflow: hidden;
  position: absolute;
  top: 0;
}

.cc-glow {
  background: radial-gradient(
    closest-side,
    var(--cc-glow-core),
    var(--cc-glow-mid) 58%,
    var(--cc-glow-warm) 80%,
    transparent
  );
  border-radius: 50%;
  position: absolute;
  will-change: opacity;
}

.cc-fstar {
  align-items: center;
  display: flex;
  height: 1.5em;
  justify-content: center;
  left: 0;
  line-height: 1;
  margin: -0.75em 0 0 -0.75em;
  position: absolute;
  top: 0;
  width: 1.5em;
  will-change: transform, opacity;
}

.cc-spark {
  border-radius: 50%;
  height: 8px;
  left: -4px;
  position: absolute;
  top: -4px;
  width: 8px;
  will-change: transform, opacity;
}

.cc-ring {
  border: 3px solid #f15d22;
  border-radius: 50%;
  position: absolute;
  will-change: transform, opacity;
}

.cc-strings {
  stroke: var(--cc-string);
}
</style>
