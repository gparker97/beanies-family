/**
 * Conditional one-time notice flag backed by localStorage.
 *
 * Pair with a detector that calls `activate()` when a condition is met, and a
 * modal that checks `isActive()` and calls `dismiss()` on the dismiss button.
 * Each situation gets its own key; keys are namespaced under
 * `beanies:notice:{key}:...` to avoid collision.
 *
 * Example: `useStalePwaNotice` uses `noticeFlag('stalePwa')`.
 */
export function noticeFlag(key: string) {
  const showKey = `beanies:notice:${key}:show`;
  const dismissKey = `beanies:notice:${key}:dismissed`;
  return {
    isActive(): boolean {
      try {
        return (
          localStorage.getItem(showKey) === 'true' && localStorage.getItem(dismissKey) !== 'true'
        );
      } catch {
        return false;
      }
    },
    activate(): void {
      try {
        localStorage.setItem(showKey, 'true');
      } catch {
        /* storage unavailable */
      }
    },
    dismiss(): void {
      try {
        localStorage.setItem(dismissKey, 'true');
      } catch {
        /* storage unavailable */
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(showKey);
        localStorage.removeItem(dismissKey);
      } catch {
        /* storage unavailable */
      }
    },
  };
}
