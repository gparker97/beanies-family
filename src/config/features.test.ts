import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `features` is a const evaluated at module load against import.meta.env.
// To test different env permutations we stubEnv() and re-import the module
// per test via vi.resetModules() + dynamic import.

const ALL_ENV_KEYS = [
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_GOOGLE_API_KEY',
  'VITE_GOOGLE_PROJECT_NUMBER',
  'VITE_OAUTH_PROXY_URL',
  'VITE_REGISTRY_API_URL',
  'VITE_REGISTRY_API_KEY',
  'VITE_INVITE_GATE',
  'VITE_INVITE_BEAN_HASHES',
  'VITE_INVITE_WEBHOOK_URL',
  'VITE_SLACK_WEBHOOK_URL',
  'VITE_BEANIES_ERROR_WEBHOOK_URL',
  'VITE_MARKETING_URL',
  'VITE_PLAUSIBLE_DOMAIN',
  'VITE_MYMEMORY_EMAIL',
] as const;

function clearAllEnv(): void {
  for (const key of ALL_ENV_KEYS) {
    vi.stubEnv(key, '');
  }
}

function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, hostname },
  });
}

async function importFeatures() {
  vi.resetModules();
  return await import('./features');
}

describe('config/features', () => {
  beforeEach(() => {
    clearAllEnv();
    setHostname('localhost');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('features object — per-feature gating', () => {
    it('drive: true when VITE_GOOGLE_CLIENT_ID is set', async () => {
      let mod = await importFeatures();
      expect(mod.features.drive).toBe(false);

      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      mod = await importFeatures();
      expect(mod.features.drive).toBe(true);
    });

    it('registry: true only when both URL and KEY are set', async () => {
      vi.stubEnv('VITE_REGISTRY_API_URL', 'https://api.example.com');
      let mod = await importFeatures();
      expect(mod.features.registry).toBe(false);

      vi.stubEnv('VITE_REGISTRY_API_KEY', 'secret');
      mod = await importFeatures();
      expect(mod.features.registry).toBe(true);
    });

    it('single-var features derive directly from their env vars', async () => {
      const cases: Array<
        [string, 'slackPodCreate' | 'errorReporter' | 'analytics' | 'translationApiUpgrade']
      > = [
        ['VITE_SLACK_WEBHOOK_URL', 'slackPodCreate'],
        ['VITE_BEANIES_ERROR_WEBHOOK_URL', 'errorReporter'],
        ['VITE_PLAUSIBLE_DOMAIN', 'analytics'],
        ['VITE_MYMEMORY_EMAIL', 'translationApiUpgrade'],
      ];

      for (const [envKey, featureKey] of cases) {
        clearAllEnv();
        let mod = await importFeatures();
        expect(
          mod.features[featureKey],
          `${featureKey} should be false when ${envKey} is empty`
        ).toBe(false);

        vi.stubEnv(envKey, 'value');
        mod = await importFeatures();
        expect(mod.features[featureKey], `${featureKey} should be true when ${envKey} is set`).toBe(
          true
        );
      }
    });

    it('treats whitespace-only env vars as unset', async () => {
      vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '   ');
      const mod = await importFeatures();
      expect(mod.features.analytics).toBe(false);
    });
  });

  // The gate is the one feature with an EXPLICIT operator switch rather than
  // presence-inference, plus a safety interlock. Both halves matter:
  //  - switch off + hashes present  → off (the 2026-07-21 prod state: tokens
  //    survive for re-arming, but nobody is gated)
  //  - switch on + NO hashes        → off (interlock: arming with zero valid
  //    tokens would lock 100% of new users out of the Create path)
  describe('features.inviteGate — explicit switch AND token interlock', () => {
    const HASHES = 'abc123,def456';

    it('is OFF when the switch is unset, even with hashes present', async () => {
      vi.stubEnv('VITE_INVITE_BEAN_HASHES', HASHES);
      const mod = await importFeatures();
      expect(mod.features.inviteGate).toBe(false);
    });

    it('is ON only when the switch is "true" AND hashes are present', async () => {
      vi.stubEnv('VITE_INVITE_BEAN_HASHES', HASHES);
      vi.stubEnv('VITE_INVITE_GATE', 'true');
      const mod = await importFeatures();
      expect(mod.features.inviteGate).toBe(true);
    });

    it('stays OFF when the switch is "true" but no hashes exist (lockout interlock)', async () => {
      vi.stubEnv('VITE_INVITE_GATE', 'true');
      const mod = await importFeatures();
      expect(mod.features.inviteGate).toBe(false);
    });

    it('accepts surrounding whitespace and mixed case on the switch', async () => {
      vi.stubEnv('VITE_INVITE_BEAN_HASHES', HASHES);
      for (const value of ['  true  ', 'TRUE', 'True']) {
        vi.stubEnv('VITE_INVITE_GATE', value);
        const mod = await importFeatures();
        expect(mod.features.inviteGate, `"${value}" should arm the gate`).toBe(true);
      }
    });

    it('fails OPEN for every non-"true" value (empty, "false", typos, "1", "yes")', async () => {
      vi.stubEnv('VITE_INVITE_BEAN_HASHES', HASHES);
      for (const value of ['', 'false', 'FALSE', '1', 'yes', 'on', 'ture', 'truthy']) {
        vi.stubEnv('VITE_INVITE_GATE', value);
        const mod = await importFeatures();
        expect(mod.features.inviteGate, `"${value}" must NOT arm the gate`).toBe(false);
      }
    });
  });

  describe('misc env parsing', () => {
    it('treats whitespace-only env vars as unset', async () => {
      vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '   ');
      const mod = await importFeatures();
      expect(mod.features.analytics).toBe(false);
    });
  });

  describe('features.oauthProxy — permissive resolver', () => {
    it('true when only VITE_OAUTH_PROXY_URL is set', async () => {
      vi.stubEnv('VITE_OAUTH_PROXY_URL', 'https://oauth.example.com');
      const mod = await importFeatures();
      expect(mod.features.oauthProxy).toBe(true);
    });

    it('true when only VITE_REGISTRY_API_URL is set (cloud convention)', async () => {
      vi.stubEnv('VITE_REGISTRY_API_URL', 'https://api.beanies.family');
      const mod = await importFeatures();
      expect(mod.features.oauthProxy).toBe(true);
    });

    it('false when neither is set', async () => {
      const mod = await importFeatures();
      expect(mod.features.oauthProxy).toBe(false);
    });
  });

  describe('canInviteFamily', () => {
    it('returns false when neither flag is set', async () => {
      const mod = await importFeatures();
      expect(mod.canInviteFamily()).toBe(false);
    });

    it('returns true with drive + oauth proxy (registry optional — Drive Picker fallback)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      vi.stubEnv('VITE_OAUTH_PROXY_URL', 'https://oauth.example.com');
      const mod = await importFeatures();
      expect(mod.canInviteFamily()).toBe(true);
    });

    it('returns true with drive + registry URL (cloud shape — registry URL serves both surfaces)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      vi.stubEnv('VITE_REGISTRY_API_URL', 'u');
      vi.stubEnv('VITE_REGISTRY_API_KEY', 'k');
      const mod = await importFeatures();
      expect(mod.canInviteFamily()).toBe(true);
    });

    it('returns false with drive but no OAuth proxy (Path A self-host with only client ID)', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      // Neither VITE_OAUTH_PROXY_URL nor VITE_REGISTRY_API_URL set — Drive
      // sign-in cannot complete because there's no token-exchange endpoint.
      const mod = await importFeatures();
      expect(mod.canInviteFamily()).toBe(false);
    });

    it('returns false with only registry (no Drive means no shareable file)', async () => {
      vi.stubEnv('VITE_REGISTRY_API_URL', 'u');
      vi.stubEnv('VITE_REGISTRY_API_KEY', 'k');
      const mod = await importFeatures();
      expect(mod.canInviteFamily()).toBe(false);
    });
  });

  describe('getDeploymentMode', () => {
    it('returns "cloud" for app.beanies.family', async () => {
      setHostname('app.beanies.family');
      const mod = await importFeatures();
      expect(mod.getDeploymentMode()).toBe('cloud');
    });

    it('returns "self-host-full" for non-canonical host with all essentials set', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      vi.stubEnv('VITE_REGISTRY_API_URL', 'u');
      vi.stubEnv('VITE_REGISTRY_API_KEY', 'k');
      setHostname('localhost');
      const mod = await importFeatures();
      expect(mod.getDeploymentMode()).toBe('self-host-full');
    });

    it('returns "self-host-limited" for non-canonical host with one essential missing', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      // registry missing
      setHostname('localhost');
      const mod = await importFeatures();
      expect(mod.getDeploymentMode()).toBe('self-host-limited');
    });
  });

  describe('getDeploymentBadge', () => {
    it('cloud: cloud icon, no docs link', async () => {
      setHostname('app.beanies.family');
      const mod = await importFeatures();
      const badge = mod.getDeploymentBadge();
      expect(badge.icon).toBe('☁️');
      expect(badge.labelKey).toBe('selfHost.badge.cloud');
      expect(badge.docsUrl).toBeUndefined();
    });

    it('self-host-full: dev-build icon, no docs link', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
      vi.stubEnv('VITE_REGISTRY_API_URL', 'u');
      vi.stubEnv('VITE_REGISTRY_API_KEY', 'k');
      setHostname('localhost');
      const mod = await importFeatures();
      const badge = mod.getDeploymentBadge();
      expect(badge.icon).toBe('🛠');
      expect(badge.labelKey).toBe('selfHost.badge.devBuild');
      expect(badge.docsUrl).toBeUndefined();
    });

    it('self-host-limited: community icon WITH docs link', async () => {
      setHostname('localhost');
      const mod = await importFeatures();
      const badge = mod.getDeploymentBadge();
      expect(badge.icon).toBe('🏠');
      expect(badge.labelKey).toBe('selfHost.badge.community');
      expect(badge.docsUrl).toBe(mod.SELF_HOSTING_DOCS_URL);
    });
  });
});
