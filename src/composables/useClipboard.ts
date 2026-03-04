import { ref } from 'vue';

/**
 * Composable for clipboard copy with auto-resetting feedback state.
 * Replaces inline copy-with-timeout patterns used across the app.
 */
export function useClipboard() {
  const copied = ref(false);

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
      return true;
    } catch {
      return false;
    }
  }

  return { copied, copy };
}
