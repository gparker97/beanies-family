package family.beanies.app.widget;

import static family.beanies.app.widget.WidgetFill.COLUMN_AGE;
import static family.beanies.app.widget.WidgetFill.COLUMN_AUDIENCE;
import static family.beanies.app.widget.WidgetFill.COLUMN_DUE;
import static family.beanies.app.widget.WidgetFill.COLUMN_STALE;
import static family.beanies.app.widget.WidgetFill.COLUMN_WEATHER;
import static family.beanies.app.widget.WidgetFill.COLUMN_WEATHER_SUB;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/**
 * The date column's line budget (#134): RemoteViews has no ViewThatFits, so
 * {@link WidgetFill#dateColumnLines} decides which optional lines fit a placed height. Heights
 * are the portrait heights a host reports (the Pixel Launcher, 2026-10-12: a two-row 4x2 reports
 * 224dp, a three-row 4x3 344dp), passed the way the renderer has them: divided by the effective
 * text scale ({@code WidgetSizes.layoutHeightDp}). Scales: Standard 1.0, Large 1.15, Larger 1.3.
 *
 * Then the To-dos focus's shared rule (2026-11-11, the plan's section 0): every
 * {@link WidgetFill#todosFill} and {@link WidgetFill#effective} vector from the plan's tables,
 * verbatim, one test each. These prove the logic iOS mirrors (WidgetFill.swift), not iOS's own
 * constants. The plan-level To-dos cases against the v4 fixture are in WidgetFillTodosPlanTest.
 */
public class WidgetFillTest {

    private static final float STANDARD = 1.0f;
    private static final float LARGE = 1.15f;
    private static final float LARGER = 1.3f;

    private static final int MEDIUM_DP = 224;
    private static final int LARGE_DP = 344;

    /** What the renderer passes for a host-reported height at an effective scale. */
    private static int lines(int reportedDp, float scale, int flags) {
        return WidgetFill.dateColumnLines(reportedDp / Math.max(1f, scale), scale, flags);
    }

    private static final int MEDIUM_WEATHER = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_DUE;

    @Test
    public void standardAndLargeKeepEveryLineOnATwoRowWidget() {
        int stale = MEDIUM_WEATHER | COLUMN_STALE;
        assertEquals(stale, lines(MEDIUM_DP, STANDARD, stale));
        assertEquals(stale, lines(MEDIUM_DP, LARGE, stale));
        // A shorter host's 4x2 still holds the whole column at Standard.
        assertEquals(MEDIUM_WEATHER, lines(180, STANDARD, MEDIUM_WEATHER));
    }

    @Test
    public void theCalculatorOnlyWeighsTheWantedLines() {
        // Leaving the weather's age out under a stale snapshot's own "as of" is the renderer's
        // call (DayWidgetRenderer, where asOf is in hand); this calculator never rewrites wants.
        // Given both, it keeps both when they fit, and with no height it returns them unchanged.
        int flags = MEDIUM_WEATHER | COLUMN_AGE | COLUMN_STALE;
        assertEquals(flags, lines(MEDIUM_DP, STANDARD, flags));
        assertEquals(flags, WidgetFill.dateColumnLines(0f, LARGER, flags));
        // What the renderer sends for a stale snapshot whose reading still shows its range.
        int range = MEDIUM_WEATHER | COLUMN_STALE;
        assertEquals(range, lines(MEDIUM_DP, LARGE, range));
    }

    @Test
    public void largeKeepsTheTwoLineAgeAndTheCount() {
        // "as of 4:08 am" is two lines at every scale, so a two-row widget at Large holds it.
        int flags = MEDIUM_WEATHER | COLUMN_AGE;
        assertEquals(flags, lines(MEDIUM_DP, LARGE, flags));
    }

    @Test
    public void largerKeepsTheRangeAndCountUntilTheSnapshotIsStale() {
        assertEquals(MEDIUM_WEATHER, lines(MEDIUM_DP, LARGER, MEDIUM_WEATHER));
        // Stale: the "as of" line (two lines) is never dropped, so the range goes, then the
        // count: the weather row, the as-of and a three-line count need 229.9dp of the 224
        // (checked against the emulator's p1-stale-larger render, 2026-10-18), and keeping the
        // count would clip the as-of. The weather row stays whatever happens.
        int stale = MEDIUM_WEATHER | COLUMN_STALE;
        assertEquals(COLUMN_WEATHER | COLUMN_STALE, lines(MEDIUM_DP, LARGER, stale));
    }

    @Test
    public void pastCurrentUntilTheAgeLineGoesFirstAndTheHighRowStays() {
        // Today's high sits in the always-kept row; the line under it is the (two-line) age.
        int old = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AGE | COLUMN_DUE;
        assertEquals(old, lines(MEDIUM_DP, STANDARD, old));
        assertEquals(COLUMN_WEATHER | COLUMN_AGE | COLUMN_DUE, lines(MEDIUM_DP, LARGER, old));
    }

    @Test
    public void withoutWeatherTheColumnHoldsWhatItHeldBefore() {
        // The pre-#134 column at Larger: a two-line stale "as of" and a three-line count still
        // fit a two-row widget, so a v2 snapshot loses nothing.
        int flags = COLUMN_STALE | COLUMN_DUE;
        assertEquals(flags, lines(MEDIUM_DP, LARGER, flags));
    }

    @Test
    public void aThreeRowWidgetKeepsEverythingAtLarger() {
        int all = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AGE | COLUMN_AUDIENCE | COLUMN_DUE;
        assertEquals(all, lines(LARGE_DP, LARGER, all));
        assertEquals(all, lines(LARGE_DP, STANDARD, all));
        int stale = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_STALE | COLUMN_AUDIENCE | COLUMN_DUE;
        assertEquals(stale, lines(LARGE_DP, LARGER, stale));
    }

    @Test
    public void linesDropInThePlansOrder() {
        int flags = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AUDIENCE | COLUMN_DUE;
        // Range/age first...
        assertEquals(COLUMN_WEATHER | COLUMN_AUDIENCE | COLUMN_DUE, lines(240, LARGER, flags));
        // ...then the child label...
        assertEquals(COLUMN_WEATHER | COLUMN_DUE, lines(220, LARGER, flags));
        // ...then the count; the weather row never goes.
        assertEquals(COLUMN_WEATHER, lines(180, LARGER, flags));
        assertEquals(COLUMN_WEATHER, lines(60, LARGER, flags));
    }

    @Test
    public void aHostThatReportsNoHeightKeepsEverything() {
        int all = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AUDIENCE | COLUMN_DUE | COLUMN_STALE;
        assertEquals(all, WidgetFill.dateColumnLines(0f, LARGER, all));
    }

    // ---- the To-dos fill (plan section 0, step 2) -------------------------------------------

    /** Android's constants, as the plan's vectors use them: heading 15, row 19, group heading 19. */
    private static final float HEADING = WidgetFill.TASKS_HEADING_DP;
    private static final float ROW = WidgetFill.ROW_DP;
    private static final float GROUP = WidgetFill.GROUP_HEADING_DP;
    private static final float H = 281f;
    private static final float[] STEPS = {1f, 1.3f, 1.6f};
    private static final float[] FIXED = {1f};
    private static final float EPS = 0.0001f;

    private static WidgetFill.TodosFill fill(float h, float reserve, float[] factors, int overflow,
            int noHeightRows, int... groups) {
        float[] headings = new float[groups.length];
        Arrays.fill(headings, GROUP);
        return WidgetFill.todosFill(h, HEADING, ROW, headings, reserve, groups, factors, overflow, noHeightRows);
    }

    private static WidgetFill.TodosFill fill(float[] factors, int... groups) {
        return fill(H, 0f, factors, 0, 10, groups);
    }

    @Test
    public void constantsAreTheOnesTheVectorsAssume() {
        assertEquals(15f, HEADING, EPS);
        assertEquals(19f, ROW, EPS);
        assertEquals(19f, GROUP, EPS);
    }

    @Test
    public void vector_2_1_fixedFactorShowsAllAtStandard() {
        // Factors [1.0]: a fixed size, API < 31, or the inferred path.
        WidgetFill.TodosFill f = fill(FIXED, 2, 1);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {2, 1}, f.shownPerGroup);
        assertEquals(0, f.more);
    }

    @Test
    public void vector_2_1_stepsToTheLargest() {
        WidgetFill.TodosFill f = fill(STEPS, 2, 1);
        assertEquals(1.6f, f.step, EPS);
        assertArrayEquals(new int[] {2, 1}, f.shownPerGroup);
        assertEquals(0, f.more);
        // The cost at x1.6: 15 + 2 x 19 x 1.6 + 3 x 19 x 1.6.
        assertEquals(167f, HEADING + 2 * GROUP * 1.6f + 3 * ROW * 1.6f, 0.01f);
    }

    @Test
    public void vector_2_2_3_stepsToTheMiddle() {
        // x1.6 costs 319; x1.3 costs 262.
        WidgetFill.TodosFill f = fill(STEPS, 2, 2, 3);
        assertEquals(1.3f, f.step, EPS);
        assertArrayEquals(new int[] {2, 2, 3}, f.shownPerGroup);
        assertEquals(0, f.more);
    }

    @Test
    public void vector_12_fitsAtStandard() {
        // Cost 262 at x1.0.
        WidgetFill.TodosFill f = fill(STEPS, 12);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {12}, f.shownPerGroup);
        assertEquals(0, f.more);
    }

    @Test
    public void vector_2_4_6_takesRowsInOrderWhileTheyFit() {
        WidgetFill.TodosFill f = fill(STEPS, 2, 4, 6);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {2, 4, 5}, f.shownPerGroup);
        assertEquals(1, f.more);
    }

    @Test
    public void vector_16_withOverflow4() {
        WidgetFill.TodosFill f = fill(H, 0f, STEPS, 4, 10, 16);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {13}, f.shownPerGroup);
        assertEquals(7, f.more);
    }

    @Test
    public void vector_20_oneGroup_neverMoreThanSixteen() {
        // n > 16 fails every factor, however tall.
        WidgetFill.TodosFill f = fill(1000f, 0f, STEPS, 0, 10, 20);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {16}, f.shownPerGroup);
        assertEquals(4, f.more);
    }

    @Test
    public void vector_3_inATinyRoom_stillShowsOne() {
        WidgetFill.TodosFill f = fill(20f, 0f, STEPS, 0, 10, 3);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {1}, f.shownPerGroup);
        assertEquals(2, f.more);
        // Not all clear: a widget with to-dos due always shows a row.
        assertEquals(1, f.shown());
    }

    @Test
    public void vector_2_3_theEventsReserveHoldsTheStepBack() {
        // Reserve 76 (3 rows + the divider): x1.6 costs 304; without it x1.6 fits.
        WidgetFill.TodosFill f = fill(H, 76f, STEPS, 0, 10, 2, 3);
        assertEquals(1.3f, f.step, EPS);
        assertArrayEquals(new int[] {2, 3}, f.shownPerGroup);
        assertEquals(0, f.more);
        assertEquals(1.6f, fill(H, 0f, STEPS, 0, 10, 2, 3).step, EPS);
    }

    @Test
    public void vector_none_isAllClear() {
        WidgetFill.TodosFill f = fill(STEPS);
        assertEquals(0, f.shown());
        assertEquals(0, f.more);
        assertEquals(1f, f.step, EPS);
    }

    @Test
    public void vector_2_1_withBothGroupHeadingsZero() {
        // Snapshot labels missing: no headings, charged 0. Cost 106 at x1.6.
        WidgetFill.TodosFill f = WidgetFill.todosFill(
                H, HEADING, ROW, new float[] {0f, 0f}, 0f, new int[] {2, 1}, STEPS, 0, 10);
        assertEquals(1.6f, f.step, EPS);
        assertArrayEquals(new int[] {2, 1}, f.shownPerGroup);
        assertEquals(106f, HEADING + 3 * ROW * 1.6f, 0.5f);
    }

    @Test
    public void vector_12_withNoHeight_takesTheNoHeightRows() {
        WidgetFill.TodosFill f = fill(0f, 0f, STEPS, 0, 10, 12);
        assertEquals(1f, f.step, EPS);
        assertArrayEquals(new int[] {10}, f.shownPerGroup);
        assertEquals(2, f.more);
    }

    @Test
    public void vector_runOverdueBlankToday_theBlankJoinsOverdue() {
        List<WidgetFill.Run> runs = WidgetFill.taskRuns(Arrays.asList("overdue", "", "today"));
        assertEquals(2, runs.size());
        assertEquals(WidgetFill.Group.OVERDUE, runs.get(0).group);
        assertEquals(2, runs.get(0).size);
        assertEquals(WidgetFill.Group.TODAY, runs.get(1).group);
        assertEquals(1, runs.get(1).size);
    }

    @Test
    public void runsMergeUndatedAndLaterIntoComingUpAndKeepALeadingUnknownHeadless() {
        List<WidgetFill.Run> runs = WidgetFill.taskRuns(
                Arrays.asList("someday", "overdue", "today", "today", "undated", "later", "later"));
        assertEquals(4, runs.size());
        assertNull(runs.get(0).group);
        assertEquals(1, runs.get(0).size);
        assertEquals(WidgetFill.Group.OVERDUE, runs.get(1).group);
        assertEquals(WidgetFill.Group.TODAY, runs.get(2).group);
        assertEquals(2, runs.get(2).size);
        assertEquals(WidgetFill.Group.COMING_UP, runs.get(3).group);
        assertEquals(3, runs.get(3).size);
        assertTrue(WidgetFill.taskRuns(Arrays.<String>asList()).isEmpty());
    }

    @Test
    public void theSmallsNoHeightAndSlotsAreThePlansNumbers() {
        assertEquals(3, WidgetFill.noHeightRows(WidgetSizes.Size.SMALL));
        assertEquals(4, WidgetFill.noHeightRows(WidgetSizes.Size.MEDIUM));
        assertEquals(10, WidgetFill.noHeightRows(WidgetSizes.Size.LARGE));
        assertEquals(0, WidgetFill.eventsSlot(WidgetSizes.Size.SMALL));
        assertEquals(1, WidgetFill.eventsSlot(WidgetSizes.Size.MEDIUM));
        assertEquals(3, WidgetFill.eventsSlot(WidgetSizes.Size.LARGE));
    }

    // ---- effective switches and layout (plan section 0, step 1) ------------------------------

    private static final int EVENTS_I = 0;
    private static final int WHOS_WHERE_I = 1;
    private static final int MEALS_I = 2;
    private static final int DUE_I = 3;
    private static final int COMING_UP_I = 4;
    private static final int HINT_I = 5;

    private static boolean[] blocks(boolean events, boolean whosWhere, boolean meals,
            boolean due, boolean comingUp, boolean hint) {
        return new boolean[] {events, whosWhere, meals, due, comingUp, hint};
    }

    private static WidgetPrefs prefs(boolean[] blocks, WidgetPrefs.Focus focus, boolean events, boolean meals) {
        return new WidgetPrefs(blocks, WidgetPrefs.DEFAULT_OPACITY, WidgetPrefs.TextSize.AUTO, focus, events, meals);
    }

    private static final boolean[] INFERRED = blocks(false, true, true, true, false, true);

    @Test
    public void theTestIndicesMatchFillOrder() {
        assertEquals(WidgetFill.EVENTS, WidgetFill.FILL_ORDER[EVENTS_I]);
        assertEquals(WidgetFill.WHOS_WHERE, WidgetFill.FILL_ORDER[WHOS_WHERE_I]);
        assertEquals(WidgetFill.MEALS, WidgetFill.FILL_ORDER[MEALS_I]);
        assertEquals(WidgetFill.DUE, WidgetFill.FILL_ORDER[DUE_I]);
        assertEquals(WidgetFill.COMING_UP, WidgetFill.FILL_ORDER[COMING_UP_I]);
        assertEquals(WidgetFill.HINT, WidgetFill.FILL_ORDER[HINT_I]);
    }

    @Test
    public void effective_childWithFocusTodos_isYourDay() {
        boolean[] stored = blocks(true, true, true, true, true, true);
        WidgetFill.Effective e = WidgetFill.effective(prefs(stored, WidgetPrefs.Focus.TODOS, true, true), true);
        assertEquals(WidgetFill.Layout.DAY, e.layout);
        assertArrayEquals(stored, e.switches);
    }

    @Test
    public void effective_focusTodosWithDueOff_turnsDueOn() {
        boolean[] stored = blocks(true, true, true, false, true, true);
        WidgetFill.Effective e = WidgetFill.effective(prefs(stored, WidgetPrefs.Focus.TODOS, false, false), false);
        assertEquals(WidgetFill.Layout.TODOS, e.layout);
        assertTrue(e.shows(WidgetFill.DUE));
        assertFalse(e.shows(WidgetFill.EVENTS));
        assertFalse(e.shows(WidgetFill.WHOS_WHERE));
        assertFalse(e.shows(WidgetFill.MEALS));
        assertFalse(e.shows(WidgetFill.COMING_UP));
        assertFalse(e.shows(WidgetFill.HINT));
    }

    @Test
    public void effective_focusTodosTakesTheExtrasNotTheStoredSwitches() {
        boolean[] allOff = blocks(false, false, false, false, false, false);
        WidgetFill.Effective e = WidgetFill.effective(prefs(allOff, WidgetPrefs.Focus.TODOS, true, true), false);
        assertArrayEquals(blocks(true, false, true, true, false, false), e.switches);
    }

    @Test
    public void effective_focusDayWithEventsAndComingUpOffAndDueOn_isInferredTodos() {
        WidgetFill.Effective e = WidgetFill.effective(prefs(INFERRED, WidgetPrefs.Focus.DAY, true, true), false);
        assertEquals(WidgetFill.Layout.TODOS, e.layout);
        // The stored switches: tonight follows Meals, hints follow Helpful hint.
        assertArrayEquals(INFERRED, e.switches);
    }

    @Test
    public void effective_focusDayWithEventsOn_isYourDay() {
        boolean[] stored = blocks(true, false, false, true, false, false);
        WidgetFill.Effective e = WidgetFill.effective(prefs(stored, WidgetPrefs.Focus.DAY, false, false), false);
        assertEquals(WidgetFill.Layout.DAY, e.layout);
        assertArrayEquals(stored, e.switches);
    }

    @Test
    public void effective_childWithTheInferredSwitches_isYourDay() {
        WidgetFill.Effective e = WidgetFill.effective(prefs(INFERRED, WidgetPrefs.Focus.DAY, false, false), true);
        assertEquals(WidgetFill.Layout.DAY, e.layout);
        assertArrayEquals(INFERRED, e.switches);
    }

    @Test
    public void effective_focusDayWithEventsComingUpAndDueAllOff_isYourDay() {
        boolean[] stored = blocks(false, true, true, false, false, true);
        WidgetFill.Effective e = WidgetFill.effective(prefs(stored, WidgetPrefs.Focus.DAY, false, false), false);
        assertEquals(WidgetFill.Layout.DAY, e.layout);
    }

    @Test
    public void effective_returnsACopyAndLeavesTheStoredSettingsAlone() {
        WidgetPrefs p = prefs(INFERRED, WidgetPrefs.Focus.DAY, false, false);
        WidgetFill.effective(p, false).switches[DUE_I] = false;
        assertTrue(p.blocks[DUE_I]);
        assertEquals(WidgetFill.Layout.TODOS, WidgetFill.effective(p, false).layout);
    }

    // ---- Automatic step factors (WidgetSizes) -------------------------------------------------

    private static final int API_31 = 31;

    @Test
    public void stepFactorsClampAtTheTaskStepCeiling() {
        assertArrayEquals(new float[] {1f, 1.3f, 1.6f}, WidgetSizes.stepFactors(1f), EPS);
        // Accessibility text never compounds past 1.6: 1.3 x 1.3 = 1.69 is capped.
        assertArrayEquals(new float[] {1f, 1.6f / 1.3f, 1.6f / 1.3f}, WidgetSizes.stepFactors(1.3f), EPS);
        assertArrayEquals(new float[] {1f, 1f, 1f}, WidgetSizes.stepFactors(2f), EPS);
        assertEquals(1.6f, WidgetSizes.TASK_STEP_MAX, EPS);
    }

    @Test
    public void onlyAStoredTodosFocusWithAutomaticTextStepsOnMediumAndLargeAtApi31() {
        boolean[] all = blocks(true, true, true, true, true, true);
        WidgetPrefs todosAuto = prefs(all, WidgetPrefs.Focus.TODOS, false, false);
        assertArrayEquals(STEPS, WidgetSizes.taskStepFactors(todosAuto, WidgetSizes.Size.MEDIUM, API_31, 1f), EPS);
        assertArrayEquals(STEPS, WidgetSizes.taskStepFactors(todosAuto, WidgetSizes.Size.LARGE, API_31, 1f), EPS);
        // The small never steps; below API 31 nothing steps.
        assertArrayEquals(FIXED, WidgetSizes.taskStepFactors(todosAuto, WidgetSizes.Size.SMALL, API_31, 1f), EPS);
        assertArrayEquals(FIXED, WidgetSizes.taskStepFactors(todosAuto, WidgetSizes.Size.LARGE, 30, 1f), EPS);
        // A fixed Text size never steps.
        WidgetPrefs todosStandard = new WidgetPrefs(all, WidgetPrefs.DEFAULT_OPACITY,
                WidgetPrefs.TextSize.STANDARD, WidgetPrefs.Focus.TODOS, false, false);
        assertArrayEquals(FIXED, WidgetSizes.taskStepFactors(todosStandard, WidgetSizes.Size.LARGE, API_31, 1f), EPS);
        // The inferred path (focus Your day) never steps, even with Automatic.
        WidgetPrefs inferred = prefs(INFERRED, WidgetPrefs.Focus.DAY, false, false);
        assertArrayEquals(FIXED, WidgetSizes.taskStepFactors(inferred, WidgetSizes.Size.LARGE, API_31, 1f), EPS);
    }
}
