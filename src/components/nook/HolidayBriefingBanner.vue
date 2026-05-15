<script setup lang="ts">
import { computed } from 'vue';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import {
  getHolidayGreeting,
  getHolidayEmoji,
  getHolidayTheme,
  type HolidayTheme,
} from '@/utils/holidayGreeting';

const holidayStore = useHolidayStore();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const { today } = useToday();
const { t } = useTranslation();

interface DisplaySurface {
  theme: HolidayTheme | 'default';
  greeting: string;
  emoji: string;
  caption: string;
}

/**
 * What goes in the banner today. Birthday > public holiday > nothing.
 * Computed as a discriminated surface so the template branches cleanly
 * on a single value instead of juggling three nullable refs.
 */
const surface = computed<DisplaySurface | null>(() => {
  // 1) Current viewer's birthday wins over everything else.
  const member = familyStore.currentMember;
  const dob = member?.dateOfBirth;
  if (dob) {
    const [, monthStr, dayStr] = today.value.split('-');
    const todayMonth = Number(monthStr);
    const todayDay = Number(dayStr);
    if (dob.month === todayMonth && dob.day === todayDay) {
      const firstName = (member.name ?? '').trim().split(/\s+/)[0] ?? '';
      const greetingTemplate = t('nook.holiday.greeting.birthday');
      return {
        theme: 'birthday',
        greeting: firstName
          ? greetingTemplate.replace('{name}', firstName)
          : greetingTemplate.replace(', {name}', '').replace('{name}', ''),
        emoji: '🎂',
        caption: t('nook.holiday.birthday.caption'),
      };
    }
  }

  // 2) Public holiday — gated on country + the "show public holidays" toggle.
  if (settingsStore.showPublicHolidays) {
    const holiday = holidayStore.holidayForDate(today.value);
    if (holiday) {
      return {
        theme: getHolidayTheme(holiday) ?? 'default',
        greeting: getHolidayGreeting(holiday, t),
        emoji: getHolidayEmoji(holiday),
        caption: t('nook.holiday.banner.caption'),
      };
    }
  }

  return null;
});

// Confetti palette for the New Year burst. Six colours → 12 pieces means each
// colour shows ~twice, giving variety without listing each piece by hand.
const confettiPalette = ['#f15d22', '#d4a017', '#aed6f1', '#e67e22', '#f4e1c1', '#8b2828'];

// `HolidayTheme` is camelCase ('lunarNewYear', 'mothersDay'…) for type-safety,
// but CSS class names are kebab-case per stylelint. Convert at the boundary.
const themeClass = computed(() =>
  surface.value ? `theme-${surface.value.theme.replace(/([A-Z])/g, '-$1').toLowerCase()}` : ''
);
</script>

<template>
  <div v-if="surface" class="holiday-banner" :class="themeClass" role="status">
    <span class="holiday-banner-emoji" aria-hidden="true">{{ surface.emoji }}</span>
    <div class="holiday-banner-text">
      <p class="holiday-banner-greeting font-outfit">{{ surface.greeting }}</p>
      <p class="holiday-banner-caption">{{ surface.caption }}</p>
    </div>

    <!-- Decorative motif layer — every banner gets one, even the default. -->
    <div class="holiday-banner-deco" aria-hidden="true">
      <!-- BIRTHDAY — the most elaborate in-banner treatment.
           Sparkles + drifting confetti + emoji bounce. Pair this with the
           once-per-day BirthdayConfettiOverlay for the big moment. -->
      <template v-if="surface.theme === 'birthday'">
        <span v-for="i in 5" :key="`bday-sparkle-${i}`" class="deco-sparkle" :style="{ '--i': i }">
          ✦
        </span>
        <span
          v-for="i in 8"
          :key="`bday-conf-${i}`"
          class="deco-bday-confetti"
          :style="{ '--i': i, '--c': confettiPalette[i % confettiPalette.length] }"
        />
      </template>

      <!-- Christmas — gentle snowfall -->
      <template v-else-if="surface.theme === 'christmas'">
        <span v-for="i in 5" :key="`flake-${i}`" class="deco-snowflake" :style="{ '--i': i }">
          {{ ['❄', '❅', '❆'][i % 3] }}
        </span>
      </template>

      <!-- Diwali — golden diyas twinkling along the bottom -->
      <template v-else-if="surface.theme === 'diwali'">
        <span v-for="i in 6" :key="`diya-${i}`" class="deco-diya" :style="{ '--i': i }" />
      </template>

      <!-- New Year — one-shot confetti burst (12 pieces) -->
      <template v-else-if="surface.theme === 'newYear'">
        <span
          v-for="i in 12"
          :key="`confetti-${i}`"
          class="deco-confetti"
          :style="{ '--i': i, '--c': confettiPalette[i % confettiPalette.length] }"
        />
      </template>

      <!-- Mother's Day — drifting petal dots -->
      <template v-else-if="surface.theme === 'mothersDay'">
        <span v-for="i in 4" :key="`petal-${i}`" class="deco-petal" :style="{ '--i': i }" />
      </template>

      <!-- Thanksgiving — drifting leaf dots -->
      <template v-else-if="surface.theme === 'thanksgiving'">
        <span v-for="i in 4" :key="`leaf-${i}`" class="deco-leaf" :style="{ '--i': i }" />
      </template>

      <!-- Default (non-allowlist holiday) — three quiet sparkle dots so
           local / regional holidays still feel slightly festive without
           competing with the named themes. -->
      <template v-else-if="surface.theme === 'default'">
        <span
          v-for="i in 3"
          :key="`default-sparkle-${i}`"
          class="deco-default-sparkle"
          :style="{ '--i': i }"
        />
      </template>
      <!-- (LNY + Eid use box-shadow / halo animations — no extra DOM.) -->
    </div>
  </div>
</template>

<style scoped>
/* ─────────────────────────────────────────────────────────────────────────
 * Base banner — palette is driven by CSS variables so each theme block
 * below only needs to override variables, never re-declare layout.
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner {
  /* Palette (overridable per theme) */
  --banner-bg-start: var(--color-sky-silk-100, #daeef9);
  --banner-bg-end: var(--color-sky-silk-50, #ebf6fc);
  --banner-border: var(--color-sky-silk-200, #c5e2f5);
  --banner-text: var(--color-secondary-700, #1a2e44);
  --banner-text-muted: rgb(44 62 80 / 65%);
  --banner-emoji-bg: rgb(255 255 255 / 60%);
  --banner-emoji-ring: transparent;
  --banner-shadow: 0 1px 2px rgb(0 0 0 / 4%);

  align-items: center;
  animation: holiday-banner-fade-in 320ms ease-out;
  background: linear-gradient(135deg, var(--banner-bg-start) 0%, var(--banner-bg-end) 100%);
  border: 1px solid var(--banner-border);
  border-radius: 1rem;
  box-shadow: var(--banner-shadow);
  color: var(--banner-text);
  display: flex;
  gap: 0.75rem;
  overflow: hidden;
  padding: 0.75rem 1rem;
  position: relative;
}

.holiday-banner-emoji {
  align-items: center;
  background: var(--banner-emoji-bg);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--banner-emoji-ring);
  display: inline-flex;
  flex-shrink: 0;
  font-size: 1.25rem;
  height: 2.25rem;
  justify-content: center;
  position: relative;
  width: 2.25rem;
  z-index: 2;
}

.holiday-banner-text {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 2;
}

.holiday-banner-greeting {
  color: var(--banner-text);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
}

.holiday-banner-caption {
  color: var(--banner-text-muted);
  font-size: 0.75rem;
  margin-top: 0.125rem;
}

.holiday-banner-deco {
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 1;
}

@keyframes holiday-banner-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: default — non-allowlist public holidays
 * Sky Silk gradient warmed with a peach tint + three drifting sparkle
 * dots. Quiet, but more festive than the original utilitarian banner.
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-default {
  --banner-bg-start: #e7f3fb;
  --banner-bg-end: #fef0e8;
  --banner-border: rgb(174 214 241 / 70%);
  --banner-text: var(--color-secondary-700, #1a2e44);
  --banner-text-muted: rgb(44 62 80 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 75%);
  --banner-emoji-ring: rgb(241 93 34 / 25%);
}

.deco-default-sparkle {
  animation: default-twinkle 3.6s ease-in-out infinite;
  animation-delay: calc(var(--i) * -1.2s);
  background: radial-gradient(circle, rgb(241 93 34 / 55%) 0%, transparent 70%);
  border-radius: 50%;
  height: 4px;
  position: absolute;
  right: calc(8% + var(--i) * 5%);
  top: calc(15% + var(--i) * 22%);
  width: 4px;
}

@keyframes default-twinkle {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }

  50% {
    opacity: 0.85;
    transform: scale(1.15);
  }
}

/* Dark mode — only adjusts the default Sky Silk theme. Each festive theme
 * below already declares deep enough colours to carry through both modes. */
:global(.dark) .holiday-banner.theme-default {
  --banner-bg-start: rgb(174 214 241 / 12%);
  --banner-bg-end: rgb(241 93 34 / 8%);
  --banner-border: rgb(174 214 241 / 22%);
  --banner-text: rgb(255 255 255 / 92%);
  --banner-text-muted: rgb(255 255 255 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 10%);
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Birthday — the most elaborate in-banner treatment.
 * Magenta → champagne gradient, ✦ sparkles, drifting confetti, emoji bounce.
 * The screen-fill BirthdayConfettiOverlay fires separately once per day.
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-birthday {
  --banner-bg-start: #d63384;
  --banner-bg-end: #f4c842;
  --banner-border: rgb(244 200 66 / 80%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 82%);
  --banner-emoji-bg: rgb(255 245 225 / 28%);
  --banner-emoji-ring: rgb(244 225 193 / 60%);

  animation:
    holiday-banner-fade-in 320ms ease-out,
    bday-glow 2.8s ease-in-out infinite 320ms;
}

@keyframes bday-glow {
  0%,
  100% {
    box-shadow:
      var(--banner-shadow),
      0 0 14px rgb(244 200 66 / 18%);
  }

  50% {
    box-shadow:
      var(--banner-shadow),
      0 0 28px rgb(244 200 66 / 45%);
  }
}

.holiday-banner.theme-birthday .holiday-banner-emoji {
  animation: bday-bounce 1.6s ease-in-out infinite;
}

@keyframes bday-bounce {
  0%,
  100% {
    transform: translateY(0) rotate(-3deg);
  }

  50% {
    transform: translateY(-4px) rotate(3deg);
  }
}

.deco-sparkle {
  animation: bday-sparkle-pulse 2s ease-in-out infinite;
  animation-delay: calc(var(--i) * -0.4s);
  color: rgb(255 245 225 / 85%);
  font-size: 0.75rem;
  line-height: 1;
  position: absolute;
  right: calc(8% + var(--i) * 14%);
  text-shadow: 0 0 6px rgb(255 215 100 / 60%);
  top: calc(8% + var(--i) * 16%);
}

@keyframes bday-sparkle-pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.7) rotate(0deg);
  }

  50% {
    opacity: 1;
    transform: scale(1.15) rotate(180deg);
  }
}

.deco-bday-confetti {
  animation: bday-confetti-drift 5s linear infinite;
  animation-delay: calc(var(--i) * -0.7s);
  background: var(--c);
  border-radius: 1px;
  height: 7px;
  left: calc(var(--i) * 13% + 4%);
  position: absolute;
  top: -8%;
  width: 5px;
}

@keyframes bday-confetti-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg);
  }

  15% {
    opacity: 0.85;
  }

  85% {
    opacity: 0.85;
  }

  100% {
    opacity: 0;
    transform: translate(14px, 80px) rotate(540deg);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Christmas — evergreen → cranberry, drifting snowflakes
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-christmas {
  --banner-bg-start: #2d5a3d;
  --banner-bg-end: #7a2828;
  --banner-border: rgb(212 160 23 / 55%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 78%);
  --banner-emoji-bg: rgb(244 225 193 / 18%);
  --banner-emoji-ring: rgb(212 160 23 / 40%);
}

.deco-snowflake {
  animation: snowfall 7s linear infinite;
  animation-delay: calc(var(--i) * -1.4s);
  color: rgb(255 255 255 / 60%);
  font-size: 0.7rem;
  left: calc(var(--i) * 19%);
  line-height: 1;
  position: absolute;
  top: -10%;
}

@keyframes snowfall {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg);
  }

  15% {
    opacity: 0.75;
  }

  85% {
    opacity: 0.75;
  }

  100% {
    opacity: 0;
    transform: translate(8px, 90px) rotate(360deg);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Lunar New Year — cinnabar → gold, warm glow pulse
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-lunar-new-year {
  --banner-bg-start: #c8332c;
  --banner-bg-end: #d49a17;
  --banner-border: rgb(244 200 66 / 75%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 78%);
  --banner-emoji-bg: rgb(244 225 193 / 22%);
  --banner-emoji-ring: rgb(244 200 66 / 55%);

  animation:
    holiday-banner-fade-in 320ms ease-out,
    lny-glow 3.5s ease-in-out infinite 320ms;
}

@keyframes lny-glow {
  0%,
  100% {
    box-shadow:
      var(--banner-shadow),
      0 0 14px rgb(244 200 66 / 15%);
  }

  50% {
    box-shadow:
      var(--banner-shadow),
      0 0 26px rgb(244 200 66 / 38%);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Diwali — indigo → amber, twinkling diyas
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-diwali {
  --banner-bg-start: #1f1f5c;
  --banner-bg-end: #c9871f;
  --banner-border: rgb(244 200 66 / 60%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 78%);
  --banner-emoji-bg: rgb(244 200 66 / 20%);
  --banner-emoji-ring: rgb(244 200 66 / 50%);
}

.deco-diya {
  animation: diya-twinkle 2.4s ease-in-out infinite;
  animation-delay: calc(var(--i) * -0.4s);
  background: radial-gradient(circle at 35% 35%, #ffd56b 0%, #d49a17 65%, transparent 100%);
  border-radius: 50%;
  bottom: 6px;
  box-shadow: 0 0 6px rgb(212 160 23 / 70%);
  height: 6px;
  left: calc(var(--i) * 15% + 6%);
  position: absolute;
  width: 6px;
}

@keyframes diya-twinkle {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Eid — sage → cream, soft moon halo on the emoji circle
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-eid {
  --banner-bg-start: #7a9b78;
  --banner-bg-end: #f0e6d2;
  --banner-border: rgb(122 155 120 / 55%);
  --banner-text: #2c3e50;
  --banner-text-muted: rgb(44 62 80 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 70%);
  --banner-emoji-ring: rgb(122 155 120 / 60%);
}

.holiday-banner.theme-eid .holiday-banner-emoji {
  animation: eid-halo 3.6s ease-in-out infinite;
}

@keyframes eid-halo {
  0%,
  100% {
    box-shadow:
      0 0 0 1px var(--banner-emoji-ring),
      0 0 0 0 rgb(255 255 255 / 50%);
  }

  50% {
    box-shadow:
      0 0 0 1px var(--banner-emoji-ring),
      0 0 14px 2px rgb(255 255 255 / 60%);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: New Year — midnight → champagne, one-shot confetti burst
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-new-year {
  --banner-bg-start: #1a1d3a;
  --banner-bg-end: #c9871f;
  --banner-border: rgb(244 200 66 / 70%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 78%);
  --banner-emoji-bg: rgb(244 200 66 / 22%);
  --banner-emoji-ring: rgb(244 200 66 / 60%);
}

.deco-confetti {
  animation: confetti-burst 1.6s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  animation-delay: calc(var(--i) * 55ms);
  background: var(--c);
  border-radius: 1px;
  height: 5px;
  left: 18%;
  opacity: 0;
  position: absolute;
  top: 45%;
  transform-origin: center;
  width: 5px;
}

@keyframes confetti-burst {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg) scale(0.6);
  }

  20% {
    opacity: 1;
  }

  100% {
    opacity: 0;

    /* Each piece deflects via its index — `--i` drives the x-offset and a
     * mod-3 lift produces three rough heights, giving the spread shape. */
    transform: translate(calc((var(--i) * 17px) - 110px), calc(-30px + ((var(--i) % 3) * 18px)))
      rotate(540deg) scale(1);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Easter — mint → blush, gentle emoji bounce
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-easter {
  --banner-bg-start: #c4e6ce;
  --banner-bg-end: #f9d5e5;
  --banner-border: rgb(196 230 206 / 70%);
  --banner-text: #2c3e50;
  --banner-text-muted: rgb(44 62 80 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 80%);
  --banner-emoji-ring: rgb(249 213 229 / 70%);
}

.holiday-banner.theme-easter .holiday-banner-emoji {
  animation: easter-bounce 3.2s ease-in-out infinite;
}

@keyframes easter-bounce {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-3px);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Mother's Day — rose → cream, drifting petals
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-mothers-day {
  --banner-bg-start: #f4c5d8;
  --banner-bg-end: #f9ecec;
  --banner-border: rgb(244 197 216 / 75%);
  --banner-text: #5a2a3f;
  --banner-text-muted: rgb(90 42 63 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 75%);
  --banner-emoji-ring: rgb(244 197 216 / 60%);
}

.deco-petal {
  animation: petal-drift 8s linear infinite;
  animation-delay: calc(var(--i) * -1.8s);
  background: rgb(217 137 168 / 55%);
  border-radius: 60% 40% / 50% 60% 40% 50%;
  height: 6px;
  left: calc(var(--i) * 22% + 8%);
  position: absolute;
  top: -8%;
  width: 6px;
}

@keyframes petal-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg);
  }

  15% {
    opacity: 0.65;
  }

  85% {
    opacity: 0.65;
  }

  100% {
    opacity: 0;
    transform: translate(14px, 95px) rotate(220deg);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Father's Day — warm sage → cream, palette only (static, calm)
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-fathers-day {
  --banner-bg-start: #a8b89e;
  --banner-bg-end: #ede5d0;
  --banner-border: rgb(168 184 158 / 70%);
  --banner-text: #2c3e50;
  --banner-text-muted: rgb(44 62 80 / 70%);
  --banner-emoji-bg: rgb(255 255 255 / 70%);
  --banner-emoji-ring: rgb(168 184 158 / 55%);
}

/* ─────────────────────────────────────────────────────────────────────────
 * THEME: Thanksgiving — amber → russet, drifting fall leaves
 * ──────────────────────────────────────────────────────────────────────── */
.holiday-banner.theme-thanksgiving {
  --banner-bg-start: #d4922e;
  --banner-bg-end: #8b4513;
  --banner-border: rgb(212 146 46 / 70%);
  --banner-text: #fff5e1;
  --banner-text-muted: rgb(255 245 225 / 78%);
  --banner-emoji-bg: rgb(255 245 225 / 22%);
  --banner-emoji-ring: rgb(244 200 66 / 50%);
}

.deco-leaf {
  animation: leaf-drift 9s linear infinite;
  animation-delay: calc(var(--i) * -2.2s);
  background: linear-gradient(135deg, #d4922e 0%, #8b4513 100%);
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  height: 7px;
  left: calc(var(--i) * 24% + 6%);
  position: absolute;
  top: -8%;
  width: 7px;
}

@keyframes leaf-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg);
  }

  15% {
    opacity: 0.7;
  }

  85% {
    opacity: 0.7;
  }

  100% {
    opacity: 0;
    transform: translate(18px, 100px) rotate(280deg);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Reduced motion — strip every animation, keep the palette + static
 * decorations. Burst-only motifs (confetti / NY confetti) are hidden so a
 * fresh mount doesn't leave pieces frozen mid-flight.
 * ──────────────────────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .holiday-banner,
  .holiday-banner .holiday-banner-emoji,
  .deco-snowflake,
  .deco-diya,
  .deco-confetti,
  .deco-bday-confetti,
  .deco-sparkle,
  .deco-default-sparkle,
  .deco-petal,
  .deco-leaf {
    animation: none !important;
  }

  .deco-snowflake,
  .deco-diya,
  .deco-petal,
  .deco-leaf,
  .deco-sparkle,
  .deco-default-sparkle {
    opacity: 0.55;
  }

  .deco-confetti,
  .deco-bday-confetti {
    opacity: 0;
  }
}
</style>
