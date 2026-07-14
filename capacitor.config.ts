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
  // Native biometric uses the hardware Keystore via the custom `BiometricKeystore`
  // plugin (no WebAuthn/RP-ID/assetlinks). The retired @capgo/capacitor-passkey shim
  // config was removed with it (ADR-029, 2026-07-14). Web/PWA keeps WebAuthn-PRF.
};

export default config;
