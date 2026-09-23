/**
 * #45 — single-interruption-per-session coordinator.
 *
 * At most ONE unsolicited "look at me" surface may open per tab-load. Every
 * auto-appearing surface (what's-new drawer, onboarding wizard, passkey/trust
 * modal, install prompt, PWA-reinstall, feedback survey) calls `claimInterruption`
 * at its true show-site and only shows if it wins; later surfaces yield.
 *
 * Semantics: in-memory module singleton (like `useCommunityNudge`), so "session"
 * = this page load — it resets on a full reload. NOT persisted, so a surface can
 * never be permanently suppressed across sessions; a yielded surface simply defers
 * to the bell / next load / Settings. First-wins with no preemption: the natural
 * session-start fire order approximates priority (security/onboarding fire first;
 * the feedback survey claims last, making it strictly lowest priority).
 *
 * User-initiated opens (buttons), action-driven celebrations, and state-driven
 * toasts/banners never call this — the rule governs only unsolicited auto-popups.
 *
 * ⚠️ THE ONE EXEMPTION (2026-09-23): the trusted-device question. greg: "for any new
 * device, at the first sign-in, ALWAYS ask". It still claims the slot when free, but
 * shows even if another surface already holds it (`isUnpreemptable` in authPrompts.ts,
 * applied at App.vue's show-site). It is a one-per-device question with security
 * consequences, not a nudge. Do not add a second exemption without the same bar.
 */

let claimedBy: string | null = null;

/**
 * Attempt to claim this session's single interruption slot.
 * @returns true if the caller may show (it won, or it already holds the claim);
 *          false if another surface already claimed it this load.
 *
 * Idempotent per id: a surface whose watch re-fires can re-check and still show.
 * Call ONLY at the moment you are actually going to display, so a "decided not to
 * show" branch never consumes the slot.
 */
export function claimInterruption(id: string): boolean {
  if (claimedBy === null) {
    claimedBy = id;
    return true;
  }
  return claimedBy === id;
}

/** Whether any surface has claimed the interruption this load (telemetry / tests). */
export function wasInterrupted(): boolean {
  return claimedBy !== null;
}

/** Test-only: reset the module singleton between test cases. Never called in app code. */
export function __resetSessionInterruptionForTests(): void {
  claimedBy = null;
}
