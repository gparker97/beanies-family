<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { getAvatarImagePath } from '@/constants/avatars';
import { resolveMemberColor } from '@/constants/memberColors';
import type { AvatarVariant } from '@/constants/avatars';

/**
 * THE member face. There is exactly one, deliberately.
 *
 * Until 2026-09-02 there were five: this component, `WallMemberFace`,
 * `MemberChip`'s `dot` size, and hand-rolled circles inside `MemberChipFilter`
 * and `FamilyChipPicker`. They differed in exactly one respect — what shows when
 * there is no photo — and were otherwise five copies of a circle, a colour ring,
 * a size scale and a photo overlay. The copies had already drifted: three
 * derived the initial with `charAt(0)` (breaking on emoji names) and
 * `WallMemberFace` shipped its photo WITHOUT `referrerpolicy="no-referrer"`,
 * silently losing the lh3 rate-limit fix every other photo surface carries.
 *
 * So the one axis of variation is a prop, not a component:
 *   fallback="beanie"   → the brand illustration (character, warmth). DEFAULT,
 *                         so all 33 pre-existing usages are unchanged.
 *   fallback="initials" → the member's initials on their own colour (identity).
 *                         Use wherever the job is telling two beans apart — the
 *                         beanie is picked from age group and species, so a
 *                         family with two adults gets identical faces.
 *
 * The two modes also fill the container differently, and must: an initial on a
 * 20%-tint wash has nowhere near enough contrast, so `initials` fills the circle
 * with the member colour and draws the glyph in white, while `beanie` keeps the
 * bordered pastel container an illustration needs.
 */
interface Props {
  /**
   * Avatar variant from the registry. Required in practice for
   * `fallback="beanie"`; optional in the type because `withDefaults` cannot take
   * a discriminated union (it would force every other default off, churning all
   * 24 call-site files). A missing variant in beanie mode is caught loudly at
   * mount instead — see `onMounted` below.
   */
  variant?: AvatarVariant;
  /** What to draw when there is no photo. Defaults to today's behaviour. */
  fallback?: 'beanie' | 'initials';
  /** Display initials, for `fallback="initials"`. Pass `familyStore.initialsById`. */
  initials?: string;
  /** Member's profile color for the ring border + pastel background */
  color?: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Accessible label */
  ariaLabel?: string;
  /**
   * Optional user-uploaded photo URL. When set AND the photo successfully
   * loads, it renders on top of the beanie variant. While loading (or on
   * error), the beanie variant stays visible — no flash. Added 2026-04
   * with The Pod's avatar-photo feature.
   */
  photoUrl?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  variant: undefined,
  fallback: 'beanie',
  initials: '',
  color: '#3b82f6',
  size: 'md',
  ariaLabel: undefined,
  photoUrl: null,
});

/**
 * Emitted when the user-supplied `photoUrl` fails to load. Consumers that
 * resolved the URL from Drive (see `useAvatarPhotoUrl`) listen for this
 * to drop their thumb-URL cache and re-fetch once — the beanie variant
 * stays visible in the meantime, so this is best-effort recovery.
 */
const emit = defineEmits<{
  'photo-error': [];
}>();

// `2xl` was ADDED for WallMemberFace's largest step. The five original values are
// byte-identical on purpose: 24 call-site files depend on them and this change is meant
// to be invisible to every one of them.
const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
  '2xl': 'h-14 w-14',
};

/** Initials scale with the circle; all rem-based, so Large reading mode carries them. */
const TEXT_CLASSES: Record<string, string> = {
  xs: 'text-xs',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-xl',
  '2xl': 'text-lg',
};

const sizeClass = computed(() => SIZE_CLASSES[props.size] || SIZE_CLASSES.md);
const textClass = computed(() => TEXT_CLASSES[props.size] || TEXT_CLASSES.md);
const showInitials = computed(() => props.fallback === 'initials');
const resolvedColor = computed(() => resolveMemberColor(props.color));
const imagePath = computed(() => getAvatarImagePath(props.variant ?? 'adult-other'));
const isFiltered = computed(() => props.variant === 'family-filtered');

/**
 * A beanie with no variant renders the neutral bean, which looks deliberate and
 * is therefore the worst kind of bug — `OnboardingInvitePanel` shipped exactly
 * that for months by passing an invalid `'classic'`. Say so once, loudly.
 */
onMounted(() => {
  if (props.fallback === 'beanie' && !props.variant) {
    console.error(
      '[beanieAvatar] fallback="beanie" requires a `variant` prop — falling back to ' +
        'adult-other, which renders the neutral bean for everyone. Pass ' +
        'getMemberAvatarVariant(member), or set fallback="initials".'
    );
  }
});

// Photo load state — only flips to `true` once the <img> fires `load`. An
// `error` event (Drive 404, CDN hiccup, bad URL) resets it and the beanie
// fallback stays visible.
const photoLoaded = ref(false);
watch(
  () => props.photoUrl,
  () => {
    photoLoaded.value = false;
  }
);
function onPhotoLoad() {
  photoLoaded.value = true;
}
function onPhotoError() {
  photoLoaded.value = false;
  if (props.photoUrl) {
    console.warn('[beanieAvatar] photo failed to load, falling back to beanie', props.photoUrl);
    emit('photo-error');
  }
}
</script>

<template>
  <div
    :class="[sizeClass, 'relative flex-shrink-0 overflow-hidden rounded-full']"
    :style="
      showInitials
        ? { background: resolvedColor }
        : { border: `2px solid ${resolvedColor}`, backgroundColor: `${resolvedColor}20` }
    "
    :aria-label="ariaLabel"
    :aria-hidden="!ariaLabel"
    role="img"
    data-testid="beanie-avatar"
    :data-variant="variant"
    :data-fallback="fallback"
  >
    <!--
      Initials mode fills the circle with the member's colour and draws a white
      glyph. It deliberately does NOT reuse the bordered pastel container above:
      an initial on a 20%-tint wash fails contrast at every size we ship.
    -->
    <span
      v-if="showInitials"
      class="font-outfit grid h-full w-full place-items-center leading-none font-bold text-white"
      :class="textClass"
      aria-hidden="true"
      >{{ initials }}</span
    >
    <img
      v-else
      :src="imagePath"
      :alt="ariaLabel || ''"
      class="h-full w-full object-contain"
      draggable="false"
    />
    <!--
      Optional user photo overlay. Only shows once `load` fires — the
      beanie underneath stays visible during loading and on error.

      `referrerpolicy="no-referrer"` strips the Referer header from the
      request to Google's lh3 CDN. lh3 rate-limits per-Referer; without
      this, dev (Vite default port localhost:5173, shared across
      millions of devs) hits 429 fast since the global per-Referer
      bucket is exhausted. With no-referrer, requests rate-limit by IP
      only — effectively unlimited for a single user. Caught
      2026-05-04 from greg's localhost showing 429 while prod's
      app.beanies.family origin had its own clean bucket.
    -->
    <img
      v-if="photoUrl"
      :src="photoUrl"
      :alt="ariaLabel || ''"
      class="absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
      :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
      draggable="false"
      referrerpolicy="no-referrer"
      @load="onPhotoLoad"
      @error="onPhotoError"
    />
    <!-- Filter badge overlay for family-filtered variant -->
    <div
      v-if="isFiltered"
      class="bg-secondary-500/80 absolute right-0 bottom-0 flex h-[40%] w-[40%] items-center justify-center rounded-full"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        class="h-[60%] w-[60%]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M1 2h14L10 8.5V13l-4 2V8.5L1 2Z" fill="white" opacity="0.9" />
      </svg>
    </div>
  </div>
</template>
