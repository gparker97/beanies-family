/**
 * The shared BRAIN of recipe-link entry (#72).
 *
 * Two surfaces now take a recipe link: the link modal (link-first intake) and the shortcut
 * band at the top of the Add Recipe form. They look deliberately different — one is a whole
 * modal, one is a compact band inside another form — but they must agree exactly on what
 * counts as a valid link, when to complain, and what to say about a video. Sharing the
 * PRESENTATION would have forced one of them into the other's shape; sharing the LOGIC costs
 * nothing and makes disagreement impossible.
 *
 * Validation is the same `routeUrl` the resolver uses, so what the user is told here and what
 * the fetcher will actually accept can never drift apart.
 */
import { computed, ref } from 'vue';
import { routeUrl } from '@/utils/recipeSourceUrl';

export function useRecipeLinkInput() {
  const link = ref('');
  /** Only complain once the user has actually tried, so an empty field is never scolded. */
  const touched = ref(false);

  const route = computed(() => routeUrl(link.value));
  const isValid = computed(() => route.value.kind !== 'invalid');
  const showError = computed(() => touched.value && link.value.trim().length > 0 && !isValid.value);
  /** Tell the user we recognised a video, so the different behaviour is not a surprise. */
  const isVideo = computed(() => route.value.kind === 'youtube');

  /** The single hint line, as a translation key. One place decides which of the three shows. */
  const hintKey = computed(() =>
    showError.value
      ? 'recipeExtract.link.invalid'
      : isVideo.value
        ? 'recipeExtract.link.videoHint'
        : 'recipeExtract.link.hint'
  );

  function reset(): void {
    link.value = '';
    touched.value = false;
  }

  /** Returns the trimmed URL when it is safe to submit, or null when it is not. */
  function trySubmit(): string | null {
    touched.value = true;
    return isValid.value ? link.value.trim() : null;
  }

  return { link, touched, isValid, showError, isVideo, hintKey, reset, trySubmit };
}
