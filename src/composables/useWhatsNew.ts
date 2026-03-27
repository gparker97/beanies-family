import { ref, computed } from 'vue';
import { getLatestVersion, getLatestReleaseNote, type ReleaseNote } from '@/content/release-notes';

const STORAGE_KEY = 'beanies-lastSeenWhatsNew';

const lastSeenVersion = ref(localStorage.getItem(STORAGE_KEY) ?? '');

export function useWhatsNew() {
  const latestVersion = getLatestVersion();

  const shouldShowModal = computed(() => {
    if (!latestVersion) return false;
    return lastSeenVersion.value !== latestVersion;
  });

  const latestReleaseNote = computed<ReleaseNote | undefined>(() => getLatestReleaseNote());

  function dismissModal(): void {
    lastSeenVersion.value = latestVersion;
    try {
      localStorage.setItem(STORAGE_KEY, latestVersion);
    } catch {
      // storage unavailable
    }
  }

  return {
    shouldShowModal,
    latestReleaseNote,
    dismissModal,
  };
}
