#!/usr/bin/env node
/**
 * Fail an App Store release EARLY when a previous build is still sitting in review.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────
 *
 * On 2026-09-04 the 0.16 release built, signed, uploaded and finished processing — and then
 * died at the very last step with:
 *
 *     A relationship value is not acceptable for the current resource state.
 *     - The specified pre-release build could not be added. - /data/relationships/build
 *
 * Build 65 was already attached to a version awaiting review. A version in that state is not
 * editable, so `patch_app_store_version_with_build` cannot swap in the new build. The message
 * says nothing about any of that, and the fix was a manual dance in the App Store Connect UI:
 * remove the pending build from consideration, refresh, re-open the version, attach the new
 * build, submit again.
 *
 * This check takes a couple of seconds and runs BEFORE the build, so the answer arrives in
 * seconds rather than after a full signed build, and the message names the flag that fixes it.
 *
 * ── The escape hatch ─────────────────────────────────────────────────────────────────────
 *
 * `REPLACE_PENDING_SUBMISSION=true` (the workflow's `replace_pending_submission` input) says
 * "cancel whatever is pending and ship this instead". With it set, this check reports what it
 * found and stands aside; `deliver`'s own `reject_if_possible` then does the cancelling, and
 * polls until Apple has actually released the version — the same wait that had to be done by
 * hand.
 *
 * ⚠️ It is deliberately NOT the default. Apple does not distinguish "waiting for review" from
 * "in review" here, and cancelling the latter pulls a build out from under a reviewer and
 * sends it back to the end of the queue. Silently torpedoing an in-flight review would be a
 * worse failure than the one this prevents, so replacing is something you ask for.
 *
 * ── Failure posture ──────────────────────────────────────────────────────────────────────
 *
 * FAIL OPEN on any transport or credential fault, exactly like `assert-store-version-unused`:
 * a preflight that blocks a good release because Apple had a wobble is worse than the failure
 * it prevents, and the real upload still refuses. It exits non-zero for one reason only — a
 * pending submission was CONFIRMED and the caller did not ask to replace it.
 */

import {
  ascCredentials,
  ascGet,
  resolveAppId,
  resolveBundleId,
  tokenFromCredentials,
} from './ascClient.mjs';

/**
 * The states fastlane treats as "in progress", copied from
 * `Spaceship::ConnectAPI::App#get_in_progress_review_submission` (fastlane 2.238.0). Kept
 * identical on purpose: this check exists to predict whether `reject_if_possible` will have
 * something to do, so a different list would make the preflight disagree with the tool it is
 * guarding.
 */
export const IN_PROGRESS_STATES = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];

/**
 * Decide the outcome from the review submissions App Store Connect reports.
 *
 * Split from the network call so the part that can be WRONG in a way that matters is
 * unit-testable without mocking HTTP.
 *
 * @param {Array<{ attributes?: { state?: string, platform?: string } }>} submissions
 * @param {boolean} replaceRequested
 */
export function judge(submissions, replaceRequested) {
  const pending = (submissions ?? [])
    .map((s) => s?.attributes?.state)
    .filter((state) => IN_PROGRESS_STATES.includes(state));

  if (pending.length === 0) return { ok: true, pending: [] };

  if (replaceRequested) {
    return {
      ok: true,
      pending,
      note:
        `A submission is already in progress (${pending.join(', ')}), and ` +
        `replace_pending_submission is set — it will be cancelled before this build is ` +
        `attached. If that submission is IN_REVIEW, this sends it back to the queue.`,
    };
  }

  return {
    ok: false,
    pending,
    message:
      `A previous submission is still in progress: ${pending.join(', ')}.\n\n` +
      `An App Store version in that state is NOT editable, so the new build cannot be\n` +
      `attached to it. The upload would succeed and then fail at the very last step with\n` +
      `"The specified pre-release build could not be added".\n\n` +
      `  FIX: re-run this workflow with replace_pending_submission = true, which cancels\n` +
      `       the pending submission first and then ships this build.\n\n` +
      `  ⚠️  If that submission is IN_REVIEW rather than merely WAITING_FOR_REVIEW,\n` +
      `      cancelling it returns the app to the back of the review queue. Check App Store\n` +
      `      Connect before replacing.`,
  };
}

/** Every review submission App Store Connect holds for the app, in the in-progress states. */
export async function fetchInProgressSubmissions({
  appId,
  token,
  platform = 'IOS',
  fetchImpl = fetch,
}) {
  const filter = `filter[state]=${IN_PROGRESS_STATES.join(',')}` + `&filter[platform]=${platform}`;
  const body = await ascGet(
    `/v1/reviewSubmissions?filter[app]=${appId}&${filter}&limit=200`,
    token,
    fetchImpl
  );
  return body?.data ?? [];
}

async function main() {
  const replaceRequested = process.env.REPLACE_PENDING_SUBMISSION?.trim() === 'true';
  const credentials = ascCredentials();

  if (!credentials) {
    console.warn(
      '[preflight] App Store Connect credentials are not set ' +
        '(APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID / ASC_API_KEY_P8_PATH). ' +
        'Skipping the pending-submission check.'
    );
    return;
  }

  let submissions;
  try {
    // Inside the try with the network calls: an unreadable config or key is the same class of
    // environment fault as an unreachable Apple, and takes the same fail-open path.
    const token = tokenFromCredentials(credentials);
    const appId = await resolveAppId({ bundleId: resolveBundleId(), token });
    submissions = await fetchInProgressSubmissions({ appId, token });
  } catch (err) {
    // FAIL OPEN — see the header. Loud, so a persistently broken preflight is visible in the
    // log rather than quietly protecting nothing.
    console.warn(
      `[preflight] could not read review submissions from App Store Connect ` +
        `(${err instanceof Error ? err.message : String(err)}). Continuing.`
    );
    return;
  }

  const verdict = judge(submissions, replaceRequested);
  if (!verdict.ok) {
    console.error(`[preflight] ${verdict.message}`);
    process.exit(1);
  }
  if (verdict.note) {
    console.warn(`[preflight] ${verdict.note}`);
    return;
  }
  console.log('[preflight] no submission is in progress — the new build can be attached.');
}

// CLI only when invoked directly, so the test can import the pure parts.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    // Anything unforeseen also fails open: this check must never be the reason a good release
    // cannot ship.
    console.warn(`[preflight] unexpected error, continuing: ${err?.message ?? err}`);
  });
}
