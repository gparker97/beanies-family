<script setup lang="ts">
/**
 * `/recipe#<payload>` — a recipe someone was sent (#92).
 *
 * The whole recipe is in the URL fragment, so this page needs no account, no pod and no
 * network. It decodes what is already in the address bar and renders it.
 *
 * THE RECIPE COMES FIRST, THE INVITATION SECOND. Most people who open this link will never
 * sign up, and they should still get exactly what their friend meant to send. The offer
 * lives in a sticky bar that is always one tap away and never in the way — never a sign-in
 * wall in front of the content.
 *
 * ⚠️ NO ORACLE. Every decode failure except `unsupported-version` collapses into one
 * identical dead-end. The discriminated `reason` goes to telemetry, never to the screen: a
 * "which part was malformed" signal shown to whoever holds the link tells an attacker which
 * of their probes got closer.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { showToast } from '@/composables/useToast';
import { decodeRecipeShare, type SharedRecipeFields } from '@/utils/recipeShareLink';
import { stashKeptRecipe, KEPT_RECIPE_DESTINATION } from '@/utils/recipeKeepStash';
import { getUrlDomain, safeHttpsUrl } from '@/utils/url';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const authStore = useAuthStore();

type State = 'recipe' | 'dead-end' | 'stale';

const state = ref<State>('dead-end');
const fields = ref<SharedRecipeFields | null>(null);

// Decoded ONCE, in setup rather than `onMounted`. The fragment is already in the address
// bar, so there is nothing to wait for — and mounting first would paint the dead-end for a
// frame before the recipe replaced it, which is a bad first impression of the product for
// exactly the person we are trying to win over. `route.hash` includes the leading '#'.
{
  const raw = route.hash.startsWith('#') ? route.hash.slice(1) : route.hash;
  const result = decodeRecipeShare(raw);

  if (result.ok) {
    fields.value = result.fields;
    state.value = 'recipe';
    logEvent({
      level: 'info',
      surface: 'recipe-share',
      message: 'shared recipe opened',
      context: { action: 'received_opened', ingredient_count: result.fields.ingredients.length },
    });
  } else {
    // An unknown version is the one failure with a real, actionable answer, so it gets its
    // own screen. Everything else is the single dead-end.
    state.value = result.reason === 'unsupported-version' ? 'stale' : 'dead-end';
    logEvent({
      level: 'warn',
      surface: 'recipe-share',
      message: 'shared recipe link could not be decoded',
      // `detail` names which check refused — a developer diagnostic, never rendered.
      context: { action: 'received_undecodable', error_code: 'bad-payload', detail: result.reason },
    });
  }
}

/** Re-screened at the binding, not trusted from the decode. */
const sourceHref = computed(() => safeHttpsUrl(fields.value?.sourceUrl ?? null));

/**
 * Does this visitor already have a pod? `isAuthenticated && podCreated` — the same pair
 * `needsPodSetup` is derived from. Anything else (signed out, or signed in mid-onboarding)
 * goes to `/welcome`, which is where an unfinished setup belongs anyway.
 */
const hasPod = computed(() => authStore.isAuthenticated && authStore.podCreated);

/** Prep · Cook · Serves, only the parts that exist. */
const hasMeta = computed(
  () => !!(fields.value?.prepTime || fields.value?.cookTime || fields.value?.servings)
);

/**
 * Keep it. One code path for both cases — the only difference is where the user goes next.
 * The recipe is NOT written to a pod here: it is stashed, and `FamilyCookbookPage` opens the
 * normal review form with it, which is the same rule the inbound share boundary already
 * follows ("nothing is persisted without the user confirming it in a review modal").
 */
function keep() {
  if (!fields.value) return;

  if (!stashKeptRecipe(fields.value)) {
    // Storage refused it. Say so rather than routing to a cookbook that will be empty —
    // the link is still in their chat, so the recovery is real and one tap long.
    showToast(
      'error',
      t('recipeShare.received.keepFailed'),
      t('recipeShare.received.keepFailedHelp')
    );
    return;
  }

  logEvent({
    level: 'info',
    surface: 'recipe-share',
    message: 'shared recipe kept',
    context: { action: 'received_kept', kind: hasPod.value ? 'existing_pod' : 'new_user' },
  });

  router.push(hasPod.value ? KEPT_RECIPE_DESTINATION : '/welcome');
}
</script>

<template>
  <div class="dark:bg-surface-ground min-h-dvh bg-[#fbf3e3]">
    <!-- ── The recipe ──────────────────────────────────────────────────────── -->
    <template v-if="state === 'recipe' && fields">
      <!-- Sticky bottom offer. Padding below the content keeps it clear of the bar. -->
      <div class="mx-auto max-w-2xl px-4 pt-6 pb-32 sm:px-6">
        <!-- Provenance. A slim line, not a hero: the dish is what they came for. -->
        <p
          class="font-inter text-secondary-500/70 dark:text-ink-soft flex items-center gap-2 text-xs"
        >
          <span aria-hidden="true">🌱</span>
          <span>{{ t('recipeShare.received.eyebrow') }}</span>
        </p>
        <p class="font-inter text-secondary-500/50 dark:text-ink-faint mt-0.5 text-xs">
          {{ t('recipeShare.received.from') }}
        </p>

        <h1 class="font-outfit text-secondary-500 dark:text-ink mt-4 text-3xl font-bold">
          {{ fields.name }}
        </h1>
        <p
          v-if="fields.subtitle"
          class="font-caveat text-primary-500 dark:text-accent-lift mt-1 text-lg"
        >
          {{ fields.subtitle }}
        </p>

        <div
          v-if="hasMeta"
          class="font-inter text-secondary-500/70 dark:text-ink-soft mt-3 flex flex-wrap gap-3 text-xs"
        >
          <span v-if="fields.prepTime">
            🕐
            <strong class="font-outfit text-secondary-500 dark:text-ink font-semibold">{{
              fields.prepTime
            }}</strong>
          </span>
          <span v-if="fields.cookTime">
            🔥
            <strong class="font-outfit text-secondary-500 dark:text-ink font-semibold">{{
              fields.cookTime
            }}</strong>
          </span>
          <span v-if="fields.servings">
            🍽️
            <strong class="font-outfit text-secondary-500 dark:text-ink font-semibold">{{
              fields.servings
            }}</strong>
          </span>
        </div>

        <section
          v-if="fields.ingredients.length"
          class="dark:bg-surface-raised mt-6 rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)]"
        >
          <h2 class="font-outfit text-secondary-500 dark:text-ink mb-3 text-sm font-bold">
            🌿 {{ t('recipeShare.received.ingredients') }}
          </h2>
          <ul class="space-y-1">
            <li
              v-for="(ing, i) in fields.ingredients"
              :key="i"
              class="font-inter text-secondary-500/80 dark:text-ink-soft text-sm leading-relaxed"
            >
              · {{ ing }}
            </li>
          </ul>
        </section>

        <section
          v-if="fields.steps.length"
          class="dark:bg-surface-raised mt-5 rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)]"
        >
          <h2 class="font-outfit text-secondary-500 dark:text-ink mb-3 text-sm font-bold">
            📋 {{ t('recipeShare.received.method') }}
          </h2>
          <ol class="space-y-2">
            <li
              v-for="(step, i) in fields.steps"
              :key="i"
              class="font-inter text-secondary-500/80 dark:text-ink-soft text-sm leading-relaxed"
            >
              <strong class="font-outfit text-primary-500 dark:text-accent-lift font-semibold"
                >{{ i + 1 }}.</strong
              >
              {{ step }}
            </li>
          </ol>
        </section>

        <section
          v-if="fields.notes"
          class="dark:bg-surface-raised mt-5 rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)]"
        >
          <h2 class="font-outfit text-secondary-500 dark:text-ink mb-2 text-sm font-bold">
            📝 {{ t('recipeShare.received.notes') }}
          </h2>
          <p
            class="font-inter text-secondary-500/80 dark:text-ink-soft text-sm leading-relaxed whitespace-pre-line"
          >
            {{ fields.notes }}
          </p>
        </section>

        <a
          v-if="sourceHref"
          :href="sourceHref"
          target="_blank"
          rel="noopener noreferrer"
          class="font-inter text-secondary-500/70 hover:text-primary-500 dark:text-ink-soft mt-5 inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <span aria-hidden="true">🔗</span>
          <span>{{ t('recipeShare.received.source') }}</span>
          <strong
            class="font-outfit text-primary-500 dark:text-accent-lift font-semibold underline underline-offset-2"
          >
            {{ getUrlDomain(fields.sourceUrl ?? '') }}
          </strong>
        </a>
      </div>

      <!-- The offer. Always on screen, never in front of the recipe. -->
      <div
        class="dark:border-line-strong dark:bg-surface-raised/95 fixed inset-x-0 bottom-0 border-t border-[var(--color-sky-silk-300)]/40 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6"
      >
        <div class="mx-auto flex max-w-2xl flex-col gap-2">
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 w-full rounded-2xl bg-gradient-to-r px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
            data-testid="shared-recipe-keep"
            @click="keep"
          >
            {{ t('recipeShare.received.keep') }}
          </button>
          <p class="font-inter text-secondary-500/60 dark:text-ink-faint text-center text-xs">
            {{ t('recipeShare.received.keepHint') }}
            <a
              href="https://beanies.family"
              class="text-primary-500 dark:text-accent-lift font-semibold underline underline-offset-2"
            >
              {{ t('recipeShare.received.what') }}
            </a>
          </p>
          <!-- Stated BEFORE sign-up, deliberately. On the one journey the stash cannot
               survive (the iOS Drive OAuth hop clears script-writable storage), any marker
               saying "a keep was in flight" would live in the storage that was just wiped —
               so a message afterwards could never fire. -->
          <p
            v-if="!hasPod"
            class="font-inter text-secondary-500/50 dark:text-ink-faint text-center text-xs"
          >
            {{ t('recipeShare.received.keepAcrossSignup') }}
          </p>
        </div>
      </div>
    </template>

    <!-- ── Dead ends. One message for every decode failure but a stale build. ── -->
    <div v-else class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <p class="text-4xl" aria-hidden="true">🌱</p>
      <h1 class="font-outfit text-secondary-500 dark:text-ink mt-4 text-xl font-bold">
        {{
          state === 'stale'
            ? t('recipeShare.received.staleTitle')
            : t('recipeShare.received.deadEndTitle')
        }}
      </h1>
      <p class="font-inter text-secondary-500/70 dark:text-ink-soft mt-2 text-sm leading-relaxed">
        {{
          state === 'stale'
            ? t('recipeShare.received.staleBody')
            : t('recipeShare.received.deadEndBody')
        }}
      </p>
      <a
        href="https://beanies.family"
        class="font-outfit text-primary-500 dark:text-accent-lift mt-6 text-sm font-semibold underline underline-offset-2"
      >
        {{ t('recipeShare.received.explore') }}
      </a>
    </div>
  </div>
</template>
