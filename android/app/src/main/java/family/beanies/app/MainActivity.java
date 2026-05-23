package family.beanies.app;

import com.getcapacitor.BridgeActivity;

/**
 * WebView-based WebAuthn (WebSettingsCompat.setWebAuthenticationSupport) was tried
 * for native biometric/passkeys and is a dead end on this stack (ADR-029):
 *   - WEB_AUTHENTICATION_SUPPORT_FOR_APP  → GMS returns an opaque
 *     CreateCredentialUnknownException ("unknown error talking to the credential
 *     manager") even though Digital-Asset-Links validate (Google's own checker
 *     reports linked:true) and the chooser/biometric/RegistrationActivity all fire.
 *   - WEB_AUTHENTICATION_SUPPORT_FOR_BROWSER → hard native crash inside the
 *     Chromium WebView (org.chromium.base.JniAndroid$UncaughtExceptionException)
 *     the instant navigator.credentials.create() runs.
 *
 * The device itself creates passkeys fine via Chrome and the installed PWA, so the
 * limitation is specifically the Capacitor WebView ↔ Credential Manager bridge.
 * With no setWebAuthenticationSupport call, the WebView leaves
 * window.PublicKeyCredential undefined, so isWebAuthnSupported() is false and the
 * app cleanly shows "biometric unavailable on this device — use your password"
 * (no crash, password sign-in unaffected). Native biometric, if pursued, will go
 * through a native Capacitor passkey plugin (own Credential Manager / ASAuthorization
 * calls), NOT this WebView path — see docs/plans/2026-05-23-native-pwa-biometric-login.md.
 */
public class MainActivity extends BridgeActivity {}
