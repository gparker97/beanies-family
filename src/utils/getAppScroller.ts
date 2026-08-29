/**
 * The app's single scroll container.
 *
 * `App.vue` renders `<main class="flex-1 overflow-auto overscroll-y-contain">`
 * — the window does NOT scroll. Anything doing scroll math (positioning a day
 * card, detecting a scroll limit, measuring an element against the viewport)
 * must resolve THAT element, and several callers used to do it independently
 * with an inline `closest('main')`.
 *
 * Resolving by walking UP from an attached element (rather than
 * `document.querySelector('main')`) matters: during a route transition the
 * document query can return null on the first mount tick, which silently
 * aborted the caller — a real bug this helper's callers previously carried.
 *
 * One named seam means a future `App.vue` restructure breaks here, loudly and
 * once, instead of in five places quietly.
 */
export function getAppScroller(from: Element | null | undefined): HTMLElement | null {
  return from?.closest('main') ?? null;
}
