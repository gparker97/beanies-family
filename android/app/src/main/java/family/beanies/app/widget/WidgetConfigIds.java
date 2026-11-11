package family.beanies.app.widget;

import family.beanies.app.R;

/**
 * The configuration screen's radio ids for each stored choice (2026-11-11), as explicit tables,
 * never an enum's `ordinal()`: {@link WidgetPrefs.TextSize#AUTO} is declared first, and an index
 * lookup by declaration order would silently move a stored choice to another radio. Each table is
 * two parallel arrays, written side by side (the same shape as the screen's block and opacity
 * ids). A plain class, not {@link DayWidgetConfigActivity}, so the JVM tests can prove every
 * value has exactly one radio.
 */
final class WidgetConfigIds {

    private WidgetConfigIds() {}

    /** Text size radios, in the screen's order. */
    static final WidgetPrefs.TextSize[] TEXT_SIZES = {
        WidgetPrefs.TextSize.AUTO,
        WidgetPrefs.TextSize.STANDARD,
        WidgetPrefs.TextSize.LARGE,
        WidgetPrefs.TextSize.LARGER,
    };
    static final int[] TEXT_SIZE_IDS = {
        R.id.config_text_auto,
        R.id.config_text_standard,
        R.id.config_text_large,
        R.id.config_text_larger,
    };

    /** Focus radios, in the screen's order. */
    static final WidgetPrefs.Focus[] FOCUSES = {
        WidgetPrefs.Focus.DAY,
        WidgetPrefs.Focus.TODOS,
    };
    static final int[] FOCUS_IDS = {
        R.id.config_focus_day,
        R.id.config_focus_todos,
    };

    /** The radio of {@code value}; 0 when the table has none (WidgetPrefsTest fails on that). */
    static <T> int idOf(T[] values, int[] ids, T value) {
        for (int i = 0; i < values.length && i < ids.length; i++) {
            if (values[i] == value) return ids[i];
        }
        return 0;
    }

    /** The value whose radio is {@code id}; {@code fallback} when none is (nothing checked). */
    static <T> T valueOf(T[] values, int[] ids, int id, T fallback) {
        for (int i = 0; i < values.length && i < ids.length; i++) {
            if (ids[i] == id) return values[i];
        }
        return fallback;
    }
}
