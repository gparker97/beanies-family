package family.beanies.app;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * WebView-based WebAuthn (WebSettingsCompat.setWebAuthenticationSupport) is a dead
 * end on this stack and is intentionally NOT enabled (ADR-029): FOR_APP returned an
 * opaque CreateCredentialUnknownException and FOR_BROWSER hard-crashed the Chromium
 * WebView. Native biometric instead goes through the @capgo/capacitor-passkey plugin
 * (its own Credential Manager calls, shimmed in main.ts), so this Activity stays a
 * plain BridgeActivity for auth. The device creates passkeys fine via Chrome/PWA —
 * the limitation was specifically the WebView ↔ Credential Manager bridge.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Edge-to-edge system bars, done natively. The @capacitor/status-bar plugin
        // only uses deprecated APIs (setSystemUiVisibility / setStatusBarColor) that
        // are no-ops on Android 15+, and the app targets SDK 36, where edge-to-edge
        // is enforced and a painted status bar is impossible — so the bar showed the
        // system's translucent contrast scrim ("transparent black"). Instead, let the
        // WebView draw under transparent bars (its own background shows through and
        // blends, tracking light/dark in CSS) and turn OFF the auto contrast scrim.
        // The layout pads content via env(safe-area-inset-*); icon contrast is set in
        // JS via StatusBar.setStyle. Both calls are guarded by API level (minSdk 24).
        // See ADR-029.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        // Render web text at the same size as the mobile browser / installed PWA.
        // The Android System WebView otherwise scales text by the OS font-size
        // setting (textZoom); because the whole app is rem-based, that scales the
        // ENTIRE layout — not just text — so a below-default OS font shrinks the
        // whole UI versus the PWA (which renders web content at a fixed 100%).
        // beanies' own Settings → Appearance → Text size (Large reading mode) is
        // the in-app accessibility control, so the OS font scale must not
        // double-apply here. See ADR-029.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
        }
    }
}
