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

/**
 * Inviting family members requires Drive — the invite link points at a
 * Drive-shared `.beanpod` file. The family registry is *not* required: when
 * absent, the joiner falls back to picking the shared file via Google Drive
 * Picker. Registry is a smoothness feature (saves the joiner one click), not
 * a hard prerequisite.
 */
export function canInviteFamily(): boolean {
  return features.drive;
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

// Security ESLint flags GitHub URLs as high-entropy strings via no-secrets.
// This is a public repo URL, not a credential — disable the rule on the
// URL line specifically (the rule triggers on the string column, not the
// `export` line, so the disable has to be right above the string).
export const SELF_HOSTING_DOCS_URL =
  'https://github.com/gparker97/beanies-family/blob/main/docs/SELF_HOSTING.md';

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
