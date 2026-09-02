/**
 * "Has this activity already had its confetti?" — once per activity, per session.
 *
 * A celebrating card re-mounts constantly: the planner re-keys on navigation, long lists
 * virtualise, and the wall repaints on every day rollover. Without this the confetti would
 * replay every time a birthday scrolled back into view, which turns a once-a-year moment
 * into a twitch. The border and the bunting still render on every mount, so nothing is lost
 * visually — only the animation is spent.
 *
 * Module-level on purpose. Component state would reset with the component, which is the
 * exact failure this exists to prevent (and the same one the wall's PIN cooldown hit).
 *
 * NOT persisted. A reload is a new session and re-earning the confetti then is correct —
 * the point is to stop it replaying on scroll, not to ration it across days.
 */

/** Activity ids that have already spent their confetti this session. */
const seen = new Set<string>();

/**
 * Bounded, so a wall left running for months cannot grow this without limit.
 *
 * Clearing wholesale rather than evicting one entry is deliberate: the cost of a miss is
 * one replayed animation, and the alternative (an LRU with insertion ordering) is real
 * machinery for a decoration. The same reasoning `useActivityIdentity`'s caches use.
 */
const MAX_SEEN = 500;

/**
 * Claim the confetti for this activity. `true` exactly once per id per session.
 *
 * Named `claim`, not `shouldShow`, because it MUTATES: calling it twice returns false the
 * second time. A caller that wants to ask without spending must not use this.
 */
export function claimConfetti(activityId: string): boolean {
  if (seen.has(activityId)) return false;
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(activityId);
  return true;
}

/**
 * Forget every claim — sign-out, and pod switching.
 *
 * Activity ids are UUIDs so they cannot collide across pods, which means this is hygiene
 * rather than correctness; a family switching pods should still get the moment.
 */
export function resetCelebrationSeen(): void {
  seen.clear();
}
