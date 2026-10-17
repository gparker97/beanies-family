package family.beanies.app.widget;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The ONE owner of the widget snapshot file, `filesDir/widgets/snapshot.json` (#130, ADR-042).
 * The plugin writes and deletes through here; the provider and the list factory read through
 * here. Nothing else knows the path.
 *
 * Three read outcomes, never conflated:
 *  - file absent → {@link State#SIGNED_OUT} ("open beanies" / "sign in to see your day");
 *  - present but unreadable (I/O) or undecodable / a version outside
 *    {@link WidgetSnapshot#MIN_VERSION}..{@link WidgetSnapshot#MAX_VERSION} → {@link State#UNREADABLE}
 *    ("open beanies to refresh"), and a fixed token is left in prefs for the plugin to relay to
 *    the firehose on the next publish (`read_failed` | `decode_failed;v=<n>`);
 *  - decoded → {@link State#READY}.
 * A read never throws into the provider.
 *
 * Writes go through {@link AtomicFile} (temp-then-rename, and openRead() recovers a backup left
 * by an interrupted write), so the widget never reads a half-written snapshot.
 */
public final class WidgetSnapshotStore {

    private static final String TAG = DayWidgetProvider.TAG;
    private static final String DIR = "widgets";
    private static final String FILE = "snapshot.json";
    /** Bounds a read: the real snapshot is a few KB. A runaway file is treated as unreadable. */
    private static final int MAX_BYTES = 512 * 1024;

    public enum State {
        SIGNED_OUT,
        UNREADABLE,
        READY
    }

    public static final class Result {
        public final State state;
        /** Non-null only when {@link #state} is READY. */
        final WidgetSnapshot snapshot;

        private Result(State state, WidgetSnapshot snapshot) {
            this.state = state;
            this.snapshot = snapshot;
        }

        /** The refresh state for a snapshot that decoded but could not be painted. */
        static Result unreadableForRender() {
            return new Result(State.UNREADABLE, null);
        }
    }

    private WidgetSnapshotStore() {}

    private static AtomicFile file(Context context) {
        File dir = new File(context.getFilesDir(), DIR);
        return new AtomicFile(new File(dir, FILE));
    }

    /** Read and decode the snapshot. Never throws. */
    public static Result read(Context context) {
        AtomicFile atomic = file(context);
        // AtomicFile keeps a ".bak" while a write is in flight; openRead() restores it, so a
        // backup alone still counts as "present". Absent means neither exists.
        File base = atomic.getBaseFile();
        File backup = new File(base.getPath() + ".bak");
        if (!base.exists() && !backup.exists()) {
            return new Result(State.SIGNED_OUT, null);
        }
        String json;
        try (FileInputStream in = atomic.openRead()) {
            json = readAll(in);
        } catch (FileNotFoundException e) {
            // Deleted between the exists() check and the open: a sign-out raced the read.
            return new Result(State.SIGNED_OUT, null);
        } catch (IOException | RuntimeException e) {
            return unreadable(context, "read_failed", e);
        }
        try {
            JSONObject root = new JSONObject(json);
            int version = root.optInt("version", -1);
            // Any version this reader knows (v2 and v3); outside the range the detail names the
            // version it saw, so the firehose can tell an old reader from a damaged file.
            if (!WidgetSnapshot.isReadable(version)) {
                return unreadable(context, "decode_failed;v=" + version, null);
            }
            return new Result(State.READY, WidgetSnapshot.from(root));
        } catch (JSONException | RuntimeException e) {
            return unreadable(context, "decode_failed;v=unknown", e);
        }
    }

    /** Atomically replace the snapshot. Throws so the plugin can reject with `write_failed`. */
    public static void write(Context context, String json) throws IOException {
        AtomicFile atomic = file(context);
        File dir = atomic.getBaseFile().getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("could not create the widgets directory");
        }
        FileOutputStream out = null;
        try {
            out = atomic.startWrite();
            out.write(json.getBytes(StandardCharsets.UTF_8));
            atomic.finishWrite(out);
        } catch (IOException | RuntimeException e) {
            if (out != null) atomic.failWrite(out);
            throw e instanceof IOException ? (IOException) e : new IOException(e);
        }
    }

    /** Remove the snapshot (absent = success). Throws when a file is still there afterwards. */
    public static void delete(Context context) throws IOException {
        AtomicFile atomic = file(context);
        atomic.delete();
        File base = atomic.getBaseFile();
        if (base.exists() || new File(base.getPath() + ".bak").exists()) {
            throw new IOException("the widget snapshot could not be deleted");
        }
    }

    private static Result unreadable(Context context, String token, Throwable cause) {
        Log.w(TAG, "widget snapshot unreadable: " + token, cause);
        WidgetPrefs.recordReadOutcome(context, token);
        return new Result(State.UNREADABLE, null);
    }

    private static String readAll(FileInputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(chunk)) != -1) {
            total += n;
            if (total > MAX_BYTES) throw new IOException("snapshot larger than " + MAX_BYTES);
            out.write(chunk, 0, n);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
