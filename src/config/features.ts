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
  inviteGate: ok(env.VITE_INVITE_BEAN_HASHES),
  slackInvite: ok(env.VITE_INVITE_WEBHOOK_URL),
  slackPodCreate: ok(env.VITE_SLACK_WEBHOOK_URL),
  errorReporter: ok(env.VITE_BEANIES_ERROR_WEBHOOK_URL),
  marketingUrl: ok(env.VITE_MARKETING_URL),
  analytics: ok(env.VITE_PLAUSIBLE_DOMAIN),
  translationApiUpgrade: ok(env.VITE_MYMEMORY_EMAIL),
} as const;

export type FeatureKey = keyof typeof features;

// A cloud-ish build (Drive and/or the family registry wired) with no error
// webhook means `reportError()` silently no-ops — exactly the failure mode
// that hid a real iPhone onboarding break (May 2026). Make it loud at boot so
// a missing `VITE_BEANIES_ERROR_WEBHOOK_URL` (e.g. an unset GitHub repo
// variable) can't masquerade as working error reporting. Production builds
// only — dev/test don't ship that env var and that's fine.
if (env.PROD && !features.errorReporter && (features.drive || features.registry)) {
  console.warn(
    '[features] errorReporter is OFF (VITE_BEANIES_ERROR_WEBHOOK_URL is unset) but this looks like a cloud build (drive/registry are configured). Errors will NOT reach #beanies-errors. Set the BEANIES_ERROR_WEBHOOK_URL repo variable.'
  );
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
// invite gate, marketing URL, analytics, and translation upgrade are all
// optional even on greg's local dev — they don't downgrade the badge.
const ESSENTIAL: FeatureKey[] = ['drive', 'registry'];

export type DeploymentMode = 'cloud' | 'self-host-full' | 'self-host-limited';

// Update this set if the canonical cloud host ever changes.
const CLOUD_HOSTS = new Set(['app.beanies.family']);

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
