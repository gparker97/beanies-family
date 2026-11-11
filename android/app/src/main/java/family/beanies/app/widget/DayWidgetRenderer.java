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
 * and in the child's label at the foot of the date column.
 *
 * TWO LAYOUTS (2026-11-11), from {@link WidgetFill.Plan#layout}: Your day, unchanged, and To-dos,
 * where the to-dos section is added into the panel's TOP slot with group headings, its rows pinned
 * (API 31+) to the heights the fill charged and drawn at its size step, and the footer's right side
 * is "N more" / "all to-dos ›" to the To-Dos page. The small To-dos widget draws the count in the
 * peek's slot and the rows under the header, and opens the To-Dos page.
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
    /**
     * The date column's temperature (#134): Outfit Bold 13sp, as iOS DayColumnView. It shrinks to
     * fit the room beside the glyph down to 9sp before it would ellipsize: at a 200% system font
     * the 11sp floor still overran and drew "2…".
     */
    private static final WidgetTextBitmaps.Style COLUMN_TEMP =
            new WidgetTextBitmaps.Style(R.font.outfit_bold, 13f, 9f, 1, false);
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
    /** A task row's glyph sizes (widget_task_box's 10dp, the 12dp glyphs) and its 14dp member dot. */
    private static final float TASK_BOX_DP = 10f;
    private static final float TASK_GLYPH_DP = 12f;
    private static final float DOT_DP = 14f;
    /** The small To-dos rows' lead column (API 31+): the glyph and a little air, not a time's width. */
    private static final float SMALL_TASK_LEAD_DP = 16f;

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
                        ? WidgetFill.plan(result.snapshot, prefs, size, heightDp, now,
                                WidgetSizes.taskStepFactors(context, prefs, size),
                                WidgetViews.titleWidthCheck(context, agendaPanelDp(widthDp), textScale))
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
        // The child's "Ava's day" label; an adult's family view has none.
        String audience = plan.isChild ? s.labels.childsDay : "";
        // countText.text is '' when nothing is due; an empty WidgetText is never drawn.
        boolean dueCount = plan.shows(WidgetFill.DUE) && day != null && day.tasks.count > 0
                && !day.tasks.countText.text.isEmpty();
        // The weather (#134) under the month: the row always (glyph + temperature, or + today's
        // high once the temperature is gone), then the range, or the age once the reading is old
        // enough (WidgetWeather; no thresholds here).
        WidgetWeather.Shown weather = WidgetWeather.at(s.weather, now);
        // A stale snapshot's own "as of" (asOf) already dates the whole column, the weather
        // included, so the reading's age would repeat it: the age is left out and the row stays.
        String age = weather != null && weather.showsAge() && asOf.isEmpty()
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

        // Footer: tonight (meals block) and "later ›" (always, to the calendar on today); in To-dos
        // the right side is "N more" / "all to-dos ›" to the To-Dos page ("" without the label).
        boolean todos = plan.layout == WidgetFill.Layout.TODOS;
        boolean tonight = plan.shows(WidgetFill.MEALS) && day != null && day.tonight != null
                && !day.tonight.text.text.isEmpty();
        v.setViewVisibility(R.id.footer_tonight, tonight ? View.VISIBLE : View.INVISIBLE);
        if (tonight) {
            v.setTextViewText(R.id.footer_tonight, WidgetText.emphasised(day.tonight.text));
            WidgetViews.onClick(v, R.id.footer_tonight, context, id, WidgetViews.SLOT_TONIGHT,
                    WidgetViews.or(day.tonight.link, s.links.nook), size);
        }
        String right = todos ? plan.todosFooterText() : s.labels.later;
        if (WidgetViews.textOrGone(v, R.id.footer_later, right)) {
            WidgetViews.onClick(v, R.id.footer_later, context, id, WidgetViews.SLOT_LATER,
                    todos ? s.links.todo : s.links.nook, size);
        }
        v.setViewVisibility(R.id.panel_footer, tonight || !right.isEmpty() ? View.VISIBLE : View.GONE);
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
     * The to-dos section (`widget_part_tasks.xml`): the heading ("to-dos and lists", a hairline,
     * and at its right "2 more" in Your day or the due count in To-dos, whose "N more" is in the
     * footer) and the rows. Built once per render as a nested RemoteViews and added into ONE slot:
     * under the calendar in Your day, above it in To-dos. Both slots are emptied first on every
     * render, so no old section survives. Your day adds nothing when no task shows; To-dos keeps
     * the heading over the all-clear block.
     */
    private static void bindTasks(RemoteViews v, Context context, int id, WidgetSizes.Size size,
            float textScale, WidgetFill.Plan plan) {
        v.removeAllViews(R.id.tasks_slot_top);
        v.removeAllViews(R.id.tasks_slot_bottom);
        boolean todos = plan.layout == WidgetFill.Layout.TODOS;
        WidgetSnapshot.Day day = plan.day;
        boolean show = !plan.visibleTasks.isEmpty() || (todos && day != null && !day.tasks.heading.isEmpty());
        if (!show) return;

        WidgetSnapshot s = plan.snapshot;
        RemoteViews section = new RemoteViews(context.getPackageName(), R.layout.widget_part_tasks);
        WidgetViews.textSize(section, context, textScale, R.dimen.widget_text_body,
                R.id.tasks_heading, R.id.tasks_more);
        String sectionLink = WidgetViews.or(day.tasks.link, s.links.todo);
        WidgetViews.textOrGone(section, R.id.tasks_heading, day.tasks.heading);
        WidgetViews.textOrGone(section, R.id.tasks_more,
                todos ? WidgetText.emphasised(day.tasks.countText) : plan.moreText());
        WidgetViews.onClick(section, R.id.tasks_heading_row, context, id, WidgetViews.SLOT_TASKS_HEADING,
                sectionLink, size);
        addTaskRows(section, context, id, size, textScale, plan, sectionLink, true);
        v.addView(todos ? R.id.tasks_slot_top : R.id.tasks_slot_bottom, section);
    }

    /**
     * The task rows into {@code target}'s `tasks_rows` (the section's, or the small widget's):
     * each a nested RemoteViews (`widget_task_row.xml`) so every row has its own dot views and,
     * when {@code rowClicks}, its own tap slot. In To-dos each group with a label is led by its
     * heading, and on API 31+ every row and heading is pinned to the height the fill charged
     * ({@link WidgetFill#ROW_DP} / {@link WidgetFill#GROUP_HEADING_DP} × the step) in real dp:
     * the fill's dp are text-scaled (`WidgetSizes.layoutHeightDp` divides by max(1, scale)).
     */
    private static void addTaskRows(RemoteViews target, Context context, int id, WidgetSizes.Size size,
            float textScale, WidgetFill.Plan plan, String sectionLink, boolean rowClicks) {
        boolean todos = plan.layout == WidgetFill.Layout.TODOS;
        float step = plan.taskStep;
        float realDp = Math.max(1f, WidgetSizes.effectiveScale(context, textScale));
        float leadDp = WidgetViews.leadColumnDp(context, plan, textScale);
        int slot = 0;
        if (!todos) {
            for (WidgetSnapshot.Task task : plan.visibleTasks) {
                target.addView(R.id.tasks_rows, taskRow(context, id, size, textScale, task, slot++,
                        sectionLink, leadDp, rowClicks));
            }
            return;
        }
        for (WidgetFill.TaskGroup group : plan.taskGroups) {
            if (!group.label.isEmpty()) {
                RemoteViews heading = WidgetViews.heading(context, textScale * step, group.label,
                        group.isAccent() ? R.color.widget_accent_text : R.color.widget_ink_soft, "");
                WidgetViews.pinHeight(heading, R.id.divider_root, WidgetFill.GROUP_HEADING_DP * step * realDp);
                target.addView(R.id.tasks_rows, heading);
            }
            for (WidgetSnapshot.Task task : group.tasks) {
                RemoteViews row = taskRow(context, id, size, textScale * step, task, slot++,
                        sectionLink, leadDp, rowClicks);
                WidgetViews.pinHeight(row, R.id.task_root, WidgetFill.ROW_DP * step * realDp);
                if (size == WidgetSizes.Size.SMALL) {
                    WidgetViews.pinWidth(row, R.id.task_lead, SMALL_TASK_LEAD_DP);
                }
                if (step > 1f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    stepGlyphAndDot(row, task, step);
                }
                target.addView(R.id.tasks_rows, row);
            }
        }
    }

    /**
     * One task row at {@code textScale} (the widget's, × the To-dos step when stepping). A tap
     * opens the task ({@code rowClicks}); the small widget passes false, so its rows fall through
     * to the whole-widget tap (the To-Dos page), as on iOS.
     */
    private static RemoteViews taskRow(Context context, int id, WidgetSizes.Size size, float textScale,
            WidgetSnapshot.Task task, int index, String sectionLink, float leadDp, boolean rowClicks) {
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
        if (rowClicks) {
            WidgetViews.onClick(row, R.id.task_root, context, id, WidgetViews.SLOT_TASK + index,
                    WidgetViews.or(task.link, sectionLink), size);
        }
        return row;
    }

    /**
     * API 31+, a stepped To-dos row: the glyph and the member dot grow with the text. The glyph
     * moves to its fitCenter copy (centerInside never scales up) at its own size × the step.
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private static void stepGlyphAndDot(RemoteViews row, WidgetSnapshot.Task task, float step) {
        int glyph = taskGlyph(task);
        row.setViewVisibility(R.id.task_glyph, View.GONE);
        row.setViewVisibility(R.id.task_glyph_step, View.VISIBLE);
        row.setImageViewResource(R.id.task_glyph_step, glyph);
        WidgetViews.pinSize(row, R.id.task_glyph_step,
                (glyph == R.drawable.widget_task_box ? TASK_BOX_DP : TASK_GLYPH_DP) * step);
        WidgetViews.pinSize(row, R.id.dot_frame, DOT_DP * step);
        WidgetViews.bindDot(row, task.dot, false, step);
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
        // To-dos: the whole widget opens the To-Dos page, and the due count takes the peek's slot
        // while there is one ("" with only undated / later to-dos: the slot is then Your day's).
        boolean todos = plan.layout == WidgetFill.Layout.TODOS;
        boolean countInSlot = todos && plan.day != null && !plan.day.tasks.countText.text.isEmpty();
        // The weather takes the peek's slot only while a current temperature exists (#134).
        WidgetWeather.Shown weather = WidgetWeather.at(s.weather, now);
        WidgetWeather.Shown slot = !countInSlot && weather != null && weather.hasCurrent() ? weather : null;
        float headerScale = smallHeaderScale(context, widthDp, textScale, plan, slot);
        sizeSmallText(v, context, textScale, headerScale);
        String link = todos ? s.links.todo : s.links.nook;
        frame(v, context, id, size, prefs.opacity, link);
        dateTile(v, prefs.opacity);
        // The count is readable text in the header row, so it gets the header's tile too.
        tile(v, R.id.small_count, prefs.opacity);

        WidgetTextBitmaps.bind(v, context, R.id.date_weekday, plan.entry.weekdayShort, SMALL_WEEKDAY,
                headerScale, 0, R.color.widget_accent_text);
        WidgetTextBitmaps.bind(v, context, R.id.date_numeral, plan.entry.numeral, SMALL_NUMERAL,
                headerScale, 0, R.color.widget_ink);
        WidgetViews.onClick(v, R.id.date_column, context, id, WidgetViews.SLOT_DATE, link, size);
        WidgetViews.bindPeek(v, plan, slot != null || countInSlot);
        bindSmallWeather(v, context, headerScale, slot);
        WidgetViews.textOrGone(v, R.id.date_as_of, asOf(context, plan));

        WidgetSnapshot.Day day = plan.day;
        // A clear week: the relaxed block replaces only the panel's content (Your day's small has
        // no to-dos section, so tasks never hold it back: its visibleTasks is always empty). In
        // To-dos it is the all-clear state: no task at all.
        float panelDp = widthDp - SMALL_PANEL_INSET_DP;
        boolean relaxed = bindRelaxed(v, context, plan, textScale, panelDp);
        bindSmallTasks(v, context, id, textScale, plan, todos, countInSlot);
        boolean events = !todos && !relaxed && plan.shows(WidgetFill.EVENTS) && day != null;
        WidgetTextBitmaps.bind(v, context, R.id.small_things, events ? day.thingsText : "",
                CAVEAT_LINE, textScale, panelDp, R.color.widget_accent_text);

        // Next: the shared search (WidgetFill.Plan#next, the same rule as iOS), named with its
        // day when it falls on a later one ("next · Wed 15").
        WidgetFill.Next found = relaxed || todos ? null : plan.next(now);
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
     * The small widget's To-dos parts, set on every path: the due count in the peek's slot, the
     * rows under the header (no headings, no per-row tap) and "N more" at the foot. Your day
     * hides all three, so its small lays out as before.
     */
    private static void bindSmallTasks(RemoteViews v, Context context, int id, float textScale,
            WidgetFill.Plan plan, boolean todos, boolean countInSlot) {
        v.removeAllViews(R.id.tasks_rows);
        boolean rows = todos && !plan.visibleTasks.isEmpty();
        v.setViewVisibility(R.id.tasks_rows, rows ? View.VISIBLE : View.GONE);
        WidgetSnapshot.Day day = plan.day;
        WidgetViews.textOrGone(v, R.id.small_count,
                countInSlot ? WidgetText.emphasised(day.tasks.countText) : "");
        WidgetViews.textOrGone(v, R.id.small_more, rows ? plan.moreText() : "");
        if (rows) {
            addTaskRows(v, context, id, WidgetSizes.Size.SMALL, textScale, plan,
                    WidgetViews.or(day.tasks.link, plan.snapshot.links.todo), false);
        }
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
     * Show the relaxed block ("nothing on today," in Caveat over "enjoy", or "all clear," in the
     * To-dos layout ({@link WidgetFill.Plan#relaxedTitle}), the hug at the panel's
     * bottom right; `widget_part_relaxed.xml`) when {@link WidgetFill.Plan#isRelaxed}. Returns
     * whether it is shown; the caller hides the panel content it replaces. Its "enjoy" line is
     * sized by the caller's sizing helper.
     */
    private static boolean bindRelaxed(
            RemoteViews v, Context context, WidgetFill.Plan plan, float textScale, float panelDp) {
        boolean relaxed = plan.isRelaxed();
        v.setViewVisibility(R.id.relaxed, relaxed ? View.VISIBLE : View.GONE);
        if (relaxed) {
            WidgetTextBitmaps.bind(v, context, R.id.relaxed_title, plan.relaxedTitle(),
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
        return message(context, id, size, widthDp, prefs, textScale, WidgetViews.FALLBACK_CALENDAR,
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

    /**
     * Medium + large: the date column, the footer and the relaxed line. The to-dos section is a
     * nested RemoteViews sized where it is built ({@link #bindTasks}).
     */
    private static void sizeAgendaText(
            RemoteViews v, Context context, float textScale, WidgetSnapshot.DayEntry entry) {
        WidgetViews.textSize(v, context, textScale, R.dimen.widget_text_body,
                R.id.date_weather_sub, R.id.date_as_of, R.id.date_audience, R.id.date_due,
                R.id.footer_tonight, R.id.footer_later);
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
                R.id.small_next_label, R.id.date_as_of, R.id.small_count, R.id.small_more);
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
            // The To-dos due count holds the same slot.
            v.setViewLayoutHeight(R.id.small_count, grown, TypedValue.COMPLEX_UNIT_DIP);
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
                WidgetViews.or(link, WidgetViews.FALLBACK_CALENDAR), size);
    }

    /**
     * The date column's (the small header's) 95% tile, drawn only when the card is see-through,
     * so a solid widget looks exactly as before. Day layouts only: the message layout has no
     * date column and keeps its card solid.
     */
    private static void dateTile(RemoteViews v, int opacity) {
        tile(v, R.id.date_column, opacity);
    }

    /** {@link #dateTile}'s 95% tile behind {@code viewId}, only while the card is see-through. */
    private static void tile(RemoteViews v, int viewId, int opacity) {
        v.setInt(viewId, "setBackgroundResource", opacity < 100 ? R.drawable.widget_tile_bg : 0);
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
