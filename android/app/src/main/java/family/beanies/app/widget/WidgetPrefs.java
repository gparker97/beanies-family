package family.beanies.app.widget;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;

/**
 * Per-widget choices from {@link DayWidgetConfigActivity}, plus the read-outcome relay slot, in
 * `SharedPreferences("beanies_widgets")` (#130). The ONE place that knows the key format:
 * `<id>.audience`, `<id>.block.<kind>`, `<id>.opacity`, `<id>.textSize`, and `read_outcome`.
 *
 * A widget the launcher placed without running the configuration activity (Android 12+
 * `configuration_optional`) has no keys and reads the defaults: my day, every block on
 * (WIDGET_DEFAULT_BLOCKS in src/types/widgetSnapshot.ts), a 70% background ({@link #DEFAULT_OPACITY}),
 * Standard text.
 */
public final class WidgetPrefs {

    static final String FILE = "beanies_widgets";
    static final String KEY_READ_OUTCOME = "read_outcome";

    static final String AUDIENCE_MY = "my";
    static final String AUDIENCE_OUR = "our";

    /** The three background-opacity choices, in percent. */
    static final int[] OPACITIES = {100, 70, 40};
    /**
     * The background a widget starts with: a little wallpaper shows through, the text stays on
     * solid tiles. Same default as the iOS picker (`WidgetBackgroundOption.lighter`).
     */
    static final int DEFAULT_OPACITY = 70;

    /**
     * The text-size choice: the stored key and the factor on the system text size. The rule that
     * turns it into a multiplier (with the ceiling) is {@link WidgetSizes#textScale}; this enum is
     * only what is stored. Declaration order is the configuration screen's radio order.
     */
    enum TextSize {
        STANDARD("standard", 1f),
        LARGE("large", 1.15f),
        LARGER("larger", 1.3f);

        final String key;
        final float factor;

        TextSize(String key, float factor) {
            this.key = key;
            this.factor = factor;
        }

        /** The stored choice; absent or unknown reads as Standard (the same rule as opacity). */
        static TextSize fromKey(String key) {
            for (TextSize t : values()) if (t.key.equals(key)) return t;
            return STANDARD;
        }
    }

    final String audience;
    /** Indexed like {@link WidgetFill#FILL_ORDER}. */
    final boolean[] blocks;
    final int opacity;
    final TextSize textSize;

    WidgetPrefs(String audience, boolean[] blocks, int opacity, TextSize textSize) {
        this.audience = AUDIENCE_OUR.equals(audience) ? AUDIENCE_OUR : AUDIENCE_MY;
        this.blocks = blocks.clone();
        this.opacity = isKnownOpacity(opacity) ? opacity : DEFAULT_OPACITY;
        this.textSize = textSize == null ? TextSize.STANDARD : textSize;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static WidgetPrefs load(Context context, int appWidgetId) {
        SharedPreferences p = prefs(context);
        String prefix = appWidgetId + ".";
        boolean[] blocks = new boolean[WidgetFill.FILL_ORDER.length];
        for (int i = 0; i < blocks.length; i++) {
            String kind = WidgetFill.FILL_ORDER[i];
            blocks[i] = p.getBoolean(prefix + blockKey(kind), WidgetFill.isDefaultOn(kind));
        }
        return new WidgetPrefs(
                p.getString(prefix + "audience", AUDIENCE_MY),
                blocks,
                p.getInt(prefix + "opacity", DEFAULT_OPACITY),
                TextSize.fromKey(p.getString(prefix + "textSize", TextSize.STANDARD.key)));
    }

    @SuppressLint("ApplySharedPref") // see the commit() note below
    void save(Context context, int appWidgetId) {
        String prefix = appWidgetId + ".";
        SharedPreferences.Editor e = prefs(context).edit();
        e.putString(prefix + "audience", audience);
        for (int i = 0; i < blocks.length; i++) {
            e.putBoolean(prefix + blockKey(WidgetFill.FILL_ORDER[i]), blocks[i]);
        }
        e.putInt(prefix + "opacity", opacity);
        e.putString(prefix + "textSize", textSize.key);
        // commit, not apply: the activity renders straight after and must read these values.
        e.commit();
    }

    static void clear(Context context, int[] appWidgetIds) {
        SharedPreferences p = prefs(context);
        SharedPreferences.Editor e = p.edit();
        for (int id : appWidgetIds) {
            String prefix = id + ".";
            for (String key : p.getAll().keySet()) {
                if (key.startsWith(prefix)) e.remove(key);
            }
        }
        e.apply();
    }

    /** The most distinct failures held for one relay; the oldest is dropped once full. */
    private static final int MAX_OUTCOME_TOKENS = 4;
    /** The longest exception name a token carries (the app's token grammar, homeWidgetEvents.ts). */
    private static final int MAX_TOKEN_NAME = 40;

    /**
     * Records a failure for the next publish to relay ({@link #mergeOutcome}: the four most recent
     * distinct failures). Synchronised: callers run on the provider, the list factory's binder
     * thread, the plugin thread and the config activity. An evicted token is logged, so a drop is
     * never silent.
     */
    static synchronized void recordReadOutcome(Context context, String token) {
        SharedPreferences p = prefs(context);
        String stored = p.getString(KEY_READ_OUTCOME, "");
        String merged = mergeOutcome(stored, token);
        String oldest = stored == null || stored.isEmpty() ? "" : stored.split("\\|")[0];
        if (!oldest.isEmpty() && !hasToken(merged, oldest)) {
            Log.w(DayWidgetProvider.TAG, "widget failure dropped from the relay (four newer ones held): " + oldest);
        }
        p.edit().putString(KEY_READ_OUTCOME, merged).apply();
    }

    /**
     * Pure: {@code outcome} with {@code token} added as the newest, '|'-joined (the separator the
     * app splits on), distinct (re-adding a token moves it to newest) and at most four, the oldest
     * dropped first, so one pass that fails two ways keeps both and a new failure is never crowded
     * out by stale ones while the app stays closed. A null or empty token leaves it unchanged.
     * Used for the stored relay and by WidgetBridgePlugin to join its own tokens onto it.
     */
    public static String mergeOutcome(String outcome, String token) {
        String base = outcome == null ? "" : outcome;
        if (token == null || token.isEmpty()) return base;
        List<String> parts = new ArrayList<>();
        if (!base.isEmpty()) {
            for (String part : base.split("\\|")) {
                if (!part.isEmpty() && !part.equals(token)) parts.add(part);
            }
        }
        parts.add(token);
        while (parts.size() > MAX_OUTCOME_TOKENS) parts.remove(0);
        StringBuilder joined = new StringBuilder();
        for (String part : parts) {
            if (joined.length() > 0) joined.append('|');
            joined.append(part);
        }
        return joined.toString();
    }

    private static boolean hasToken(String outcome, String token) {
        for (String part : outcome.split("\\|")) {
            if (part.equals(token)) return true;
        }
        return false;
    }

    /** Read and clear the relayed read outcome; "" when there is none. */
    public static synchronized String takeReadOutcome(Context context) {
        SharedPreferences p = prefs(context);
        String value = p.getString(KEY_READ_OUTCOME, "");
        if (value != null && !value.isEmpty()) p.edit().remove(KEY_READ_OUTCOME).apply();
        return value == null ? "" : value;
    }

    /**
     * `<prefix>;<root cause>`: the simple name of the innermost cause, not the wrapper.
     * AppWidgetManager rethrows a binder failure (TransactionTooLargeException and the like) as a
     * plain RuntimeException, so the outer class alone says nothing. The name is reduced to the
     * app's token grammar ([A-Za-z_], at most 40) so it is never logged as "unrecognised";
     * "Unknown" for an anonymous class.
     */
    public static String failureToken(String prefix, Throwable e) {
        Throwable root = e;
        for (int hops = 0; hops < 10 && root.getCause() != null && root.getCause() != root; hops++) {
            root = root.getCause();
        }
        String name = root.getClass().getSimpleName().replaceAll("[^A-Za-z_]", "");
        if (name.length() > MAX_TOKEN_NAME) name = name.substring(0, MAX_TOKEN_NAME);
        return prefix + ";" + (name.isEmpty() ? "Unknown" : name);
    }

    /**
     * The stored key of a switch. "comingUp" is stored as "block.tripsAndBirthdays" on purpose:
     * round 9b changed that switch from the old "coming up" chips (off by default) to calendar
     * rows (on), so a widget set up on the old key must not carry its "off" over. Same rule as
     * the iOS intent's `tripsAndBirthdays` parameter. The old key is left unread.
     */
    private static String blockKey(String kind) {
        return "block." + (WidgetFill.COMING_UP.equals(kind) ? "tripsAndBirthdays" : kind);
    }

    private static boolean isKnownOpacity(int value) {
        for (int o : OPACITIES) if (o == value) return true;
        return false;
    }
}
