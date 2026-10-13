package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import family.beanies.app.R;
import java.util.ArrayList;
import java.util.List;

/**
 * The calendar list of one medium or large widget (#130, round 9b): today's rows (each followed
 * by its handoff sub-line when "who's where" is on and the drop-off and pick-up people differ),
 * or a handwritten "nothing on today" line when today has none; then, for every later day with a
 * row, its date divider ("Wed 15 tomorrow") and its rows. The list has no budget: it scrolls, and
 * the to-dos section is fixed underneath it, outside the list (DayWidgetRenderer).
 *
 * It resolves the SAME {@link WidgetFill.Plan} as the provider (same store read, same prefs, same
 * size classifier), so the list can never show a different day, audience or set of rows from the
 * rest of the widget. "Past" is judged here on the device clock (`endsAt < now`); the provider's
 * re-render alarm at the next row end calls notifyAppWidgetViewDataChanged so a row greys out
 * without a republish.
 */
final class DayWidgetFactory implements RemoteViewsService.RemoteViewsFactory {

    private static final int TYPE_ROW = 0;
    private static final int TYPE_SUB = 1;
    private static final int TYPE_DIVIDER = 2;
    private static final int TYPE_NOTHING = 3;

    /** The calendar's "nothing on today" line: Caveat Bold, accent (bitmap, see WidgetTextBitmaps). */
    private static final WidgetTextBitmaps.Style NOTHING_LINE =
            new WidgetTextBitmaps.Style(R.font.caveat_bold, 16f, 13f, 1, false);

    private static final class Item {
        final int type;
        final WidgetSnapshot.Row row;
        final String label;
        final boolean flag;

        /** `flag`: the row is past (row, sub-line) or the day is tomorrow (divider). */
        Item(int type, WidgetSnapshot.Row row, String label, boolean flag) {
            this.type = type;
            this.row = row;
            this.label = label;
            this.flag = flag;
        }
    }

    private final Context context;
    private final int appWidgetId;
    private List<Item> items = new ArrayList<>();
    private WidgetSizes.Size size = WidgetSizes.Size.MEDIUM;
    private boolean whosWhere;
    private boolean isChild;
    private String nookLink = "";
    private String tomorrowLabel = "";
    private float leadDp = WidgetViews.LEAD_MIN_DP;
    /** The widget's Text size multiplier ({@link WidgetSizes#textScale}), set in {@link #build}. */
    private float textScale = 1f;
    private float panelDp;

    DayWidgetFactory(Context context, Intent intent) {
        this.context = context.getApplicationContext();
        this.appWidgetId = intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
    }

    @Override
    public void onCreate() {
        // onDataSetChanged follows immediately; nothing to prepare.
    }

    @Override
    public void onDataSetChanged() {
        List<Item> next = new ArrayList<>();
        try {
            next = build();
        } catch (RuntimeException e) {
            // A bad row must never take the list (or the launcher's binder thread) down: an
            // empty list under a valid date column is the degraded state.
            android.util.Log.w("beanies-widget", "agenda list build failed", e);
        }
        items = next;
    }

    private List<Item> build() {
        List<Item> out = new ArrayList<>();
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return out;
        WidgetSnapshotStore.Result result = WidgetSnapshotStore.read(context);
        if (result.state != WidgetSnapshotStore.State.READY) return out;
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        android.os.Bundle options = manager.getAppWidgetOptions(appWidgetId);
        size = WidgetSizes.sizeFor(options);
        long now = System.currentTimeMillis();
        WidgetPrefs prefs = WidgetPrefs.load(context, appWidgetId);
        textScale = WidgetSizes.textScale(context, prefs.textSize);
        WidgetFill.Plan plan = WidgetFill.plan(result.snapshot, prefs, size,
                WidgetSizes.layoutHeightDp(context, options, textScale), now);
        if (plan == null || plan.isRelaxed()) return out;

        whosWhere = plan.shows(WidgetFill.WHOS_WHERE);
        isChild = plan.isChild;
        nookLink = plan.snapshot.links.nook;
        tomorrowLabel = plan.snapshot.labels.tomorrow;
        panelDp = WidgetSizes.widthDp(options, size) - DayWidgetRenderer.AGENDA_PANEL_INSET_DP;

        String nothing = plan.nothingTodayLine();
        if (!nothing.isEmpty()) out.add(new Item(TYPE_NOTHING, null, nothing, false));
        addRows(out, plan.todayRows, now);
        for (WidgetFill.LaterDay later : plan.laterDays) {
            out.add(new Item(TYPE_DIVIDER, null, later.entry.dividerDate, later.isTomorrow));
            addRows(out, later.rows, now);
        }
        leadDp = WidgetViews.leadColumnDp(context, plan, textScale);
        return out;
    }

    private void addRows(List<Item> out, List<WidgetSnapshot.Row> rows, long now) {
        for (WidgetSnapshot.Row row : rows) {
            boolean past = row.isPast(now);
            out.add(new Item(TYPE_ROW, row, null, past));
            WidgetSnapshot.Handoff h = row.handoff;
            if (whosWhere && h != null && !h.line.isEmpty()) {
                out.add(new Item(TYPE_SUB, row, h.line, past));
            }
        }
    }

    @Override
    public void onDestroy() {
        items = new ArrayList<>();
    }

    @Override
    public int getCount() {
        return items.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
        List<Item> current = items;
        if (position < 0 || position >= current.size()) return getLoadingView();
        Item item = current.get(position);
        switch (item.type) {
            case TYPE_SUB:
                return sub(item);
            case TYPE_DIVIDER:
                return divider(item);
            case TYPE_NOTHING:
                return nothing(item);
            default:
                return row(item);
        }
    }

    private RemoteViews row(Item item) {
        WidgetSnapshot.Row row = item.row;
        boolean past = item.flag;
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

    private RemoteViews sub(Item item) {
        WidgetSnapshot.Row row = item.row;
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_row_sub);
        textSize(v, R.id.sub_time_ghost);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body, R.id.sub_text);
        v.setTextViewText(R.id.sub_time_ghost, WidgetText.styled(row.time, isChild, false));
        WidgetViews.leadWidth(v, R.id.sub_time_ghost, leadDp);
        // The row's own rule: a child's past row is never struck through (it gets the tick).
        v.setTextViewText(R.id.sub_text, WidgetText.styled(item.label, false, !isChild && item.flag));
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
    private RemoteViews divider(Item item) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_divider);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body,
                R.id.divider_date, R.id.divider_tomorrow);
        v.setTextViewText(R.id.divider_date, item.label);
        WidgetViews.textOrGone(v, R.id.divider_tomorrow, item.flag ? tomorrowLabel : "");
        return v;
    }

    private RemoteViews nothing(Item item) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_nothing);
        WidgetTextBitmaps.bind(v, context, R.id.nothing_line, item.label, NOTHING_LINE, textScale,
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

    @Override
    public RemoteViews getLoadingView() {
        return new RemoteViews(context.getPackageName(), R.layout.widget_day_row_loading);
    }

    /** Row, sub-line, divider, "nothing on today", and the loading layout (a stale position). */
    @Override
    public int getViewTypeCount() {
        return 5;
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public boolean hasStableIds() {
        return false;
    }
}
