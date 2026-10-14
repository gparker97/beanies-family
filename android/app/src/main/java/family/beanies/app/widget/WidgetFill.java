package family.beanies.app.widget;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * What one placed widget shows, decided once and shared by the provider (date column, to-dos
 * section, footer, small widget) and the list factory (the calendar), so the two halves of a
 * widget can never disagree about the day, the audience, the switches or which rows show (#130).
 *
 * TWO SECTIONS (round 9b). The calendar is the scrolling list: today's rows in full, then every
 * later day that has a row, under its date divider. The to-dos section sits in a fixed place under
 * the list and shows up to {@link #taskRows} tasks. Each switch shows or hides a KIND of row and
 * never moves one: events → event rows; comingUp → trip and birthday rows; due → to-dos and
 * lists; hint → hints. Who's where and meals change a row's line and the footer.
 *
 * TODAY. "Today" is the device-local day (the app's `useToday`). The snapshot carries seven days
 * as of its build; past midnight the next entry becomes today with no republish. A snapshot whose
 * last day is before today keeps that day's content and is flagged stale, as is one built more
 * than 24 hours ago ("as of {time}").
 */
final class WidgetFill {

    static final String EVENTS = "events";
    static final String WHOS_WHERE = "whosWhere";
    static final String MEALS = "meals";
    static final String DUE = "due";
    static final String COMING_UP = "comingUp";
    static final String HINT = "hint";

    /**
     * ⚠️ MIRRORS WIDGET_FILL_ORDER in src/types/widgetSnapshot.ts (and WidgetFill.swift on iOS).
     * Keep the three in this order; the config activity and the prefs keys use these names.
     */
    static final String[] FILL_ORDER = {EVENTS, WHOS_WHERE, MEALS, DUE, COMING_UP, HINT};

    static final long STALE_AFTER_MS = 24L * 60L * 60L * 1000L;

    private WidgetFill() {}

    /** WIDGET_DEFAULT_BLOCKS: everything on. */
    static boolean isDefaultOn(String kind) {
        return true;
    }

    /*
     * Approximate heights, in dp, of what the panel stacks (measured on the Pixel Launcher at the
     * default text size). They only share out ROOM: the calendar is a scrolling list, so an
     * estimate that is a little off makes it scroll a row early or late, never clips anything.
     */
    static final float ROW_DP = 19f;
    static final float SUB_LINE_DP = 15f;
    static final float DIVIDER_DP = 19f;
    static final float NOTHING_LINE_DP = 21f;
    static final float TASKS_HEADING_DP = 15f;
    /**
     * Frame and panel padding, the peek's drop, the tasks' top margin and the footer, around
     * the list and the tasks (root 5+7, panel drop 20, panel padding 4+3, tasks margin 2,
     * footer 17+1). Over-estimating is the safe side: one task row fewer, never a squeezed list.
     */
    static final float PANEL_CHROME_DP = 59f;
    /** The most task rows any widget draws (each one needs its own tap slot, `WidgetViews`). */
    static final int MAX_TASK_ROWS = 16;

    /**
     * Task rows for a widget: the size's guaranteed slot ({@link #taskRows(WidgetSizes.Size)}),
     * plus every whole row the calendar leaves free in a widget {@code heightDp} tall (mockup 9b:
     * "plus any room left over"). A host that reports no height gets the slot alone.
     */
    static int taskRows(WidgetSizes.Size size, float heightDp, float calendarDp) {
        int reserve = taskRows(size);
        if (reserve == 0 || heightDp <= 0) return reserve;
        float spare = heightDp - PANEL_CHROME_DP - TASKS_HEADING_DP - calendarDp;
        return Math.min(MAX_TASK_ROWS, Math.max(reserve, (int) Math.floor(spare / ROW_DP)));
    }

    /** The guaranteed task rows of a size's fixed to-dos section (the small has none). */
    static int taskRows(WidgetSizes.Size size) {
        switch (size) {
            case SMALL:
                return 0;
            case MEDIUM:
                return 2;
            default:
                return 4;
        }
    }

    /** One later day in the calendar look-ahead: its divider and the rows that show under it. */
    static final class LaterDay {
        final WidgetSnapshot.DayEntry entry;
        /** The device's tomorrow: the divider adds `labels.tomorrow`. */
        final boolean isTomorrow;
        final List<WidgetSnapshot.Row> rows;

        LaterDay(WidgetSnapshot.DayEntry entry, boolean isTomorrow, List<WidgetSnapshot.Row> rows) {
            this.entry = entry;
            this.isTomorrow = isTomorrow;
            this.rows = rows;
        }
    }

    /** One placed widget's resolved content. */
    static final class Plan {
        final WidgetSnapshot snapshot;
        final WidgetSnapshot.DayEntry entry;
        /** The audience's day; null when the snapshot has none for this entry. */
        final WidgetSnapshot.Day day;
        final boolean isChild;
        final boolean isOurDay;
        final boolean stale;
        /** Today's calendar rows the switches show (todayOnly rows included). */
        final List<WidgetSnapshot.Row> todayRows;
        /** Every later entry with at least one shown row, ascending; never a todayOnly row. */
        final List<LaterDay> laterDays;
        /** Every task the switches show, in display order (empty for a child). */
        final List<WidgetSnapshot.Task> tasks;
        /** The tasks the fixed section has room for: the first {@link #taskRows} of {@link #tasks}. */
        final List<WidgetSnapshot.Task> visibleTasks;
        private final boolean[] shown;

        private Plan(
                WidgetSnapshot snapshot,
                WidgetSnapshot.DayEntry entry,
                WidgetSnapshot.Day day,
                boolean isChild,
                boolean isOurDay,
                boolean stale,
                boolean[] shown,
                List<WidgetSnapshot.Row> todayRows,
                List<LaterDay> laterDays,
                List<WidgetSnapshot.Task> tasks,
                int taskRows) {
            this.snapshot = snapshot;
            this.entry = entry;
            this.day = day;
            this.isChild = isChild;
            this.isOurDay = isOurDay;
            this.stale = stale;
            this.shown = shown;
            this.todayRows = todayRows;
            this.laterDays = laterDays;
            this.tasks = tasks;
            this.visibleTasks = tasks.subList(0, Math.min(taskRows, tasks.size()));
        }

        boolean shows(String kind) {
            int i = indexOf(kind);
            return i >= 0 && shown[i];
        }

        /**
         * The relaxed block ("nothing on today," / "enjoy" + the hug) in place of the calendar:
         * the events switch is on, the whole look-ahead is clear and no task shows (the small has
         * no task rows, so a clear week alone relaxes it). The date column, peek and footer stay.
         */
        /**
         * The next thing on (mirrors iOS `WidgetFill.nextRow`): today's next timed row that has not
         * ended, else today's first untimed row (a pinned trip or a birthday, which never end),
         * else the first row of the next later day. Timed first, so a trip pinned to the top of
         * today never hides the 4:30pm lesson all day. Null when the week is clear.
         */
        Next next(long now) {
            for (WidgetSnapshot.Row row : todayRows) {
                if (row.endsAt != null && !row.isPast(now)) return new Next(row, null);
            }
            for (WidgetSnapshot.Row row : todayRows) {
                if (row.endsAt == null) return new Next(row, null);
            }
            if (!laterDays.isEmpty()) {
                LaterDay later = laterDays.get(0);
                return new Next(later.rows.get(0), later);
            }
            return null;
        }

        boolean isRelaxed() {
            return shows(EVENTS) && todayRows.isEmpty() && laterDays.isEmpty() && visibleTasks.isEmpty();
        }

        /**
         * The calendar's handwritten first line when today has no rows but the widget is not
         * relaxed: "nothing on today" above waiting tasks, else "nothing on today, enjoy". ""
         * when today has rows or the events switch is off (hidden events are not "nothing").
         */
        String nothingTodayLine() {
            if (!shows(EVENTS) || !todayRows.isEmpty() || isRelaxed()) return "";
            WidgetSnapshot.Labels l = snapshot.labels;
            if (!visibleTasks.isEmpty()) return l.nothingToday;
            if (l.enjoy.isEmpty()) return l.nothingOnToday;
            return l.nothingOnToday + " " + l.enjoy;
        }

        /** "2 more" when the section cannot show every task; "" otherwise. */
        String moreText() {
            // Plus what the snapshot's per-switch cap left out, for the switches that are on.
            int capped = day == null ? 0
                    : (shows(DUE) ? day.tasks.overflowDue : 0) + (shows(HINT) ? day.tasks.overflowHint : 0);
            int more = capped + tasks.size() - visibleTasks.size();
            if (more <= 0 || snapshot.labels.more.isEmpty()) return "";
            return snapshot.labels.more.replace("{n}", String.valueOf(more));
        }

        /** The calendar rows' times (today, then the look-ahead), for the shared lead column. */
        List<String> calendarTimes() {
            List<String> times = new ArrayList<>();
            for (WidgetSnapshot.Row row : todayRows) times.add(row.time);
            for (LaterDay later : laterDays) {
                for (WidgetSnapshot.Row row : later.rows) times.add(row.time);
            }
            return times;
        }
    }

    /** The next thing on, and the later day it falls on (null for today). */
    static final class Next {
        final WidgetSnapshot.Row row;
        final LaterDay later;

        Next(WidgetSnapshot.Row row, LaterDay later) {
            this.row = row;
            this.later = later;
        }
    }

    /**
     * Resolve a snapshot for one widget. Null when the snapshot carries no day at all.
     * {@code heightDp} is the widget's height in TEXT-scaled units (`WidgetSizes.layoutHeightDp`),
     * used only to share the panel between the calendar and the to-dos.
     */
    static Plan plan(
            WidgetSnapshot s, WidgetPrefs prefs, WidgetSizes.Size size, float heightDp, long now) {
        if (s.days.isEmpty()) return null;
        int index = todayIndex(s, now);
        // A negative index means no entry for today: the latest day before today is shown and
        // flagged stale (the index is encoded as -(i + 1)).
        boolean stale = index < 0;
        if (stale) index = -index - 1;
        long generated = parseIso(s.generatedAt);
        if (generated > 0 && now - generated > STALE_AFTER_MS) stale = true;

        WidgetSnapshot.DayEntry entry = s.days.get(index);
        boolean isChild = s.viewer.isChild;
        boolean wantsOur = !isChild && WidgetPrefs.AUDIENCE_OUR.equals(prefs.audience);
        boolean isOur = wantsOur && entry.our != null;
        WidgetSnapshot.Day day = pick(entry, isOur);

        boolean[] shown = new boolean[FILL_ORDER.length];
        for (int i = 0; i < FILL_ORDER.length; i++) {
            String kind = FILL_ORDER[i];
            // A child sees no to-dos and no hints, whatever the configuration says.
            boolean childHidden = isChild && (DUE.equals(kind) || HINT.equals(kind));
            shown[i] = prefs.blocks[i] && !childHidden;
        }
        boolean events = shown[indexOf(EVENTS)];
        boolean comingUp = shown[indexOf(COMING_UP)];
        boolean due = shown[indexOf(DUE)];
        boolean hint = shown[indexOf(HINT)];

        List<WidgetSnapshot.Row> todayRows = rows(day, events, comingUp, true);
        List<LaterDay> later = new ArrayList<>();
        String tomorrowYmd = ymd(now, 1);
        for (int i = index + 1; i < s.days.size(); i++) {
            WidgetSnapshot.DayEntry next = s.days.get(i);
            List<WidgetSnapshot.Row> r = rows(pick(next, isOur), events, comingUp, false);
            if (!r.isEmpty()) later.add(new LaterDay(next, tomorrowYmd.equals(next.ymd), r));
        }

        List<WidgetSnapshot.Task> tasks = new ArrayList<>();
        if (day != null) {
            for (WidgetSnapshot.Task task : day.tasks.items) {
                if (task.title.isEmpty()) continue;
                if (task.isHint() ? hint : due) tasks.add(task);
            }
        }
        float calendarDp = calendarDp(todayRows, later, events, shown[indexOf(WHOS_WHERE)]);
        return new Plan(s, entry, day, isChild, isOur, stale, shown,
                Collections.unmodifiableList(todayRows), Collections.unmodifiableList(later),
                Collections.unmodifiableList(tasks), taskRows(size, heightDp, calendarDp));
    }

    /**
     * The index of the entry every widget shows for `now`: today's entry when the snapshot has
     * it; otherwise the latest day before today, returned as {@code -(index + 1)} so the caller
     * can flag it stale; a snapshot entirely in the future (the clock moved back) shows its first
     * day, unflagged. The snapshot must carry at least one day.
     */
    static int todayIndex(WidgetSnapshot s, long now) {
        String todayYmd = ymd(now, 0);
        for (int i = 0; i < s.days.size(); i++) {
            if (todayYmd.equals(s.days.get(i).ymd)) return i;
        }
        int latestBefore = -1;
        for (int i = 0; i < s.days.size(); i++) {
            if (s.days.get(i).ymd.compareTo(todayYmd) < 0) latestBefore = i;
        }
        return latestBefore >= 0 ? -(latestBefore + 1) : 0;
    }

    /**
     * The `ymd` the widgets painted from this read, or null when nothing dated was painted
     * (signed out, unreadable, or a snapshot with no days). The plugin relays it so the firehose
     * can tell "painted yesterday" from "painted today" without a device in hand.
     */
    static String renderedYmd(WidgetSnapshotStore.Result result, long now) {
        if (result.state != WidgetSnapshotStore.State.READY || result.snapshot.days.isEmpty()) {
            return null;
        }
        int index = todayIndex(result.snapshot, now);
        if (index < 0) index = -index - 1;
        return result.snapshot.days.get(index).ymd;
    }

    /** The calendar list's height: the nothing line or today's rows, then each later day. */
    private static float calendarDp(
            List<WidgetSnapshot.Row> todayRows, List<LaterDay> later, boolean events, boolean whosWhere) {
        float dp = todayRows.isEmpty() && events ? NOTHING_LINE_DP : 0f;
        for (WidgetSnapshot.Row row : todayRows) {
            dp += ROW_DP;
            if (whosWhere && row.handoff != null && !row.handoff.line.isEmpty()) dp += SUB_LINE_DP;
        }
        for (LaterDay day : later) dp += DIVIDER_DP + day.rows.size() * ROW_DP;
        return dp;
    }

    private static int indexOf(String kind) {
        for (int i = 0; i < FILL_ORDER.length; i++) {
            if (FILL_ORDER[i].equals(kind)) return i;
        }
        return -1;
    }

    /** A day's rows the switches show; a todayOnly row only when the day is today. */
    private static List<WidgetSnapshot.Row> rows(
            WidgetSnapshot.Day day, boolean events, boolean comingUp, boolean isToday) {
        List<WidgetSnapshot.Row> out = new ArrayList<>();
        if (day == null) return out;
        for (WidgetSnapshot.Row row : day.rows) {
            if (row.todayOnly && !isToday) continue;
            if (row.isComingUp() ? comingUp : events) out.add(row);
        }
        return out;
    }

    /**
     * The audience's day. "Our day" missing falls back to the viewer's own day (a child session
     * publishes no "our"); "my day" missing is an empty day, never the family's view, so a
     * damaged entry can never put other adults' items on a "my day" widget (same as iOS).
     */
    private static WidgetSnapshot.Day pick(WidgetSnapshot.DayEntry entry, boolean our) {
        return our && entry.our != null ? entry.our : entry.my;
    }

    /** The device-local calendar date `offsetDays` after `now`, as "yyyy-MM-dd". */
    static String ymd(long now, int offsetDays) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        if (offsetDays != 0) c.add(Calendar.DAY_OF_MONTH, offsetDays);
        return String.format(
                Locale.US,
                "%04d-%02d-%02d",
                c.get(Calendar.YEAR),
                c.get(Calendar.MONTH) + 1,
                c.get(Calendar.DAY_OF_MONTH));
    }

    /** The next device-local midnight after `now`, in epoch ms. */
    static long nextMidnight(long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.add(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** `generatedAt` (a JS `toISOString()`) in epoch ms, or -1 when absent or unparseable. */
    static long parseIso(String iso) {
        if (iso == null || iso.isEmpty()) return -1;
        String[] patterns = {"yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX"};
        for (String pattern : patterns) {
            try {
                Date d = new SimpleDateFormat(pattern, Locale.US).parse(iso);
                if (d != null) return d.getTime();
            } catch (ParseException ignored) {
                // Try the next shape.
            }
        }
        return -1;
    }
}
