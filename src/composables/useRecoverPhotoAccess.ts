import { ref } from 'vue';
import { pickBeanpodFolder } from '@/services/google/drivePicker';
import {
  findBeanpodInFolder,
  NoBeanpodInFolderError,
  DriveFileNotFoundError,
} from '@/services/google/driveService';
import { requestAccessToken } from '@/services/google/googleAuth';
import { usePhotoStore } from '@/stores/photoStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Orchestrates the "reconnect your photo folder" recovery flow. Opens
 * the folder picker, validates the picked folder matches the current
 * pod, then clears photoStore's broken-photo state so the next render
 * re-resolves every unresolved photo against the newly-granted
 * folder-wide `drive.file` scope.
 *
 * Every failure branch surfaces through `showToast` + `console` — the
 * flow never completes silently, even on user cancel.
 */
export function useRecoverPhotoAccess() {
  const isReconnecting = ref(false);
  const photoStore = usePhotoStore();
  const syncStore = useSyncStore();
  const familyContextStore = useFamilyContextStore();
  const { t } = useTranslation();

  async function reconnect(): Promise<boolean> {
    if (isReconnecting.value) return false;
    isReconnecting.value = true;
    try {
      const expectedFileId = syncStore.driveFileId;
      if (!expectedFileId) {
        showToast(
          'error',
          t('recoverPhotos.notConnectedTitle'),
          t('recoverPhotos.notConnectedBody')
        );
        console.warn('[recoverPhotoAccess] reconnect aborted — no syncStore.driveFileId yet');
        return false;
      }

      const token = await requestAccessToken().catch((e) => {
        showToast('error', t('recoverPhotos.tokenFailedTitle'), t('recoverPhotos.tokenFailedBody'));
        console.error('[recoverPhotoAccess] requestAccessToken failed', e);
        return null;
      });
      if (!token) return false;

      const picked = await pickBeanpodFolder(token).catch((e) => {
        showToast(
          'error',
          t('recoverPhotos.pickerFailedTitle'),
          t('recoverPhotos.pickerFailedBody')
        );
        console.error('[recoverPhotoAccess] pickBeanpodFolder failed', e);
        return null;
      });
      if (!picked) return false; // user cancelled — silent no-op is the valid UX here

      let found: { fileId: string; name: string };
      try {
        const match = await findBeanpodInFolder(token, picked.folderId);
        found = { fileId: match.fileId, name: match.name };
      } catch (e) {
        if (e instanceof NoBeanpodInFolderError) {
          showToast('error', t('recoverPhotos.noBeanpodTitle'), t('recoverPhotos.noBeanpodBody'));
          console.warn('[recoverPhotoAccess] picked folder has no .beanpod', {
            folderId: picked.folderId,
            folderName: picked.folderName,
          });
        } else if (e instanceof DriveFileNotFoundError) {
          showToast(
            'error',
            t('recoverPhotos.folderInaccessibleTitle'),
            t('recoverPhotos.folderInaccessibleBody')
          );
          console.error('[recoverPhotoAccess] folder listing 404/403', e);
        } else {
          showToast(
            'error',
            t('recoverPhotos.genericFailureTitle'),
            t('recoverPhotos.genericFailureBody')
          );
          console.error('[recoverPhotoAccess] findBeanpodInFolder failed', e);
        }
        return false;
      }

      if (found.fileId !== expectedFileId) {
        showToast(
          'error',
          t('recoverPhotos.wrongFolderTitle'),
          t('recoverPhotos.wrongFolderBody').replace(
            '{familyName}',
            familyContextStore.activeFamilyName ?? ''
          )
        );
        console.warn('[recoverPhotoAccess] beanpod mismatch', {
          pickedFolderId: picked.folderId,
          foundFileId: found.fileId,
          expectedFileId,
        });
        return false;
      }

      photoStore.clearUnresolved();

      // On the next render PhotoThumbnail / avatar resolvers will retry
      // getBlobUrl under the new folder-wide grant. If any fail again
      // (genuine deletions, not scope issues), `markUnresolved` will
      // re-flip them and the banner re-appears — with different copy
      // via the "still unresolved" path in the banner logic.
      showToast('success', t('recoverPhotos.successTitle'), t('recoverPhotos.successBody'));
      console.info('[recoverPhotoAccess] reconnected', {
        folderId: picked.folderId,
      });
      return true;
    } finally {
      isReconnecting.value = false;
    }
  }

  return { isReconnecting, reconnect };
}
