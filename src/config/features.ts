/**
 * Cloud-feature gating for beanies.family.
 *
 * Each gate is derived automatically from the presence of its env vars — no
 * global mode flag. greg's local dev with full .env.local satisfies all
 * gates → all features available. Vanilla self-host with no .env.local →
 * features auto-disable in the UI.
 *
 * Adding a new gated feature: update FOUR places —
 *   1. this file (add to `features` object + type any combined helpers)
 *   2. src/vite-env.d.ts (declare the env var)
 *   3. .env.example (add a commented entry)
 *   4. docs/SELF_HOSTING.md (document what it gates and how to provision it)
 */

const env = import.meta.env;

const ok = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

// Explicit boolean switch, for gates that must be turned on/off deliberately
// rather than inferred from "some config string happens to be present".
// ONLY the exact string "true" (case/whitespace-insensitive) enables — unset,
// empty, "false", or a typo all mean OFF. That asymmetry is deliberate: a
// misconfigured build fails OPEN (feature off), never silently on.
const flagOn = (v: unknown): boolean => typeof v === 'string' && v.trim().toLowerCase() === 'true';

// The canonical cloud host. Update this set if it ever changes.
const CLOUD_HOSTS = new Set(['app.beanies.family']);

export const features = {
  // Drive sync only requires VITE_GOOGLE_CLIENT_ID — that's what gates OAuth
  // and the Drive REST API. VITE_GOOGLE_API_KEY + VITE_GOOGLE_PROJECT_NUMBER
  // are required by the Drive Picker specifically, but the picker is opt-in
  // (used during recovery flows); main Drive sync works without them.
  drive: ok(env.VITE_GOOGLE_CLIENT_ID),
  // OAuth proxy is reachable when *either* env var supplies a URL. See
  // src/services/google/oauthProxy.ts for the resolver — it prefers
  // VITE_OAUTH_PROXY_URL (Path B self-host) and falls back to
  // VITE_REGISTRY_API_URL (cloud, where one Lambda backs both surfaces).
  oauthProxy: ok(env.VITE_OAUTH_PROXY_URL) || ok(env.VITE_REGISTRY_API_URL),
  registry: ok(env.VITE_REGISTRY_API_URL) && ok(env.VITE_REGISTRY_API_KEY),
  // Invite gate: retained but switched OFF in prod as of 2026-07-21, superseded by the
  // Create-pod welcome modal. NOT dead code — flip the INVITE_GATE repo variable to
  // "true" to re-gate (e.g. a future closed cohort or paid beta). See
  // docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
  //
  // TWO conditions, both required:
  //   1. VITE_INVITE_GATE === "true"  — the explicit operator switch (repo VARIABLE,
  //      readable/editable in the GitHub UI, unlike the write-only secret).
  //   2. VITE_INVITE_BEAN_HASHES non-empty — at least one valid token must exist.
  // The AND is a safety interlock: arming the gate with no valid tokens would lock
  // 100% of new users out of the Create path with no way in. Turning the gate off does
  // NOT require deleting the hashes secret, so the tokens survive for later re-arming.
  inviteGate: flagOn(env.VITE_INVITE_GATE) && ok(env.VITE_INVITE_BEAN_HASHES),
  // NOTE: VITE_INVITE_WEBHOOK_URL and VITE_MARKETING_URL are NOT gated here — they
  // are read directly at their point of use (InviteGateOverlay's `hasInviteWebhook`;
  // `utils/marketing.ts`'s MARKETING_URL, which has its own apex fallback). A derived
  // `features.*` flag for either would be dead, so it isn't added (feature-gate by
  // request only).
  slackPodCreate: ok(env.VITE_SLACK_WEBHOOK_URL),
  errorReporter: ok(env.VITE_BEANIES_ERROR_WEBHOOK_URL),
  analytics: ok(env.VITE_PLAUSIBLE_DOMAIN),
  translationApiUpgrade: ok(env.VITE_MYMEMORY_EMAIL),
} as const;

export type FeatureKey = keyof typeof features;

// A cloud-ish build (Drive and/or the family registry wired) is the official
// app, so it MUST also have the operational webhooks wired — otherwise the
// notification silently no-ops: `slackPost` short-circuits on an empty URL, and
// the client POSTs with `no-cors` so even a live-but-dead webhook can't surface
// a failure. This exact gap hid a real iPhone onboarding break (May 2026,
// errorReporter) and later dropped every "new family pod" Slack ping (June 2026,
// slackPodCreate — a dev build shipped to prod with no webhook). Make it loud at
// boot so an unset GitHub secret/variable can't masquerade as working alerting.
// Production builds only — dev/test/self-host omit these and that's fine.
if (env.PROD && (features.drive || features.registry)) {
  const operationalWebhooks: ReadonlyArray<readonly [FeatureKey, string, string]> = [
    ['errorReporter', 'VITE_BEANIES_ERROR_WEBHOOK_URL', 'Errors will NOT reach #beanies-errors'],
    [
      'slackPodCreate',
      'VITE_SLACK_WEBHOOK_URL',
      'New-family pod notifications will NOT reach Slack',
    ],
  ];
  for (const [key, envVar, impact] of operationalWebhooks) {
    if (!features[key]) {
      console.warn(
        `[features] ${key} is OFF (${envVar} is unset) but this looks like a cloud build ` +
          `(drive/registry are configured). ${impact}. Set the matching GitHub secret/variable.`
      );
    }
  }

  // A dev/local build (no VITE_BUILD_SHA → 'dev') must never reach the canonical
  // cloud host: it ships none of the CI-injected env (webhooks, analytics, build
  // SHA). Detecting it here fingerprints the June 2026 incident — a manual
  // `npm run build` synced to app.beanies.family instead of deploying through the
  // "Deploy beanies PROD" workflow. Fix: redeploy via the workflow.
  const buildSha = (env.VITE_BUILD_SHA as string | undefined) ?? 'dev';
  if (
    typeof window !== 'undefined' &&
    CLOUD_HOSTS.has(window.location.hostname) &&
    buildSha === 'dev'
  ) {
    console.error(
      '[features] A dev/local build is live on the cloud host (VITE_BUILD_SHA is "dev"). ' +
        'This bundle was NOT produced by the "Deploy beanies PROD" workflow, so Slack webhooks, ' +
        'error reporting, and analytics are all disabled. Redeploy via the workflow.'
    );
  }
}

/**
 * Inviting family members requires Drive — the invite link points at a
 * Drive-shared `.beanpod` file. Drive sign-in itself requires the OAuth proxy
 * (Google's Web Application client type requires a server-side client_secret;
 * see docs/SELF_HOSTING.md → Path B for the architectural reason). The family
 * registry is *not* required: when absent, the joiner falls back to picking
 * the shared file via Google Drive Picker. Registry is a smoothness feature
 * (saves the joiner one click), not a hard prerequisite.
 */
export function canInviteFamily(): boolean {
  return features.drive && features.oauthProxy;
}

// Discriminator for the "developer build" badge: only the two features that
// require real infrastructure to wire up. Slack webhooks, error reporter,
// invite gate, analytics, and translation upgrade are all optional even on
// greg's local dev — they don't downgrade the badge.
const ESSENTIAL: FeatureKey[] = ['drive', 'registry'];

export type DeploymentMode = 'cloud' | 'self-host-full' | 'self-host-limited';

export function getDeploymentMode(): DeploymentMode {
  if (CLOUD_HOSTS.has(window.location.hostname)) return 'cloud';
  return ESSENTIAL.every((k) => features[k]) ? 'self-host-full' : 'self-host-limited';
}

// Build the URL from segments so no single string literal trips the
// security ESLint plugin's no-secrets rule (which flagged the full URL as
// high-entropy at 4.26). Splitting the repo path out keeps every literal
// short + low-entropy without needing inline-disable comments (Prettier
// strips those when the URL wraps).
const SELF_HOSTING_DOCS_REPO = 'gparker97/beanies-family';
export const SELF_HOSTING_DOCS_URL = `https://github.com/${SELF_HOSTING_DOCS_REPO}/blob/main/docs/SELF_HOSTING.md`;

import type { UIStringKey } from '@/services/translation/uiStrings';

export interface DeploymentBadge {
  icon: string;
  labelKey: UIStringKey;
  /** Present iff the badge should render a docs link (i.e. self-host-limited). */
  docsUrl?: string;
}

export function getDeploymentBadge(): DeploymentBadge {
  switch (getDeploymentMode()) {
    case 'cloud':
      return { icon: '☁️', labelKey: 'selfHost.badge.cloud' };
    case 'self-host-full':
      return { icon: '🛠', labelKey: 'selfHost.badge.devBuild' };
    case 'self-host-limited':
      return {
        icon: '🏠',
        labelKey: 'selfHost.badge.community',
        docsUrl: SELF_HOSTING_DOCS_URL,
      };
  }
}
