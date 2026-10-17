package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.RequiresApi;
import family.beanies.app.R;
import java.util.Date;
import java.util.List;

/**
 * Builds one placed widget's RemoteViews from the snapshot read (#130). Called only from
 * {@link DayWidgetProvider#renderAll}; the calendar rows inside the list come from
 * {@link DayWidgetList}, built from the same {@link WidgetFill.Plan}: inline in this update on API
 * 31+ (so a row-end re-render re-sends the whole widget), through {@link DayWidgetFactory} on API
 * 24-30. The medium and large
 * share one layout (round 9b) and differ only in how many task rows the fixed to-dos section has
 * and in the "my day" / "our day" label at the foot of the date column (large only).
 *
 * EVERY PATH SETS EVERY VIEW IT COULD LEAVE BEHIND. The launcher re-applies a new RemoteViews
 * onto the views it already inflated when the layout id is unchanged, so a view one render showed
 * and the next render does not mention keeps its old text (signed out → unreadable once kept
 * "sign in to see your day"). Each view a path may change is therefore set or hidden on every
 * path through the same layout, or lives inside a container whose visibility is always set.
 *
 * TEXT SIZES FOLLOW THE SAME RULE, BY STRUCTURE. Each layout's text is sized by one helper
 * (`sizeAgendaText`, `sizeSmallText`, `sizeMessageText`, and the task row's line) called on the line
 * straight after `new RemoteViews(...)`, before any branch, so every size is set on every render at
 * base × `textScale` ({@link WidgetSizes#textScale}). A new TextView is one added line there.
 */
final class DayWidgetRenderer {

    // Bitmap-drawn branded strings (WidgetTextBitmaps): font, size, shrink floor, lines, centred.
    private static final WidgetTextBitmaps.Style COLUMN_NUMERAL =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 32f, 26f, 1, false);
    private static final WidgetTextBitmaps.Style SMALL_NUMERAL =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 28f, 28f, 1, false);
    private static final WidgetTextBitmaps.Style SMALL_WEEKDAY =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 14f, 14f, 1, false);
    private static final WidgetTextBitmaps.Style CAVEAT_LINE =
            new WidgetTextBitmaps.Style(R.font.caveat_bold, 20f, 15f, 1, false);
    private static final WidgetTextBitmaps.Style MESSAGE_TITLE =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 16f, 13f, 2, true);
    /** The date column's temperature (#134): Outfit Bold 13sp, as iOS DayColumnView. */
    private static final WidgetTextBitmaps.Style COLUMN_TEMP =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 13f, 11f, 1, false);
    /** The small header's temperature: Outfit Bold 15sp, scaled with the header like the numeral. */
    private static final WidgetTextBitmaps.Style SMALL_TEMP =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 15f, 15f, 1, false);

    /** The weather glyphs' Standard sizes (the layouts' 14dp / 16dp) and the gap to the temperature. */
    private static final float COLUMN_GLYPH_DP = 14f;
    private static final float SMALL_GLYPH_DP = 16f;
    private static final float WEATHER_GAP_DP = 3f;

    /** Layout insets (dp) between the widget's width and the line a bitmap may fill. */
    private static final float DATE_COLUMN_DP = 52f;
    /** The date column's weekday and month never shrink below this (the old XML autosize floor). */
    private static final float DATE_COLUMN_MIN_SP = 10f;
    /** The small next time's trailing room: its 6dp end margin and the 14dp member dot. */
    private static final float SMALL_NEXT_TIME_TRAIL_DP = 20f;
    /**
     * The small next time's floor. Below its 20sp Standard size on purpose: on the narrowest 2x2
     * (a 5-column launcher grid) "10:15am" at 20sp already pushes the member dot out of the panel.
     */
    private static final float SMALL_NEXT_TIME_MIN_SP = 16f;
    /** The small widget's content padding, both sides (widget_day_small.xml: 10 + 9). */
    private static final float SMALL_CONTENT_INSET_DP = 19f;
    /** In the small header row: the tile's 6dp end padding and the numeral's 5dp start margin. */
    private static final float SMALL_HEADER_TRAIL_DP = 6f + 5f;
    /** The small header never shrinks below this, however narrow the widget. */
    private static final float SMALL_HEADER_MIN_SCALE = 0.7f;
    private static final Typeface WEEKDAY_FACE = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    /** Root padding to the content 10 + 9, date column 52 + 8, panel padding 6 + 13. */
    private static final float AGENDA_PANEL_INSET_DP = 98f;
    /** Root padding 10 + 9, panel padding 8 + 8. */
    private static final float SMALL_PANEL_INSET_DP = 35f;
    /** Message padding 14 + 14. */
    private static final float MESSAGE_INSET_DP = 28f;

    private DayWidgetRenderer() {}

    static RemoteViews build(
            Context context,
            int appWidgetId,
            WidgetSizes.Size size,
            float widthDp,
            float heightDp,
            WidgetPrefs prefs,
            float textScale,
            WidgetSnapshotStore.Result result,
            long now) {
        if (result.state == WidgetSnapshotStore.State.SIGNED_OUT) {
            return signedOut(context, appWidgetId, size, widthDp, prefs, textScale);
        }
        WidgetFill.Plan plan =
                result.state == WidgetSnapshotStore.State.READY
                        ? WidgetFill.plan(result.snapshot, prefs, size, heightDp, now)
                        : null;
        if (plan == null) return refresh(context, appWidgetId, size, widthDp, prefs, textScale);

        if (size == WidgetSizes.Size.SMALL) {
            return small(context, appWidgetId, widthDp, prefs, textScale, plan, now);
        }
        return agenda(context, appWidgetId, size, widthDp, heightDp, prefs, textScale, plan, now);
    }

    // ---- medium + large ------------------------------------------------------------------

    private static RemoteViews agenda(
            Context context, int id, WidgetSizes.Size size, float widthDp, float heightDp,
            WidgetPrefs prefs, float textScale, WidgetFill.Plan plan, long now) {
        WidgetSnapshot s = plan.snapshot;
        WidgetSnapshot.Day day = plan.day;
        RemoteViews v = new RemoteViews(context.getPackageName(), size.layout);
        sizeAgendaText(v, context, textScale, plan.entry);
        frame(v, context, id, size, prefs.opacity, s.links.nook);
        dateTile(v, prefs.opacity);

        // Date column.
        WidgetTextBitmaps.bind(v, context, R.id.date_numeral, plan.entry.numeral, COLUMN_NUMERAL,
                textScale, DATE_COLUMN_DP, R.color.widget_ink);
        v.setTextViewText(R.id.date_weekday, plan.entry.weekday);
        v.setTextViewText(R.id.date_month, plan.entry.month);
        WidgetViews.onClick(v, R.id.date_column, context, id, WidgetViews.SLOT_DATE, s.links.nook, size);
        String asOf = asOf(context, plan);
        String audience = "";
        if (plan.isChild) {
            audience = s.labels.childsDay;
        } else if (size == WidgetSizes.Size.LARGE) {
            audience = plan.isOurDay ? s.labels.ourDay : s.labels.myDay;
        }
        // countText.text is '' when nothing is due; an empty WidgetText is never drawn.
        boolean dueCount = plan.shows(WidgetFill.DUE) && day != null && day.tasks.count > 0
                && !day.tasks.countText.text.isEmpty();
        // The weather (#134) under the month: the row always (glyph + temperature, or + today's
        // high once the temperature is gone), then the range, or the age once the reading is old
        // enough (WidgetWeather; no thresholds here).
        WidgetWeather.Shown weather = WidgetWeather.at(s.weather, now);
        String age = weather != null && weather.showsAge()
                ? asOfText(context, s.labels.weatherAsOf, weather.fetchedAt) : "";
        // An aged reading with no age label falls back to the range; past currentUntil the line
        // is the age or nothing.
        String weatherSub = weather == null || !age.isEmpty() || !weather.hasCurrent() ? age : weather.range;
        // Which optional lines fit the placed height, dropped in the plan's order (range/age, then
        // the audience, then the count): RemoteViews has no ViewThatFits.
        int lines = WidgetFill.dateColumnLines(heightDp, WidgetSizes.effectiveScale(context, textScale),
                (weather != null ? WidgetFill.COLUMN_WEATHER : 0)
                        | (!weatherSub.isEmpty() ? WidgetFill.COLUMN_WEATHER_SUB : 0)
                        | (!age.isEmpty() ? WidgetFill.COLUMN_AGE : 0)
                        | (!asOf.isEmpty() ? WidgetFill.COLUMN_STALE : 0)
                        | (!audience.isEmpty() ? WidgetFill.COLUMN_AUDIENCE : 0)
                        | (dueCount ? WidgetFill.COLUMN_DUE : 0));
        bindColumnWeather(v, context, textScale, weather,
                (lines & WidgetFill.COLUMN_WEATHER_SUB) != 0 ? weatherSub : "", age.isEmpty());
        WidgetViews.textOrGone(v, R.id.date_as_of, asOf);
        WidgetViews.textOrGone(v, R.id.date_audience,
                (lines & WidgetFill.COLUMN_AUDIENCE) != 0 ? audience : "");
        boolean showDue = (lines & WidgetFill.COLUMN_DUE) != 0;
        WidgetViews.textOrGone(
                v, R.id.date_due, showDue ? WidgetText.emphasised(day.tasks.countText) : "");
        if (showDue) {
            WidgetViews.onClick(v, R.id.date_due, context, id, WidgetViews.SLOT_DUE_COUNT,
                    WidgetViews.or(day.tasks.link, s.links.todo), size);
        }

        WidgetViews.bindPeek(v, plan, false);

        float panelDp = agendaPanelDp(widthDp);
        // The scrolling calendar, set on every render (relaxed included, where it is empty).
        if (DayWidgetList.INLINE) {
            setInlineList(v, context, plan, size, panelDp, textScale, now);
        } else {
            setServiceList(v, context, id);
        }
        v.setPendingIntentTemplate(R.id.agenda_list, WidgetViews.listTemplate(context, id));
        // A clear week with no tasks: the relaxed block takes the list's place inside the panel;
        // the date column, peek and footer stay (the same state as iOS).
        boolean relaxed = bindRelaxed(v, context, plan, textScale, panelDp);
        v.setViewVisibility(R.id.agenda_list, relaxed ? View.GONE : View.VISIBLE);

        bindTasks(v, context, id, size, textScale, plan);

        // Footer: tonight (meals block) and "later ›" (always, to the Nook).
        boolean tonight = plan.shows(WidgetFill.MEALS) && day != null && day.tonight != null
                && !day.tonight.text.text.isEmpty();
        v.setViewVisibility(R.id.footer_tonight, tonight ? View.VISIBLE : View.INVISIBLE);
        if (tonight) {
            v.setTextViewText(R.id.footer_tonight, WidgetText.emphasised(day.tonight.text));
            WidgetViews.onClick(v, R.id.footer_tonight, context, id, WidgetViews.SLOT_TONIGHT,
                    WidgetViews.or(day.tonight.link, s.links.nook), size);
        }
        if (WidgetViews.textOrGone(v, R.id.footer_later, s.labels.later)) {
            WidgetViews.onClick(v, R.id.footer_later, context, id, WidgetViews.SLOT_LATER, s.links.nook, size);
        }
        v.setViewVisibility(
                R.id.panel_footer, tonight || !s.labels.later.isEmpty() ? View.VISIBLE : View.GONE);
        return v;
    }

    /**
     * The date column's weather: the row when there is weather, and the line under it ({@code sub}:
     * the range or the age; "" when there is none or the fill dropped it). The row is the glyph and
     * an Outfit bitmap like the numeral: the temperature (softer ink while the reading shows its
     * age), or, past `currentUntil`, today's glyph and high in the softer ink and the same style,
     * so the row that is never dropped is never a lone glyph. A range line shrinks to one line like the month; an age
     * wraps. Sets every weather view on every path.
     */
    private static void bindColumnWeather(RemoteViews v, Context context, float textScale,
            WidgetWeather.Shown weather, String sub, boolean subIsRange) {
        v.setViewVisibility(R.id.date_weather, weather == null ? View.GONE : View.VISIBLE);
        if (weather == null) {
            v.setViewVisibility(R.id.date_weather_sub, View.GONE);
            return;
        }
        float scale = Math.min(WidgetSizes.effectiveScale(context, textScale), WidgetSizes.TEXT_SCALE_MAX);
        float glyphDp = WidgetViews.bindWeatherGlyph(
                v, R.id.date_weather_glyph, weather, COLUMN_GLYPH_DP * scale, COLUMN_GLYPH_DP);
        WidgetTextBitmaps.bind(v, context, R.id.date_weather_temp, weather.rowText(), COLUMN_TEMP, textScale,
                DATE_COLUMN_DP - glyphDp - WEATHER_GAP_DP,
                weather.soft() ? R.color.widget_ink_soft : R.color.widget_ink);
        if (WidgetViews.textOrGone(v, R.id.date_weather_sub, sub) && subIsRange) {
            float body = WidgetViews.sp(context, R.dimen.widget_text_body) * textScale;
            v.setTextViewTextSize(R.id.date_weather_sub, TypedValue.COMPLEX_UNIT_SP, WidgetViews.fitSp(
                    context, sub, Typeface.DEFAULT, body, DATE_COLUMN_MIN_SP, DATE_COLUMN_DP));
        }
    }

    /** The agenda panel's inner width (dp) for a medium/large widget {@code widthDp} wide. */
    static float agendaPanelDp(float widthDp) {
        return widthDp - AGENDA_PANEL_INSET_DP;
    }

    /**
     * API 31+: the list's item views travel inside this update, so the launcher gets the date
     * column and the list as one parcel. No try here: a data failure is already absorbed by
     * {@link DayWidgetList#viewsOrEmpty}, and a {@code build()} throw (more item layouts than
     * {@link DayWidgetList#VIEW_TYPE_COUNT}) is a programming error that should surface as
     * `render_failed`. The type count is fixed so the host's recycler sees the same count on every
     * update, with or without dividers.
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private static void setInlineList(RemoteViews v, Context context, WidgetFill.Plan plan,
            WidgetSizes.Size size, float panelDp, float textScale, long now) {
        RemoteViews.RemoteCollectionItems.Builder items = new RemoteViews.RemoteCollectionItems.Builder()
                .setHasStableIds(false)
                .setViewTypeCount(DayWidgetList.VIEW_TYPE_COUNT);
        List<RemoteViews> views = DayWidgetList.viewsOrEmpty(context, plan, size, panelDp, textScale, now);
        for (int i = 0; i < views.size(); i++) items.addItem(i, views.get(i));
        v.setRemoteAdapter(R.id.agenda_list, items.build());
    }

    /**
     * API 24-30: the list is served by {@link DayWidgetService}. A unique data Uri per widget id
     * stops the system from sharing one factory between two placed widgets (Intent equality
     * ignores extras). TODO(minSdk 31): delete.
     */
    @SuppressWarnings("deprecation")
    private static void setServiceList(RemoteViews v, Context context, int id) {
        Intent service = new Intent(context, DayWidgetService.class);
        service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.agenda_list, service);
    }

    /**
     * The fixed to-dos section between the list and the footer: the heading ("to-dos and lists",
     * a hairline, "2 more" when not every task fits) and up to {@link WidgetFill#taskRows} rows,
     * each a nested RemoteViews (`widget_task_row.xml`) so every row has its own dot views. GONE
     * when no task shows; the row container is emptied on every render so no old row survives.
     */
    private static void bindTasks(RemoteViews v, Context context, int id, WidgetSizes.Size size,
            float textScale, WidgetFill.Plan plan) {
        WidgetSnapshot s = plan.snapshot;
        List<WidgetSnapshot.Task> tasks = plan.visibleTasks;
        v.removeAllViews(R.id.tasks_rows);
        v.setViewVisibility(R.id.tasks, tasks.isEmpty() ? View.GONE : View.VISIBLE);
        if (tasks.isEmpty()) return;

        String sectionLink = WidgetViews.or(plan.day.tasks.link, s.links.todo);
        WidgetViews.textOrGone(v, R.id.tasks_heading, plan.day.tasks.heading);
        WidgetViews.textOrGone(v, R.id.tasks_more, plan.moreText());
        WidgetViews.onClick(v, R.id.tasks_heading_row, context, id, WidgetViews.SLOT_TASKS_HEADING,
                sectionLink, size);

        float leadDp = WidgetViews.leadColumnDp(context, plan, textScale);
        for (int i = 0; i < tasks.size(); i++) {
            WidgetSnapshot.Task task = tasks.get(i);
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task_row);
            WidgetViews.textSize(row, context, textScale, R.dimen.widget_text_body,
                    R.id.task_title, R.id.task_tag);
            row.setImageViewResource(R.id.task_glyph, taskGlyph(task));
            WidgetViews.leadWidth(row, R.id.task_lead, leadDp);
            row.setTextViewText(R.id.task_title, task.title);
            if (WidgetViews.textOrGone(row, R.id.task_tag, task.tag)) {
                WidgetViews.textColorRes(row, context, R.id.task_tag,
                        task.tagAccent ? R.color.widget_accent_text : R.color.widget_ink_soft);
            }
            WidgetViews.bindDot(row, task.dot, false);
            WidgetViews.onClick(row, R.id.task_root, context, id, WidgetViews.SLOT_TASK + i,
                    WidgetViews.or(task.link, sectionLink), size);
            v.addView(R.id.tasks_rows, row);
        }
    }

    /** A to-do's checkbox, a hint's bean, a list's checklist mark (the time is in the tag). */
    private static int taskGlyph(WidgetSnapshot.Task task) {
        if (task.isHint()) return R.drawable.widget_bean;
        if ("list".equals(task.kind)) return R.drawable.widget_glyph_checklist;
        return R.drawable.widget_task_box;
    }

    // ---- small ---------------------------------------------------------------------------

    private static RemoteViews small(
            Context context, int id, float widthDp, WidgetPrefs prefs, float textScale,
            WidgetFill.Plan plan, long now) {
        WidgetSizes.Size size = WidgetSizes.Size.SMALL;
        WidgetSnapshot s = plan.snapshot;
        RemoteViews v = new RemoteViews(context.getPackageName(), size.layout);
        // The weather takes the peek's slot only while a current temperature exists (#134).
        WidgetWeather.Shown weather = WidgetWeather.at(s.weather, now);
        WidgetWeather.Shown slot = weather != null && weather.hasCurrent() ? weather : null;
        float headerScale = smallHeaderScale(context, widthDp, textScale, plan, slot);
        sizeSmallText(v, context, textScale, headerScale);
        frame(v, context, id, size, prefs.opacity, s.links.nook);
        dateTile(v, prefs.opacity);

        WidgetTextBitmaps.bind(v, context, R.id.date_weekday, plan.entry.weekdayShort, SMALL_WEEKDAY,
                headerScale, 0, R.color.widget_accent_text);
        WidgetTextBitmaps.bind(v, context, R.id.date_numeral, plan.entry.numeral, SMALL_NUMERAL,
                headerScale, 0, R.color.widget_ink);
        WidgetViews.onClick(v, R.id.date_column, context, id, WidgetViews.SLOT_DATE, s.links.nook, size);
        WidgetViews.bindPeek(v, plan, slot != null);
        bindSmallWeather(v, context, headerScale, slot);
        WidgetViews.textOrGone(v, R.id.date_as_of, asOf(context, plan));

        WidgetSnapshot.Day day = plan.day;
        // A clear week: the relaxed block replaces only the panel's content (the small has no
        // to-dos section, so tasks never hold it back: its visibleTasks is always empty).
        float panelDp = widthDp - SMALL_PANEL_INSET_DP;
        boolean relaxed = bindRelaxed(v, context, plan, textScale, panelDp);
        boolean events = !relaxed && plan.shows(WidgetFill.EVENTS) && day != null;
        WidgetTextBitmaps.bind(v, context, R.id.small_things, events ? day.thingsText : "",
                CAVEAT_LINE, textScale, panelDp, R.color.widget_accent_text);

        // Next: the shared search (WidgetFill.Plan#next, the same rule as iOS), named with its
        // day when it falls on a later one ("next · Wed 15").
        WidgetFill.Next found = relaxed ? null : plan.next(now);
        WidgetSnapshot.Row next = found == null ? null : found.row;
        String label = s.labels.next;
        if (found != null && found.later != null && !found.later.entry.dividerDate.isEmpty()) {
            String laterDate = found.later.entry.dividerDate;
            label = label.isEmpty() ? laterDate : label + " · " + laterDate;
        }
        v.setViewVisibility(R.id.small_next, next == null ? View.GONE : View.VISIBLE);
        if (next != null) {
            WidgetViews.textOrGone(v, R.id.small_next_label, label);
            WidgetViews.textOrGone(v, R.id.small_next_time, next.time);
            // The time is the line that matters: it shrinks to fit beside the member dot on a
            // narrow 2x2 rather than ellipsizing or pushing the dot out.
            float timeSp = WidgetViews.sp(context, R.dimen.widget_text_small_time) * textScale;
            v.setTextViewTextSize(R.id.small_next_time, TypedValue.COMPLEX_UNIT_SP, WidgetViews.fitSp(
                    context, next.time, Typeface.DEFAULT_BOLD, timeSp, SMALL_NEXT_TIME_MIN_SP,
                    panelDp - SMALL_NEXT_TIME_TRAIL_DP));
            v.setTextViewText(R.id.small_next_title, WidgetText.styled(
                    rowTitle(next, plan.shows(WidgetFill.WHOS_WHERE)), plan.isChild, false));
            // Same rule as the list (DayWidgetFactory.row): a child view names no one, so no
            // member dot; a done or past child item gets the tick.
            WidgetViews.bindDot(v, plan.isChild ? null : next.dot, plan.isChild && next.isDone);
            WidgetViews.onClick(v, R.id.small_next, context, id, WidgetViews.SLOT_SMALL_NEXT,
                    WidgetViews.or(next.link, s.links.nook), size);
        }
        return v;
    }

    /**
     * The small header's weather in the peek's slot: glyph + temperature at the header's scale
     * (so a narrow 2x2 shrinks them together), soft ink while the reading shows its age; GONE
     * when {@code slot} is null and the peek is back. No range or age line: the 2x2 has no room.
     */
    private static void bindSmallWeather(
            RemoteViews v, Context context, float headerScale, WidgetWeather.Shown slot) {
        v.setViewVisibility(R.id.small_weather, slot == null ? View.GONE : View.VISIBLE);
        if (slot == null) return;
        float scale = Math.min(WidgetSizes.effectiveScale(context, headerScale), WidgetSizes.TEXT_SCALE_MAX);
        WidgetViews.bindWeatherGlyph(
                v, R.id.small_weather_glyph, slot, SMALL_GLYPH_DP * scale, SMALL_GLYPH_DP);
        WidgetTextBitmaps.bind(v, context, R.id.small_weather_temp, slot.temp, SMALL_TEMP, headerScale, 0,
                slot.aged ? R.color.widget_ink_soft : R.color.widget_ink);
    }

    // ---- message states ------------------------------------------------------------------

    /**
     * Show the relaxed block ("nothing on today," in Caveat over "enjoy", the hug at the panel's
     * bottom right; `widget_part_relaxed.xml`) when {@link WidgetFill.Plan#isRelaxed}. Returns
     * whether it is shown; the caller hides the panel content it replaces. Its "enjoy" line is
     * sized by the caller's sizing helper.
     */
    private static boolean bindRelaxed(
            RemoteViews v, Context context, WidgetFill.Plan plan, float textScale, float panelDp) {
        boolean relaxed = plan.isRelaxed();
        v.setViewVisibility(R.id.relaxed, relaxed ? View.VISIBLE : View.GONE);
        if (relaxed) {
            WidgetTextBitmaps.bind(v, context, R.id.relaxed_title, plan.snapshot.labels.nothingOnToday,
                    CAVEAT_LINE, textScale, panelDp, R.color.widget_accent_text);
            WidgetViews.textOrGone(v, R.id.relaxed_enjoy, plan.snapshot.labels.enjoy);
        }
        return relaxed;
    }

    private static RemoteViews signedOut(Context context, int id, WidgetSizes.Size size, float widthDp,
            WidgetPrefs prefs, float textScale) {
        return message(context, id, size, widthDp, prefs, textScale, WidgetViews.SIGNED_OUT_LINK,
                context.getString(R.string.widget_open_beanies),
                context.getString(R.string.widget_sign_in_to_see));
    }

    /** File present but unreadable / an unknown version: never shown as signed out. */
    private static RemoteViews refresh(Context context, int id, WidgetSizes.Size size, float widthDp,
            WidgetPrefs prefs, float textScale) {
        return message(context, id, size, widthDp, prefs, textScale, WidgetViews.FALLBACK_NOOK,
                context.getString(R.string.widget_refresh), "");
    }

    /** Sets EVERY message view (title, line, image), so no state's text survives into another. */
    private static RemoteViews message(Context context, int id, WidgetSizes.Size size, float widthDp,
            WidgetPrefs prefs, float textScale, String link, String title, String line) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_message);
        sizeMessageText(v, context, textScale);
        // A message's text sits on the card itself, so a message is always drawn solid.
        frame(v, context, id, size, 100, link);
        v.setImageViewResource(R.id.message_image, R.drawable.widget_covering_eyes);
        WidgetTextBitmaps.bind(v, context, R.id.message_title, title, MESSAGE_TITLE,
                textScale, widthDp - MESSAGE_INSET_DP, R.color.widget_accent_text);
        WidgetViews.textOrGone(v, R.id.message_line, line);
        return v;
    }

    // ---- text sizes (one helper per layout, called first) -----------------------------------

    /** Medium + large: the date column, the to-dos heading, the footer and the relaxed line. */
    private static void sizeAgendaText(
            RemoteViews v, Context context, float textScale, WidgetSnapshot.DayEntry entry) {
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body,
                R.id.date_weather_sub, R.id.date_as_of, R.id.date_audience, R.id.date_due,
                R.id.tasks_heading, R.id.tasks_more, R.id.footer_tonight, R.id.footer_later);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_relaxed, R.id.relaxed_enjoy);
        // The weekday and month fill the fixed 52dp column: a short name grows with the choice, a
        // long one ("Wednesday", "September") shrinks to fit, never below DATE_COLUMN_MIN_SP.
        float body = WidgetViews.sp(context, R.dimen.widget_text_body) * textScale;
        v.setTextViewTextSize(R.id.date_weekday, TypedValue.COMPLEX_UNIT_SP, WidgetViews.fitSp(
                context, entry.weekday, WEEKDAY_FACE, body, DATE_COLUMN_MIN_SP, DATE_COLUMN_DP));
        v.setTextViewTextSize(R.id.date_month, TypedValue.COMPLEX_UNIT_SP, WidgetViews.fitSp(
                context, entry.month, Typeface.DEFAULT, body, DATE_COLUMN_MIN_SP, DATE_COLUMN_DP));
    }

    /**
     * The scale the small header's weekday and numeral bitmaps draw at: the Text size multiplier,
     * but no wider than the room beside the peek. On a wide enough widget a Standard header is
     * unchanged (1). On the narrowest one (a 5-column launcher grid, the 60dp family peek) even
     * Standard runs under the peek, so the header shrinks to fit, down to
     * {@link #SMALL_HEADER_MIN_SCALE}. Below API 31 the header row cannot grow
     * (setViewLayoutHeight is 31+), so the header never draws bigger than Standard there.
     *
     * When the weather holds the peek's slot ({@code slot}, #134) its glyph and temperature
     * scale with the header, so they share the budget: the slot's fixed part is only the gap.
     */
    private static float smallHeaderScale(Context context, float widthDp, float textScale,
            WidgetFill.Plan plan, WidgetWeather.Shown slot) {
        float upper = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? textScale : 1f;
        float standard = WidgetTextBitmaps.naturalWidthDp(context, plan.entry.weekdayShort, SMALL_WEEKDAY, 1f)
                + WidgetTextBitmaps.naturalWidthDp(context, plan.entry.numeral, SMALL_NUMERAL, 1f);
        if (standard <= 0f) return upper;
        float slotFixed = WidgetViews.peekWidthDp(context, plan);
        if (slot != null) {
            slotFixed = WEATHER_GAP_DP;
            standard += SMALL_GLYPH_DP * WidgetSizes.effectiveScale(context, 1f)
                    + WidgetTextBitmaps.naturalWidthDp(context, slot.temp, SMALL_TEMP, 1f);
        }
        float room = widthDp - SMALL_CONTENT_INSET_DP - slotFixed
                - WidgetViews.dp(context, R.dimen.widget_small_peek_end) - SMALL_HEADER_TRAIL_DP;
        return Math.max(SMALL_HEADER_MIN_SCALE, Math.min(upper, room / standard));
    }

    /**
     * Small: the next item, the stale line, the relaxed line, and (API 31+) the header row, which
     * holds the weekday and numeral bitmaps at a fixed height, so it grows with them (`headerScale`
     * × the system font scale, which the bitmaps are drawn through); the peeks move down by the
     * same amount so they still end 2dp inside the panel. Never `date_weekday`: on the 2x2 it is
     * an ImageView (a bitmap), and a text-size action on it fails in the launcher.
     */
    private static void sizeSmallText(RemoteViews v, Context context, float textScale, float headerScale) {
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body,
                R.id.small_next_label, R.id.date_as_of);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_small_title, R.id.small_next_title);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_small_time, R.id.small_next_time);
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_relaxed, R.id.relaxed_enjoy);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // The row grows as much as its numeral bitmap actually does: through applyDimension, so
            // Android 14's non-linear font scaling is honoured, and never past TEXT_SCALE_MAX, so a
            // very large system font cannot take the panel's room (beyond it the bitmaps fit the
            // row, as they always have).
            android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            float numeralGrowth = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP,
                    SMALL_NUMERAL.sp * headerScale, metrics)
                    / TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, SMALL_NUMERAL.sp, metrics);
            float header = WidgetViews.dp(context, R.dimen.widget_small_header_height);
            float grown = header * Math.max(1f, Math.min(numeralGrowth, WidgetSizes.TEXT_SCALE_MAX));
            v.setViewLayoutHeight(R.id.date_column, grown, TypedValue.COMPLEX_UNIT_DIP);
            // The weather in the peek's slot is the header row's height, so it stays level with it.
            v.setViewLayoutHeight(R.id.small_weather, grown, TypedValue.COMPLEX_UNIT_DIP);
            float peekTop = WidgetViews.dp(context, R.dimen.widget_small_peek_top) + grown - header;
            v.setViewLayoutMargin(R.id.peek_family, RemoteViews.MARGIN_TOP, peekTop, TypedValue.COMPLEX_UNIT_DIP);
            v.setViewLayoutMargin(R.id.peek_avatar, RemoteViews.MARGIN_TOP, peekTop, TypedValue.COMPLEX_UNIT_DIP);
        }
    }

    /** Signed out / refresh / the render fallback. */
    private static void sizeMessageText(RemoteViews v, Context context, float textScale) {
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body, R.id.message_line);
    }

    // ---- shared --------------------------------------------------------------------------

    /**
     * The card's opacity and the whole-widget tap. Below 100% the frame (widget_frame) alone
     * paints the card, at the Background choice, so it is one even surface; readable text never
     * sits on it: the agenda panel keeps its own 95% fill, and the date column (the small header)
     * gets {@link #dateTile}.
     */
    private static void frame(
            RemoteViews v, Context context, int id, WidgetSizes.Size size, int opacity, String link) {
        int alpha = Math.round(opacity * 255f / 100f);
        v.setInt(R.id.widget_frame, "setImageAlpha", alpha);
        // See-through: the frame alone paints the card. Thinning both layers left the inner one
        // stacked on the frame, so the card's middle came out more solid than its 10dp edge and
        // the edge read as a separate ring. Solid: the inner surface stays, as before.
        v.setInt(R.id.widget_inner, "setImageAlpha", opacity < 100 ? 0 : 255);
        WidgetViews.onClick(v, R.id.widget_root, context, id, WidgetViews.SLOT_ROOT,
                WidgetViews.or(link, WidgetViews.FALLBACK_NOOK), size);
    }

    /**
     * The date column's (the small header's) 95% tile, drawn only when the card is see-through,
     * so a solid widget looks exactly as before. Day layouts only: the message layout has no
     * date column and keeps its card solid.
     */
    private static void dateTile(RemoteViews v, int opacity) {
        v.setInt(R.id.date_column, "setBackgroundResource", opacity < 100 ? R.drawable.widget_tile_bg : 0);
    }

    /** "as of 08:30" (device time format) when the plan is stale; "" otherwise. */
    private static String asOf(Context context, WidgetFill.Plan plan) {
        if (!plan.stale) return "";
        return asOfText(context, plan.snapshot.labels.asOf, WidgetFill.parseIso(plan.snapshot.generatedAt));
    }

    /**
     * {@code template} ("as of {time}": `labels.asOf`, or `labels.weatherAsOf` for a reading's
     * age) filled with {@code epochMs}; "" when the template is empty or the instant unknown.
     */
    private static String asOfText(Context context, String template, long epochMs) {
        if (template.isEmpty() || epochMs <= 0) return "";
        // A time alone reads as "this morning"; another day names the day (same rule as iOS
        // StaleLabel). Lowercased so "3:31 AM" matches the rows' "10:15am" style.
        String when = android.text.format.DateUtils.isToday(epochMs)
                ? DateFormat.getTimeFormat(context).format(new Date(epochMs)).toLowerCase(java.util.Locale.ROOT)
                : android.text.format.DateUtils.formatDateTime(context, epochMs,
                        android.text.format.DateUtils.FORMAT_SHOW_DATE
                                | android.text.format.DateUtils.FORMAT_ABBREV_MONTH
                                | android.text.format.DateUtils.FORMAT_NO_YEAR);
        return template.replace("{time}", when);
    }

    /** The row's title, or the handoff's inline title when "who's where" is on. */
    static String rowTitle(WidgetSnapshot.Row row, boolean whosWhere) {
        if (whosWhere && row.handoff != null && !row.handoff.inlineTitle.isEmpty()) {
            return row.handoff.inlineTitle;
        }
        return row.title;
    }
}
