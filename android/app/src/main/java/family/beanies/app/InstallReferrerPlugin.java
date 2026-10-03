package family.beanies.app;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Reads the Google Play install referrer, the `referrer=` string the Play Store link carried
 * (`utm_source`, `utm_medium`, ...), so a native install can be attributed to the ad or post
 * that sent the person to the store.
 *
 * Written first-party rather than taking a community plugin: those stop at Capacitor 7 (this
 * app is on 8.5), and the Play Install Referrer API is a single call.
 *
 * ONE-SHOT, BY THE CALLER. This plugin only reads; the JS side (`readInstallReferrerOnce`)
 * decides whether to ask at all and remembers that it did.
 *
 * TRANSIENT VS PERMANENT. Only a failure that can clear on a later launch REJECTS
 * (`SERVICE_UNAVAILABLE`, a disconnect, an exception during the read), so the JS side logs
 * `referrer-failed` and retries next launch. `FEATURE_NOT_SUPPORTED`, `DEVELOPER_ERROR` and
 * `PERMISSION_ERROR` will answer the same on every launch, so they RESOLVE `{ referrer: null }`
 * like a sideload: the JS side logs `referrer-absent`, sets its marker and stops asking,
 * instead of reporting the same warning on every boot forever.
 *
 * STALENESS IS THE CALLER'S CALL. Play keeps the referrer for the life of the install, so a
 * device that took this build as an UPGRADE answers with a referrer that may be months old.
 * The result therefore carries `installBeginSeconds` (`0` when Play does not know), and the
 * JS side drops a referrer whose install began longer ago than the tag's own lifetime.
 *
 * ONE ANSWER, ONE CONNECTION. Setup, a disconnect and a throwing `startConnection` can each end
 * the read; a `settled` flag lets only the first settle the call, and every path ends the client
 * connection so a failed read never leaves the Play service bound.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void get(final PluginCall call) {
        final InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        final AtomicBoolean settled = new AtomicBoolean(false);
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    if (!settled.compareAndSet(false, true)) {
                        // A disconnect already answered the call.
                        endQuietly(client);
                        return;
                    }
                    try {
                        switch (responseCode) {
                            case InstallReferrerClient.InstallReferrerResponse.OK: {
                                ReferrerDetails details = client.getInstallReferrer();
                                String referrer = details.getInstallReferrer();
                                JSObject result = new JSObject();
                                result.put(
                                        "referrer",
                                        referrer == null || referrer.isEmpty() ? null : referrer);
                                result.put(
                                        "installBeginSeconds",
                                        details.getInstallBeginTimestampSeconds());
                                call.resolve(result);
                                break;
                            }
                            case InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED:
                            case InstallReferrerClient.InstallReferrerResponse.DEVELOPER_ERROR:
                            case InstallReferrerClient.InstallReferrerResponse.PERMISSION_ERROR: {
                                // Permanent on this device: answer "no referrer" so the caller
                                // stops asking (see the class comment).
                                JSObject result = new JSObject();
                                result.put("referrer", JSObject.NULL);
                                result.put("installBeginSeconds", 0);
                                call.resolve(result);
                                break;
                            }
                            case InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE:
                                call.reject("install referrer SERVICE_UNAVAILABLE");
                                break;
                            default:
                                call.reject("install referrer response code " + responseCode);
                        }
                    } catch (Exception e) {
                        call.reject("install referrer read failed: " + e.getClass().getSimpleName(), e);
                    } finally {
                        endQuietly(client);
                    }
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    // Setup, when it won, ends the connection in its own finally.
                    if (!settled.compareAndSet(false, true)) return;
                    call.reject("install referrer SERVICE_DISCONNECTED");
                    endQuietly(client);
                }
            });
        } catch (Exception e) {
            if (settled.compareAndSet(false, true)) {
                call.reject("install referrer connect failed: " + e.getClass().getSimpleName(), e);
            }
            endQuietly(client);
        }
    }

    /** `endConnection` is idempotent; a throw from it must never escape the plugin method. */
    private static void endQuietly(InstallReferrerClient client) {
        try {
            client.endConnection();
        } catch (Exception ignored) {
            // Nothing left to release, and the call is already settled.
        }
    }
}
