/**
 * REVIEW-DEMO: store-review demo mode — a code-gated, no-Google way into a
 * fully-populated synthetic family. TEMPORARY: see the retirement checklist in
 * `docs/runbooks/native-store-submission.md` and the plan at
 * `docs/plans/2026-08-20-app-review-demo-mode.md`.
 *
 * WHY IT EXISTS: App Store / Play reviewers could not sign in to the demo Google
 * account because Google's risk engine challenges every sign-in from an
 * unfamiliar device + IP + country — which is exactly what a reviewer VM looks
 * like. There is no consumer setting that disables that. Apple's own guidance is
 * to supply a demo mode that needs no third-party sign-in; this is it.
 *
 * SECURITY MODEL — read this before changing anything here. Apple ships the
 * binary it reviewed, so there is no "review build" separate from the released
 * one: this code IS in the app users download. It is safe because of three
 * things, and removing any one of them breaks it:
 *
 *   1. DISARMED BY DEFAULT — both `VITE_REVIEW_DEMO=true` and a non-empty
 *      `VITE_REVIEW_DEMO_CODE_HASH` are required (`features.reviewDemo`). Web,
 *      dev, self-host and the debug lanes set neither, so the gate is false and
 *      nothing renders.
 *   2. USELESS WITHOUT THE SECRET — only the SHA-256 of the code is in the
 *      bundle. The plaintext exists only in App Store Connect and greg's notes.
 *   3. SELF-DISARMING — `VITE_REVIEW_DEMO_EXPIRES` bakes in a date after which
 *      the gate is permanently false. No new release, no remote kill switch, no
 *      server dependency.
 *
 * Do NOT claim this is tree-shaken out of un-armed builds: `features.reviewDemo`
 * is two function calls over Vite-injected literals, which Rollup will not
 * reliably constant-fold, so this module ships everywhere. What IS guaranteed is
 * that the gate reads false at runtime and that `demoSeed`'s chunk (dynamically
 * imported) is never fetched.
 */

import { ref, readonly } from 'vue';
import { features } from '@/config/features';
import { parseIsoDateSafely } from '@/utils/safeDate';
import { matchesHashedCode } from '@/utils/hashedCodeGate';

const HASHES_ENV = import.meta.env.VITE_REVIEW_DEMO_CODE_HASH ?? '';

/**
 * The first instant at which demo mode is DEAD, as epoch ms.
 *
 * Parsed exactly once, at module load. A per-call parse would re-run
 * `parseIsoDateSafely`'s console warning on every render and every keystroke of
 * the code field.
 *
 * `-Infinity` (unset or unparseable) means permanently expired — fail closed,
 * never fail open.
 *
 * TIMEZONE: `new Date('2026-11-01')` is UTC midnight, so the value is the first
 * EXPIRED instant, not the last working day. Set it to the day AFTER the last
 * day the demo should work: `2026-11-01` keeps it live through 31 Oct UTC.
 */
const EXPIRES_AT =
  parseIsoDateSafely(
    import.meta.env.VITE_REVIEW_DEMO_EXPIRES,
    'VITE_REVIEW_DEMO_EXPIRES'
  )?.getTime() ?? -Infinity;

// An armed build with no expiry is permanently disarmed — and `parseIsoDateSafely`
// is SILENT for empty input (it only warns on unparseable input), so this would
// otherwise fail with zero signal and burn a submission cycle. Warn where a build
// operator can see it.
if (features.reviewDemo && EXPIRES_AT === -Infinity) {
  console.warn(
    '[reviewDemo] ARMED but VITE_REVIEW_DEMO_EXPIRES is unset/unparseable — demo mode ' +
      'is permanently disabled in this build. Set it on the release lane to UTC midnight ' +
      'of the FIRST expired day (e.g. 2026-11-01 keeps the demo live through 31 Oct).'
  );
}

/**
 * THE single predicate for demo mode. The welcome-screen affordance, the code
 * validator, the seed guard and the `MemoryProvider` production guard all bind
 * to this one function, so they can never disagree — an expired build cannot
 * render the button, accept a code, OR install a memory provider.
 *
 * Cheap and side-effect-free; safe to call from a render expression.
 */
export function isReviewDemoAvailable(): boolean {
  return features.reviewDemo && Date.now() < EXPIRES_AT;
}

/**
 * Validate a reviewer-entered demo code.
 *
 * Gate closed means DENY — the opposite polarity to the invite gate, whose "off"
 * means allow. See the note in `hashedCodeGate.ts`.
 */
export async function validateReviewDemoCode(code: string): Promise<boolean> {
  if (!isReviewDemoAvailable()) return false;
  return matchesHashedCode(code, HASHES_ENV);
}

// ─── Demo-session flag ───────────────────────────────────────────────────────
//
// Module-level rather than a store, following the `newFamilyFlag.ts` precedent:
// it is set and read in the same JS session with no reload between, and keeping
// it out of Pinia avoids a store-to-store import for one boolean. A `ref` (not a
// plain boolean) because the banner binds to it reactively.

const DEMO_SESSION_KEY = 'beanies:review-demo-session';

/**
 * Backed by `sessionStorage`, not just module memory.
 *
 * `createNewFile` deliberately writes the ordinary LOCAL artifacts of any local
 * session (an IndexedDB family cache, a cached family key), so a reviewer who
 * reloads the app lands back in the SAME demo pod rather than at the login
 * screen. With a memory-only flag the banner would vanish while the synthetic
 * data stayed on screen — precisely the "someone mistakes demo data for their
 * own" case the banner exists to prevent. (Found in the browser walkthrough;
 * the plan's Assumption 7 predicted a reload would end the session, and it does
 * not.)
 *
 * `sessionStorage` rather than `localStorage`: it survives a reload, which is
 * the gap, but dies with the tab / app process, so it can never outlive the pod
 * it describes.
 *
 * All access is wrapped — storage throws in private-mode and hardened browsers,
 * and a banner is never worth crashing the app over. On failure we fall back to
 * module memory and warn, following the same pattern as `config/flags.ts`.
 */
function readPersistedDemoFlag(): boolean {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY) === 'true';
  } catch (err) {
    console.warn('[reviewDemo] could not read the demo-session flag; assuming not a demo.', err);
    return false;
  }
}

const demoSession = ref(readPersistedDemoFlag());

/** True while this session is a seeded demo — drives the persistent banner. */
export const isDemoSession = readonly(demoSession);

/** Mark this session as a demo. Called once, at the end of a successful seed. */
export function markDemoSession(): void {
  demoSession.value = true;
  try {
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true');
  } catch (err) {
    // Non-fatal: the banner still shows for this page view, just not across a
    // reload. Warn rather than fail the seed over it.
    console.warn('[reviewDemo] could not persist the demo-session flag.', err);
  }
}

/**
 * Clear the demo flag. Called from `resetAllAppStores()`, which every sign-out
 * and family-switch path already runs.
 *
 * This is NOT optional bookkeeping: `AppHeader`'s sign-out does
 * `resetAllAppStores(); router.replace('/login')` with no page reload, so this
 * module survives. Without clearing, the demo banner would follow the user onto
 * the login screen and onto any real pod they created next in the same session.
 */
export function clearDemoSession(): void {
  demoSession.value = false;
  try {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
  } catch (err) {
    console.warn('[reviewDemo] could not clear the demo-session flag.', err);
  }
}
