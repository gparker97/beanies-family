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
import { extractRecipeFromDocument } from '@/services/ai/documentExtractionService';
import { recipeExtractionToPrefill, type RecipePrefill } from '@/utils/recipeExtractionToRecipe';
import { logEvent } from '@/services/telemetry/logEvent';
import { toDateInputValue } from '@/utils/date';
import type { UUID } from '@/types/models';

const SURFACE = 'recipe-extract';

export interface RecipeReady {
  prefill: RecipePrefill;
  /** The ORIGINAL picked file (image or PDF), attached to the recipe after it saves. */
  sourceFile: File;
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

  const isProcessing = ref(false);
  /** Held between a successful extraction and the save that follows it. */
  const pendingSource = ref<File | null>(null);

  /** Run intake → extract → map for one document (consent already granted by the caller). */
  async function processFile(file: File): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

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
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'recipe ready for review',
        context: {
          action: 'ready',
          kind: 'document',
          extraction_path: 'document',
          inferred_count: prefill.inferredIngredients.length + prefill.inferredSteps.length,
          ingredient_count: prefill.fields.ingredients.length,
        },
      });
      options.onRecipeReady({ prefill, sourceFile: file });
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
    pendingSource.value = null;
    if (!file) return; // manual save with no AI source — nothing to attach

    const photos = usePhotos({
      collection: 'recipes',
      entityId: recipeId,
      photoIds: computed(() => recipesStore.recipes.find((r) => r.id === recipeId)?.photoIds ?? []),
      updatePhotoIds: (ids) => void recipesStore.updateRecipe(recipeId, { photoIds: ids }),
      // The source may be a PDF (a scanned recipe card), so this surface must accept both.
      accept: 'imagesAndPdf',
    });

    try {
      const added = await photos.add([file]);
      if (added.length === 0) {
        // usePhotos already told the user why (cloud off, bad type, cap reached). Record it
        // so the RATE is measurable — a source silently not attaching is data the user
        // handed us and cannot see.
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'source document was not attached to the saved recipe',
          context: { action: 'attach_failed', kind: 'source' },
        });
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

  /** Drop a held source when the user abandons the form without saving. */
  function discardPendingSource(): void {
    pendingSource.value = null;
  }

  return { isProcessing, processFile, attachAfterSave, discardPendingSource };
}
