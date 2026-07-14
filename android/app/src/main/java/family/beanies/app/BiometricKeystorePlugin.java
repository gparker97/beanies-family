package family.beanies.app;

import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed, biometric-gated storage for the family AES key (#52 Keystore
 * pivot, ADR-029 2026-07-14). Replaces the retired native WebAuthn-PRF path; web/PWA
 * keeps WebAuthn-PRF.
 *
 * An AES-256-GCM key in the AndroidKeyStore, `setUserAuthenticationRequired(true)` +
 * `setInvalidatedByBiometricEnrollment(true)`, is used ONLY through a `BiometricPrompt`
 * `CryptoObject`, so the wrapped family key is released only after a live biometric.
 * The wrapped blob (iv||ciphertext) is device-local in SharedPreferences. Per-op auth
 * binding: `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` on API 30+,
 * `setUserAuthenticationValidityDurationSeconds(-1)` on 24–29. StrongBox best-effort.
 *
 * All rejects carry a typed code (userCancel/notEnrolled/lockout/invalidated/unknown)
 * — never a raw platform string reaches JS.
 */
@CapacitorPlugin(name = "BiometricKeystore")
public class BiometricKeystorePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFS = "beanies_biometric";
    private static final String ALIAS_PREFIX = "beanies_bk_";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_LEN = 12;

    private static String aliasFor(String account) {
        return ALIAS_PREFIX + account;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    // --- isAvailable ---

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            int status = BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            boolean ok = status == BiometricManager.BIOMETRIC_SUCCESS;
            ret.put("available", ok);
            ret.put("biometryType", "fingerprint");
            if (!ok) ret.put("reason", "status_" + status);
        } catch (Exception e) {
            ret.put("available", false);
            ret.put("reason", "error");
        }
        call.resolve(ret);
    }

    // --- setKey (enable): wrap the family key behind a live biometric ---

    @PluginMethod
    public void setKey(final PluginCall call) {
        final String account = call.getString("account");
        final String keyB64 = call.getString("keyB64");
        if (account == null || account.isEmpty() || keyB64 == null || keyB64.isEmpty()) {
            call.reject("account and keyB64 are required", "unknown");
            return;
        }
        final byte[] raw;
        try {
            raw = Base64.decode(keyB64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject("invalid keyB64", "unknown");
            return;
        }

        final String[] backing = new String[1];
        final Cipher cipher;
        try {
            // Fresh key per enable (last-writer-wins) — drop any prior alias.
            deleteAlias(account);
            SecretKey key = generateKey(account, backing);
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (Exception e) {
            call.reject("keygen failed", "unknown", e);
            return;
        }

        promptAndFinish(call, cipher, "Enable biometric unlock", (finished) -> {
            try {
                byte[] iv = finished.getIV();
                byte[] ct = finished.doFinal(raw);
                java.util.Arrays.fill(raw, (byte) 0);
                byte[] blob = new byte[IV_LEN + ct.length];
                System.arraycopy(iv, 0, blob, 0, IV_LEN);
                System.arraycopy(ct, 0, blob, IV_LEN, ct.length);
                prefs().edit().putString(account, Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
                JSObject ret = new JSObject();
                ret.put("keyBacking", backing[0]);
                call.resolve(ret);
            } catch (Exception e) {
                deleteAlias(account);
                call.reject("wrap failed", "unknown", e);
            }
        });
    }

    // --- getKey (unlock): prompt biometric, unwrap, return the family key ---

    @PluginMethod
    public void getKey(final PluginCall call) {
        final String account = call.getString("account");
        if (account == null || account.isEmpty()) {
            call.reject("account is required", "unknown");
            return;
        }
        final String stored = prefs().getString(account, null);
        if (stored == null) {
            call.reject("no key for account", "invalidated");
            return;
        }
        final byte[] blob;
        try {
            blob = Base64.decode(stored, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            call.reject("corrupt blob", "invalidated");
            return;
        }
        if (blob.length <= IV_LEN) {
            call.reject("corrupt blob", "invalidated");
            return;
        }
        byte[] iv = new byte[IV_LEN];
        final byte[] ct = new byte[blob.length - IV_LEN];
        System.arraycopy(blob, 0, iv, 0, IV_LEN);
        System.arraycopy(blob, IV_LEN, ct, 0, ct.length);

        final Cipher cipher;
        try {
            SecretKey key = loadKey(account);
            if (key == null) {
                call.reject("key missing", "invalidated");
                return;
            }
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        } catch (KeyPermanentlyInvalidatedException e) {
            // Biometrics changed → key wiped. Caller clears the record + re-enrolls.
            call.reject("key invalidated", "invalidated");
            return;
        } catch (Exception e) {
            call.reject("cipher init failed", "unknown", e);
            return;
        }

        promptAndFinish(call, cipher, "Unlock beanies.family", (finished) -> {
            try {
                byte[] plain = finished.doFinal(ct);
                String out = Base64.encodeToString(plain, Base64.NO_WRAP);
                java.util.Arrays.fill(plain, (byte) 0);
                JSObject ret = new JSObject();
                ret.put("keyB64", out);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("unwrap failed", "invalidated", e);
            }
        });
    }

    // --- hasKey / deleteKey ---

    @PluginMethod
    public void hasKey(PluginCall call) {
        String account = call.getString("account");
        JSObject ret = new JSObject();
        boolean present = false;
        if (account != null && !account.isEmpty()) {
            try {
                present = prefs().contains(account) && loadKey(account) != null;
            } catch (Exception e) {
                present = false;
            }
        }
        ret.put("present", present);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String account = call.getString("account");
        if (account != null && !account.isEmpty()) {
            prefs().edit().remove(account).apply();
            deleteAlias(account);
        }
        call.resolve();
    }

    // --- BiometricPrompt bridge ---

    private interface CipherConsumer {
        void accept(Cipher cipher);
    }

    private void promptAndFinish(
        final PluginCall call,
        final Cipher cipher,
        final String title,
        final CipherConsumer onSuccess
    ) {
        final FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            call.reject("no activity", "unknown");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle("Confirm it's you")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Use password")
                    .build();
                BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            call.reject("biometric error", mapError(errorCode));
                        }

                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            BiometricPrompt.CryptoObject co = result.getCryptoObject();
                            Cipher c = co != null ? co.getCipher() : null;
                            if (c == null) {
                                call.reject("no cipher", "unknown");
                                return;
                            }
                            onSuccess.accept(c);
                        }

                        // onAuthenticationFailed = a single non-match; the prompt stays
                        // open for another try, so we do NOT reject here.
                    }
                );
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception e) {
                call.reject("prompt failed", "unknown", e);
            }
        });
    }

    private static String mapError(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "userCancel";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockout";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "notEnrolled";
            default:
                return "unknown";
        }
    }

    // --- Keystore helpers ---

    private SecretKey generateKey(String account, String[] backingOut) throws Exception {
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        // Build with StrongBox first (best-effort); fall back to TEE if unavailable.
        try {
            gen.init(specBuilder(account, true).build());
            SecretKey key = gen.generateKey();
            backingOut[0] = "strongbox";
            return key;
        } catch (Exception e) {
            if (!(e instanceof StrongBoxUnavailableException) && !(e.getCause() instanceof StrongBoxUnavailableException)) {
                // Not a StrongBox problem — rethrow.
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                    // Pre-P: StrongBox API doesn't exist; the first init used no StrongBox already.
                    throw e;
                }
            }
            gen.init(specBuilder(account, false).build());
            SecretKey key = gen.generateKey();
            backingOut[0] = "tee";
            return key;
        }
    }

    private KeyGenParameterSpec.Builder specBuilder(String account, boolean strongBox) {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
            aliasFor(account),
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+: require a fresh STRONG biometric for EVERY crypto op (0 = per-use).
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // API 24–29: -1 = require biometric auth for each key use via CryptoObject.
            b.setUserAuthenticationValidityDurationSeconds(-1);
        }
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            b.setIsStrongBoxBacked(true);
        }
        return b;
    }

    private SecretKey loadKey(String account) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        return (SecretKey) ks.getKey(aliasFor(account), null);
    }

    private void deleteAlias(String account) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(aliasFor(account))) {
                ks.deleteEntry(aliasFor(account));
            }
        } catch (Exception e) {
            // best-effort
        }
    }
}
