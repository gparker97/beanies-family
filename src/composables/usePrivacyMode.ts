import { ref } from 'vue';

/**
 * Privacy mode composable — masks financial figures when locked.
 *
 * State is global (module-level ref) so all components share the same
 * locked/unlocked state. Always starts locked on app load; the unlocked
 * state is NOT persisted across sessions.
 *
 * In a future issue (#19), `unlock()` will require biometric / passkey
 * authentication before revealing figures.
 */

const MASK = '***';

// Global state — shared across all component instances
const isUnlocked = ref(false);

export function usePrivacyMode() {
  function toggle() {
    isUnlocked.value = !isUnlocked.value;
  }

  function lock() {
    isUnlocked.value = false;
  }

  function unlock() {
    // Simple toggle for now — will be extended in #19 to require auth
    isUnlocked.value = true;
  }

  /**
   * Returns the value when unlocked, or `***` when locked.
   */
  function formatMasked(value: string | number): string {
    if (isUnlocked.value) return String(value);
    return MASK;
  }

  return {
    isUnlocked,
    toggle,
    lock,
    unlock,
    formatMasked,
    MASK,
  };
}
