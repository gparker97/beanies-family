package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Bundle;
import family.beanies.app.R;

/**
 * The ONE classifier from a placed widget's size to a layout and a telemetry key (#130). The
 * provider, the list factory and the plugin's placements report all go through
 * {@link #sizeFor(Bundle)}, so the layout a person sees and the size the firehose records can
 * never disagree.
 *
 * Classified from the PORTRAIT size the host reports, on every API level. Android documents the
 * four options as: `MIN_WIDTH` = portrait width, `MAX_HEIGHT` = portrait height (`MIN_HEIGHT` and
 * `MAX_WIDTH` are the landscape pair). Narrower than {@link #SMALL_MAX_WIDTH_DP} is the 2x2;
 * otherwise the widget is the 4x3 when it is at least {@link #LARGE_MIN_HEIGHT_DP} tall, else the
 * 4x2. Since round 9b the two share one layout and differ only in how many to-do rows the fixed
 * section keeps ({@link WidgetFill#taskRows}) and the "my day" label in the date column. Deciding
 * by height rather than by a guessed cell count holds across launchers whose cells differ.
 * A host that reports no height falls back to `MIN_HEIGHT`; one that reports nothing (0) lands
 * on the 4x2, the default placement.
 *
 * The keys mirror WIDGET_SIZES in src/types/widgetSnapshot.ts; the app logs a size only when it
 * is one of those.
 */
public final class WidgetSizes {

    public enum Size {
        SMALL("android-2x2", R.layout.widget_day_small),
        MEDIUM("android-4x2", R.layout.widget_day_medium),
        LARGE("android-4x3", R.layout.widget_day_large);

        /** The `&w=` value and the placements key. */
        public final String key;
        final int layout;

        Size(String key, int layout) {
            this.key = key;
            this.layout = layout;
        }
    }

    static final int SMALL_MAX_WIDTH_DP = 220;
    /**
     * Portrait height from which a widget counts as the 4x3. Measured on the Pixel Launcher
     * (Pixel 7 profile, 2026-10-12): cells are 104dp tall with 16dp gaps, so two rows report
     * 224dp and three rows 344dp; 300 sits between them with room for taller cells.
     */
    static final int LARGE_MIN_HEIGHT_DP = 300;

    private WidgetSizes() {}

    /**
     * The placed widget's portrait width in dp (`MIN_WIDTH`), for fitting the bitmap-drawn
     * branded lines; a host that reports nothing gets a typical width for the size.
     */
    static float widthDp(Bundle options, Size size) {
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        if (width > 0) return width;
        return size == Size.SMALL ? 150f : 320f;
    }

    /**
     * The placed widget's portrait height (`MAX_HEIGHT`, else `MIN_HEIGHT`) divided by the text
     * scale, for giving the to-dos section the rows the calendar leaves free: rows grow with
     * the system font size and the widget's Text size choice ({@link #textScale}), so bigger
     * text leaves fewer of them. 0 when the host reports nothing.
     */
    static float layoutHeightDp(Context context, Bundle options, float textScale) {
        if (options == null) return 0f;
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (height <= 0) height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (height <= 0) return 0f;
        // height / max(1, effective scale): not max(1, fontScale) × textScale, which is wrong
        // when the system scale is below 1.
        return height / Math.max(1f, fontScale(context) * textScale);
    }

    /**
     * The ceiling on the widget's effective text scale (system × the Text size choice). Mirrors
     * iOS `WidgetMetrics.maxScale` (ios/App/BeaniesWidgets/WidgetStyle.swift); change both.
     */
    static final float TEXT_SCALE_MAX = 1.3f;

    /**
     * The multiplier on a base sp for this widget's Text size choice: the effective scale
     * `max(fs, min(fs × factor, TEXT_SCALE_MAX))` divided by the system font scale `fs`, because
     * the launcher applies `fs` itself to every SP size. 1 at Standard. The choice makes text
     * bigger up to the ceiling, never smaller, and never past what the system alone already does.
     * Worked values (Standard / Large / Larger): fs 1.0 → 1 / 1.15 / 1.3; fs 1.3 → 1 / 1 / 1;
     * fs 0.85 → 1 / 1.15 / 1.3 (capped at 1.105 / 0.85).
     *
     * Deliberately not called "scale": iOS `WidgetMetrics.scale` is the absolute effective scale.
     * This class is the only reader of `Configuration.fontScale`.
     */
    static float textScale(Context context, WidgetPrefs.TextSize size) {
        float fs = fontScale(context);
        float effective = Math.max(fs, Math.min(fs * size.factor, TEXT_SCALE_MAX));
        return effective / fs;
    }

    /**
     * The absolute scale text draws at for a widget whose multiplier is {@code textScale} (the
     * system font scale × it, which {@link #textScale} keeps within {@link #TEXT_SCALE_MAX} unless
     * the system alone is bigger): what a fixed-width column wraps by ({@link WidgetFill#dateColumnLines}).
     */
    static float effectiveScale(Context context, float textScale) {
        return fontScale(context) * textScale;
    }

    private static float fontScale(Context context) {
        float fs = context.getResources().getConfiguration().fontScale;
        return fs > 0 ? fs : 1f;
    }

    public static Size sizeFor(Bundle options) {
        if (options == null) return Size.MEDIUM;
        int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (height <= 0) height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (width <= 0 || height <= 0) return Size.MEDIUM;
        if (width < SMALL_MAX_WIDTH_DP) return Size.SMALL;
        if (height < LARGE_MIN_HEIGHT_DP) return Size.MEDIUM;
        return Size.LARGE;
    }
}
