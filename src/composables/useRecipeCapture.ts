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
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  extractRecipeFromDocument,
  extractRecipeFromText,
} from '@/services/ai/documentExtractionService';
import { resolveRecipeSource, type ExtractionPath } from '@/services/ai/recipeSourceResolver';
import { routeUrl } from '@/utils/recipeSourceUrl';
import { assertNever } from '@/utils/assertNever';
import { safeHttpsUrl } from '@/utils/url';
import {
  jsonLdToPrefill,
  recipeExtractionToPrefill,
  type RecipePrefill,
} from '@/utils/recipeExtractionToRecipe';
import { logEvent } from '@/services/telemetry/logEvent';
import { recipeFetchService } from '@/services/ai/recipeFetchService';
import { reportError } from '@/utils/errorReporter';
import { toDateInputValue } from '@/utils/date';
import type { UUID } from '@/types/models';

const SURFACE = 'recipe-extract';

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
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();
  const recipesStore = useRecipesStore();
  const familyStore = useFamilyStore();

  const isProcessing = ref(false);
  /** A screened dish-image URL held until the recipe is saved, then fetched and stored. */
  const pendingDishImageUrl = ref<string | null>(null);
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
  async function processFile(file: File): Promise<void> {
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

      // Loud-but-non-blocking FIRST — before the not-a-recipe return — so a >cap PDF whose
      // ingredients sat on a dropped page still tells the user. Never silent.
      if (result.truncated) {
        showToast('info', t('ai.pdfTruncated.title'), t('ai.pdfTruncated.message'));
      }

      const prefill = recipeExtractionToPrefill(result.data);
      if (!prefill) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'source was not a recipe',
          context: { action: 'not_recipe', kind: 'document' },
        });
        showToast('info', t('recipeExtract.notRecipe.title'), t('recipeExtract.notRecipe.message'));
        return;
      }

      pendingSource.value = file;
      pendingCompressed.value = result.compressedBlob ?? null;
      handOver(prefill, 'document', 'document', file);
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
      },
    });
    options.onRecipeReady({ prefill, sourceFile });
  }

  /**
   * Capture from a pasted URL — a recipe page or a YouTube video (#72 phases 2/3).
   *
   * The whole ladder lives in `resolveRecipeSource`; this is a flat switch over its four
   * outcomes, closed with `assertNever` so a fifth variant fails the BUILD.
   */
  async function processUrl(rawUrl: string): Promise<void> {
    if (isProcessing.value) return;
    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    // The route is known BEFORE any network call. Both branches of the old ternary were
    // 'page', so `handOver`'s 'youtube' kind was unreachable and CloudWatch could not tell a
    // video capture from a page one. And `start` must be logged BEFORE the await, or a
    // failure has no denominator — you cannot compute a rate from outcomes alone.
    const kind = routeUrl(rawUrl).kind === 'youtube' ? 'youtube' : 'page';
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
          // The model is NEVER invoked here — quantities come straight from the site's own
          // structured data, so nothing can be hallucinated and nothing is inferred.
          const prefill = jsonLdToPrefill(resolved.recipe, resolved.sourceUrl);
          pendingDishImageUrl.value = safeHttpsUrl(resolved.imageUrl);
          handOver(prefill, kind, resolved.path, null);
          return;
        }
        case 'text': {
          const result = await extractRecipeFromText(resolved.text, {
            tier: tier.value,
            todayIso: toDateInputValue(new Date()),
            byok: byokConfig.value ?? undefined,
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
          const prefill = recipeExtractionToPrefill(result.data, resolved.sourceUrl);
          if (!prefill) {
            logEvent({
              level: 'info',
              surface: SURFACE,
              message: 'source was not a recipe',
              context: { action: 'not_recipe', kind, extraction_path: resolved.path },
            });
            showToast(
              'info',
              t('recipeExtract.notRecipe.title'),
              t('recipeExtract.notRecipe.message')
            );
            return;
          }
          prefill.fields.sourceUrl = resolved.sourceUrl;
          pendingDishImageUrl.value = prefill.dishImageUrl ?? safeHttpsUrl(resolved.imageUrl);
          handOver(prefill, kind, resolved.path, null);
          return;
        }
        case 'refusal': {
          logEvent({
            level: 'warn',
            surface: SURFACE,
            message: 'refused to guess a recipe',
            context: { action: 'refused', kind, error_code: resolved.reason },
          });
          const isVideo = resolved.reason === 'no_transcript_no_link';
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
  async function attachAfterSave(recipeId: UUID): Promise<void> {
    const file = pendingSource.value;
    const compressed = pendingCompressed.value;
    const dishUrl = pendingDishImageUrl.value;
    pendingSource.value = null;
    pendingCompressed.value = null;
    pendingDishImageUrl.value = null;
    if (!file && !dishUrl) return; // manual save with no AI source — nothing to attach

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
    if (dishUrl) {
      try {
        const img = await recipeFetchService.fetchImage(dishUrl);
        if (img.success && img.data) {
          // Named from the SNIFFED mime, never from the URL: a filename taken from an
          // attacker-supplied path is how an svg ends up called .jpg, and usePhotos'
          // accept test ORs the extension.
          const ext =
            img.data.mime === 'image/png' ? 'png' : img.data.mime === 'image/webp' ? 'webp' : 'jpg';
          const blob = await (await fetch(img.data.dataUrl)).blob();
          await photos.add([new File([blob], `dish-${recipeId}.${ext}`, { type: img.data.mime })]);
        } else {
          logEvent({
            level: 'info',
            surface: SURFACE,
            message: 'dish image not attached',
            context: { action: 'attach_failed', kind: 'dish_image', error_code: img.errorCode },
          });
        }
      } catch (err) {
        // Never fatal: the recipe is saved and a missing photo is cosmetic. The user can
        // add one themselves, and the recipe text — the part that matters — is intact.
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'dish image fetch threw',
          context: { action: 'attach_failed', kind: 'dish_image' },
          error: err,
        });
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
    pendingDishImageUrl.value = null;
  }

  return { isProcessing, processFile, processUrl, attachAfterSave, discardPendingSource };
}
