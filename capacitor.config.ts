import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'family.beanies.app',
  appName: 'beanies.family',
  webDir: 'dist',
  // Serve the bundled app under the production app origin so the WebView's
  // document origin is `https://app.beanies.family`. Content is still the LOCAL
  // bundle (Capacitor just labels the origin); the app fetches only from
  // api.beanies.family / googleapis, so there's no local-vs-network proxy
  // conflict, and OAuth requests originate from the already-CORS-allowlisted
  // app origin. See ADR-029 and docs/plans/2026-05-23-native-pwa-biometric-login.md.
  server: {
    androidScheme: 'https',
    hostname: 'app.beanies.family',
  },
  // Native biometric/passkeys go through the native Credential Manager (Android)
  // / ASAuthorization (iOS) via @capgo/capacitor-passkey's WebAuthn shim — NOT
  // the WebView's own WebAuthn (which dead-ended: FOR_APP errored, FOR_BROWSER
  // crashed). `origin` is the WebAuthn origin the native call presents; `domains`
  // is the RP-ID allowlist. The shim is installed only on native (main.ts), so
  // web/PWA use the real browser WebAuthn untouched. See ADR-029.
  plugins: {
    CapacitorPasskey: {
      origin: 'https://app.beanies.family',
      domains: ['app.beanies.family'],
    },
  },
};

export default config;
