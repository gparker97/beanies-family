package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.RemoteViews;
import family.beanies.app.R;
import java.util.Date;
import java.util.List;

/**
 * Builds one placed widget's RemoteViews from the snapshot read (#130). Called only from
 * {@link DayWidgetProvider#renderAll}; the calendar rows inside the list come from
 * {@link DayWidgetFactory}, which resolves the same {@link WidgetFill.Plan}. The medium and large
 * share one layout (round 9b) and differ only in how many task rows the fixed to-dos section has
 * and in the "my day" / "our day" label at the foot of the date column (large only).
 *
 * EVERY PATH SETS EVERY VIEW IT COULD LEAVE BEHIND. The launcher re-applies a new RemoteViews
 * onto the views it already inflated when the layout id is unchanged, so a view one render showed
 * and the next render does not mention keeps its old text (signed out → unreadable once kept
 * "sign in to see your day"). Each view a path may change is therefore set or hidden on every
 * path through the same layout, or lives inside a container whose visibility is always set.
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

    /** Layout insets (dp) between the widget's width and the line a bitmap may fill. */
    private static final float DATE_COLUMN_DP = 52f;
    /** Root padding 14 + 12, date column 52 + 8, panel padding 6 + 13. */
    static final float AGENDA_PANEL_INSET_DP = 105f;
    /** Root padding 14 + 14, panel padding 8 + 8. */
    private static final float SMALL_PANEL_INSET_DP = 44f;
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
            WidgetSnapshotStore.Result result,
            long now) {
        if (result.state == WidgetSnapshotStore.State.SIGNED_OUT) {
            return signedOut(context, appWidgetId, size, widthDp, prefs);
        }
        WidgetFill.Plan plan =
                result.state == WidgetSnapshotStore.State.READY
                        ? WidgetFill.plan(result.snapshot, prefs, size, heightDp, now)
                        : null;
        if (plan == null) return refresh(context, appWidgetId, size, widthDp, prefs);

        if (size == WidgetSizes.Size.SMALL) return small(context, appWidgetId, widthDp, prefs, plan, now);
        return agenda(context, appWidgetId, size, widthDp, prefs, plan);
    }

    // ---- medium + large ------------------------------------------------------------------

    private static RemoteViews agenda(
            Context context, int id, WidgetSizes.Size size, float widthDp, WidgetPrefs prefs,
            WidgetFill.Plan plan) {
        WidgetSnapshot s = plan.snapshot;
        WidgetSnapshot.Day day = plan.day;
        RemoteViews v = new RemoteViews(context.getPackageName(), size.layout);
        frame(v, context, id, size, prefs, s.links.nook);

        // Date column.
        WidgetTextBitmaps.bind(v, context, R.id.date_numeral, plan.entry.numeral, COLUMN_NUMERAL,
                DATE_COLUMN_DP, R.color.widget_ink);
        v.setTextViewText(R.id.date_weekday, plan.entry.weekday);
        v.setTextViewText(R.id.date_month, plan.entry.month);
        WidgetViews.onClick(v, R.id.date_column, context, id, WidgetViews.SLOT_DATE, s.links.nook, size);
        WidgetViews.textOrGone(v, R.id.date_as_of, asOf(context, plan));
        String audience = "";
        if (plan.isChild) {
            audience = s.labels.childsDay;
        } else if (size == WidgetSizes.Size.LARGE) {
            audience = plan.isOurDay ? s.labels.ourDay : s.labels.myDay;
        }
        WidgetViews.textOrGone(v, R.id.date_audience, audience);
        // countText.text is '' when nothing is due; an empty WidgetText is never drawn.
        boolean dueCount = plan.shows(WidgetFill.DUE) && day != null && day.tasks.count > 0
                && !day.tasks.countText.text.isEmpty();
        WidgetViews.textOrGone(
                v, R.id.date_due, dueCount ? WidgetText.emphasised(day.tasks.countText) : "");
        if (dueCount) {
            WidgetViews.onClick(v, R.id.date_due, context, id, WidgetViews.SLOT_DUE_COUNT,
                    WidgetViews.or(day.tasks.link, s.links.todo), size);
        }

        WidgetViews.bindPeek(v, plan);

        // The scrolling calendar. A unique data Uri per widget id stops the system from sharing
        // one factory between two placed widgets (Intent equality ignores extras).
        Intent service = new Intent(context, DayWidgetService.class);
        service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.agenda_list, service);
        v.setPendingIntentTemplate(R.id.agenda_list, WidgetViews.listTemplate(context, id));
        // A clear week with no tasks: the relaxed block takes the list's place inside the panel;
        // the date column, peek and footer stay (the same state as iOS).
        boolean relaxed = bindRelaxed(v, context, plan, widthDp - AGENDA_PANEL_INSET_DP);
        v.setViewVisibility(R.id.agenda_list, relaxed ? View.GONE : View.VISIBLE);

        bindTasks(v, context, id, size, plan);

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
     * The fixed to-dos section between the list and the footer: the heading ("to-dos and lists",
     * a hairline, "2 more" when not every task fits) and up to {@link WidgetFill#taskRows} rows,
     * each a nested RemoteViews (`widget_task_row.xml`) so every row has its own dot views. GONE
     * when no task shows; the row container is emptied on every render so no old row survives.
     */
    private static void bindTasks(
            RemoteViews v, Context context, int id, WidgetSizes.Size size, WidgetFill.Plan plan) {
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

        float leadDp = WidgetViews.leadColumnDp(context, plan);
        for (int i = 0; i < tasks.size(); i++) {
            WidgetSnapshot.Task task = tasks.get(i);
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task_row);
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
            Context context, int id, float widthDp, WidgetPrefs prefs, WidgetFill.Plan plan, long now) {
        WidgetSizes.Size size = WidgetSizes.Size.SMALL;
        WidgetSnapshot s = plan.snapshot;
        RemoteViews v = new RemoteViews(context.getPackageName(), size.layout);
        frame(v, context, id, size, prefs, s.links.nook);

        WidgetTextBitmaps.bind(v, context, R.id.date_weekday, plan.entry.weekdayShort, SMALL_WEEKDAY,
                0, R.color.widget_accent_text);
        WidgetTextBitmaps.bind(v, context, R.id.date_numeral, plan.entry.numeral, SMALL_NUMERAL,
                0, R.color.widget_ink);
        WidgetViews.onClick(v, R.id.date_column, context, id, WidgetViews.SLOT_DATE, s.links.nook, size);
        WidgetViews.bindPeek(v, plan);
        WidgetViews.textOrGone(v, R.id.date_as_of, asOf(context, plan));

        WidgetSnapshot.Day day = plan.day;
        // A clear week: the relaxed block replaces only the panel's content (the small has no
        // to-dos section, so tasks never hold it back: its visibleTasks is always empty).
        float panelDp = widthDp - SMALL_PANEL_INSET_DP;
        boolean relaxed = bindRelaxed(v, context, plan, panelDp);
        boolean events = !relaxed && plan.shows(WidgetFill.EVENTS) && day != null;
        WidgetTextBitmaps.bind(v, context, R.id.small_things, events ? day.thingsText : "",
                CAVEAT_LINE, panelDp, R.color.widget_accent_text);

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

    // ---- message states ------------------------------------------------------------------

    /**
     * Show the relaxed block ("nothing on today," in Caveat over "enjoy", the hug at the panel's
     * bottom right; `widget_part_relaxed.xml`) when {@link WidgetFill.Plan#isRelaxed}. Returns
     * whether it is shown; the caller hides the panel content it replaces.
     */
    private static boolean bindRelaxed(
            RemoteViews v, Context context, WidgetFill.Plan plan, float panelDp) {
        boolean relaxed = plan.isRelaxed();
        v.setViewVisibility(R.id.relaxed, relaxed ? View.VISIBLE : View.GONE);
        if (relaxed) {
            WidgetTextBitmaps.bind(v, context, R.id.relaxed_title, plan.snapshot.labels.nothingOnToday,
                    CAVEAT_LINE, panelDp, R.color.widget_accent_text);
            WidgetViews.textOrGone(v, R.id.relaxed_enjoy, plan.snapshot.labels.enjoy);
        }
        return relaxed;
    }

    private static RemoteViews signedOut(
            Context context, int id, WidgetSizes.Size size, float widthDp, WidgetPrefs prefs) {
        return message(context, id, size, widthDp, prefs, WidgetViews.SIGNED_OUT_LINK,
                context.getString(R.string.widget_open_beanies),
                context.getString(R.string.widget_sign_in_to_see));
    }

    /** File present but unreadable / an unknown version: never shown as signed out. */
    private static RemoteViews refresh(
            Context context, int id, WidgetSizes.Size size, float widthDp, WidgetPrefs prefs) {
        return message(context, id, size, widthDp, prefs, WidgetViews.FALLBACK_NOOK,
                context.getString(R.string.widget_refresh), "");
    }

    /** Sets EVERY message view (title, line, image), so no state's text survives into another. */
    private static RemoteViews message(Context context, int id, WidgetSizes.Size size, float widthDp,
            WidgetPrefs prefs, String link, String title, String line) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day_message);
        frame(v, context, id, size, prefs, link);
        v.setImageViewResource(R.id.message_image, R.drawable.widget_covering_eyes);
        WidgetTextBitmaps.bind(v, context, R.id.message_title, title, MESSAGE_TITLE,
                widthDp - MESSAGE_INSET_DP, R.color.widget_accent_text);
        WidgetViews.textOrGone(v, R.id.message_line, line);
        return v;
    }

    // ---- shared --------------------------------------------------------------------------

    /** The outer frame's opacity and the whole-widget tap. */
    private static void frame(
            RemoteViews v, Context context, int id, WidgetSizes.Size size, WidgetPrefs prefs, String link) {
        v.setInt(R.id.widget_frame, "setImageAlpha", Math.round(prefs.opacity * 255f / 100f));
        WidgetViews.onClick(v, R.id.widget_root, context, id, WidgetViews.SLOT_ROOT,
                WidgetViews.or(link, WidgetViews.FALLBACK_NOOK), size);
    }

    /** "as of 08:30" (device time format) when the plan is stale; "" otherwise. */
    private static String asOf(Context context, WidgetFill.Plan plan) {
        if (!plan.stale || plan.snapshot.labels.asOf.isEmpty()) return "";
        long generated = WidgetFill.parseIso(plan.snapshot.generatedAt);
        if (generated <= 0) return "";
        // A time alone reads as "this morning"; a snapshot from another day names the day (same
        // rule as iOS StaleLabel). Lowercased so "3:31 AM" matches the rows' "10:15am" style.
        String when = android.text.format.DateUtils.isToday(generated)
                ? DateFormat.getTimeFormat(context).format(new Date(generated)).toLowerCase(java.util.Locale.ROOT)
                : android.text.format.DateUtils.formatDateTime(context, generated,
                        android.text.format.DateUtils.FORMAT_SHOW_DATE
                                | android.text.format.DateUtils.FORMAT_ABBREV_MONTH
                                | android.text.format.DateUtils.FORMAT_NO_YEAR);
        return plan.snapshot.labels.asOf.replace("{time}", when);
    }

    /** The row's title, or the handoff's inline title when "who's where" is on. */
    static String rowTitle(WidgetSnapshot.Row row, boolean whosWhere) {
        if (whosWhere && row.handoff != null && !row.handoff.inlineTitle.isEmpty()) {
            return row.handoff.inlineTitle;
        }
        return row.title;
    }
}
