<script setup lang="ts">
/**
 * The celebratory "what's new" detail body. Renders inside the shared
 * `CelebrationDetail` shell (hero + Pod + greg's sign-off + footer); this
 * component owns only the CONTENT: the headline + detail blocks (the general
 * rule — single = centred, several = a "beanstalk" list), an optional "also
 * fixed" list, and the see-all footer.
 *
 * Resolves its own `release` from the notification's `sourceId` (like
 * `AnnouncementBody`), so `NotificationDetail` hands every rich body the same
 * `:notification` prop.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBeanieText } from '@/composables/useBeanieText';
import { MARKETING_URL } from '@/utils/marketing';
import { openExternal } from '@/utils/openExternal';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import { getReleaseNote } from '@/content/release-notes';
import CelebrationDetail from '@/components/notifications/CelebrationDetail.vue';
import type { AppNotification } from '@/types/notifications';
import { logEvent } from '@/services/telemetry/logEvent';

const props = defineProps<{ notification: AppNotification }>();

const router = useRouter();
const store = useNotificationsStore();
const { t } = useTranslation();
const { txt } = useBeanieText();

const release = computed(() =>
  props.notification.sourceId ? getReleaseNote(props.notification.sourceId) : undefined
);

/**
 * The note's headline + detail blocks. One block reads as a focused
 * announcement; several hang off a "beanstalk" stalk. No blocks (a legacy /
 * minor summary-only note) falls back to its centred `summary` message.
 */
const blocks = computed(() => release.value?.features ?? []);

/**
 * Per-block description split for an optional inline `descriptionLink`. `null`
 * when the block has no link; otherwise `{ lead, accent, trail }` where `accent`
 * is the linked phrase (empty if the phrase isn't found — then it renders as the
 * whole sentence in `lead`, no link).
 */
const blockParts = computed(() =>
  blocks.value.map((f) =>
    f.descriptionLink ? splitAroundAccent(txt(f.description), txt(f.descriptionLink.phrase)) : null
  )
);

const isMulti = computed(() => blocks.value.length > 1);
const isSingle = computed(() => blocks.value.length === 1);
const fixes = computed(() => release.value?.fixes ?? []);
const summaryText = computed(() => (release.value?.summary ? txt(release.value.summary) : ''));

async function handleTryIt(route: string) {
  store.close();
  // `router.push` reports guard cancellations as a RESOLVED NavigationFailure —
  // swallowed, this read as "tapping the button does nothing" (0.13R2 field bug:
  // the first post-login tap can land while a guard, e.g. the critical-write
  // block, rejects navigation). Await it, retry once after a beat, and log the
  // failure so the real guard is identifiable from CloudWatch if it recurs.
  const failure = await Promise.resolve(router.push(route)).catch((e) => e);
  if (failure) {
    logEvent({
      level: 'warn',
      surface: 'notifications',
      message: 'whats-new CTA navigation was cancelled — retrying once',
      context: { action: 'tryit_nav_cancelled', detail: String(failure).slice(0, 120) },
    });
    await new Promise((r) => setTimeout(r, 400));
    await Promise.resolve(router.push(route)).catch(() => {});
  }
}

function handleSeeAll() {
  openExternal(`${MARKETING_URL}/help/whats-new`);
}
</script>

<template>
  <CelebrationDetail v-if="release" :date-label="release.month" :signature="release.signature">
    <template #kick>
      ✨ {{ t('notifications.kindWhatsNew')
      }}<span v-if="isMulti">
        · {{ t('whatsNew.updateCount').replace('{n}', String(blocks.length)) }}</span
      >
    </template>

    <!-- legacy / minor summary-only note: just the centred message -->
    <p v-if="blocks.length === 0 && summaryText" class="wn-message">{{ summaryText }}</p>

    <!-- the general rule: headline + detail blocks (single = centred; many = beanstalk) -->
    <template v-else>
      <div class="wn-list" :class="{ single: isSingle }">
        <div v-for="(feature, i) in blocks" :key="i" class="wn-item">
          <span v-if="isSingle && feature.icon" class="wn-item-emoji" aria-hidden="true">
            {{ feature.icon }}
          </span>
          <h4 class="wn-item-title">{{ txt(feature.title) }}</h4>
          <!-- description: plain text, or split around an inline external link -->
          <p v-if="blockParts[i] && blockParts[i]!.accent" class="wn-item-desc">
            <span>{{ blockParts[i]!.lead }}</span
            ><button
              type="button"
              class="wn-inline-link"
              @click="openExternal(feature.descriptionLink!.href)"
            >
              {{ blockParts[i]!.accent }}</button
            ><span>{{ blockParts[i]!.trail }}</span>
          </p>
          <p v-else class="wn-item-desc">{{ txt(feature.description) }}</p>
          <button
            v-if="feature.tryItRoute"
            class="wn-tryit"
            @click="handleTryIt(feature.tryItRoute!)"
          >
            {{ feature.tryItLabel ? txt(feature.tryItLabel) : t('whatsNew.tryIt')
            }}<span class="wn-tryit-arrow">→</span>
          </button>
          <button v-if="feature.cta" class="wn-tryit" @click="openExternal(feature.cta.href)">
            {{ txt(feature.cta.label) }}<span class="wn-tryit-arrow">↗</span>
          </button>
        </div>
      </div>

      <template v-if="fixes.length">
        <div class="wn-fixes-label">{{ t('whatsNew.alsoFixed') }}</div>
        <ul class="wn-fixes">
          <li v-for="(fix, i) in fixes" :key="i">{{ txt(fix.text) }}</li>
        </ul>
      </template>
    </template>

    <template #footer>
      <button class="wn-seeall" @click="handleSeeAll">{{ t('whatsNew.seeAll') }} →</button>
      <div class="wn-tagline">{{ t('app.tagline') }}</div>
    </template>
  </CelebrationDetail>
</template>

<style scoped>
/* the message (legacy / minor summary-only note) — centred in the flex region */
.wn-message {
  color: #2c3e50;
  font-family: Inter, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.62;
  margin: auto 0.25rem;
  text-align: center;
}

html.dark .wn-message {
  color: #f2f5f7;
}

/* headline + detail blocks — the "beanstalk list".
   Rules are ordered base → single-variant → multi-variant so specificity
   never descends (stylelint no-descending-specificity). */
.wn-list {
  position: relative;
}

.wn-item {
  position: relative;
}

.wn-item-emoji {
  display: block;
  font-size: 1.625rem;
  margin-bottom: 0.375rem;
  text-align: center;
}

.wn-item-title {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 0.25rem;
}

.wn-item-desc {
  color: rgb(44 62 80 / 62%);
  font-family: Inter, sans-serif;
  font-size: 0.8125rem;
  line-height: 1.58;
  margin: 0;
}

html.dark .wn-item-title {
  color: #f2f5f7;
}

html.dark .wn-item-desc {
  color: rgb(226 232 240 / 70%);
}

/* single block: a focused, centred headline + reason (no stalk) */
.wn-list.single .wn-item {
  text-align: center;
}

.wn-list.single .wn-item-title {
  font-size: 1.0625rem;
  margin-bottom: 0.5rem;
}

.wn-list.single .wn-item-desc {
  font-size: 0.875rem;
  margin: 0 0.25rem;
}

/* the stalk + bean nodes only appear when there are several blocks */
.wn-list:not(.single) {
  padding-left: 1.875rem;
}

.wn-list:not(.single)::before {
  background: linear-gradient(
    180deg,
    rgb(241 93 34 / 55%),
    rgb(230 126 34 / 35%) 70%,
    rgb(230 126 34 / 0%)
  );
  border-radius: 2px;
  bottom: 0.4375rem;
  content: '';
  left: 0.5625rem;
  position: absolute;
  top: 0.4375rem;
  width: 2px;
}

.wn-list:not(.single) .wn-item {
  padding-bottom: 1.125rem;
}

.wn-list:not(.single) .wn-item:last-child {
  padding-bottom: 0;
}

/* the bean node on the stalk */
.wn-list:not(.single) .wn-item::before {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  border-radius: 50% 50% 48% 48%;
  box-shadow:
    0 0 0 4px #fff,
    0 3px 8px -3px rgb(241 93 34 / 70%);
  content: '';
  height: 0.875rem;
  left: -1.6875rem;
  position: absolute;
  top: 0.25rem;
  width: 0.75rem;
}

html.dark .wn-list:not(.single .wn-item::before) {
  box-shadow:
    0 0 0 4px #1e2a36,
    0 3px 8px -3px rgb(241 93 34 / 70%);
}

/* inline external link inside a description (e.g. to a help article) */
.wn-inline-link {
  background: none;
  border: none;
  color: #f15d22;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.wn-inline-link:hover {
  color: #d14d1a;
}

.wn-tryit {
  align-items: center;
  background: var(--tint-orange-8, rgb(241 93 34 / 8%));
  border: none;
  border-radius: 0.625rem;
  color: #f15d22;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.3125rem;
  margin-top: 0.625rem;
  padding: 0.375rem 0.6875rem;
  white-space: nowrap;
}

.wn-tryit:hover {
  background: var(--tint-orange-15, rgb(241 93 34 / 15%));
}

.wn-tryit-arrow {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative arrow glyph paired with adjacent button text */
  font-size: 0.875rem;
}

.wn-fixes-label {
  color: rgb(44 62 80 / 40%);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  margin: 0.75rem 0 0.5rem;
}

.wn-fixes {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding-left: 1rem;
}

.wn-fixes li {
  color: rgb(44 62 80 / 50%);
  font-size: 0.75rem;
}

html.dark .wn-fixes li {
  color: rgb(226 232 240 / 55%);
}

/* Quiet secondary link — "see all" is the rarer, app-leaving action, so it
   sits beneath the primary Done as an understated text link, not a button. */
.wn-seeall {
  background: none;
  border: none;
  color: #f15d22;
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  transition: color 0.15s;
}

.wn-seeall:hover {
  color: #d14d1a;
}

.wn-tagline {
  color: rgb(44 62 80 / 30%);
  font-family: Outfit, sans-serif;
  font-size: 0.625rem;
  font-style: italic;
  letter-spacing: 0.06em;
  margin-top: 0.6875rem;
}

html.dark .wn-tagline {
  color: rgb(226 232 240 / 30%);
}
</style>
