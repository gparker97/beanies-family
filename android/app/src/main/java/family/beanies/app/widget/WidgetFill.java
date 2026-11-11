package family.beanies.app.widget;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * What one placed widget shows, decided once and shared by the provider (date column, to-dos
 * section, footer, small widget) and the list factory (the calendar), so the two halves of a
 * widget can never disagree about the day, the switches or which rows show (#130).
 *
 * TWO SECTIONS (round 9b). The calendar is the scrolling list: today's rows in full, then every
 * later day that has a row, under its date divider. The to-dos section sits in a fixed place under
 * the list and shows up to {@link #taskRows} tasks. Each switch shows or hides a KIND of row and
 * never moves one: events → event rows; comingUp → trip and birthday rows; due → to-dos and
 * lists; hint → hints. Who's where and meals change a row's line and the footer.
 *
 * TWO LAYOUTS (2026-11-11). {@link #effective} turns the stored choices into the switches every
 * reader already goes through plus a {@link Layout}: Your day (above, unchanged) or To-dos, where
 * the to-dos section sits at the TOP of the panel, grouped Overdue / Due Today / Coming Up, and
 * gets its rows (and, under Automatic text, its size) from {@link #todosFill}; the calendar below
 * it shows only what the effective switches leave (the upcoming-events extra). Nothing downstream
 * reads the Focus setting itself.
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

    /*
     * The To-dos layout (2026-11-11). Same estimates as above, but the to-dos section does not
     * scroll, so on API 31+ the renderer pins each task row and group heading to the height
     * charged here (DayWidgetRenderer) and the estimate cannot accumulate error.
     */
    /** A group heading ("overdue"): the divider layout, so the divider's height. */
    static final float GROUP_HEADING_DP = DIVIDER_DP;
    /**
     * The small widget's chrome around its panel content: content padding 14 + 7, the header
     * row's 34dp less its 2dp raise, the panel's 2dp top margin and 5 + 5 padding, rounded up.
     * {@link #PANEL_CHROME_DP} is the medium / large chrome only.
     */
    static final float SMALL_CHROME_DP = 66f;
    /** The small widget's "N more" line under its to-do rows: reserved only when not all fit. */
    static final float SMALL_MORE_DP = 15f;
    /** The fill's comparison slack: the stepped sums are floats. */
    private static final float FIT_EPSILON_DP = 0.01f;
    /**
     * The one-step answer: no stepping (the 5-argument {@link #plan}, and
     * `WidgetSizes.taskStepFactors` whenever the widget cannot step). Never mutate it: share
     * through {@code clone()}.
     */
    static final float[] NO_STEPS = {1f};

    /**
     * Whether every to-do title still fits its row at a size step (2026-11-11): the fill weighs
     * height only, so a step that fits the panel can still cut "buy birthday candles" to "buy
     * birthday ca…". Supplied by the device callers from ONE implementation
     * (`WidgetViews.titleWidthCheck`, Paint-measured) because measuring text needs a Context;
     * {@link #plan} applies it to the candidate factors before {@link #todosFill}, which stays
     * pure. {@code calendarTimes} sets the lead column the rows share with the calendar.
     */
    interface StepWidthCheck {
        boolean fits(List<WidgetSnapshot.Task> tasks, List<String> calendarTimes, float factor);
    }

    /** The check the 5- and 6-argument {@link #plan} overloads pass: every step fits. */
    static final StepWidthCheck ANY_WIDTH = (tasks, calendarTimes, factor) -> true;

    /** One task row's widths at a factor, in dp: what its title needs and the room it has. */
    interface RowMeasure {
        float titleDp(WidgetSnapshot.Task task, float factor);

        float roomDp(WidgetSnapshot.Task task, float factor);
    }

    /**
     * The width rule, pure: a step {@code factor} is allowed only if no title that fits its row
     * at ×1 would be cut at {@code factor}. A title already too long at ×1 does not block a step
     * (it is cut at every size).
     */
    static boolean noNewTruncation(List<WidgetSnapshot.Task> tasks, float factor, RowMeasure m) {
        for (WidgetSnapshot.Task task : tasks) {
            boolean fitsAtOne = m.titleDp(task, 1f) <= m.roomDp(task, 1f);
            if (fitsAtOne && m.titleDp(task, factor) > m.roomDp(task, factor)) return false;
        }
        return true;
    }

    /**
     * {@code factors} without the steps above ×1 that {@code check} rejects for {@code tasks};
     * ×1 (and anything below it) always stays. The check is never called when nothing steps.
     */
    static float[] widthAllowedSteps(float[] factors, List<WidgetSnapshot.Task> tasks,
            List<String> calendarTimes, StepWidthCheck check) {
        if (factors == null || factors.length == 0) return NO_STEPS.clone();
        float[] kept = new float[factors.length];
        int n = 0;
        for (float f : factors) {
            if (f <= 1f || check.fits(tasks, calendarTimes, f)) kept[n++] = f;
        }
        return n == 0 ? NO_STEPS.clone() : Arrays.copyOf(kept, n);
    }

    /** Which layout a placed widget draws, resolved once per render by {@link #effective}. */
    enum Layout {
        DAY,
        TODOS
    }

    /** The effective switches (indexed like {@link #FILL_ORDER}) and the layout. */
    static final class Effective {
        final boolean[] switches;
        final Layout layout;

        Effective(boolean[] switches, Layout layout) {
            this.switches = switches;
            this.layout = layout;
        }

        boolean shows(String kind) {
            int i = indexOf(kind);
            return i >= 0 && switches[i];
        }
    }

    /**
     * Step 1 of the shared rule (the plan's section 0, mirrored in WidgetFill.swift): the stored
     * choices to the switches every reader goes through, and the layout. Called once per render,
     * at the top of {@link #plan}, where the viewer is known.
     *
     *  - a child viewer: the stored switches, Your day (a child's snapshot carries no tasks);
     *  - focus To-dos: events = the events extra, meals = the meals extra, to-dos on, who's
     *    where, trips and birthdays and hints off; To-dos;
     *  - focus Your day with events and trips/birthdays off and to-dos on: the stored switches,
     *    To-dos (the "inferred" path: a to-dos-only widget loses its gap with no settings change);
     *  - otherwise the stored switches, Your day (the existing path, untouched).
     */
    static Effective effective(WidgetPrefs stored, boolean isChild) {
        boolean[] blocks = stored.blocks.clone();
        if (isChild) return new Effective(blocks, Layout.DAY);
        if (stored.focus == WidgetPrefs.Focus.TODOS) {
            boolean[] todos = new boolean[FILL_ORDER.length];
            todos[indexOf(EVENTS)] = stored.todosEvents;
            todos[indexOf(MEALS)] = stored.todosMeals;
            todos[indexOf(DUE)] = true;
            return new Effective(todos, Layout.TODOS);
        }
        if (!blocks[indexOf(EVENTS)] && !blocks[indexOf(COMING_UP)] && blocks[indexOf(DUE)]) {
            return new Effective(blocks, Layout.TODOS);
        }
        return new Effective(blocks, Layout.DAY);
    }

    /** The To-dos layout's groups, in the order the snapshot sends them (TASK_BUCKET_ORDER). */
    enum Group {
        OVERDUE,
        TODAY,
        /** `undated` and `later`, as on the To-Dos page. */
        COMING_UP
    }

    /** A task bucket's group; null for an empty or unrecognised bucket (it joins the current run). */
    static Group groupOf(String bucket) {
        if (bucket == null) return null;
        switch (bucket) {
            case "overdue":
                return Group.OVERDUE;
            case "today":
                return Group.TODAY;
            case "undated":
            case "later":
                return Group.COMING_UP;
            default:
                return null;
        }
    }

    /** One run of consecutive tasks in a group; a null group (a leading unknown bucket) has no heading. */
    static final class Run {
        final Group group;
        final int size;

        Run(Group group, int size) {
            this.group = group;
            this.size = size;
        }
    }

    /**
     * The tasks' buckets, in display order, split into runs: a run-length split, never a sort
     * (the snapshot already orders them bucket-first). An empty or unrecognised bucket joins the
     * current run with no heading of its own (a newer app's bucket, or a task with none).
     */
    static List<Run> taskRuns(List<String> buckets) {
        List<Run> runs = new ArrayList<>();
        Group current = null;
        int size = 0;
        for (String bucket : buckets) {
            Group g = groupOf(bucket);
            if (size > 0 && (g == null || g == current)) {
                size++;
                continue;
            }
            if (size > 0) runs.add(new Run(current, size));
            current = g;
            size = 1;
        }
        if (size > 0) runs.add(new Run(current, size));
        return runs;
    }

    /** What {@link #todosFill} chose: the step, the rows each group shows, and the "N more" count. */
    static final class TodosFill {
        final float step;
        final int[] shownPerGroup;
        final int more;

        TodosFill(float step, int[] shownPerGroup, int more) {
            this.step = step;
            this.shownPerGroup = shownPerGroup;
            this.more = more;
        }

        int shown() {
            int n = 0;
            for (int c : shownPerGroup) n += c;
            return n;
        }
    }

    /**
     * Step 2 of the shared rule: how the To-dos layout fills {@code heightDp} (the room for the
     * to-dos section and the events slot, in the same text-scaled dp as the constants). A pure
     * function of numbers, so it is tested on the plain JVM (WidgetFillTest's vectors) and
     * transliterates to WidgetFill.swift line for line; it never reads the OS version or the
     * snapshot.
     *
     * The cost at factor f is {@code headingDp + Σ groupHeadingDp[i] × f (non-empty groups) +
     * n × rowDp × f + reserveDp}. The largest factor in {@code stepFactors} whose cost fits and with
     * n ≤ {@link #MAX_TASK_ROWS} wins and every row shows. If none fits, rows are taken in order at
     * ×1 while they fit (a group heading only with at least one of its rows), never more than
     * {@link #MAX_TASK_ROWS} and never fewer than one. A host that reports no height
     * ({@code heightDp} ≤ 0) gets ×1 and the first {@code noHeightRows} rows. A group whose label
     * is missing passes a heading height of 0. {@code more} = {@code overflow} (what the snapshot's
     * cap left out) + the rows not shown.
     */
    static TodosFill todosFill(float heightDp, float headingDp, float rowDp, float[] groupHeadingDp,
            float reserveDp, int[] groupSizes, float[] stepFactors, int overflow, int noHeightRows) {
        int groups = groupSizes.length;
        int[] shown = new int[groups];
        int n = 0;
        for (int size : groupSizes) n += Math.max(0, size);
        int capped = Math.max(0, overflow);
        if (n == 0) return new TodosFill(1f, shown, capped);

        if (heightDp <= 0) {
            int left = Math.min(Math.max(1, noHeightRows), MAX_TASK_ROWS);
            int taken = 0;
            for (int i = 0; i < groups && left > 0; i++) {
                shown[i] = Math.min(Math.max(0, groupSizes[i]), left);
                left -= shown[i];
                taken += shown[i];
            }
            return new TodosFill(1f, shown, capped + n - taken);
        }

        float best = 0f;
        if (n <= MAX_TASK_ROWS) {
            float[] factors = stepFactors == null || stepFactors.length == 0 ? NO_STEPS : stepFactors;
            for (float f : factors) {
                float cost = headingDp + reserveDp + n * rowDp * f;
                for (int i = 0; i < groups; i++) {
                    if (groupSizes[i] > 0) cost += groupHeadingDp[i] * f;
                }
                if (cost <= heightDp + FIT_EPSILON_DP && f > best) best = f;
            }
        }
        if (best > 0f) {
            for (int i = 0; i < groups; i++) shown[i] = Math.max(0, groupSizes[i]);
            return new TodosFill(best, shown, capped);
        }

        float used = headingDp + reserveDp;
        int taken = 0;
        rows:
        for (int i = 0; i < groups; i++) {
            for (int r = 0; r < groupSizes[i]; r++) {
                if (taken >= MAX_TASK_ROWS) break rows;
                float need = rowDp + (r == 0 ? groupHeadingDp[i] : 0f);
                if (taken > 0 && used + need > heightDp + FIT_EPSILON_DP) break rows;
                used += need;
                shown[i]++;
                taken++;
            }
        }
        return new TodosFill(1f, shown, capped + n - taken);
    }

    /** The upcoming-events extra's guaranteed rows: medium 1, large 3 (never on the small). */
    static int eventsSlot(WidgetSizes.Size size) {
        switch (size) {
            case SMALL:
                return 0;
            case MEDIUM:
                return 1;
            default:
                return 3;
        }
    }

    /** The rows the To-dos fill shows when the host reports no height: small 3, medium 4, large 10. */
    static int noHeightRows(WidgetSizes.Size size) {
        switch (size) {
            case SMALL:
                return 3;
            case MEDIUM:
                return 4;
            default:
                return 10;
        }
    }

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

    /*
     * The date column (#134). RemoteViews has no ViewThatFits, so which of its optional lines show
     * is decided here, from the placed height, before binding. Flags name the lines a render
     * WANTS; dateColumnLines returns the ones that fit.
     */
    /**
     * The weather row under the month: glyph + temperature, or glyph + today's high once the
     * temperature is gone (WidgetWeather.Shown#rowText). Counted, never dropped.
     */
    static final int COLUMN_WEATHER = 1;
    /**
     * The line under it: today's range, or the reading's age when {@link #COLUMN_AGE} is set (an
     * aged reading, and every reading past `currentUntil`, whose row then shows today's high).
     */
    static final int COLUMN_WEATHER_SUB = 1 << 1;
    /**
     * The sub line is the age ("as of 3:40 pm", two lines) rather than the one-line range. The
     * renderer never wants it alongside {@link #COLUMN_STALE} (the snapshot's own "as of" says
     * the same date), so a stale snapshot's flags carry no age.
     */
    static final int COLUMN_AGE = 1 << 2;
    /** The snapshot's own "as of" line (a stale snapshot). Counted, never dropped. */
    static final int COLUMN_STALE = 1 << 3;
    /** "Ava's day": the child's label (an adult has none). */
    static final int COLUMN_AUDIENCE = 1 << 4;
    /** "2 for you today". */
    static final int COLUMN_DUE = 1 << 5;

    /*
     * The column's heights in dp at an effective text scale of 1, from widget_part_date_column.xml
     * and the bundled fonts' metrics: Outfit draws 1.26em (ascent 1.0 + descent 0.26), the host's
     * Roboto 11sp body line 14.6dp with font padding and 12.9dp per extra wrapped line.
     */
    /** Root padding 5 + 7, the column's 1dp top margin and its 6 + 4 padding: never scales. */
    static final float COLUMN_CHROME_DP = 23f;
    /** The Outfit Bold 32sp numeral bitmap. */
    static final float COLUMN_NUMERAL_DP = 40.3f;
    /** One body line (11sp) and each further wrapped line. */
    static final float COLUMN_LINE_DP = 14.6f;
    static final float COLUMN_WRAP_DP = 12.9f;
    /** The 2dp top margin of the weekday, the weather sub line, the child label and the due count. */
    static final float COLUMN_GAP_DP = 2f;
    /** The weather row: a 3dp top margin, then the taller of the 14dp glyph and 13sp Outfit temp. */
    static final float COLUMN_WEATHER_GAP_DP = 3f;
    static final float COLUMN_WEATHER_GLYPH_DP = 14f;
    static final float COLUMN_WEATHER_TEMP_DP = 16.4f;
    /**
     * Above this effective scale the 52dp column wraps the due count ("2 for you today") onto
     * three lines instead of two, and a child's "Ava's day" onto two (the layout's measured note:
     * three lines at Larger, two at Standard and Large). The "as of" phrases ("as of Oct 17",
     * "as of 4:08 am") stay on two lines at every scale (emulator, 2026-10-18).
     */
    static final float COLUMN_WRAP_SCALE = 1.2f;
    /** The "as of" lines (the stale snapshot's and the weather's age): two lines at every scale. */
    static final int COLUMN_AS_OF_LINES = 2;

    /**
     * Which of the date column's wanted lines fit a widget {@code heightDp} tall (the TEXT-scaled
     * height the renderer already has, `WidgetSizes.layoutHeightDp`) at the effective text scale
     * {@code textScale} (system font scale × the Text size choice, `WidgetSizes.effectiveScale`).
     *
     * The weather row and a stale snapshot's "as of" always stay. Only the wanted lines are
     * weighed; none is added or rewritten here. When the rest does not fit the lines go in the plan's order (#134 requirement 12, the same order as iOS's ViewThatFits
     * candidates): the weather's range/age line first, then the child label, then the due count. A
     * host that reports no height (0) keeps everything, as before weather.
     */
    static int dateColumnLines(float heightDp, float textScale, int flags) {
        if (heightDp <= 0) return flags;
        float scale = Math.max(textScale, 0.5f);
        // Back to real dp: layoutHeightDp divided the reported height by max(1, scale), and the
        // fixed parts (padding, glyph) do not grow with text, so the estimate runs in real dp.
        float room = heightDp * Math.max(1f, scale);
        int wrapped = scale > COLUMN_WRAP_SCALE ? 3 : 2;
        float body = COLUMN_LINE_DP * scale;

        float need = COLUMN_CHROME_DP + COLUMN_NUMERAL_DP * scale
                + COLUMN_GAP_DP + body          // weekday
                + body;                         // month
        if ((flags & COLUMN_WEATHER) != 0) {
            need += COLUMN_WEATHER_GAP_DP
                    + Math.max(COLUMN_WEATHER_GLYPH_DP * scale, COLUMN_WEATHER_TEMP_DP * scale);
        }
        float asOf = lines(COLUMN_AS_OF_LINES, scale);
        if ((flags & COLUMN_STALE) != 0) need += asOf;

        float sub = (flags & COLUMN_AGE) != 0 ? asOf : body;
        float audience = lines(wrapped - 1, scale);
        float due = lines(wrapped, scale);
        int[] dropOrder = {COLUMN_WEATHER_SUB, COLUMN_AUDIENCE, COLUMN_DUE};
        float[] cost = {COLUMN_GAP_DP + sub, COLUMN_GAP_DP + audience, COLUMN_GAP_DP + due};
        for (int i = 0; i < dropOrder.length; i++) {
            if ((flags & dropOrder[i]) != 0) need += cost[i];
        }
        int kept = flags;
        for (int i = 0; i < dropOrder.length && need > room; i++) {
            if ((kept & dropOrder[i]) == 0) continue;
            kept &= ~dropOrder[i];
            need -= cost[i];
        }
        return kept;
    }

    /** The height of a phrase that wraps onto {@code count} body lines. */
    private static float lines(int count, float scale) {
        return (COLUMN_LINE_DP + COLUMN_WRAP_DP * Math.max(0, count - 1)) * scale;
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
        /** The entry's day view; null when the snapshot has none for this entry. */
        final WidgetSnapshot.Day day;
        final boolean isChild;
        final boolean stale;
        /**
         * Today's calendar rows the switches show (todayOnly rows included); in To-dos, without
         * the rows that have already ended (the events extra has no scroll position).
         */
        final List<WidgetSnapshot.Row> todayRows;
        /** Every later entry with at least one shown row, ascending; never a todayOnly row. */
        final List<LaterDay> laterDays;
        /** Every task the switches show, in display order (empty for a child). */
        final List<WidgetSnapshot.Task> tasks;
        /**
         * The tasks the section has room for: the first {@link #taskRows} of {@link #tasks} in Your
         * day, the rows {@link #todosFill} chose in To-dos (always a prefix, never empty while a
         * task shows).
         */
        final List<WidgetSnapshot.Task> visibleTasks;
        /** Your day or To-dos ({@link #effective}). */
        final Layout layout;
        /** The To-dos rows' size step (1 = as drawn today); 1 in Your day. */
        final float taskStep;
        /** To-dos: {@link #visibleTasks} split into its groups, in order; empty in Your day. */
        final List<TaskGroup> taskGroups;
        private final boolean[] shown;

        private Plan(
                WidgetSnapshot snapshot,
                WidgetSnapshot.DayEntry entry,
                WidgetSnapshot.Day day,
                boolean isChild,
                boolean stale,
                boolean[] shown,
                List<WidgetSnapshot.Row> todayRows,
                List<LaterDay> laterDays,
                List<WidgetSnapshot.Task> tasks,
                int taskRows,
                Layout layout,
                float taskStep,
                List<TaskGroup> taskGroups) {
            this.snapshot = snapshot;
            this.entry = entry;
            this.day = day;
            this.isChild = isChild;
            this.stale = stale;
            this.shown = shown;
            this.todayRows = todayRows;
            this.laterDays = laterDays;
            this.tasks = tasks;
            this.visibleTasks = tasks.subList(0, Math.min(taskRows, tasks.size()));
            this.layout = layout;
            this.taskStep = taskStep;
            this.taskGroups = taskGroups;
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
            // To-dos: all clear is the day having no tasks (never how many rows fit, and not gated
            // on the events switch, which is off by default there), and the calendar is empty too.
            if (layout == Layout.TODOS) return isAllClear() && todayRows.isEmpty() && laterDays.isEmpty();
            return shows(EVENTS) && todayRows.isEmpty() && laterDays.isEmpty() && visibleTasks.isEmpty();
        }

        /** To-dos: the day has no task to show (a widget with tasks due always shows one row). */
        boolean isAllClear() {
            return layout == Layout.TODOS && tasks.isEmpty();
        }

        /**
         * The relaxed block's title: "all clear," in To-dos (falling back to "nothing on today,"
         * for a snapshot without the label), "nothing on today," in Your day.
         */
        String relaxedTitle() {
            WidgetSnapshot.Labels l = snapshot.labels;
            if (layout == Layout.TODOS && !l.todosAllClear.isEmpty()) return l.todosAllClear;
            return l.nothingOnToday;
        }

        /**
         * To-dos, all clear but the events extra has rows: the calendar's one handwritten line
         * above them ("all clear, enjoy"), in place of the relaxed block. "" otherwise.
         */
        String allClearLine() {
            if (!isAllClear() || isRelaxed()) return "";
            String enjoy = snapshot.labels.enjoy;
            return enjoy.isEmpty() ? relaxedTitle() : relaxedTitle() + " " + enjoy;
        }

        /**
         * To-dos: the footer's right side, "N more" when not every task fits, else "all to-dos ›"
         * ("" when the snapshot has no such label). Your day keeps "later ›".
         */
        String todosFooterText() {
            String more = moreText();
            return more.isEmpty() ? snapshot.labels.allTodos : more;
        }

        /**
         * The calendar's handwritten first line when today has no rows but the widget is not
         * relaxed: "nothing on today" above waiting tasks, else "nothing on today, enjoy". ""
         * when today has rows or the events switch is off (hidden events are not "nothing").
         */
        String nothingTodayLine() {
            // To-dos: the calendar under the to-dos is an extra, so an empty today says nothing.
            if (layout == Layout.TODOS) return "";
            if (!shows(EVENTS) || !todayRows.isEmpty() || isRelaxed()) return "";
            WidgetSnapshot.Labels l = snapshot.labels;
            if (!visibleTasks.isEmpty()) return l.nothingToday;
            if (l.enjoy.isEmpty()) return l.nothingOnToday;
            return l.nothingOnToday + " " + l.enjoy;
        }

        /** "2 more" when the section cannot show every task; "" otherwise. */
        String moreText() {
            // Plus what the snapshot's per-switch cap left out, for the switches that are on.
            int capped = capped(day, shows(DUE), shows(HINT));
            int more = capped + tasks.size() - visibleTasks.size();
            if (more <= 0 || snapshot.labels.more.isEmpty()) return "";
            return snapshot.labels.more.replace("{n}", String.valueOf(more));
        }

        /** The calendar rows' times (today, then the look-ahead), for the shared lead column. */
        List<String> calendarTimes() {
            return times(todayRows, laterDays);
        }
    }

    /** One group of the To-dos layout: its heading ("" = none) and the rows it shows. */
    static final class TaskGroup {
        final Group group;
        final String label;
        final List<WidgetSnapshot.Task> tasks;

        TaskGroup(Group group, String label, List<WidgetSnapshot.Task> tasks) {
            this.group = group;
            this.label = label;
            this.tasks = tasks;
        }

        /** "overdue" is drawn in the accent; the other headings in the softer ink. */
        boolean isAccent() {
            return group == Group.OVERDUE;
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
        return plan(s, prefs, size, heightDp, now, NO_STEPS);
    }

    /**
     * {@link #plan(WidgetSnapshot, WidgetPrefs, WidgetSizes.Size, float, long)} with the To-dos
     * fill's step factors, which come from ONE place, `WidgetSizes.taskStepFactors` (the stored
     * focus, Text size, size and API level), so the renderer and the list factory resolve the same
     * plan. Only the To-dos layout reads them.
     */
    static Plan plan(WidgetSnapshot s, WidgetPrefs prefs, WidgetSizes.Size size, float heightDp,
            long now, float[] stepFactors) {
        return plan(s, prefs, size, heightDp, now, stepFactors, ANY_WIDTH);
    }

    /**
     * The full plan: {@code widthCheck} drops the To-dos steps at which a title that fits at ×1
     * would be cut ({@link StepWidthCheck}); the renderer and the list factory both pass
     * `WidgetViews.titleWidthCheck`, so their plans agree.
     */
    static Plan plan(WidgetSnapshot s, WidgetPrefs prefs, WidgetSizes.Size size, float heightDp,
            long now, float[] stepFactors, StepWidthCheck widthCheck) {
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
        WidgetSnapshot.Day day = entry.day();

        // Before shown[] is consulted anywhere: the stored choices to switches and a layout.
        Effective effective = effective(prefs, isChild);
        Layout layout = effective.layout;
        boolean todos = layout == Layout.TODOS;
        boolean[] shown = new boolean[FILL_ORDER.length];
        for (int i = 0; i < FILL_ORDER.length; i++) {
            String kind = FILL_ORDER[i];
            // A child sees no to-dos and no hints, whatever the configuration says.
            boolean childHidden = isChild && (DUE.equals(kind) || HINT.equals(kind));
            // Neither To-dos extra appears on the small size: there is only room for the to-dos.
            boolean smallExtra = todos && size == WidgetSizes.Size.SMALL
                    && (EVENTS.equals(kind) || MEALS.equals(kind));
            shown[i] = effective.switches[i] && !childHidden && !smallExtra;
        }
        boolean events = shown[indexOf(EVENTS)];
        boolean comingUp = shown[indexOf(COMING_UP)];
        boolean due = shown[indexOf(DUE)];
        boolean hint = shown[indexOf(HINT)];

        List<WidgetSnapshot.Row> todayRows = rows(day, events, comingUp, true);
        // To-dos: the calendar has no scroll position, so a finished event would hold the
        // medium's one-row slot all afternoon; today's ended rows are left out.
        if (todos) todayRows = notEnded(todayRows, now);
        List<LaterDay> later = new ArrayList<>();
        String tomorrowYmd = ymd(now, 1);
        for (int i = index + 1; i < s.days.size(); i++) {
            WidgetSnapshot.DayEntry next = s.days.get(i);
            List<WidgetSnapshot.Row> r = rows(next.day(), events, comingUp, false);
            if (!r.isEmpty()) later.add(new LaterDay(next, tomorrowYmd.equals(next.ymd), r));
        }

        List<WidgetSnapshot.Task> tasks = new ArrayList<>();
        if (day != null) {
            for (WidgetSnapshot.Task task : day.tasks.items) {
                if (task.title.isEmpty()) continue;
                if (task.isHint() ? hint : due) tasks.add(task);
            }
        }
        if (!todos) {
            float calendarDp = calendarDp(todayRows, later, events, shown[indexOf(WHOS_WHERE)]);
            return new Plan(s, entry, day, isChild, stale, shown,
                    Collections.unmodifiableList(todayRows), Collections.unmodifiableList(later),
                    Collections.unmodifiableList(tasks), taskRows(size, heightDp, calendarDp),
                    layout, 1f, Collections.<TaskGroup>emptyList());
        }

        // The To-dos layout: the section's groups, then the fill.
        List<String> buckets = new ArrayList<>();
        for (WidgetSnapshot.Task task : tasks) buckets.add(task.bucket);
        boolean small = size == WidgetSizes.Size.SMALL;
        // The small draws no group headings: one run, no heading.
        List<Run> runs;
        if (!small) {
            runs = taskRuns(buckets);
        } else {
            runs = tasks.isEmpty()
                    ? Collections.<Run>emptyList()
                    : Collections.singletonList(new Run(null, tasks.size()));
        }
        int[] sizes = new int[runs.size()];
        float[] headings = new float[runs.size()];
        String[] labels = new String[runs.size()];
        for (int i = 0; i < runs.size(); i++) {
            sizes[i] = runs.get(i).size;
            labels[i] = small ? "" : groupLabel(runs.get(i).group, s.labels);
            headings[i] = labels[i].isEmpty() ? 0f : GROUP_HEADING_DP;
        }
        int overflow = capped(day, due, hint);
        TodosFill fill;
        if (small) {
            // Under the header (a stale snapshot's "as of" reserved). The "N more" line is held
            // only when something does not fit, as on iOS: first without it, then with it.
            float room = heightDp <= 0 ? 0f : Math.max(FIT_EPSILON_DP, heightDp - SMALL_CHROME_DP);
            float asOf = stale ? SUB_LINE_DP : 0f;
            fill = todosFill(room, 0f, ROW_DP, headings, asOf, sizes, NO_STEPS, overflow,
                    noHeightRows(size));
            if (fill.more > 0) {
                fill = todosFill(room, 0f, ROW_DP, headings, asOf + SMALL_MORE_DP, sizes, NO_STEPS,
                        overflow, noHeightRows(size));
            }
        } else {
            // Steps that would cut a title are dropped first; the fill itself weighs height only.
            List<WidgetSnapshot.Task> candidates = tasks.subList(0, Math.min(tasks.size(), MAX_TASK_ROWS));
            float[] factors = widthAllowedSteps(stepFactors, candidates, times(todayRows, later),
                    widthCheck == null ? ANY_WIDTH : widthCheck);
            float room = heightDp <= 0 ? 0f : Math.max(FIT_EPSILON_DP, heightDp - PANEL_CHROME_DP);
            fill = todosFill(room, TASKS_HEADING_DP, ROW_DP, headings,
                    eventsReserve(size, events, todayRows, later), sizes, factors, overflow,
                    noHeightRows(size));
        }
        List<TaskGroup> groups = new ArrayList<>();
        int start = 0;
        for (int i = 0; i < runs.size(); i++) {
            int count = fill.shownPerGroup[i];
            if (count > 0) {
                groups.add(new TaskGroup(runs.get(i).group, labels[i],
                        Collections.unmodifiableList(tasks.subList(start, start + count))));
            }
            start += sizes[i];
        }
        return new Plan(s, entry, day, isChild, stale, shown,
                Collections.unmodifiableList(todayRows), Collections.unmodifiableList(later),
                Collections.unmodifiableList(tasks), fill.shown(), layout, fill.step,
                Collections.unmodifiableList(groups));
    }

    /** A group's heading from the snapshot; "" (no heading) for a missing label or a null group. */
    private static String groupLabel(Group group, WidgetSnapshot.Labels l) {
        if (group == null) return "";
        switch (group) {
            case OVERDUE:
                return l.groupOverdue;
            case TODAY:
                return l.groupToday;
            default:
                return l.groupComingUp;
        }
    }

    /**
     * The upcoming-events extra's reserved room in the To-dos layout: when events show and the
     * look-ahead has a row, one divider (the "next up" heading) and up to {@link #eventsSlot}
     * rows. Only this slot can displace to-dos (they then count toward "N more").
     */
    private static float eventsReserve(WidgetSizes.Size size, boolean events,
            List<WidgetSnapshot.Row> todayRows, List<LaterDay> later) {
        if (!events) return 0f;
        int available = todayRows.size();
        for (LaterDay day : later) available += day.rows.size();
        if (available == 0) return 0f;
        return DIVIDER_DP + Math.min(eventsSlot(size), available) * ROW_DP;
    }

    /** What the snapshot's per-switch cap left out, for the switches that are on. */
    private static int capped(WidgetSnapshot.Day day, boolean due, boolean hint) {
        if (day == null) return 0;
        return (due ? day.tasks.overflowDue : 0) + (hint ? day.tasks.overflowHint : 0);
    }

    /** The calendar rows' times, today then the look-ahead (the shared lead column's widths). */
    private static List<String> times(List<WidgetSnapshot.Row> todayRows, List<LaterDay> later) {
        List<String> times = new ArrayList<>();
        for (WidgetSnapshot.Row row : todayRows) times.add(row.time);
        for (LaterDay day : later) {
            for (WidgetSnapshot.Row row : day.rows) times.add(row.time);
        }
        return times;
    }

    /** {@code rows} without the ones that have already ended at {@code now}. */
    private static List<WidgetSnapshot.Row> notEnded(List<WidgetSnapshot.Row> rows, long now) {
        List<WidgetSnapshot.Row> out = new ArrayList<>();
        for (WidgetSnapshot.Row row : rows) {
            if (!row.isPast(now)) out.add(row);
        }
        return out;
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

    /** The device-local calendar date `offsetDays` after `now`, as "yyyy-MM-dd". */
    static String ymd(long now, int offsetDays) {
        return ymd(now, offsetDays, TimeZone.getDefault());
    }

    /** The calendar date in `zone` `offsetDays` after `now`, as "yyyy-MM-dd". */
    static String ymd(long now, int offsetDays, TimeZone zone) {
        Calendar c = Calendar.getInstance(zone);
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
        return nextMidnight(now, TimeZone.getDefault());
    }

    /** The next midnight in `zone` after `now`, in epoch ms. */
    static long nextMidnight(long now, TimeZone zone) {
        Calendar c = Calendar.getInstance(zone);
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
