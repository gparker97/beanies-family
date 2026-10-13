package family.beanies.app.widget;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;

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

    /** The widget's last read failure, for the plugin to relay. The later token wins. */
    static void recordReadOutcome(Context context, String token) {
        prefs(context).edit().putString(KEY_READ_OUTCOME, token).apply();
    }

    /** Read and clear the relayed read outcome; "" when there is none. */
    public static String takeReadOutcome(Context context) {
        SharedPreferences p = prefs(context);
        String value = p.getString(KEY_READ_OUTCOME, "");
        if (value != null && !value.isEmpty()) p.edit().remove(KEY_READ_OUTCOME).apply();
        return value == null ? "" : value;
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
