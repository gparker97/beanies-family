package family.beanies.app.widget;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.ChecksSdkIntAtLeast;
import family.beanies.app.R;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The calendar list of one medium or large widget (#130, round 9b), as item views: today's rows
 * (each followed by its handoff sub-line when "who's where" is on and the drop-off and pick-up
 * people differ), or a handwritten "nothing on today" line when today has none; then, for every
 * later day with a row, its date divider ("Wed 15 tomorrow") and its rows. The list has no budget:
 * it scrolls, and the to-dos section is fixed underneath it, outside the list (DayWidgetRenderer).
 *
 * ONE BUILDER, TWO CARRIERS. On API 31+ the renderer puts these views straight into the widget's
 * update as {@code RemoteCollectionItems} ({@link #INLINE}), so the date column and the list
 * always arrive together. Only API 24-30 still serves them through {@link DayWidgetService} and
 * {@link DayWidgetFactory}. Inline is not a nicety: a Pixel 10 Pro on Android 17 twice kept
 * yesterday's date on the two list-bearing sizes while the list-free 2x2 updated from the same
 * render pass (2026-10-14, 2026-10-16).
 *
 * Built from the SAME {@link WidgetFill.Plan} as the rest of the widget, so the list can never show
 * a different day, audience or set of rows. "Past" is judged on the device clock at build time
 * (`endsAt < now`); the provider's re-render alarm at the next row end rebuilds the list.
 */
final class DayWidgetList {

    /**
     * Whether the list travels inside the widget's update (API 31+). The ONE place the split is
     * decided; the renderer and the provider both read it.
     * TODO(minSdk 31): delete this, DayWidgetService (and its manifest entry), DayWidgetFactory and
     * DayWidgetRenderer.setServiceList.
     */
    @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.S)
    static final boolean INLINE = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;

    /**
     * The item layouts: widget_day_row, widget_day_row_sub, widget_day_divider and
     * widget_day_nothing. A new item layout means bumping this, or
     * {@code RemoteCollectionItems.Builder.build()} throws on the first render.
     */
    static final int VIEW_TYPE_COUNT = 4;

    /** The calendar's "nothing on today" line: Caveat Bold, accent (bitmap, see WidgetTextBitmaps). */
    private static final WidgetTextBitmaps.Style NOTHING_LINE =
            new WidgetTextBitmaps.Style(R.font.caveat_bold, 16f, 13f, 1, false);

    private final Context context;
    private final WidgetFill.Plan plan;
    private final WidgetSizes.Size size;
    private final boolean whosWhere;
    private final boolean isChild;
    private final String nookLink;
    private final String tomorrowLabel;
    private final float leadDp;
    /** The widget's Text size multiplier ({@link WidgetSizes#textScale}). */
    private final float textScale;
    private final float panelDp;

    private DayWidgetList(
            Context context, WidgetFill.Plan plan, WidgetSizes.Size size, float panelDp, float textScale) {
        this.context = context;
        this.plan = plan;
        this.size = size;
        this.panelDp = panelDp;
        this.textScale = textScale;
        this.whosWhere = plan.shows(WidgetFill.WHOS_WHERE);
        this.isChild = plan.isChild;
        this.nookLink = plan.snapshot.links.nook;
        this.tomorrowLabel = plan.snapshot.labels.tomorrow;
        this.leadDp = WidgetViews.leadColumnDp(context, plan, textScale);
    }

    /**
     * The list's item views in display order; empty for a relaxed plan (the relaxed block takes
     * the list's place). A build failure never takes the widget down: it degrades to an empty list
     * under a valid date column and is relayed as `list_failed;<Exception>` on the next publish.
     * The only try/catch around the list, for both carriers.
     */
    static List<RemoteViews> viewsOrEmpty(Context context, WidgetFill.Plan plan, WidgetSizes.Size size,
            float panelDp, float textScale, long now) {
        // Relaxed: the relaxed block takes the list's place; nothing to build or measure.
        if (plan.isRelaxed()) return Collections.emptyList();
        try {
            return new DayWidgetList(context, plan, size, panelDp, textScale).views(now);
        } catch (RuntimeException e) {
            Log.w(DayWidgetProvider.TAG, "agenda list build failed", e);
            WidgetPrefs.recordReadOutcome(context, WidgetPrefs.failureToken("list_failed", e));
            return Collections.emptyList();
        }
    }

    private List<RemoteViews> views(long now) {
        List<RemoteViews> out = new ArrayList<>();
        String nothing = plan.nothingTodayLine();
        if (!nothing.isEmpty()) out.add(nothing(nothing));
        addRows(out, plan.todayRows, now);
        for (WidgetFill.LaterDay later : plan.laterDays) {
            out.add(divider(later.entry.dividerDate, later.isTomorrow));
            addRows(out, later.rows, now);
        }
        return out;
    }

    private void addRows(List<RemoteViews> out, List<WidgetSnapshot.Row> rows, long now) {
        for (WidgetSnapshot.Row row : rows) {
            boolean past = row.isPast(now);
            out.add(row(row, past));
            WidgetSnapshot.Handoff h = row.handoff;
            if (whosWhere && h != null && !h.line.isEmpty()) out.add(sub(row, h.line, past));
        }
    }

    private RemoteViews row(WidgetSnapshot.Row row, boolean past) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_row);
        textSize(v, R.id.row_time, R.id.row_title, R.id.row_title_accent);
        String title = DayWidgetRenderer.rowTitle(row, whosWhere);
        // Same rules as iOS AgendaRowView. A child's row reads as done once it is over or is
        // ticked (mockup 2g): soft ink, no strikethrough, the green tick, and no member dot
        // before that (the child view names no one). Adults: faint and struck through when past.
        boolean childDone = isChild && (row.isDone || past);
        boolean strike = !isChild && past;
        int ink = isChild
                ? (childDone ? R.color.widget_ink_soft : R.color.widget_ink)
                : (past ? R.color.widget_ink_faint : R.color.widget_ink);

        // Lead column: the time, or a trip's plane / a birthday's cake in the accent. The time
        // view stays (empty) under a glyph so the column keeps its width.
        int glyph = glyphRes(row.kind);
        v.setTextViewText(R.id.row_time, glyph == 0 ? WidgetText.styled(row.time, isChild, strike) : "");
        v.setViewVisibility(R.id.row_glyph, glyph == 0 ? View.GONE : View.VISIBLE);
        if (glyph != 0) v.setImageViewResource(R.id.row_glyph, glyph);

        // A title emphasis ("day 3 of 6") is bold in the accent on a row that is not past: two
        // stacked layers (WidgetText.accentLayer). Otherwise the accent layer is GONE.
        CharSequence inkLayer = past ? null : WidgetText.accentLayer(title, row.titleEmphasis, isChild, false);
        v.setTextViewText(R.id.row_title,
                inkLayer != null ? inkLayer : WidgetText.styled(title, isChild, strike));
        v.setViewVisibility(R.id.row_title_accent, inkLayer == null ? View.GONE : View.VISIBLE);
        if (inkLayer != null) {
            v.setTextViewText(R.id.row_title_accent,
                    WidgetText.accentLayer(title, row.titleEmphasis, isChild, true));
        }
        WidgetViews.textColorRes(v, context, R.id.row_time, ink);
        WidgetViews.textColorRes(v, context, R.id.row_title, ink);
        WidgetViews.leadWidth(v, R.id.row_time, leadDp);
        WidgetViews.bindDot(v, isChild ? null : row.dot, childDone);
        v.setOnClickFillInIntent(R.id.row_root, fillIn(row.link));
        return v;
    }

    /** The accent glyph a trip or birthday row draws in the lead column; 0 for an event. */
    private static int glyphRes(String kind) {
        if ("trip".equals(kind)) return R.drawable.widget_glyph_plane;
        if ("birthday".equals(kind)) return R.drawable.widget_glyph_cake;
        return 0;
    }

    private RemoteViews sub(WidgetSnapshot.Row row, String line, boolean past) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_row_sub);
        textSize(v, R.id.sub_time_ghost);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body, R.id.sub_text);
        v.setTextViewText(R.id.sub_time_ghost, WidgetText.styled(row.time, isChild, false));
        WidgetViews.leadWidth(v, R.id.sub_time_ghost, leadDp);
        // The row's own rule: a child's past row is never struck through (it gets the tick).
        v.setTextViewText(R.id.sub_text, WidgetText.styled(line, false, !isChild && past));
        int[] avatarIds = {R.id.sub_avatar_1, R.id.sub_avatar_2};
        List<String> avatars = row.handoff == null ? new ArrayList<String>() : row.handoff.avatars;
        for (int i = 0; i < avatarIds.length; i++) {
            int res = i < avatars.size() ? WidgetViews.avatarRes(avatars.get(i)) : 0;
            v.setViewVisibility(avatarIds[i], res == 0 ? View.GONE : View.VISIBLE);
            if (res != 0) v.setImageViewResource(avatarIds[i], res);
        }
        v.setOnClickFillInIntent(R.id.sub_root, fillIn(row.link));
        return v;
    }

    /** "Wed 15" in the accent, "tomorrow" beside it when it is the device's tomorrow, a hairline. */
    private RemoteViews divider(String date, boolean isTomorrow) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_divider);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body,
                R.id.divider_date, R.id.divider_tomorrow);
        v.setTextViewText(R.id.divider_date, date);
        WidgetViews.textOrGone(v, R.id.divider_tomorrow, isTomorrow ? tomorrowLabel : "");
        return v;
    }

    private RemoteViews nothing(String line) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_nothing);
        WidgetTextBitmaps.bind(v, context, R.id.nothing_line, line, NOTHING_LINE, textScale,
                panelDp, R.color.widget_accent_text);
        return v;
    }

    /**
     * A calendar row's text at the row size (child or adult) × the Text size choice. Always set,
     * first, on every bind: a recycled row view keeps its last size otherwise.
     */
    private void textSize(RemoteViews v, int... ids) {
        WidgetViews.textSize(v, context, textScale, WidgetViews.rowDimen(isChild), ids);
    }

    /** The row's link + `w=<size>`, merged into the list's click template. */
    private Intent fillIn(String link) {
        return new Intent().setData(WidgetViews.withSize(WidgetViews.or(link, nookLink), size));
    }
}
