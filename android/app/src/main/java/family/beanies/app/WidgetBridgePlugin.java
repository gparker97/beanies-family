package family.beanies.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import family.beanies.app.widget.DayWidgetProvider;
import family.beanies.app.widget.WidgetPrefs;
import family.beanies.app.widget.WidgetSizes;
import family.beanies.app.widget.WidgetSnapshotStore;
import java.io.IOException;

/**
 * The app's side of the home-screen widget (#130, ADR-042; JS: src/services/native/widgetBridgePlugin.ts).
 *
 * `publish({ json })` writes the snapshot the app built (WidgetSnapshotStore owns the path and
 * the atomic write), re-renders every placed widget, and answers with the placements by size and
 * the widget's last read failure, which is the only route from the widget to the firehose.
 * `clear()` deletes the snapshot at sign-out so every placed widget shows "open beanies".
 *
 * Reject codes (documented on the TS interface): `write_failed`; and from `clear()` only,
 * `reload_failed` (the file is gone but the re-render failed, so the launcher still shows the
 * last views). In `publish` a render failure after a good write does NOT reject (the snapshot is
 * on disk and the next render picks it up); it is relayed as a `reload_failed;<Exception>` token.
 *
 * Capacitor runs plugin methods on its background handler thread, so the file I/O and the render
 * stay off the UI thread.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void publish(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("missing json", "write_failed");
            return;
        }
        Context context = getContext();
        try {
            WidgetSnapshotStore.write(context, json);
        } catch (IOException | RuntimeException e) {
            call.reject("widget snapshot write failed: " + e.getClass().getSimpleName(), "write_failed", toException(e));
            return;
        }
        Render render = render(context);

        JSObject ret = new JSObject();
        JSObject counts = new JSObject();
        String placementsFailure = placements(context, counts);
        ret.put("placements", counts);
        if (render.ymd != null) ret.put("renderedYmd", render.ymd);
        String reloadFailure = render.failure;
        // The stored failures, then this publish's own (newest), joined by the same rule as the
        // store (distinct, at most four), so one failure seen twice is relayed once.
        String outcome = WidgetPrefs.takeReadOutcome(context);
        for (String token : new String[] {reloadFailure, placementsFailure}) {
            outcome = WidgetPrefs.mergeOutcome(outcome, token);
        }
        if (!outcome.isEmpty()) ret.put("readOutcome", outcome);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        try {
            WidgetSnapshotStore.delete(context);
        } catch (IOException | RuntimeException e) {
            call.reject(
                    "widget snapshot delete failed; family content may remain on the home screen",
                    "write_failed",
                    toException(e));
            return;
        }
        // The file is gone, but the launcher keeps the last views until we re-render: a failed
        // re-render leaves the family's day on the home screen, so sign-out must hear about it.
        String reloadFailure = render(context).failure;
        if (reloadFailure != null) {
            call.reject(
                    "widget re-render after delete failed; family content may remain on the home screen ("
                            + reloadFailure + ")",
                    "reload_failed");
            return;
        }
        call.resolve();
    }

    /** One re-render's outcome: the `ymd` painted (null if nothing dated), or the failure token. */
    private static final class Render {
        final String ymd;
        /** A `reload_failed;<token>` line, or null on success. */
        final String failure;

        Render(String ymd, String failure) {
            this.ymd = ymd;
            this.failure = failure;
        }
    }

    /** Re-render every placed widget. */
    private static Render render(Context context) {
        try {
            return new Render(DayWidgetProvider.renderAll(context), null);
        } catch (RuntimeException e) {
            android.util.Log.w(DayWidgetProvider.TAG, "widget render after publish failed", e);
            return new Render(null, WidgetPrefs.failureToken("reload_failed", e));
        }
    }

    /**
     * Count placed widgets of our provider into {@code counts} by size key (`android-2x2` /
     * `-4x2` / `-4x3`). Returns a `placements_failed;<Exception>` token on failure, else null.
     */
    private static String placements(Context context, JSObject counts) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, DayWidgetProvider.class));
            for (int id : ids) {
                String key = WidgetSizes.sizeFor(manager.getAppWidgetOptions(id)).key;
                counts.put(key, counts.optInt(key, 0) + 1);
            }
        } catch (RuntimeException e) {
            android.util.Log.w(DayWidgetProvider.TAG, "could not count widget placements", e);
            return WidgetPrefs.failureToken("placements_failed", e);
        }
        return null;
    }

    private static Exception toException(Throwable t) {
        return t instanceof Exception ? (Exception) t : new Exception(t);
    }
}
