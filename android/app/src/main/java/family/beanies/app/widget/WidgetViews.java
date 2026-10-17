package family.beanies.app.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.DimenRes;
import androidx.annotation.IdRes;
import family.beanies.app.MainActivity;
import family.beanies.app.R;

/**
 * RemoteViews helpers shared by {@link DayWidgetRenderer} and {@link DayWidgetFactory} (#130):
 * taps, member dots, avatars, mode-safe text colours, text sizes and the lead (time) column width.
 *
 * TEXT SIZES: base sp × `textScale` ({@link WidgetSizes#textScale}), set as SP so the launcher
 * still applies the live system font scale on top. The base sizes live in
 * `res/values/widget_dimens.xml`, which the layouts reference too: one source of truth.
 */
final class WidgetViews {

    /** The narrowest lead column (dp): a row with no time, or a glyph, still lines up. */
    static final float LEAD_MIN_DP = 30f;

    /** The origin every widget link lives on (`shareableOrigin()` on the JS side). */
    static final String ORIGIN = "https://app.beanies.family";
    static final String FALLBACK_NOOK = ORIGIN + "/nook?src=widget";
    static final String SIGNED_OUT_LINK = ORIGIN + "/welcome?src=widget";

    /** Request-code slots per widget id, so every PendingIntent is distinct. */
    static final int SLOT_ROOT = 0;
    static final int SLOT_DATE = 1;
    static final int SLOT_LATER = 2;
    static final int SLOT_TONIGHT = 3;
    static final int SLOT_DUE_COUNT = 4;
    static final int SLOT_TASKS_HEADING = 5;
    static final int SLOT_LIST_TEMPLATE = 6;
    static final int SLOT_SMALL_NEXT = 7;
    /** The task rows, last: +0 .. {@link WidgetFill#MAX_TASK_ROWS} - 1. */
    static final int SLOT_TASK = 8;
    private static final int SLOTS_PER_WIDGET = SLOT_TASK + WidgetFill.MAX_TASK_ROWS;

    private WidgetViews() {}

    /**
     * The link with `w=<size>` appended. A missing or non-https link falls back to the Nook, so
     * a malformed snapshot can never produce a tap that goes nowhere.
     */
    static Uri withSize(String link, WidgetSizes.Size size) {
        Uri uri = link == null || link.isEmpty() ? null : Uri.parse(link);
        if (uri == null || !"https".equals(uri.getScheme())) uri = Uri.parse(FALLBACK_NOOK);
        return uri.buildUpon().appendQueryParameter("w", size.key).build();
    }

    /** `primary`, or `fallback` when `primary` is empty. */
    static String or(String primary, String fallback) {
        return primary == null || primary.isEmpty() ? fallback : primary;
    }

    private static int requestCode(int appWidgetId, int slot) {
        return appWidgetId * SLOTS_PER_WIDGET + slot;
    }

    /**
     * Open `uri` in the app: an explicit ACTION_VIEW to MainActivity, which the existing
     * `appUrlOpen` path routes exactly like a tapped app link. Immutable.
     */
    static PendingIntent open(Context context, int appWidgetId, int slot, Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        return PendingIntent.getActivity(
                context,
                requestCode(appWidgetId, slot),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void onClick(RemoteViews views, int viewId, Context context, int appWidgetId, int slot,
            String link, WidgetSizes.Size size) {
        views.setOnClickPendingIntent(viewId, open(context, appWidgetId, slot, withSize(link, size)));
    }

    /**
     * The list's click template. Fill-in intents (one per row) supply the data Uri, which the
     * platform only merges into a MUTABLE PendingIntent (required from API 31). The intent is
     * explicit (MainActivity), so nothing but the Uri can be filled in by the host.
     */
    static PendingIntent listTemplate(Context context, int appWidgetId) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setClass(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getActivity(
                context, requestCode(appWidgetId, SLOT_LIST_TEMPLATE), intent, flags);
    }

    /**
     * Set a text colour from a resource. API 31+ resolves it on the host at (re)apply time, so a
     * light/dark switch repaints it; below 31 the value is resolved now and holds until the next
     * render (the midnight / row-end alarm or the next app publish).
     */
    static void textColorRes(RemoteViews views, Context context, int viewId, int colorRes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColorStateList(viewId, "setTextColor", colorRes);
        } else {
            views.setTextColor(viewId, context.getColor(colorRes));
        }
    }

    /** Show `text` in `viewId`, or hide the view when it is empty. */
    static boolean textOrGone(RemoteViews views, int viewId, CharSequence text) {
        boolean has = text != null && text.length() > 0;
        views.setViewVisibility(viewId, has ? View.VISIBLE : View.GONE);
        if (has) views.setTextViewText(viewId, text);
        return has;
    }

    /** The bundled drawable for a WidgetAvatar, or 0 when the value is unknown. */
    static int avatarRes(String avatar) {
        if (avatar == null) return 0;
        switch (avatar) {
            case "father":
                return R.drawable.widget_avatar_father;
            case "mother":
                return R.drawable.widget_avatar_mother;
            case "neutral":
                return R.drawable.widget_avatar_neutral;
            case "boy":
                return R.drawable.widget_avatar_boy;
            case "girl":
                return R.drawable.widget_avatar_girl;
            case "dog":
                return R.drawable.widget_avatar_dog;
            default:
                return 0;
        }
    }

    /**
     * The peek over the panel: the family on "our day", the viewer's own beanie on "my day" (and
     * for a child). An unknown avatar falls back to the family. On the small widget the weather
     * (#134) takes the peek's slot while a current temperature exists ({@code weatherInSlot}, the
     * caller binds `small_weather`): both peeks hide, and return on the first render without one.
     * The medium and large always pass false (their weather lives in the date column).
     */
    static void bindPeek(RemoteViews views, WidgetFill.Plan plan, boolean weatherInSlot) {
        int avatar = weatherInSlot ? 0 : peekAvatar(plan);
        views.setViewVisibility(R.id.peek_family, !weatherInSlot && avatar == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.peek_avatar, avatar == 0 ? View.GONE : View.VISIBLE);
        if (avatar != 0) views.setImageViewResource(R.id.peek_avatar, avatar);
    }

    /**
     * The full-colour drawable for a WeatherGlyph kind (`wx_<kind>`, generated from
     * src/constants/weatherGlyphs.json; the `_mono` variants are for surfaces that tint), or 0
     * when the kind is unknown (a newer app's glyph): the caller hides the glyph, never guesses.
     */
    static int weatherGlyphRes(String kind) {
        if (kind == null) return 0;
        switch (kind) {
            case "sunny":
                return R.drawable.wx_sunny;
            case "partly":
                return R.drawable.wx_partly;
            case "cloudy":
                return R.drawable.wx_cloudy;
            case "rain":
                return R.drawable.wx_rain;
            case "thunder":
                return R.drawable.wx_thunder;
            case "snow":
                return R.drawable.wx_snow;
            case "fog":
                return R.drawable.wx_fog;
            case "night":
                return R.drawable.wx_night;
            case "nightPartly":
                return R.drawable.wx_night_partly;
            default:
                return 0;
        }
    }

    /**
     * Paint a weather glyph into {@code viewId}, {@code dp} square on API 31+ (below 31 the
     * layout's size holds), with the condition word as its description. Returns the width it
     * takes in the row (0 when hidden for an unknown kind), for budgeting the temperature beside it.
     */
    static float bindWeatherGlyph(RemoteViews views, @IdRes int viewId, WidgetWeather.Shown weather,
            float dp, float layoutDp) {
        int res = weatherGlyphRes(weather.glyph);
        views.setViewVisibility(viewId, res == 0 ? View.GONE : View.VISIBLE);
        if (res == 0) return 0f;
        views.setImageViewResource(viewId, res);
        views.setContentDescription(viewId, weather.condition.isEmpty() ? null : weather.condition);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setViewLayoutWidth(viewId, dp, TypedValue.COMPLEX_UNIT_DIP);
            views.setViewLayoutHeight(viewId, dp, TypedValue.COMPLEX_UNIT_DIP);
            return dp;
        }
        return layoutDp;
    }

    /** The viewer's avatar drawable for the peek, or 0 when the family peek shows. */
    static int peekAvatar(WidgetFill.Plan plan) {
        return plan.isOurDay ? 0 : avatarRes(plan.snapshot.viewer.avatar);
    }

    /** The width (dp) of the peek {@link #bindPeek} shows, from the same dimens as the layout. */
    static float peekWidthDp(Context context, WidgetFill.Plan plan) {
        return dp(context, peekAvatar(plan) == 0
                ? R.dimen.widget_peek_family_width
                : R.dimen.widget_peek_avatar_width);
    }

    /** A dp dimen, in dp. */
    static float dp(Context context, @DimenRes int dimenRes) {
        return context.getResources().getDimension(dimenRes)
                / context.getResources().getDisplayMetrics().density;
    }

    /**
     * Paint the 14dp dot (`widget_part_dot.xml`). Member: the snapshot's colour and initial ink,
     * never computed here. Family: the hug icon. A child's done row: the green tick instead.
     */
    static void bindDot(RemoteViews views, WidgetSnapshot.Dot dot, boolean tick) {
        if (tick) {
            views.setViewVisibility(R.id.dot_frame, View.VISIBLE);
            show(views, R.id.dot_tick, true);
            show(views, R.id.dot_fill, false);
            show(views, R.id.dot_initial, false);
            show(views, R.id.dot_family, false);
            show(views, R.id.dot_ring, false);
            return;
        }
        if (dot == null) {
            views.setViewVisibility(R.id.dot_frame, View.GONE);
            return;
        }
        views.setViewVisibility(R.id.dot_frame, View.VISIBLE);
        show(views, R.id.dot_tick, false);
        show(views, R.id.dot_family, dot.family);
        show(views, R.id.dot_fill, !dot.family);
        show(views, R.id.dot_initial, !dot.family);
        show(views, R.id.dot_ring, !dot.family);
        if (dot.family) return;
        views.setInt(R.id.dot_fill, "setColorFilter", parseColor(dot.color, 0xFF7A8A97));
        views.setTextViewText(R.id.dot_initial, dot.initial);
        views.setTextColor(R.id.dot_initial, parseColor(dot.ink, Color.WHITE));
        // Two-letter initials ("Jo", "AB") step down so they stay inside the circle.
        views.setTextViewTextSize(
                R.id.dot_initial, TypedValue.COMPLEX_UNIT_SP, dot.initial.length() > 1 ? 6.5f : 8f);
    }

    private static void show(RemoteViews views, int id, boolean visible) {
        views.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
    }

    /** "#RRGGBB" from the snapshot, or `fallback` when it is not a colour. */
    static int parseColor(String value, int fallback) {
        if (value == null || value.isEmpty()) return fallback;
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    /**
     * The lead column (dp) every calendar row, sub-line and task row shares, so a time, a trip
     * glyph and a to-do ring all line up: the widest calendar time, never under
     * {@link #LEAD_MIN_DP}. The list factory and the renderer both call this with the same plan.
     */
    static float leadColumnDp(Context context, WidgetFill.Plan plan, float textScale) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return LEAD_MIN_DP;
        float sp = sp(context, rowDimen(plan.isChild)) * textScale;
        Typeface face = plan.isChild ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT;
        float widest = widestDp(context, plan.calendarTimes(), sp, face);
        // +2dp: sub-pixel rounding between this Paint and the host's TextView must never ellipsize.
        return Math.max(LEAD_MIN_DP, widest == 0 ? 0 : widest + 2f);
    }

    /** The calendar row text size: the child view's rows are bigger and bold. */
    @DimenRes
    static int rowDimen(boolean isChild) {
        return isChild ? R.dimen.widget_text_child_row : R.dimen.widget_text_body;
    }

    /** API 31+: set a lead-column view's width (below 31 its 30dp minWidth holds the column). */
    static void leadWidth(RemoteViews views, int viewId, float dp) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setViewLayoutWidth(viewId, Math.max(LEAD_MIN_DP, dp), TypedValue.COMPLEX_UNIT_DIP);
        }
    }

    /**
     * The widest of `texts` in dp, measured in the typeface the HOST actually draws it in (system
     * sans: `@font` is ignored in launcher-hosted RemoteViews), at `sp` through the device font
     * scale. 0 when there is nothing to measure. Shared by the lead column and {@link #fitSp}.
     */
    static float widestDp(Context context, Iterable<String> texts, float sp, Typeface face) {
        return widestDp(context, texts, sp, paint(face));
    }

    private static Paint paint(Typeface face) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(face);
        return paint;
    }

    private static float widestDp(Context context, Iterable<String> texts, float sp, Paint paint) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, metrics));
        float widest = 0;
        for (String t : texts) {
            if (t != null && !t.isEmpty()) widest = Math.max(widest, paint.measureText(t));
        }
        return widest == 0 ? 0 : (float) Math.ceil(widest / metrics.density);
    }

    /**
     * The largest sp, from `sp` down in 0.5sp steps to `minSp`, at which `text` fits `maxWidthDp`
     * on one line (`minSp` when even that does not fit; the view's ellipsize is the last resort).
     * Replaces XML autosize, which ignores any size set by the app (`TextView.setTextSize` does
     * nothing while autosize is on), so a Text size choice could never reach it.
     */
    static float fitSp(Context context, String text, Typeface face, float sp, float minSp, float maxWidthDp) {
        java.util.List<String> one = java.util.Collections.singletonList(text);
        Paint paint = paint(face);
        for (float s = sp; s > minSp; s -= 0.5f) {
            // +2dp, as the lead column: this Paint and the host's TextView round differently, and
            // a fit that is exact here can ellipsize there.
            if (widestDp(context, one, s, paint) + 2f <= maxWidthDp) return s;
        }
        return minSp;
    }

    /**
     * A base size from `widget_dimens.xml`, in sp. Never throws: a throw here would also fail the
     * refresh-state fallback in {@link DayWidgetProvider#renderAll}, and the provider's update
     * callbacks have no catch. A dimen in another unit is logged and its number used as sp; the
     * build-time grep in the plan's testing steps keeps that from shipping. The unit is read with
     * the shift-and-mask form because `TypedValue.getComplexUnit()` is API 30 (minSdk is 24).
     */
    static float sp(Context context, @DimenRes int dimenRes) {
        TypedValue tv = new TypedValue();
        context.getResources().getValue(dimenRes, tv, true);
        int unit = (tv.data >> TypedValue.COMPLEX_UNIT_SHIFT) & TypedValue.COMPLEX_UNIT_MASK;
        if (tv.type != TypedValue.TYPE_DIMENSION || unit != TypedValue.COMPLEX_UNIT_SP) {
            Log.e(DayWidgetProvider.TAG, "widget text dimen "
                    + context.getResources().getResourceEntryName(dimenRes)
                    + " must be declared in sp (res/values/widget_dimens.xml); using its number as sp");
        }
        return TypedValue.complexToFloat(tv.data);
    }

    /**
     * Size `ids` at the base `dimenRes` × `textScale`, as SP. Called on EVERY render, Standard
     * included: the launcher re-applies a RemoteViews onto the views it already inflated, so a
     * size set by an earlier render would otherwise persist.
     */
    static void textSize(RemoteViews views, Context context, float textScale, @DimenRes int dimenRes,
            @IdRes int... ids) {
        float sp = sp(context, dimenRes) * textScale;
        for (int id : ids) views.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_SP, sp);
    }
}
