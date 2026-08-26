package family.beanies.app;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Native biometric unlock uses the hardware Keystore via the custom
 * `BiometricKeystorePlugin` (BiometricPrompt + AndroidKeyStore CryptoObject), NOT
 * WebAuthn — the WebView↔Credential Manager bridge (and WebAuthn-PRF over it) was a
 * dead end on this stack (ADR-029, 2026-07-14). Web/PWA keeps WebAuthn-PRF.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate() (Capacitor's plugin-
        // registration contract). #53 WindowBackground paints the status-bar strip to
        // match the in-app theme; #52 BiometricKeystore does hardware biometric unlock.
        registerPlugin(WindowBackgroundPlugin.class);
        registerPlugin(BiometricKeystorePlugin.class);
        // #64 ShareIntent receives ACTION_SEND / ACTION_SEND_MULTIPLE so beanies appears in
        // the system share sheet. launchMode="singleTask" (manifest) means a warm app gets
        // the intent via onNewIntent, which Capacitor routes to the plugin.
        registerPlugin(ShareIntentPlugin.class);
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
