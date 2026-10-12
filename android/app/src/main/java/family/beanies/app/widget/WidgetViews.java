package family.beanies.app.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import family.beanies.app.MainActivity;
import family.beanies.app.R;

/**
 * RemoteViews helpers shared by {@link DayWidgetRenderer} and {@link DayWidgetFactory} (#130):
 * taps, member dots, avatars, mode-safe text colours and the lead (time) column width.
 */
final class WidgetViews {

    /** The narrowest lead column (dp): a row with no time, or a glyph, still lines up. */
    static final float LEAD_MIN_DP = 30f;
    /** Calendar and task row text; the child view's rows are bigger and bold. */
    static final float ROW_TEXT_SP = 11f;
    static final float CHILD_ROW_TEXT_SP = 19f;

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
     * for a child). An unknown avatar falls back to the family.
     */
    static void bindPeek(RemoteViews views, WidgetFill.Plan plan) {
        int avatar = plan.isOurDay ? 0 : avatarRes(plan.snapshot.viewer.avatar);
        views.setViewVisibility(R.id.peek_family, avatar == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.peek_avatar, avatar == 0 ? View.GONE : View.VISIBLE);
        if (avatar != 0) views.setImageViewResource(R.id.peek_avatar, avatar);
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
    static float leadColumnDp(Context context, WidgetFill.Plan plan) {
        float sp = plan.isChild ? CHILD_ROW_TEXT_SP : ROW_TEXT_SP;
        return Math.max(LEAD_MIN_DP, timeColumnDp(context, plan.calendarTimes(), sp, plan.isChild));
    }

    /** API 31+: set a lead-column view's width (below 31 its 30dp minWidth holds the column). */
    static void leadWidth(RemoteViews views, int viewId, float dp) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setViewLayoutWidth(viewId, Math.max(LEAD_MIN_DP, dp), TypedValue.COMPLEX_UNIT_DIP);
        }
    }

    /**
     * The widest of `times` in dp, measured in the typeface the HOST actually draws the row time
     * in (system sans: `row_time` has no fontFamily, since `@font` is ignored in launcher-hosted
     * RemoteViews; bold only for the child view's bold span), at `sp` through the device font
     * scale, so every row's time column (and the handoff sub-line's avatar column) lines up and
     * "10:15am" is never cut. API 31+ only (setViewLayoutWidth); 0 when there is nothing to measure.
     */
    private static float timeColumnDp(Context context, Iterable<String> times, float sp, boolean bold) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 0;
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, metrics));
        float widest = 0;
        for (String t : times) {
            if (t != null && !t.isEmpty()) widest = Math.max(widest, paint.measureText(t));
        }
        if (widest == 0) return 0;
        // +2dp: sub-pixel rounding between this Paint and the host's TextView must never ellipsize.
        return (float) Math.ceil(widest / metrics.density) + 2f;
    }
}
