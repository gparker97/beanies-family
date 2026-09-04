/**
 * Wedge orchestration (#72, ADR-030): a recipe source → extraction → a decided prefill,
 * handed to the caller. Mirrors `useDocumentToTravel`'s thin-orchestrator shape.
 *
 * MVO: this exists so `FamilyCookbookPage` stays a view. `TravelPlansPage.vue` is 1920
 * lines precisely because the travel wedge kept its post-extraction orchestration — save,
 * attach, warn-not-rollback — in the page. Everything here that is not "render a component
 * and bind a handler" belongs on this side of the line. The page's whole involvement is
 * `processFile` on pick and `attachAfterSave` on save.
 *
 * Every outcome is explicit and non-silent: offline is guarded, a non-recipe gets a
 * friendly info toast, and every extraction error code maps through the SHARED
 * `useExtractionErrorToast` (no second toast mapper exists for this feature).
 */
import { computed, ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { usePhotos } from './usePhotos';
import { useRecipePhotoPending } from './useRecipePhotoPending';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  extractRecipeFromDocument,
  extractRecipeFromText,
} from '@/services/ai/documentExtractionService';
import { resolveRecipeSource, type ExtractionPath } from '@/services/ai/recipeSourceResolver';
import { routeUrl } from '@/utils/recipeSourceUrl';
import { assertNever } from '@/utils/assertNever';
import {
  jsonLdToPrefill,
  recipeExtractionToPrefill,
  type RecipePrefill,
} from '@/utils/recipeExtractionToRecipe';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { recipeFetchService } from '@/services/ai/recipeFetchService';
import { reportError } from '@/utils/errorReporter';
import type { ConsentGrant } from './useDocumentConsent';
import type {
  DishImagePrefill,
  ImageNoneReason,
  RecipeShareSource,
  ResultEnvelope,
} from '@/types/magicPayload';
import { toShareLink } from '@/utils/shareLink';
import { attachDishImage } from '@/services/ai/attachDishImage';
import { toDateInputValue } from '@/utils/date';
import type { UUID } from '@/types/models';

const SURFACE = 'recipe-extract';

/**
 * What a developer should DO about each `image_none` reason.
 *
 * An enum tells you which branch fired; it does not tell you whether that branch is a bug. A
 * `cloud_required` is a family setting and entirely expected; an `all_failed` concentrated on
 * one rung is a real regression. Console-only, so it never leaves the device.
 */
const HINTS: Record<ImageNoneReason, string> = {
  no_candidates:
    'the page declared no image at all — expected on some sites, and the number worth watching',
  all_failed:
    'candidates were found but none fetched — check error_code; site_refused means the CDN is rejecting our Referer',
  cloud_required:
    'this family has cloud photo storage disabled, so nothing can be stored — expected, not a bug',
  at_cap: 'the recipe already holds the maximum number of photos',
  store_rejected:
    'fetched but not stored; cloud and cap were already ruled out, so this is a decode or upload failure — check sniffImageType against ACCEPTED_MIMES and the usePhotos error above',
};

export interface RecipeReady {
  prefill: RecipePrefill;
  /**
   * The ORIGINAL picked file (image or PDF), attached after save. `null` for a URL
   * capture — there is no document; provenance is the stored `sourceUrl` instead.
   */
  sourceFile: File | null;
}

export interface UseRecipeCaptureOptions {
  /**
   * Called once extraction succeeds with a usable recipe, so the page can open the form.
   * Nothing is created here — the form IS the review step, and the user must press Save.
   */
  onRecipeReady: (ready: RecipeReady) => void;
}

export function useRecipeCapture(options: UseRecipeCaptureOptions) {
  const { tier, byokConfig } = useAiCapability();
  // Family id for the proxy's per-family rate limit (#83). Read here rather than in the AI
  // service, which is deliberately store-free.
  const familyContextStore = useFamilyContextStore();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const recipesStore = useRecipesStore();
  const familyStore = useFamilyStore();

  const isProcessing = ref(false);
  /**
   * True while the source document and dish photo are being attached, AFTER the recipe has
   * saved. Separate from `isProcessing` on purpose: the recipe is already safe on screen, so
   * this must never block the UI — it exists only so the page can say "photo on its way"
   * instead of showing a pictureless recipe for five silent seconds.
   */
  const { markPending, clearPending } = useRecipePhotoPending();
  /** Held between a successful extraction and the save that follows it. */
  const pendingSource = ref<File | null>(null);
  /**
   * Page 1 of the source, already compressed to JPEG by the extraction service.
   *
   * Kept as a FALLBACK because the picker's accept list is wider than the photo store's:
   * `AI_PICKER_ACCEPT` allows `image/*` + PDF, while `usePhotos.add` accepts only
   * jpeg/png/webp/heic/heif or a PDF under 10 MB. So an AVIF/GIF/BMP/TIFF screenshot or a
   * 15 MB scan extracts fine, the form opens fully populated, and then the attach is
   * rejected seconds later and the source is lost with no retry. Attaching the compressed
   * JPEG instead keeps the provenance the user can actually see.
   */
  const pendingCompressed = ref<Blob | null>(null);

  /** Run intake → extract → map for one document (consent already granted by the caller). */
  /**
   * The post-extraction half of the document path: notices, mapping, and the hand-off.
   *
   * Split out of `processFile` (#64) so a SHARED document can be delivered without a second
   * AI call. Unlike the other two wedges this is NOT a pure code move — it also owns the
   * pending-source lifecycle (`pendingSource` / `pendingCompressed`, later consumed by
   * `attachAfterSave`). That state is composable-LOCAL, so a share must be delivered into the
   * SAME `useRecipeCapture()` instance that will later save the recipe, or the source photo
   * is silently lost. The cookbook page's consumer is that instance.
   */
  /**
   * Wrap a delivery so a throw cannot vanish.
   *
   * `deliverX` is called from TWO places: `processFile`, which has a try/catch around it,
   * and the magic-reader consumer, which is a Vue WATCH callback with no catch anywhere in
   * the chain. Splitting the mapping out of `processFile` moved it out from under that catch
   * — the same shape as the incident the catch was originally added for: the spinner clears,
   * the modal never opens, the user is told nothing and CloudWatch records nothing.
   */
  function deliverRecipe(source: RecipeShareSource, env: ResultEnvelope): void {
    try {
      deliverRecipeInner(source, env);
    } catch (err) {
      reportError({
        surface: SURFACE,
        message: 'delivering an extracted recipe threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    }
  }

  function deliverRecipeInner(source: RecipeShareSource, env: ResultEnvelope): void {
    // Drop anything held from a previous capture BEFORE claiming the new source, exactly as
    // `processFile` and `processUrl` do. Without it a shared recipe inherits the dish photo
    // of whatever was captured before it. (The dish image no longer travels this way — it
    // rides on the prefill — but the source FILE still does, and the hazard is the same.)
    discardPendingSource();

    // Loud-but-non-blocking FIRST — before the not-a-recipe return — so a >cap document whose
    // ingredients sat on a dropped page still tells the user. Never silent.
    if (env.truncated) {
      showToast('info', t('ai.pdfTruncated.title'), t('ai.pdfTruncated.message'));
    }

    // A capture read by the ORCHESTRATOR — a share, or the in-app magic-beans button (#84) —
    // never passed through the `start` that `processFile`/`processUrl` log before their
    // await. Log it here instead, so this surface's start/ready pair still balances and a
    // delivery regression stays visible.
    //
    // ⚠️ Tests for PRESENCE, not `=== 'share'`. This read `env.origin === 'share'` until #84
    // widened the field: left as it was, an in-app capture would have silently stopped being
    // compensated and the pair would have quietly gone out of balance again — the exact
    // failure this block exists to prevent, reintroduced by the change that added a second
    // orchestrated door. `detail` names WHICH door, so the two remain separable.
    if (env.origin) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'capture started',
        context: {
          action: 'start',
          kind: env.link?.kind ?? 'document',
          detail: env.origin,
        },
      });
    }

    const link = env.link ?? null;
    // `kind` and `path` come off the envelope so no caller passes them separately.
    const kind = link?.kind ?? 'document';
    const path: ExtractionPath = link?.path ?? 'document';

    // THE PAGE URL, never the provenance URL. This argument is the same-registrable-domain
    // bound on the dish image, not decoration: passing `provenanceUrl` for a video capture
    // compares the blog's photo against youtube.com and silently drops every dish photo.
    // The relabel to `provenanceUrl` happens AFTER mapping, below.
    let prefill: RecipePrefill | null;
    switch (source.via) {
      case 'jsonld':
        if (!link) {
          // Unreachable: `read` only ever constructs `via: 'jsonld'` alongside a link. Throw
          // rather than store an unprovenanced recipe — the caller's catch reports it.
          throw new Error('deliverRecipe: a jsonld recipe arrived with no link');
        }
        // The model is NEVER invoked here — quantities come straight from the site's own
        // structured data, so nothing can be hallucinated and nothing is inferred.
        prefill = jsonLdToPrefill(source.recipe, link.pageUrl);
        break;
      case 'extraction':
        prefill = recipeExtractionToPrefill(source.data);
        break;
      case 'titleOnly':
        // Deliberately the ONLY fabricated prefill in this file, and it fabricates nothing:
        // the name is the video's own title and everything else is left empty for the user.
        // Confidence is 1 on the name because it is quoted, not inferred, and 0 elsewhere
        // because there is nothing there — the review form reads these to decide what to
        // flag for checking.
        prefill = {
          fields: { name: source.title, ingredients: [], steps: [] },
          inferredIngredients: [],
          inferredSteps: [],
          // No model output on this rung, so nothing was offered and nothing was rejected.
          taxonomyRejected: [],
          dishImage: null,
          confidence: { name: 1, ingredients: 0, steps: 0 },
        };
        break;
      default:
        return assertNever(source, 'recipeShareSource');
    }

    if (!prefill) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'source was not a recipe',
        context: {
          action: 'not_recipe',
          kind,
          ...(link ? { extraction_path: path } : {}),
        },
      });
      showToast('info', t('recipeExtract.notRecipe.title'), t('recipeExtract.notRecipe.message'));
      return;
    }

    if (link) {
      // Relabel AFTER mapping. For a video we store the VIDEO the user shared, not the blog
      // the ladder followed out of its description: they chose the video, they recognise it,
      // and its description links the blog anyway.
      //
      // (`pageUrl` is no longer an image BOUND — #86 removed that — but the two URLs remain
      // distinct: `pageUrl` is what we read and what the Referer reports, `provenanceUrl` is
      // what we store and show.)
      prefill.fields.sourceUrl = link.provenanceUrl;
      // THE ONE PLACE `dishImage` IS ASSIGNED (#86). Three write sites collapsed to this one,
      // and it sits inside the `if (link)` that already knows both the link and its kind —
      // which is exactly the code that knows whether a source page existed at all. That fact
      // is what lets the caller tell "the page declared no images" from "there was no page";
      // an empty `candidates` here is meaningful, a null `dishImage` is a different thing.
      prefill.dishImage = {
        kind: link.kind,
        candidates: link.imageCandidates,
        pageUrl: link.pageUrl,
      };
    }

    pendingSource.value = env.sourceFile;
    pendingCompressed.value = env.compressedBlob ?? null;
    handOver(prefill, kind, path, env.sourceFile);
  }

  async function processFile(file: File, grant: ConsentGrant): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    // Same reasoning as processUrl: drop anything held from a previous capture first.
    discardPendingSource();

    isProcessing.value = true;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'capture started',
      context: { action: 'start', kind: 'document' },
    });
    try {
      const result = await extractRecipeFromDocument(file, {
        tier: tier.value,
        todayIso: toDateInputValue(new Date()),
        byok: byokConfig.value ?? undefined,
        grant,
        familyId: familyContextStore.activeFamilyId ?? undefined,
      });

      if (!result.success || !result.data) {
        logEvent({
          level: 'error',
          surface: SURFACE,
          message: 'extraction failed',
          context: { action: 'failed', kind: 'document', error_code: result.errorCode },
        });
        reportExtractionFailure(result.errorCode);
        return;
      }

      deliverRecipe(
        { via: 'extraction', data: result.data },
        { sourceFile: file, compressedBlob: result.compressedBlob, truncated: result.truncated }
      );
    } catch (err) {
      // NO SILENT FAILURES (docs/lessons.md). Every call site does `void capture.processX()`,
      // so without this a throw is an unhandled rejection: the spinner vanishes, the form is
      // blank, the user is told nothing and CloudWatch records nothing. Every other outcome
      // in this function is logged; the throw path was the one gap, and it is the one that
      // fires when the Lambda's response shape drifts (the client casts that JSON unchecked).
      reportError({
        surface: SURFACE,
        message: 'recipe capture threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * The one place a finished prefill reaches the caller, so the document and URL paths
   * cannot drift in what they log or what they hand over.
   */
  function handOver(
    prefill: RecipePrefill,
    kind: 'document' | 'page' | 'youtube',
    path: ExtractionPath,
    sourceFile: File | null
  ): void {
    const gotCourse = Boolean(prefill.fields.course);
    const gotMeals = (prefill.fields.mealSlots?.length ?? 0) > 0;

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'recipe ready for review',
      context: {
        action: 'ready',
        kind,
        // Which rung produced this. The field that makes "the recipe came out wrong"
        // answerable — it says whether values were PARSED or INFERRED.
        extraction_path: path,
        inferred_count: prefill.inferredIngredients.length + prefill.inferredSteps.length,
        ingredient_count: prefill.fields.ingredients.length,
        // `detail` is a per-action key across this surface; HERE it is the taxonomy outcome
        // (#87) — which of course/meal the model filled in. Riding the existing success event
        // rather than adding a second per-capture one keeps the firehose volume flat while
        // still making the fill RATE measurable, which a failure-only event could never do.
        detail:
          gotCourse && gotMeals
            ? 'both'
            : gotCourse
              ? 'course_only'
              : gotMeals
                ? 'meal_only'
                : 'none',
      },
    });

    // The event that matters. Without it a model drifting to "Main Course" or "brunch" is
    // indistinguishable from one that simply declined — both present as "the AI never fills
    // this in". The developer-facing WHY is the console.warn in `validatedTaxonomy`.
    if (prefill.taxonomyRejected.length > 0) {
      const rejectedCourse = prefill.taxonomyRejected.includes('course');
      const rejectedMeal = prefill.taxonomyRejected.includes('meal');
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'model returned an unusable course or meal slot',
        context: {
          action: 'taxonomy_rejected',
          kind,
          extraction_path: path,
          detail: rejectedCourse && rejectedMeal ? 'both' : rejectedCourse ? 'course' : 'meal',
        },
      });
    }

    options.onRecipeReady({ prefill, sourceFile });
  }

  /**
   * Capture from a pasted URL — a recipe page or a YouTube video (#72 phases 2/3).
   *
   * The whole ladder lives in `resolveRecipeSource`; this is a flat switch over its four
   * outcomes, closed with `assertNever` so a fifth variant fails the BUILD.
   */
  async function processUrl(rawUrl: string, grant: ConsentGrant): Promise<void> {
    if (isProcessing.value) return;
    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    // The route is known BEFORE any network call. Both branches of the old ternary were
    // 'page', so `handOver`'s 'youtube' kind was unreachable and CloudWatch could not tell a
    // video capture from a page one. And `start` must be logged BEFORE the await, or a
    // failure has no denominator — you cannot compute a rate from outcomes alone.
    const route = routeUrl(rawUrl);
    const kind = route.kind === 'youtube' ? 'youtube' : 'page';

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'capture started',
      context: { action: 'start', kind },
    });

    // Clear every held artefact before starting. Without this a previous capture's source
    // file or dish photo survives and is attached to whatever the user saves next.
    discardPendingSource();

    isProcessing.value = true;
    try {
      const resolved = await resolveRecipeSource(rawUrl);

      switch (resolved.kind) {
        case 'jsonld': {
          deliverRecipe(
            { via: 'jsonld', recipe: resolved.recipe },
            { sourceFile: null, link: toShareLink(resolved, route) }
          );
          return;
        }
        case 'text': {
          const result = await extractRecipeFromText(resolved.text, {
            tier: tier.value,
            todayIso: toDateInputValue(new Date()),
            byok: byokConfig.value ?? undefined,
            grant,
            familyId: familyContextStore.activeFamilyId ?? undefined,
          });
          if (!result.success || !result.data) {
            logEvent({
              level: 'error',
              surface: SURFACE,
              message: 'extraction failed',
              context: { action: 'failed', kind, error_code: result.errorCode },
            });
            reportExtractionFailure(result.errorCode);
            return;
          }
          deliverRecipe(
            { via: 'extraction', data: result.data },
            { sourceFile: null, link: toShareLink(resolved, route) }
          );
          return;
        }
        case 'titleOnly': {
          // The video's recipe is only spoken aloud. Hand over what we do know — the name
          // and the link — and tell the user plainly why the rest is blank, so an empty
          // form does not read as a failure.
          showToast(
            'info',
            t('recipeExtract.titleOnly.title'),
            t('recipeExtract.titleOnly.message')
          );
          deliverRecipe(
            { via: 'titleOnly', title: resolved.title },
            {
              sourceFile: null,
              // Via `toShareLink`, not a hand-built literal — so this path picks up the
              // video thumbnails (#86). It is the one capture with no page to read, and so
              // the one that used to be guaranteed no picture at all.
              link: toShareLink(resolved, { kind: 'youtube', url: resolved.sourceUrl }),
            }
          );
          return;
        }
        case 'refusal': {
          logEvent({
            level: 'warn',
            surface: SURFACE,
            message: 'refused to guess a recipe',
            context: { action: 'refused', kind, error_code: resolved.reason },
          });
          const isVideo = resolved.reason === 'no_text_no_link';
          showToast(
            'info',
            t(isVideo ? 'recipeExtract.noTranscript.title' : 'recipeExtract.badLink.title'),
            t(isVideo ? 'recipeExtract.noTranscript.message' : 'recipeExtract.badLink.message')
          );
          return;
        }
        case 'failed': {
          logEvent({
            level: 'error',
            surface: SURFACE,
            message: 'content fetch failed',
            context: { action: 'failed', kind, error_code: resolved.errorCode },
          });
          reportExtractionFailure(resolved.errorCode);
          return;
        }
        default:
          return assertNever(resolved, 'resolveRecipeSource');
      }
    } catch (err) {
      // NO SILENT FAILURES (docs/lessons.md). Every call site does `void capture.processX()`,
      // so without this a throw is an unhandled rejection: the spinner vanishes, the form is
      // blank, the user is told nothing and CloudWatch records nothing. Every other outcome
      // in this function is logged; the throw path was the one gap, and it is the one that
      // fires when the Lambda's response shape drifts (the client casts that JSON unchecked).
      reportError({
        surface: SURFACE,
        message: 'recipe capture threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Attach the source document to the recipe the user just saved.
   *
   * Goes through `usePhotos`, NOT `photoStore.addPhoto` directly: `Recipe` carries
   * `photoIds`, so a bare `addPhoto` would upload the file to Drive and never link it to
   * the recipe — an attachment that exists and is permanently invisible. (The travel flow
   * can call `addPhoto` directly only because vacation segments have no `photoIds` array.)
   * `usePhotos.add` also already owns the cloud-required check, mime + magic-byte
   * validation, the per-set cap, and warn-not-rollback per file.
   *
   * Warn-not-rollback: a failed attach never undoes the saved recipe.
   */
  async function attachAfterSave(
    recipeId: UUID,
    /**
     * ⚠️ USE THIS ARGUMENT. Never re-read it from a ref inside the async body.
     *
     * `RecipeFormModal.handleSave` calls this UNAWAITED and then immediately emits `close`,
     * which fires the watcher that nulls its `dishImage` ref. The object is passed by
     * reference and stays valid; the moment anyone "tidies" this into reading the ref, every
     * dish image stops attaching and does so silently.
     *
     * OWNERSHIP (#86 §7): the dish image is owned by `RecipeFormModal` on every route, while
     * the source FILE stays owned by whichever capture instance produced it. That asymmetry
     * is forced by their lifetimes — the file never leaves its instance, the candidates are
     * delivered INTO the form as a prefill by either instance — and it is what makes a double
     * attach structurally impossible: exactly one expression in the codebase passes this.
     */
    dishImage: DishImagePrefill | null = null
  ): Promise<void> {
    const file = pendingSource.value;
    const compressed = pendingCompressed.value;
    pendingSource.value = null;
    pendingCompressed.value = null;
    if (!file && !dishImage) return; // manual save with no AI source — nothing to attach
    // Mark the RECIPE, not the page: the card and the detail hero both read this, so the
    // waiting state reaches the user wherever they are looking. Only when we will actually
    // try for a photo — a source-file attach is invisible and needs no hero placeholder.
    const marked = (dishImage?.candidates.length ?? 0) > 0;
    if (marked) markPending(recipeId);
    try {
      await runAttach(recipeId, file, compressed, dishImage);
    } finally {
      // ONE exit point, wrapping the WHOLE attach.
      //
      // This used to be a `finally` on the inner source-file try, which the dish-image-only
      // path never reached: a pasted link produces an image and NO file, so `if (!file)
      // return` jumped clean over it and left the recipe marked pending forever. Pinned by
      // "CLEARS pending on the dish-image-only path" in the tests.
      //
      // CONDITIONAL since #86 §7. Both capture instances run an attach for one save, so an
      // instance handling only a source file must not clear a marker set by the other
      // instance's still-running dish fetch — that would blink "photo on its way" off early.
      // Latent rather than live today (no path produces both a file and a link), but it turns
      // an invariant that is true by accident into one true by construction.
      if (marked) clearPending(recipeId);
    }
  }

  /** The attach itself. Split out so the flag above has exactly one place to be cleared. */
  async function runAttach(
    recipeId: UUID,
    file: File | null,
    compressed: Blob | null,
    dishImage: DishImagePrefill | null
  ): Promise<void> {
    const photos = usePhotos({
      collection: 'recipes',
      entityId: recipeId,
      photoIds: computed(() => recipesStore.recipes.find((r) => r.id === recipeId)?.photoIds ?? []),
      updatePhotoIds: (ids) => void recipesStore.updateRecipe(recipeId, { photoIds: ids }),
      // Without this the attached source lands with createdBy: undefined, unlike every
      // other attachment in the app.
      currentMemberId: familyStore.currentMemberId ?? undefined,
      // The source may be a PDF (a scanned recipe card), so this surface must accept both.
      accept: 'imagesAndPdf',
    });

    // FETCH AND STORE, never hot-link. A remote <img src> would fire a third-party request
    // from every family device on every render — the opposite of the local-first posture —
    // and would break when the site moves the file. The browser cannot do this itself
    // (CORS), which is why it goes through content-fetch.
    //
    // The loop lives in `attachDishImage`; this owns the telemetry vocabulary so every event
    // for this surface is emitted from one place. `dishImage != null` is exactly "a source
    // page existed", which is what gates the events: a hand-typed or document-only save must
    // emit NEITHER, or the hit-rate denominator counts recipes that never had a page.
    if (dishImage) {
      const outcome = await attachDishImage(recipeId, dishImage.candidates, {
        photos,
        fetchImage: (url, opts) => recipeFetchService.fetchImage(url, opts),
        pageUrl: dishImage.pageUrl,
        // THE LADDER ITSELF, not just its verdict. Without this the retry behaviour — the
        // whole feature — is the one thing the firehose cannot see: when a site's og:image
        // starts 403ing but its twitter:image still works, every capture silently burns an
        // extra round trip and CloudWatch shows only a clean success on another rung.
        onAttemptFailed: ({ source, errorCode }) =>
          logEvent({
            level: 'info',
            surface: SURFACE,
            message: 'dish image candidate failed, trying the next',
            context: {
              action: 'image_attempt_failed',
              kind: dishImage.kind,
              detail: source,
              ...(errorCode ? { error_code: errorCode } : {}),
            },
          }),
      });
      if (outcome.ok) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'dish image attached',
          context: {
            action: 'image_resolved',
            kind: dishImage.kind,
            detail: outcome.source,
            // Candidates TRIED, not offered. The server may send five and the client tries
            // three, so logging the offered count read as "we tried five" and contradicted
            // the failure table. `image_attempt_failed` above accounts for the rest.
            count: outcome.attempts,
          },
        });
      } else {
        // THE EVENT THAT DID NOT EXIST (#86). Previously the commonest failure — the page
        // offering no usable image — returned null in silence, which is why a shipped feature
        // could under-deliver for weeks until a user happened to mention it.
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'no dish image attached',
          context: {
            action: 'image_none',
            kind: dishImage.kind,
            detail: outcome.reason,
            // Tried, not offered — except for `no_candidates`, where `attempts` is 0 and that
            // zero IS the signal ("the page declared nothing").
            count: outcome.attempts,
            ...(outcome.errorCode ? { error_code: outcome.errorCode } : {}),
          },
        });
        // Developer-facing, never leaves the device: the enum alone does not say what to do.
        console.warn(`[${SURFACE}] no dish image: ${outcome.reason}. ${HINTS[outcome.reason]}`);
      }
    }

    if (!file) return;

    try {
      let added = await photos.add([file]);
      // The original was refused (unsupported image type, or a PDF over the size cap).
      // Fall back to the compressed page-1 JPEG the service already produced, which is
      // always an accepted type — losing fidelity beats losing the source entirely.
      if (added.length === 0 && compressed) {
        const fallback = new File([compressed], `recipe-source-${recipeId}.jpg`, {
          type: 'image/jpeg',
        });
        added = await photos.add([fallback]);
        if (added.length > 0) {
          logEvent({
            level: 'info',
            surface: SURFACE,
            message: 'source attached as compressed fallback',
            context: { action: 'attach_fallback', kind: 'source' },
          });
        }
      }
      if (added.length === 0) {
        // usePhotos already told the user why. How loudly we escalate depends on WHY:
        //
        //  • Cloud sync off  -> expected, user-configurable, and they were told. A Slack
        //    page here would be pure noise for a setting working as designed.
        //  • Cloud sync ON and it still failed -> the user handed us a document, we said
        //    we read it, and it is now gone with no retry. That is data loss, and it is
        //    the one outcome in this feature that warrants paging.
        if (photos.canAdd.value) {
          reportError({
            surface: SURFACE,
            message: 'recipe saved but its source document was lost',
            severity: 'critical',
            context: { action: 'attach_failed', kind: 'source' },
          });
        } else {
          logEvent({
            level: 'warn',
            surface: SURFACE,
            message: 'source not attached (photo storage unavailable)',
            context: { action: 'attach_failed', kind: 'source' },
          });
        }
      }
    } catch (err) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'source attach threw',
        context: { action: 'attach_failed', kind: 'source' },
        error: err,
      });
      console.error(
        '[recipe-extract] attaching the source document failed AFTER the recipe saved. The ' +
          'recipe is intact and this is deliberately not rolled back; the user keeps the ' +
          'recipe but loses the scan. Usually a Drive/network failure or photos disabled.',
        err
      );
      showToast(
        'warning',
        t('recipeExtract.attachFailed.title'),
        t('recipeExtract.attachFailed.message')
      );
    }
  }

  /** Drop everything held when the user abandons the form without saving. */
  function discardPendingSource(): void {
    pendingSource.value = null;
    pendingCompressed.value = null;
    // The dish image is NOT held here any more (#86). It rides on the prefill and is owned by
    // `RecipeFormModal`, because the candidates are delivered INTO the form by either capture
    // instance while the source file belongs to whichever instance produced it. See §7 of
    // docs/plans/2026-09-04-recipe-dish-image-ladder.md.
  }

  return {
    isProcessing,
    processFile,
    processUrl,
    deliverRecipe,
    attachAfterSave,
    discardPendingSource,
  };
}
