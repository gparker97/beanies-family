package family.beanies.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "beanies";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableWebAuthnIfSupported();
    }

    /**
     * Enable WebAuthn (passkeys / biometric login) inside the Capacitor WebView,
     * routed through the Android Credential Manager. App-scoped — passkeys for the
     * app's associated domain only (see the WebAuthn Digital Asset Links at
     * https://app.beanies.family/.well-known/assetlinks.json), NOT browser-scoped.
     *
     * Feature-detected: older System WebViews lack WEB_AUTHENTICATION, in which case
     * window.PublicKeyCredential stays undefined in JS and biometric unlock falls
     * back to password (Tier 3). Never crash the Activity over this. See ADR-029 and
     * docs/plans/2026-05-23-native-pwa-biometric-login.md.
     */
    private void enableWebAuthnIfSupported() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
                Log.w(TAG, "WebView WEB_AUTHENTICATION feature unsupported on this System WebView; "
                        + "biometric unlock falls back to password (ADR-029).");
                return;
            }
            WebSettings settings = getBridge().getWebView().getSettings();
            WebSettingsCompat.setWebAuthenticationSupport(
                    settings,
                    WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        } catch (Exception e) {
            // Developer breadcrumb — JS can't observe native enablement state.
            Log.w(TAG, "Failed to enable WebView WebAuthn; biometric unlock falls back to password "
                    + "(ADR-029).", e);
        }
    }
}
