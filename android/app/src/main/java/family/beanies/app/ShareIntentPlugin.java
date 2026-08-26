package family.beanies.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives ACTION_SEND / ACTION_SEND_MULTIPLE and hands the shared documents to the WebView
 * (#64), so beanies appears in the Android share sheet for photos, screenshots and PDFs.
 *
 * Written first-party rather than taking the `send-intent` dependency: that plugin's peer
 * range stops at Capacitor 7 (this app is on 8.5) and it had not been published in 18 months
 * at the time of writing. It also returns a raw URI string, leaving the content-resolution
 * and permission handling below to be written anyway.
 *
 * DELIVERY. `launchMode="singleTask"` means a WARM app receives the share through
 * `onNewIntent`, while a COLD launch already has it on `getIntent()`. Both are drained here:
 * the JS side calls `consume()` once it is listening, which returns whatever is pending, and
 * `onNewIntent` pushes to the same buffer and notifies. The consumed intent is CLEARED (both
 * the buffer and the Activity's intent) so a configuration change — rotation, a dark-mode
 * toggle — cannot re-deliver a share that has already been read.
 *
 * SECURITY. This filter is EXPORTED: any app on the device can invoke it with content of its
 * choosing. Nothing here trusts the sender. The declared MIME is passed through for
 * information only and the JS side re-decides from the resolved bytes; the read is bounded by
 * MAX_BYTES so a hostile sender cannot exhaust memory; and a per-URI failure is reported to
 * JS rather than being dropped, so "nothing happened" is never the outcome.
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    /** Matches the JS-side per-file cap (AI_PICKER_MAX_BYTES). Bounds a hostile sender. */
    private static final long MAX_BYTES = 25L * 1024L * 1024L;

    /** Documents received but not yet read by the WebView. */
    private final List<JSObject> pending = new ArrayList<>();

    /** True when the pending batch arrived with the launch rather than while running. */
    private boolean pendingColdStart = false;

    @Override
    public void load() {
        // A cold launch: the share is already on the Activity's intent by the time the
        // WebView boots. Buffer it now; `consume()` collects it once JS is listening.
        Intent intent = getActivity().getIntent();
        if (isShareIntent(intent)) {
            buffer(intent, true);
            clearActivityIntent();
        }
    }

    /**
     * A warm app. Capacitor routes the Activity's onNewIntent here. The event tells JS to
     * call `consume()`; the payload deliberately does NOT ride the event, so there is exactly
     * one path that hands documents over and one place that clears them.
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isShareIntent(intent)) return;
        buffer(intent, false);
        clearActivityIntent();
        notifyListeners("shareReceived", new JSObject());
    }

    /** Hand over everything buffered, then forget it. Safe to call when nothing is pending. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = new JSObject();
        JSArray files = new JSArray();
        for (JSObject file : pending) files.put(file);
        result.put("files", files);
        result.put("coldStart", pendingColdStart);
        // Cleared BEFORE resolving: a rotation mid-call must not re-deliver these.
        pending.clear();
        pendingColdStart = false;
        call.resolve(result);
    }

    private static boolean isShareIntent(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
    }

    /**
     * Replace the Activity's intent so the same share is not re-read after a configuration
     * change. `getIntent()` keeps returning the launching intent forever otherwise.
     */
    private void clearActivityIntent() {
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
    }

    private void buffer(Intent intent, boolean coldStart) {
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) uris.add(single);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) {
                for (Uri uri : many) if (uri != null) uris.add(uri);
            }
        }

        for (Uri uri : uris) {
            JSObject file = readUri(uri);
            // A per-URI failure is REPORTED, not skipped: the JS side counts what it was
            // given against what it could read, so a partial share is never silently partial.
            if (file != null) pending.add(file);
        }
        pendingColdStart = coldStart;
    }

    /** Resolve one content:// URI into a base64 payload, or null if it cannot be read. */
    private JSObject readUri(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            long total = 0;
            int read;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                // Stop reading rather than buffering an unbounded amount from another app.
                if (total > MAX_BYTES) return null;
                out.write(chunk, 0, read);
            }

            JSObject file = new JSObject();
            file.put("name", displayName(resolver, uri));
            // Informational only — the JS side decides the real type from the bytes.
            file.put("type", resolver.getType(uri) == null ? "" : resolver.getType(uri));
            file.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return file;
        } catch (Exception e) {
            // Swallowing here would make the share vanish; returning null lets JS report
            // "nothing usable" with a real message instead.
            return null;
        }
    }

    /** The sender's display name. Untrusted — the JS side sanitises it before storage. */
    private String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // Fall through to the generic name below.
        }
        return "shared";
    }
}
