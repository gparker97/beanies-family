import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { writeFile } from 'node:fs/promises';
// Relative imports — the `@` alias defined below does not exist while this config
// file is itself being loaded. Both modules are dependency-free (no Vue, no
// `import.meta`) so importing them into the config graph is safe.
import { applyFlagWrite } from './src/config/featureFlagWrite';
import { COMMITTED_FLAGS } from './src/config/featureFlags.committed';

/**
 * Fail an *official* production build that is missing an operational webhook.
 *
 * `deploy.yml` is the only build that sets VITE_BUILD_SHA (= github.sha), so its
 * presence marks the canonical CI deploy. On such a build the Slack + error
 * webhooks MUST be wired: without them the client notifications silently no-op
 * (slackPost short-circuits on an empty URL; the no-cors POST can't report a
 * failure). Local dev and self-host builds legitimately omit these, so they are
 * skipped entirely. Runtime counterpart lives in src/config/features.ts.
 *
 * This complements — does not replace — deploying via the workflow: a manual
 * `npm run build` has no VITE_BUILD_SHA, so it's caught at runtime instead (the
 * features.ts dev-build-on-cloud-host check) rather than here.
 */
function assertOfficialBuildEnv() {
  return {
    name: 'beanies:assert-official-build-env',
    apply: 'build' as const,
    buildStart() {
      if (!process.env.VITE_BUILD_SHA) return; // not the official CI build
      const required = ['VITE_SLACK_WEBHOOK_URL', 'VITE_BEANIES_ERROR_WEBHOOK_URL'];
      const missing = required.filter((k) => !process.env[k]?.trim());
      if (missing.length > 0) {
        throw new Error(
          `[beanies] Official build is missing required env: ${missing.join(', ')}. ` +
            'These gate operational Slack alerting — shipping without them silently drops every ' +
            'notification. Set the matching GitHub secret/variable, then redeploy via "Deploy beanies PROD".'
        );
      }
    },
  };
}

/**
 * Dev-only writer for the committed feature-flag state (issue #31).
 *
 * `apply: 'serve'` + `configureServer` means this exists ONLY in the dev server
 * — it is never part of a production build, so prod ships no write endpoint. The
 * dev-only Feature Flags card POSTs `{ flag, enabled }` here; we validate via the
 * pure `applyFlagWrite` core and rewrite src/config/featureFlags.committed.ts in
 * full (deterministic template → always prettier-clean). The dev server is the
 * only writer, so we keep the authoritative state in memory (seeded from the
 * committed import) and merge each change onto it — no fragile .ts parsing.
 */
function featureFlagWriterDev() {
  const filePath = fileURLToPath(
    new URL('./src/config/featureFlags.committed.ts', import.meta.url)
  );
  let current: Record<string, boolean> = { ...COMMITTED_FLAGS };
  return {
    name: 'beanies:feature-flag-writer',
    apply: 'serve' as const,
    configureServer(server: {
      middlewares: { use: (path: string, fn: unknown) => void };
      watcher: { unwatch: (paths: string) => void };
    }) {
      server.middlewares.use(
        '/__feature-flags',
        (
          req: { method?: string; on: (e: string, cb: (chunk?: unknown) => void) => void },
          res: {
            statusCode: number;
            setHeader: (k: string, v: string) => void;
            end: (body: string) => void;
          }
        ) => {
          const json = (status: number, body: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
          };
          if (req.method !== 'POST') {
            json(405, { ok: false, error: 'Method not allowed (use POST).' });
            return;
          }
          let raw = '';
          req.on('data', (chunk) => {
            raw += chunk;
          });
          req.on('end', () => {
            void (async () => {
              try {
                let parsed: { flag?: unknown; enabled?: unknown };
                try {
                  parsed = JSON.parse(raw || '{}');
                } catch {
                  json(400, { ok: false, error: 'Invalid JSON body.' });
                  return;
                }
                const result = applyFlagWrite(current, parsed.flag, parsed.enabled);
                if (!result.ok) {
                  json(400, result);
                  return;
                }
                // Stop Vite's watcher from firing on OUR OWN write — otherwise
                // it sees the committed file (imported by flags.ts) change and
                // triggers a full-page reload after every toggle, which defeats
                // the deliberate manual "Reload to apply" flow (batch toggles,
                // reload once). The in-memory `current` is the session's
                // authoritative state; the on-disk file is for commit/deploy and
                // is re-read on the next manual reload.
                server.watcher.unwatch(filePath);
                await writeFile(filePath, result.source, 'utf8');
                current = result.nextState;
                json(200, { ok: true });
              } catch (err) {
                console.error(
                  `[feature-flag-writer] failed to write ${filePath} — check file ` +
                    'permissions / disk space.',
                  err
                );
                json(500, {
                  ok: false,
                  error: 'Failed to write the committed flags file (see dev server console).',
                });
              }
            })();
          });
          req.on('error', (err) => {
            console.error('[feature-flag-writer] request stream error', err);
            json(400, { ok: false, error: 'Request error.' });
          });
        }
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Worker bundles do NOT inherit the top-level `plugins`, so the Automerge WASM
  // module (loaded with top-level await) needs these declared here explicitly —
  // without them a `@automerge/automerge` import inside a Web Worker fails to
  // build/load. See ADR-032 (off-main-thread Automerge).
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  // Dev-server only: allow ephemeral tunnel hosts (cloudflared/ngrok/localtunnel)
  // so the ADR-032 worker spike can be opened on an iPhone over HTTPS. Vite 7
  // rejects unknown Host headers by default. No effect on the production build.
  server: {
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.loca.lt'],
  },
  plugins: [
    assertOfficialBuildEnv(),
    featureFlagWriterDev(),
    wasm(),
    topLevelAwait(),
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['brand/*.png', 'icons/*.png'],
      manifest: {
        name: 'beanies.family',
        short_name: 'beanies.family',
        description: 'Every bean counts — family planning made simple',
        theme_color: '#2C3E50',
        background_color: '#F8F9FA',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // Portrait-locked: the app is designed phone-first and every layout is
        // portrait. In an installed PWA the manifest `orientation` overrides the
        // OS auto-rotate lock, so `'any'` rotated against users who had rotation
        // locked (Discord early-adopter report, 2026-06-12). `'portrait'` keeps
        // the installed app from flipping. Native parity lives in
        // android/.../AndroidManifest.xml (android:screenOrientation).
        orientation: 'portrait',
        categories: ['finance', 'productivity'],
        icons: [
          {
            src: 'brand/beanies_father_son_icon_192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'brand/beanies_father_son_icon_512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json,wasm}'],
        // The per-country public-holiday dataset (~200 files, ~2 MB total) is
        // fetched on demand for the family's country only and cached in
        // IndexedDB (see referenceDataCacheRepository) — never precache it, or
        // the service-worker install would balloon by the whole dataset.
        globIgnores: ['**/holidays/*.json'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB — Automerge WASM is ~2.65 MB
        // When a new SW activates, clean up previous-deploy precache entries
        // (old hashed chunks nothing references anymore).
        cleanupOutdatedCaches: true,
        // NOTE: NOT setting skipWaiting / clientsClaim. They were tried on
        // 2026-05-13 (e091b47) to close the in-session deploy gap, but
        // they fight `registerType: 'prompt'` — vite-plugin-pwa's docs
        // explicitly warn against mixing them. With both on, the new SW
        // claimed the current page mid-precache-install (asset-fetch
        // race), and on greg's iPhone Safari the chunk-load recovery
        // looped silently for 4-5 minutes before settling. Defaults pair
        // correctly with 'prompt'; `usePwaUpdater` (src/composables) is the
        // intended control surface — it auto-applies a waiting SW on a quiet
        // moment, which is why registerType stays 'prompt' (not 'autoUpdate').
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // Build SHA — populated by `deploy.yml` via `VITE_BUILD_SHA: ${{ github.sha }}`.
    // Falls back to 'dev' for local builds. Read at runtime via
    // `import.meta.env.VITE_BUILD_SHA` (the errorReporter ships this in
    // every Slack message so we can correlate bugs to specific deploys).
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(process.env.VITE_BUILD_SHA || 'dev'),
    // Build timestamp — evaluated when Vite builds. In CI that is the deploy
    // time; locally it's the local build time. Paired with the SHA to show a
    // human-readable "which version am I on?" marker on the welcome gate. No
    // CI wiring needed: `new Date()` runs at build time on the runner.
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(
      process.env.VITE_BUILD_TIME || new Date().toISOString()
    ),
  },
});
