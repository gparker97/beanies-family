/**
 * Is the person typing right now?
 *
 * On every platform a soft keyboard is only ever open because an editable element has
 * focus, and a keyboard shortcut must never fire while someone types. Reading
 * `activeElement` needs no listener, no `visualViewport`, and no per-engine knowledge.
 * Shared by `useWallRoomGate` (a viewport shrink that is really a keyboard) and
 * `useKeyboardShortcuts` (a letter key that is really typing).
 */
export function isTextEntryFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
