<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Full-screen birthday celebration — a rain of confetti + a large
 * personalised greeting that fades in and out. Fires at most once per
 * birthday per device (gated on `localStorage`), so reloading the app on
 * the same day doesn't re-trigger.
 *
 * Mounted on `FamilyNookPage`. The component itself is the gate: if today
 * isn't the viewer's birthday (or the flag is already set), `visible`
 * stays false and the template renders nothing.
 *
 * Pairs with the in-banner birthday treatment in `HolidayBriefingBanner`
 * — the banner is the always-on layer for the day; this overlay is the
 * one-shot easter egg.
 */
const familyStore = useFamilyStore();
const { today } = useToday();
const { t } = useTranslation();

const visible = ref(false);
const greeting = ref('');

// 48-piece palette draw — mixed brand + warm tones so the rain reads as
// "celebration" not "ad campaign."
const PALETTE = [
  '#f15d22',
  '#d4a017',
  '#aed6f1',
  '#e67e22',
  '#f4e1c1',
  '#d63384',
  '#8b2828',
  '#f4c842',
];
const PIECE_COUNT = 48;

// `left` precomputed here (JS handles modulo cleanly) so the CSS rule can
// just consume the value — stylelint can't parse mixed-unit `%` inside calc.
const pieces = Array.from({ length: PIECE_COUNT }, (_, i) => ({
  i,
  color: PALETTE[i % PALETTE.length],
  left: (i * 47) % 100,
}));

onMounted(() => {
  const member = familyStore.currentMember;
  const dob = member?.dateOfBirth;
  if (!dob) return;

  const [, monthStr, dayStr] = today.value.split('-');
  const todayMonth = Number(monthStr);
  const todayDay = Number(dayStr);
  if (dob.month !== todayMonth || dob.day !== todayDay) return;

  // Gate — once per birthday per device. localStorage may fail in private
  // mode; fall through and fire anyway in that case (better to over-fire
  // than to skip the easter egg entirely).
  const storageKey = `beanies:birthday-confetti:${today.value}:${member.id}`;
  try {
    if (localStorage.getItem(storageKey)) return;
    localStorage.setItem(storageKey, '1');
  } catch (e) {
    console.warn('[birthday-overlay] localStorage gate unavailable — firing once:', e);
  }

  const firstName = (member.name ?? '').trim().split(/\s+/)[0] ?? '';
  const template = t('nook.birthday.overlay');
  greeting.value = firstName
    ? template.replace('{name}', firstName)
    : template.replace(', {name}', '').replace('{name}', '');

  visible.value = true;
  // Total run: ~6s. Confetti rain runs the full 6s; the centre greeting
  // animates 0.6s in → 2.8s hold → 0.6s out (4s total, leaving 2s of
  // confetti afterglow).
  setTimeout(() => {
    visible.value = false;
  }, 6000);
});
</script>

<template>
  <Transition name="bday-overlay">
    <div v-if="visible" class="bday-overlay" aria-hidden="true">
      <!-- Centred greeting hero -->
      <div class="bday-hero">
        <span class="bday-hero-cake">🎂</span>
        <p class="bday-hero-text font-outfit">{{ greeting }}</p>
      </div>

      <!-- Confetti rain — 48 pieces falling at modular-arithmetic positions -->
      <span
        v-for="piece in pieces"
        :key="piece.i"
        class="bday-piece"
        :style="{ '--i': piece.i, '--c': piece.color, '--left': `${piece.left}%` }"
      />
    </div>
  </Transition>
</template>

<style scoped>
.bday-overlay {
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  position: fixed;
  z-index: 60;
}

.bday-overlay-enter-active,
.bday-overlay-leave-active {
  transition: opacity 480ms ease-out;
}

.bday-overlay-enter-from,
.bday-overlay-leave-to {
  opacity: 0;
}

/* ─── Centred hero greeting ───────────────────────────────────────────── */
.bday-hero {
  align-items: center;
  animation: bday-hero-pop 4s ease-in-out forwards;
  display: flex;

  /* Soft glow so the text reads on top of any background. */
  filter: drop-shadow(0 6px 22px rgb(255 215 100 / 35%));
  flex-direction: column;
  gap: 0.75rem;
  left: 50%;
  position: absolute;
  text-align: center;
  top: 30%;
  transform: translate(-50%, -50%);
}

.bday-hero-cake {
  animation: bday-hero-cake-wobble 1.4s ease-in-out infinite;
  font-size: 4rem;
  line-height: 1;
}

.bday-hero-text {
  color: white;
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1.2;
  max-width: min(90vw, 32rem);
  padding: 0 1rem;
  text-shadow:
    0 2px 8px rgb(0 0 0 / 35%),
    0 0 24px rgb(244 200 66 / 55%);
}

@keyframes bday-hero-pop {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.6);
  }

  12% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.08);
  }

  18% {
    transform: translate(-50%, -50%) scale(1);
  }

  82% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }

  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.92);
  }
}

@keyframes bday-hero-cake-wobble {
  0%,
  100% {
    transform: rotate(-6deg);
  }

  50% {
    transform: rotate(6deg);
  }
}

/* ─── Confetti rain ───────────────────────────────────────────────────── */
.bday-piece {
  animation: bday-piece-fall 5.4s cubic-bezier(0.42, 0, 0.7, 1) forwards;
  animation-delay: calc(var(--i) * 70ms);
  background: var(--c);
  border-radius: 1px;
  height: 10px;

  /* Spread across the viewport via prime-multiplier modular arithmetic —
   * deterministic but visually "random" enough that 48 pieces look like
   * scattered fall, not a uniform grid. */
  left: var(--left);
  opacity: 0;
  position: absolute;
  top: -8vh;
  transform-origin: center;
  width: 6px;
}

@keyframes bday-piece-fall {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg);
  }

  10% {
    opacity: 1;
  }

  85% {
    opacity: 1;
  }

  100% {
    opacity: 0;

    /* Drift sideways while falling — alternating direction via `--i % 2`
     * gives the rain a little wind. The vertical fall is ~120vh so pieces
     * exit the viewport cleanly off the bottom even on tall screens. */
    transform: translate(calc(((var(--i) % 2) * 60px) - 30px), 120vh) rotate(720deg);
  }
}

/* Reduced motion — skip everything. Birthday users with reduce-motion get
 * the in-banner birthday treatment (still static-palette + emoji) and no
 * screen overlay. */
@media (prefers-reduced-motion: reduce) {
  .bday-overlay {
    display: none;
  }
}
</style>
