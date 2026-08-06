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
  // NOTE (2026-08-06): do NOT add `iosScheme: 'https'` here — it is silently
  // ignored, so it looks like a fix and changes nothing. `CAPInstanceDescriptor
  // .normalize()` accepts a scheme only when `WKWebView.handlesURLScheme(scheme)
  // == false`; `https` is reserved by WKWebView, so the value is discarded and
  // reset to the default `capacitor`. The iOS origin therefore IS and must stay
  // `capacitor://app.beanies.family` — the comment above describes ANDROID only
  // (Android's WebViewAssetLoader does support an https scheme). Tried and
  // reverted in build 8; the real iOS nav bugs are the /oauth/native universal
  // link, not the scheme.
  server: {
    androidScheme: 'https',
    hostname: 'app.beanies.family',
  },
  // Native biometric uses the hardware Keystore via the custom `BiometricKeystore`
  // plugin (no WebAuthn/RP-ID/assetlinks). The retired @capgo/capacitor-passkey shim
  // config was removed with it (ADR-029, 2026-07-14). Web/PWA keeps WebAuthn-PRF.
  plugins: {
    LocalNotifications: {
      // Without this, @capacitor/local-notifications falls back to
      // `android.R.drawable.ic_dialog_info` (LocalNotificationManager.java:469) —
      // Android's stock "i" glyph, which is what every beanies notification showed
      // until 2026-07-23. Applies to EVERY notification the app posts.
      //
      // The drawable MUST be an alpha-only silhouette: Android renders the small
      // icon from the alpha channel and discards colour, so a full-colour asset
      // becomes a white blob. See the comments in the drawable itself.
      smallIcon: 'ic_stat_beanie_bell',
      // Heritage Orange — the accent Android draws alongside the silhouette.
      iconColor: '#F15D22',
    },
  },
};

export default config;
