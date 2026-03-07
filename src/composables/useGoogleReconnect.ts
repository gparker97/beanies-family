import { ref } from 'vue';
import { requestAccessToken, hasRefreshToken } from '@/services/google/googleAuth';

export function useGoogleReconnect() {
  const isReconnecting = ref(false);
  const reconnectError = ref(false);

  async function reconnect(): Promise<boolean> {
    isReconnecting.value = true;
    reconnectError.value = false;
    try {
      await requestAccessToken({ forceConsent: !hasRefreshToken() });
      return true;
    } catch {
      reconnectError.value = true;
      return false;
    } finally {
      isReconnecting.value = false;
    }
  }

  return { isReconnecting, reconnectError, reconnect };
}
