package family.beanies.app.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;
import family.beanies.app.R;

/**
 * The "Your day" home-screen widget (#130). Java RemoteViews by decision (the project is
 * Java-only); the app computes everything in JS and this class only paints the snapshot.
 *
 * ONE RENDER PATH. {@link #renderAll(Context)} is the only way a widget is drawn: onUpdate,
 * onAppWidgetOptionsChanged (a resize), the RERENDER alarm, the configuration activity's Done and
 * the WidgetBridge plugin's publish/clear all call it. It reads the snapshot once, renders every
 * placed id with that id's own size and prefs, then re-arms the single re-render alarm. On API
 * 31+ the medium/large calendar list travels inside that one update ({@link DayWidgetList#INLINE});
 * only API 24-30 serves it through DayWidgetService and needs notifyAppWidgetViewDataChanged.
 *
 * THE ALARM. One inexact {@code setAndAllowWhileIdle(RTC)} for the earliest of: the next local
 * midnight (tomorrow becomes today), the next row end today (the row greys out), the instant the
 * snapshot turns 24 hours old ("as of"), the weather's `ageFrom` / `currentUntil` (its age shows,
 * its temperature goes; {@link WidgetWeather#nextChange}), or, for an unreadable file, 15 minutes (a transient read
 * failure heals without the app). No exact alarm: a widget a few minutes late is fine. Alarms do
 * not survive a reboot; the host calls onUpdate after boot, which re-arms it.
 *
 * THE BACKSTOP. `updatePeriodMillis` (widget_day_info.xml) also has the system call onUpdate about
 * every 30 minutes. It is not what moves the date: it re-sends the current picture on the same
 * path, so it covers a missed alarm, not a launcher that drops updates. That case (a Pixel 10 Pro
 * on Android 17 kept yesterday on the two list-bearing sizes while the 2x2 updated from the same
 * pass, 2026-10-14 and 10-16; the re-send did not heal it) is what the inline list addresses.
 *
 * Not exported: the launcher's APPWIDGET_UPDATE / OPTIONS_CHANGED / DELETED / DISABLED come from
 * the system (which reaches a non-exported receiver), and RERENDER only from our own
 * PendingIntent, so no other app can drive a render.
 */
public class DayWidgetProvider extends AppWidgetProvider {

    /** The widget's one logcat tag, shared by every widget class and WidgetBridgePlugin. */
    public static final String TAG = "beanies-widget";
    static final String ACTION_RERENDER = "family.beanies.app.widget.RERENDER";
    private static final long UNREADABLE_RETRY_MS = 15L * 60L * 1000L;
    private static final Object LOCK = new Object();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        renderAll(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(
            Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        renderAll(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_RERENDER.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_LOCALE_CHANGED.equals(action)) {
            // A zone or clock change moves "today" and midnight; a locale change re-reads the
            // native strings. Each re-renders and re-arms the alarm from the new clock.
            renderAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        WidgetPrefs.clear(context, appWidgetIds);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(rerenderIntent(context));
    }

    /**
     * Render every placed widget from one snapshot read and re-arm the alarm. Safe from any
     * thread (the plugin calls it from Capacitor's background thread); serialised so a publish
     * and an alarm cannot interleave their updates. Returns the `ymd` the widgets painted
     * ({@link WidgetFill#renderedYmd}), or null when nothing dated was painted.
     */
    public static String renderAll(Context context) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            AppWidgetManager manager = AppWidgetManager.getInstance(app);
            int[] ids = manager.getAppWidgetIds(new ComponentName(app, DayWidgetProvider.class));
            WidgetSnapshotStore.Result result = WidgetSnapshotStore.read(app);
            long now = System.currentTimeMillis();
            for (int id : ids) {
                Bundle options = manager.getAppWidgetOptions(id);
                WidgetSizes.Size size = WidgetSizes.sizeFor(options);
                float widthDp = WidgetSizes.widthDp(options, size);
                WidgetPrefs prefs = WidgetPrefs.load(app, id);
                float textScale = WidgetSizes.textScale(app, prefs.textSize);
                float heightDp = WidgetSizes.layoutHeightDp(app, options, textScale);
                RemoteViews views;
                try {
                    views = DayWidgetRenderer.build(
                            app, id, size, widthDp, heightDp, prefs, textScale, result, now);
                } catch (RuntimeException e) {
                    // A malformed snapshot must not leave the widget on "Can't load widget".
                    Log.w(TAG, "widget render failed; showing the refresh state", e);
                    WidgetPrefs.recordReadOutcome(app, "render_failed");
                    views = DayWidgetRenderer.build(
                            app, id, size, widthDp, heightDp, prefs, textScale,
                            WidgetSnapshotStore.Result.unreadableForRender(), now);
                }
                try {
                    manager.updateAppWidget(id, views);
                    if (size != WidgetSizes.Size.SMALL && !DayWidgetList.INLINE) {
                        manager.notifyAppWidgetViewDataChanged(id, R.id.agenda_list);
                    }
                } catch (RuntimeException e) {
                    // One instance the system refuses must not stop the others from updating or
                    // the alarm from re-arming (that left every widget on yesterday until the app
                    // was opened). Relayed on the next publish as `reload_failed;<root cause>`.
                    Log.w(TAG, "widget " + id + " update refused", e);
                    WidgetPrefs.recordReadOutcome(app, WidgetPrefs.failureToken("reload_failed", e));
                }
            }
            schedule(app, result, now, ids.length > 0);
            return WidgetFill.renderedYmd(result, now);
        }
    }

    private static void schedule(Context context, WidgetSnapshotStore.Result result, long now, boolean placed) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        PendingIntent pending = rerenderIntent(context);
        long at = placed ? nextRender(result, now) : -1;
        if (at <= 0) {
            alarms.cancel(pending);
            return;
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC, at, pending);
    }

    /** The next instant the widget's picture changes on its own, or -1 for "never". */
    static long nextRender(WidgetSnapshotStore.Result result, long now) {
        switch (result.state) {
            case SIGNED_OUT:
                return -1;
            case UNREADABLE:
                return now + UNREADABLE_RETRY_MS;
            default:
                break;
        }
        long at = WidgetFill.nextMidnight(now);
        long generated = WidgetFill.parseIso(result.snapshot.generatedAt);
        if (generated > 0 && generated + WidgetFill.STALE_AFTER_MS > now) {
            at = Math.min(at, generated + WidgetFill.STALE_AFTER_MS);
        }
        // Row ends across BOTH audiences of today's entry, so every placed widget is covered.
        String today = WidgetFill.ymd(now, 0);
        for (WidgetSnapshot.DayEntry entry : result.snapshot.days) {
            if (!today.equals(entry.ymd)) continue;
            at = Math.min(at, earliestEnd(entry.my, now));
            at = Math.min(at, earliestEnd(entry.our, now));
        }
        // The weather's age line appears or its temperature goes: instants the snapshot carries.
        at = Math.min(at, WidgetWeather.nextChange(result.snapshot.weather, now));
        return at;
    }

    private static long earliestEnd(WidgetSnapshot.Day day, long now) {
        long at = Long.MAX_VALUE;
        if (day == null) return at;
        for (WidgetSnapshot.Row row : day.rows) {
            // +1s so the render lands strictly after the end instant (`endsAt < now` is past).
            if (row.endsAt != null && row.endsAt >= now) at = Math.min(at, row.endsAt + 1000L);
        }
        return at;
    }

    private static PendingIntent rerenderIntent(Context context) {
        Intent intent = new Intent(ACTION_RERENDER);
        intent.setClass(context, DayWidgetProvider.class);
        return PendingIntent.getBroadcast(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
