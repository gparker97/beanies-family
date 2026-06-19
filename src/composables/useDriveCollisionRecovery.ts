/**
 * Shared adopt-existing recovery for a Google Drive `.beanpod` name collision
 * during onboarding (2026-06-19).
 *
 * Both the create wizard (`CreatePodView`) and the recovery screen
 * (`ResumePodSetup`) hit the same dead-end before this existed: an aborted
 * first attempt leaves an orphan `.beanpod` on Drive, and every retry collides
 * with it forever. This orchestrator turns that collision into a resolution:
 *
 *  - own empty STUB orphan  → adopt it as the create target (provider installed)
 *                             and tell the caller to continue creating;
 *  - own POPULATED pod      → confirm with the user, then tell the caller to
 *                             OPEN (load) it — never create over it;
 *  - DIFFERENT account      → reject; caller keeps the "pick a different name"
 *                             guidance.
 *
 * It lives in a composable (the orchestration layer in MVO) rather than in the
 * `connectStorage` service so that service stays crypto/UI-free. The classify +
 * install primitives are in `connectStorage`; the confirm() is a global
 * promise-based dialog usable outside a component render.
 */
import {
  resolveExistingBeanpod,
  adoptDriveStub,
  type StorageConnectFailed,
} from '@/services/sync/connectStorage';
import { confirm } from '@/composables/useConfirm';

/** What the caller should do next after a name-collision is resolved. */
export type DriveCollisionAction =
  /** Orphan stub adopted; a provider is installed — caller continues creating the pod. */
  | { kind: 'adopted-stub' }
  /** User confirmed opening their own populated pod — caller loads `fileId`. */
  | { kind: 'open-existing'; fileId: string }
  /** User chose to pick a different family name instead. */
  | { kind: 'declined' }
  /** File is owned by a different account — caller shows the duplicate-name hint. */
  | { kind: 'reject-different-account' }
  /** Something went wrong while adopting — caller surfaces `error`. */
  | { kind: 'failed'; error: string };

/**
 * Resolve a `name-collision` failure from `connectDriveStorage`.
 *
 * @param collision the grouped collision metadata from `StorageConnectFailed`.
 * @param opts.familyName base name for the `.beanpod` when adopting a stub.
 * @param opts.activeFamilyId persists the provider→family mapping on adopt.
 */
export async function resolveDriveCollision(
  collision: NonNullable<StorageConnectFailed['collision']>,
  opts: { familyName: string; activeFamilyId?: string | null }
): Promise<DriveCollisionAction> {
  const resolution = await resolveExistingBeanpod(collision);

  if (resolution.kind === 'reject-different-account') {
    return { kind: 'reject-different-account' };
  }

  if (resolution.kind === 'adopt-stub') {
    try {
      await adoptDriveStub(resolution.fileId, opts.familyName, {
        activeFamilyId: opts.activeFamilyId,
      });
      return { kind: 'adopted-stub' };
    } catch (e) {
      console.error('[driveCollisionRecovery] adopting orphan stub failed:', e);
      return { kind: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // adopt-existing: a real pod the account owns. Ask before opening.
  const ok = await confirm({
    title: 'createPod.adoptExistingTitle',
    message: 'createPod.adoptExistingMessage',
    confirmLabel: 'createPod.adoptExistingConfirm',
    cancelLabel: 'createPod.adoptExistingCancel',
    variant: 'info',
  });
  return ok ? { kind: 'open-existing', fileId: resolution.fileId } : { kind: 'declined' };
}
