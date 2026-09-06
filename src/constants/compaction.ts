/**
 * The automatic safety copy written beside the pod before a compaction (R2).
 *
 * ⚠️ THE NAME IS DERIVED FROM THE POD'S OWN FILE NAME, never a fixed constant.
 * The Drive app folder is per-ACCOUNT, so one Google account owning two families
 * keeps BOTH pods in the same folder — a single global name means each family's
 * compaction overwrites the other's rollback copy. The pod's file name is
 * already unique in that folder (the create-time collision check enforces it),
 * so deriving from it is unique by construction and stable across repeated
 * compactions of the same pod.
 *
 * ⚠️ THE MARKER IS NOT TRANSLATED, and must never be. It is matched against
 * real file names by `isSafetyCopyName` to keep the copy out of the pod pickers
 * (ADR-033), and a localized marker would be unmatchable the moment the reader's
 * language differed from the writer's — a filter that silently does nothing.
 */
export const SAFETY_COPY_INFIX = ' (before compacting)';

const BEANPOD_EXT = '.beanpod';

/** `family.beanpod` → `family (before compacting).beanpod`. */
export function safetyCopyName(podFileName: string): string {
  const base = podFileName.endsWith(BEANPOD_EXT)
    ? podFileName.slice(0, -BEANPOD_EXT.length)
    : podFileName;
  return `${base}${SAFETY_COPY_INFIX}${BEANPOD_EXT}`;
}

/**
 * Is this file one of our safety copies?
 *
 * Used where pods are IDENTIFIED, so a joiner or a recovery flow is never handed
 * the pre-compaction file by mistake. It stays VISIBLE in the human-facing
 * picker — that is what makes it a rollback route someone can choose — so the
 * name has to read as a backup at a glance, which is why the infix is prose.
 */
export function isSafetyCopyName(fileName: string): boolean {
  return fileName.includes(SAFETY_COPY_INFIX);
}
