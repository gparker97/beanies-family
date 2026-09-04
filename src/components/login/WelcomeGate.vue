<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import { getBuildVersionLabel } from '@/utils/diagnosticContext';
// REVIEW-DEMO: gates the app-review access affordance below.
import { isReviewDemoAvailable } from '@/utils/reviewDemo';
import LoginChoiceCard from './LoginChoiceCard.vue';
import { track } from '@/services/analytics/plausible';

const { t } = useTranslation();

// Subtle build marker so we can tell which deployed bundle is running (matches
// the `Build:` SHA in #beanies-errors). Computed once — the build is static.
const buildVersion = getBuildVersionLabel();

// Marketing homepage lives on the Astro site at the apex (post-Phase-C).
// DEV points at the local Astro dev server (4321) for parity; in prod
// it's the live apex.
const MARKETING_HOME_URL = import.meta.env.DEV
  ? 'http://localhost:4321/'
  : 'https://beanies.family/';

// REVIEW-DEMO: 'review-demo' opens a modal rather than switching view — see the
// early-returning first branch of LoginPage's handleNavigate.
type LoginView = 'load-pod' | 'create' | 'join' | 'review-demo';

const emit = defineEmits<{
  navigate: [view: LoginView];
}>();

/**
 * Top of the create→invite funnel: record every "plant a new pod" click so we
 * can compare it against `invite_request_click` at the invite gate and see how
 * many start the create flow but bail at the invite-only friction. Fired here
 * (the actual button) rather than in LoginPage's navigate handler, which is also
 * reached by non-button redirect paths.
 */
function onCreatePod() {
  track('create_pod_click');
  emit('navigate', 'create');
}

/**
 * Split the prompt ("where would you like to begin?") around the accent word
 * ("begin") so the brand gradient can be applied to that single word without
 * putting HTML into the translation value. See `splitAroundAccent` for the
 * graceful-fallback contract when the accent isn't present in the translated
 * string.
 */
function promptParts() {
  return splitAroundAccent(t('loginV6.welcomePrompt'), t('loginV6.welcomePromptAccent'));
}
</script>

<template>
  <div class="space-y-6">
    <!-- ────────────────────────────────────────────────────────────────
         Welcome prompt — eyebrow + larger heading with a single accented
         word rendered in the brand gradient. More inviting than the
         small grey subhead it replaces; serves as the page-level heading
         for /welcome (semantic <h1>).
         ──────────────────────────────────────────────────────────────── -->
    <header class="text-center">
      <p
        class="font-outfit text-primary-500 mb-2 text-xs font-semibold tracking-[0.12em] uppercase"
      >
        {{ t('loginV6.welcomeEyebrow') }}
      </p>
      <h1
        class="font-outfit dark:text-ink text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl"
      >
        <template v-for="(part, i) in [promptParts()]" :key="i">
          {{ part.lead
          }}<span
            class="from-primary-500 to-terracotta-400 bg-gradient-to-r bg-clip-text text-transparent"
            >{{ part.accent }}</span
          >{{ part.trail }}
        </template>
      </h1>
    </header>

    <!-- ────────────────────────────────────────────────────────────────
         PRIMARY: Create card. Full-width hero. Gradient orange backdrop
         with frosted-glass icon box + tagline + title + subtitle + chevron
         that nudges right on hover. The "start here" pill in the top-
         right makes it unmistakable which action a first-timer should
         take, without lecturing.
         ──────────────────────────────────────────────────────────────── -->
    <LoginChoiceCard
      testid="create-pod-button"
      :aria-label="t('loginV6.createTitle')"
      class="from-primary-500 to-terracotta-400 relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 shadow-lg hover:shadow-xl"
      @click="onCreatePod"
    >
      <!-- Soft radial highlight in the upper-right; adds depth to the gradient. -->
      <span
        aria-hidden="true"
        class="pointer-events-none absolute -top-1/2 -right-[20%] h-[200%] w-[70%]"
        style="
          background: radial-gradient(
            ellipse at center,
            rgb(255 255 255 / 18%) 0%,
            transparent 60%
          );
        "
      ></span>

      <!-- "Start here" pill — frosted glass over the gradient. Sits in the
           upper-right CORNER (top-3/right-3, smaller padding, smaller type)
           so it stays clear of the chevron at the right edge of the content
           row below. Earlier top-4/right-4/py-1 caused the pill's bottom
           edge to meet the chevron's top edge with zero gap on desktop. -->
      <span
        class="font-outfit absolute top-3 right-3 rounded-full border border-white/25 bg-white/20 px-2.5 py-[3px] text-xs font-semibold tracking-[0.04em] text-white uppercase backdrop-blur-md"
      >
        {{ t('loginV6.createPill') }}
      </span>

      <div class="relative z-10 flex items-center gap-4">
        <!-- Seedling icon in a frosted glass box. Rotates and scales subtly on
             hover — a small moment of delight without going overboard. -->
        <div
          aria-hidden="true"
          class="flex h-16 w-16 flex-none items-center justify-center rounded-[18px] border border-white/25 bg-white/20 text-[2rem] backdrop-blur-md transition-transform duration-300 ease-out group-hover:scale-[1.06] group-hover:-rotate-6"
        >
          🌱
        </div>
        <div class="min-w-0 flex-1">
          <p
            class="font-outfit mb-1 text-[0.75rem] font-medium tracking-[0.08em] text-white/80 uppercase"
          >
            {{ t('loginV6.createTagline') }}
          </p>
          <p class="font-outfit mb-1 text-xl font-bold tracking-tight text-white">
            {{ t('loginV6.createTitle') }}
          </p>
          <p class="text-sm leading-snug text-white/90">
            {{ t('loginV6.createSubtitle') }}
          </p>
        </div>
        <!-- Chevron — translates right on hover. -->
        <div
          aria-hidden="true"
          class="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white/20 transition-transform duration-200 group-hover:translate-x-1"
        >
          <svg
            class="h-4 w-4 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
    </LoginChoiceCard>

    <!-- ────────────────────────────────────────────────────────────────
         "Or" divider — hairline gradient lines + tiny uppercase label.
         Signals visual demotion of what follows without lecturing.
         ──────────────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-3" aria-hidden="true">
      <span
        class="dark:via-ink-faint/30 h-px flex-1 bg-gradient-to-r from-transparent via-gray-400/30 to-transparent"
      ></span>
      <span
        class="font-outfit dark:text-ink-faint text-xs font-medium tracking-[0.15em] text-gray-500/70 uppercase"
      >
        {{ t('loginV6.orDivider') }}
      </span>
      <span
        class="dark:via-ink-faint/30 h-px flex-1 bg-gradient-to-r from-transparent via-gray-400/30 to-transparent"
      ></span>
    </div>

    <!-- ────────────────────────────────────────────────────────────────
         SECONDARY ROW: Sign In + Join. Equal-weight pair, visibly quieter
         than the Create hero above. Each carries a 3px left accent strip
         in its own brand colour (slate for Sign In, Sky Silk for Join)
         and a faint radial halo behind the icon — gives them belonging
         to the brand family without competing with the Create gradient.
         ──────────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-3">
      <!-- Sign In (welcome back, waving hand emoji) -->
      <LoginChoiceCard
        :aria-label="t('loginV6.signInTitle')"
        class="hover:border-primary-500/20 dark:border-line-strong dark:bg-surface-raised relative overflow-hidden rounded-[18px] border border-gray-200/80 bg-white p-4 shadow-[0_6px_24px_-8px_rgba(44,62,80,0.12)] hover:shadow-[0_12px_32px_-8px_rgba(44,62,80,0.18)]"
        @click="emit('navigate', 'load-pod')"
      >
        <!-- 3px left accent strip in slate (foundation colour). -->
        <span
          aria-hidden="true"
          class="from-secondary-500 to-secondary-500/40 absolute top-0 bottom-0 left-0 w-[3px] bg-gradient-to-b"
        ></span>
        <!-- Faint warm halo upper-right. -->
        <span
          aria-hidden="true"
          class="pointer-events-none absolute -top-[40%] -right-[30%] h-[180%] w-[60%] opacity-50"
          style="background: radial-gradient(ellipse, rgb(241 93 34 / 5%) 0%, transparent 60%)"
        ></span>
        <div class="relative">
          <div
            class="bg-secondary-500/[0.07] dark:bg-surface-overlay mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            aria-hidden="true"
          >
            {{ '👋' }}
          </div>
          <p class="font-outfit dark:text-ink text-sm font-bold tracking-tight text-gray-900">
            {{ t('loginV6.signInTitle') }}
          </p>
          <p class="dark:text-ink-soft mt-0.5 text-xs leading-snug text-gray-500">
            {{ t('loginV6.signInSubtitle') }}
          </p>
        </div>
      </LoginChoiceCard>

      <!-- Join (heart letter emoji = "someone sent you a join link") -->
      <LoginChoiceCard
        :aria-label="t('loginV6.joinTitle')"
        class="hover:border-primary-500/20 dark:border-line-strong dark:bg-surface-raised relative overflow-hidden rounded-[18px] border border-gray-200/80 bg-white p-4 shadow-[0_6px_24px_-8px_rgba(44,62,80,0.12)] hover:shadow-[0_12px_32px_-8px_rgba(44,62,80,0.18)]"
        @click="emit('navigate', 'join')"
      >
        <!-- 3px left accent strip in Sky Silk. -->
        <span
          aria-hidden="true"
          class="from-sky-silk-300 absolute top-0 bottom-0 left-0 w-[3px] bg-gradient-to-b to-[#5dade2]"
        ></span>
        <!-- Faint cool halo upper-right. -->
        <span
          aria-hidden="true"
          class="pointer-events-none absolute -top-[40%] -right-[30%] h-[180%] w-[60%] opacity-50"
          style="background: radial-gradient(ellipse, rgb(174 214 241 / 18%) 0%, transparent 60%)"
        ></span>
        <div class="relative">
          <div
            class="bg-sky-silk-300/30 dark:bg-sky-silk-300/10 mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            aria-hidden="true"
          >
            {{ '💌' }}
          </div>
          <p class="font-outfit dark:text-ink text-sm font-bold tracking-tight text-gray-900">
            {{ t('loginV6.joinTitle') }}
          </p>
          <p class="dark:text-ink-soft mt-0.5 text-xs leading-snug text-gray-500">
            {{ t('loginV6.joinSubtitle') }}
          </p>
        </div>
      </LoginChoiceCard>
    </div>

    <div class="mt-2 text-center">
      <!-- Marketing homepage now lives on the Astro site at the apex, not in
           the Vue app. Cross-origin nav via anchor — no SPA routing. -->
      <a
        :href="MARKETING_HOME_URL"
        class="font-outfit dark:border-line-strong dark:bg-surface-raised dark:text-ink-soft inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-500 no-underline shadow-sm transition-all hover:border-[var(--heritage-orange)] hover:text-[var(--heritage-orange)] hover:shadow-md dark:hover:border-[var(--heritage-orange)] dark:hover:text-[var(--heritage-orange)]"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {{ t('homepage.learnMore') }}
      </a>
    </div>

    <!-- REVIEW-DEMO: app-review access. Rendered ONLY in a build that was
         deliberately armed AND is still inside its expiry window, so it is
         absent from every web, dev, self-host and expired build. Intentionally
         a plain labelled button rather than a hidden tap-count gesture: a
         reviewer following written instructions handles a visible control far
         more reliably, and a gesture would be untestable and inaccessible.
         Delete this block when demo mode is retired. -->
    <div v-if="isReviewDemoAvailable()" class="mt-3 text-center">
      <button
        type="button"
        class="font-outfit dark:text-ink-faint rounded-full px-3 py-1.5 text-xs font-semibold text-gray-400 underline-offset-2 transition-colors hover:text-[var(--heritage-orange)] hover:underline dark:hover:text-[var(--heritage-orange)]"
        @click="emit('navigate', 'review-demo')"
      >
        {{ t('reviewDemo.entry') }}
      </button>
    </div>

    <!-- Subtle build/version marker. Lets us confirm which deployed bundle is
         running on a device (e.g. an iPhone PWA that may be serving a stale
         cached version). The short SHA matches the `Build:` field in the error
         reporter, so a Slack alert can be cross-referenced against the running
         build. Decorative/diagnostic value — not translated. -->
    <p class="dark:text-ink-faint mt-1 text-center text-xs tracking-wide text-gray-400 select-all">
      {{ buildVersion }}
    </p>
  </div>
</template>
