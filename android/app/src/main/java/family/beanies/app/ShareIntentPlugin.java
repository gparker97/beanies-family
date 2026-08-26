package family.beanies.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Parcelable;
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

/**
 * Receives ACTION_SEND / ACTION_SEND_MULTIPLE and hands the shared documents to the WebView
 * (#64), so beanies appears in the Android share sheet for photos, screenshots and PDFs.
 *
 * Written first-party rather than taking the `send-intent` dependency: that plugin's peer
 * range stops at Capacitor 7 (this app is on 8.5) and it had not been published in 18 months.
 *
 * DELIVERY. `launchMode="singleTask"` means a WARM app receives the share through
 * `onNewIntent`, while a COLD launch already has it on `getIntent()`. Both are drained here:
 * the JS side calls `consume()` once it is listening, and `onNewIntent` notifies it. The
 * consumed intent is CLEARED so a configuration change cannot re-deliver a share.
 *
 * URIS ARE BUFFERED, BYTES ARE NOT. Only the `content://` URIs are captured on the intent
 * thread; the reads and Base64 encoding happen in `consume()`, which Capacitor runs on its
 * background HandlerThread. Doing the read at `load()` — which runs inside `onCreate`, before
 * the WebView is even loaded — meant a 20 MB PDF from a network-backed provider blocked the
 * UI thread through a binder read plus a full encode, which is an ANR at five seconds.
 *
 * SECURITY. This filter is EXPORTED: any app on the device can invoke it with content of its
 * choosing, so nothing here trusts the sender.
 *  - Unparcelling is wrapped: a hostile app can send an unknown-class Parcelable
 *    (BadParcelableException) or a non-Uri one (ClassCastException), and on the warm path
 *    there is NO framework catch above this — an uncaught throw there kills the process.
 *  - The item count is capped, not just the per-item size: twenty 25 MB photos would
 *    otherwise accumulate half a gigabyte of base64 before the JS side filters anything.
 *  - Failures are COUNTED and reported across the bridge, so a partial share can be reported
 *    as partial instead of looking like a small one.
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    /** Matches the JS-side per-file cap (AI_PICKER_MAX_BYTES). Bounds a hostile sender. */
    private static final long MAX_BYTES = 25L * 1024L * 1024L;

    /**
     * Most documents read from one share. Matches MAX_EXTRACT_PAGES on the JS side: the
     * extraction reads at most five pages, so decoding a sixth is provably wasted work.
     */
    private static final int MAX_ITEMS = 5;

    /** URIs received but not yet read. Guarded by `lock` — see the threading note above. */
    private final List<Uri> pending = new ArrayList<>();

    private final Object lock = new Object();

    /** True when the pending batch arrived with the launch rather than while running. */
    private boolean pendingColdStart = false;

    /** How many URIs the sender offered, including any dropped by MAX_ITEMS. */
    private int pendingOffered = 0;

    /**
     * Sender-attached text — a shared link, or prose around one (#64 links).
     *
     * Capped at MAX_TEXT_CHARS, which MIRRORS `MAX_SHARE_TEXT_CHARS` in
     * `src/services/share/types.ts`. That JS-side cap is the real one, applied for every
     * platform; this is defence-in-depth so an unbounded string never crosses the bridge.
     */
    private String pendingText = null;

    /** Mirrors MAX_SHARE_TEXT_CHARS in src/services/share/types.ts. */
    private static final int MAX_TEXT_CHARS = 4000;

    /** Sentinel: the URI was read fine, the file was simply empty. Not a failure. */
    private static final JSObject EMPTY_FILE = new JSObject();

    @Override
    public void load() {
        // A cold launch: the share is already on the Activity's intent by the time the
        // WebView boots. Capture the URIs only — the reads happen off this thread.
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

    /**
     * Read everything buffered and hand it over, then forget it.
     *
     * Runs on Capacitor's background HandlerThread, which is why the reads live here and why
     * the buffer is copied under the lock before any I/O — a share arriving mid-read would
     * otherwise mutate the list being iterated.
     */
    @PluginMethod
    public void consume(PluginCall call) {
        final List<Uri> batch;
        final boolean coldStart;
        final int offered;
        final String text;
        synchronized (lock) {
            batch = new ArrayList<>(pending);
            coldStart = pendingColdStart;
            offered = pendingOffered;
            text = pendingText;
            pending.clear();
            pendingColdStart = false;
            pendingOffered = 0;
            pendingText = null;
        }

        JSArray files = new JSArray();
        int read = 0;
        for (Uri uri : batch) {
            JSObject file = readUri(uri);
            if (file == null) continue;
            read += 1; // read successfully, even if the file turned out to be empty
            if (file != EMPTY_FILE) files.put(file);
        }

        JSObject result = new JSObject();
        result.put("files", files);
        result.put("coldStart", coldStart);
        // The JS side compares these: `offered > read` means the share was partial, which
        // must be said out loud rather than looking like a smaller share than it was.
        result.put("offered", offered);
        result.put("read", read);
        if (text != null) result.put("text", text);
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

    /** Capture the shared URIs. Never throws — see the unparcelling note in the header. */
    private void buffer(Intent intent, boolean coldStart) {
        List<Uri> uris = new ArrayList<>();
        int offered = 0;
        String text = null;
        try {
            CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (shared != null) {
                String value = shared.toString();
                text = value.length() > MAX_TEXT_CHARS ? value.substring(0, MAX_TEXT_CHARS) : value;
            }
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                Parcelable single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                offered = single == null ? 0 : 1;
                if (single instanceof Uri) uris.add((Uri) single);
            } else {
                ArrayList<Parcelable> many =
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (many != null) {
                    offered = many.size();
                    for (Parcelable item : many) {
                        if (uris.size() >= MAX_ITEMS) break;
                        if (item instanceof Uri) uris.add((Uri) item);
                    }
                }
            }
        } catch (Exception | Error e) {
            // A hostile Parcelable must not take the process down. `Error` is caught too:
            // an OutOfMemoryError on a huge parcel is not an Exception and would otherwise
            // escape every handler between here and the top of the warm-delivery path.
            android.util.Log.w("beanies-share", "could not read the shared intent", e);
            return;
        }

        synchronized (lock) {
            // A SHARE IS ATOMIC: its text and its files arrive in ONE intent.
            //
            // URIs append across intents so a cold-start batch is not lost when a warm share
            // lands before the WebView drains it. Text could not simply do the same: a link
            // buffered from share A would then be handed over beside share B's photo, and
            // `prepare`'s files-win rule would drop the link silently — unrecoverably, since
            // `clearActivityIntent()` has already run.
            //
            // So text presence marks a share boundary. If THIS intent carries text, or if
            // text from an earlier one is still pending, the buffer belongs to a different
            // share and is reset. Two file-only shares still append, which is the case the
            // appending was added for; a captioned photo keeps both, because they arrive in
            // the same call.
            if (text != null || pendingText != null) {
                pending.clear();
                pendingOffered = 0;
            }
            pendingText = text;
            // APPEND, never replace. A cold launch buffers at load(), and the JS side can
            // then sit in its readiness wait for up to ten seconds — a share arriving in
            // that window used to clear the first one. Still bounded by MAX_ITEMS overall.
            for (Uri uri : uris) {
                if (pending.size() >= MAX_ITEMS) break;
                pending.add(uri);
            }
            pendingOffered += offered;
            // A cold-start batch stays cold-start even if a warm one merges into it: the
            // app was launched BY a share either way, which is what the flag reports.
            pendingColdStart = pendingColdStart || coldStart;
        }
    }

    /** Resolve one content:// URI into a base64 payload, or null if it cannot be read. */
    private JSObject readUri(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            long total = 0;
            int count;
            while ((count = in.read(chunk)) != -1) {
                total += count;
                // Stop reading rather than buffering an unbounded amount from another app.
                if (total > MAX_BYTES) return null;
                out.write(chunk, 0, count);
            }
            // An empty file is a legitimate read, not a provider failure. It is filtered
            // on the JS side by size; counting it as unreadable here would make the
            // partial-share counter lie.
            if (total == 0) return EMPTY_FILE;

            String declared = resolver.getType(uri);
            JSObject file = new JSObject();
            file.put("name", displayName(resolver, uri));
            // Informational only — the JS side decides the real type from the bytes.
            file.put("type", declared == null ? "" : declared);
            file.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return file;
        } catch (Exception | Error e) {
            // Reported as a count via `read` vs `offered`, so it is never silently partial.
            android.util.Log.w("beanies-share", "could not read a shared document", e);
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
