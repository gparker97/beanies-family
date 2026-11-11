package family.beanies.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;

/**
 * {@link WidgetFill#plan} in the To-dos layout (2026-11-11) against the committed v4 fixture:
 * the groups, the step, the events slot, the all-clear state, the label fallbacks, the small and
 * the 16-row cap. The fill's arithmetic itself is WidgetFillTest's vectors; this proves plan()
 * feeds it the right numbers. UTC, as WidgetFillDayPlanTest (the fixture's times are UTC).
 *
 * The fixture's Sunday at noon, focus To-dos (to-dos on, hints off): 5 tasks in three runs,
 * overdue 1 ("buy birthday candles"), today 2, coming up 2 (a list and a later to-do).
 */
public class WidgetFillTodosPlanTest {

    private static final long SUN_NOON = 1_791_720_000_000L;
    private static final float[] STEPS = {1f, 1.3f, 1.6f};
    private static final float EPS = 0.0001f;
    private static final boolean[] ALL_ON = {true, true, true, true, true, true};

    private static TimeZone saved;

    @BeforeClass
    public static void pinZone() {
        saved = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    }

    @AfterClass
    public static void restoreZone() {
        TimeZone.setDefault(saved);
    }

    private static JSONObject v4() throws Exception {
        return WidgetFixtures.fixture("widget-snapshot.v4.json");
    }

    private static WidgetPrefs todos(boolean events, boolean meals) {
        return new WidgetPrefs(ALL_ON, WidgetPrefs.DEFAULT_OPACITY, WidgetPrefs.TextSize.AUTO,
                WidgetPrefs.Focus.TODOS, events, meals);
    }

    private static WidgetFill.Plan plan(JSONObject root, WidgetPrefs prefs, WidgetSizes.Size size,
            float heightDp, float[] steps) {
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(root), prefs, size, heightDp, SUN_NOON, steps);
        assertNotNull(p);
        return p;
    }

    private static JSONObject today(JSONObject root) throws Exception {
        return root.getJSONArray("days").getJSONObject(0).getJSONObject("view");
    }

    private static List<String> labels(WidgetFill.Plan p) {
        List<String> out = new ArrayList<>();
        for (WidgetFill.TaskGroup g : p.taskGroups) out.add(g.label + ":" + g.tasks.size());
        return out;
    }

    @Test
    public void aShortListOnTheLargeStepsToTheLargestSize() throws Exception {
        // Room 344 - 59 = 285; at x1.6 the list costs 15 + 8 x 19 x 1.6 = 258.2.
        WidgetFill.Plan p = plan(v4(), todos(false, false), WidgetSizes.Size.LARGE, 344, STEPS);
        assertEquals(WidgetFill.Layout.TODOS, p.layout);
        assertEquals(1.6f, p.taskStep, EPS);
        assertEquals(Arrays.asList("overdue:1", "due today:2", "coming up:2"), labels(p));
        assertTrue(p.taskGroups.get(0).isAccent());
        assertFalse(p.taskGroups.get(1).isAccent());
        assertEquals(5, p.visibleTasks.size());
        assertFalse(p.shows(WidgetFill.HINT));
        assertTrue(p.todayRows.isEmpty());
        assertTrue(p.laterDays.isEmpty());
        assertFalse(p.isRelaxed());
        assertFalse(p.isAllClear());
        assertEquals("", p.nothingTodayLine());
        assertEquals("", p.allClearLine());
        assertEquals("all to-dos ›", p.todosFooterText());
    }

    @Test
    public void withoutStepFactorsTheSizeIsFixed() throws Exception {
        // The 5-argument plan(): a fixed Text size, API < 31, or the inferred path.
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(v4()), todos(false, false),
                WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertEquals(1f, p.taskStep, EPS);
        assertEquals(5, p.visibleTasks.size());
    }

    @Test
    public void theEventsExtraReservesItsSlotAndDropsFinishedEvents() throws Exception {
        WidgetFill.Plan p = plan(v4(), todos(true, false), WidgetSizes.Size.LARGE, 344, STEPS);
        // The 8:30am row ended at 09:30Z: left out, so the slot is never a finished event.
        assertEquals("Carter's party", p.todayRows.get(0).title);
        assertEquals(6, p.todayRows.size());
        assertEquals(2, p.laterDays.size());
        // Reserve 19 + 3 x 19 = 76: x1.6 costs 334.2, x1.3 288.6, both over 285.
        assertEquals(1f, p.taskStep, EPS);
        assertEquals(5, p.visibleTasks.size());
        assertFalse(p.shows(WidgetFill.WHOS_WHERE));
        assertFalse(p.shows(WidgetFill.COMING_UP));
    }

    @Test
    public void aShortMediumTakesRowsInOrderAndCountsTheRestInTheFooter() throws Exception {
        // Room 224 - 59 = 165: 15, then overdue 38, today 38 + 19, coming up 38; the next is 167.
        WidgetFill.Plan p = plan(v4(), todos(false, false), WidgetSizes.Size.MEDIUM, 224, STEPS);
        assertEquals(1f, p.taskStep, EPS);
        assertEquals(Arrays.asList("overdue:1", "due today:2", "coming up:1"), labels(p));
        assertEquals("1 more", p.moreText());
        assertEquals("1 more", p.todosFooterText());
    }

    @Test
    public void onlyTheMediumsOneRowEventsSlotCanDisplaceTodos() throws Exception {
        // Reserve 19 + 19: coming up no longer fits.
        WidgetFill.Plan p = plan(v4(), todos(true, false), WidgetSizes.Size.MEDIUM, 224, STEPS);
        assertEquals(Arrays.asList("overdue:1", "due today:2"), labels(p));
        assertEquals("2 more", p.todosFooterText());
    }

    @Test
    public void tonightFollowsTheMealsExtra() throws Exception {
        assertFalse(plan(v4(), todos(false, false), WidgetSizes.Size.LARGE, 344, STEPS).shows(WidgetFill.MEALS));
        assertTrue(plan(v4(), todos(false, true), WidgetSizes.Size.LARGE, 344, STEPS).shows(WidgetFill.MEALS));
    }

    @Test
    public void theInferredToDosOnlyWidgetKeepsItsSwitches() throws Exception {
        boolean[] inferred = {false, false, true, true, false, true};
        WidgetPrefs prefs = new WidgetPrefs(inferred, WidgetPrefs.DEFAULT_OPACITY, null);
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(v4()), prefs, WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertEquals(WidgetFill.Layout.TODOS, p.layout);
        assertEquals(1f, p.taskStep, EPS);
        // Hints follow Helpful hint: the hint joins the "due today" run.
        assertEquals(Arrays.asList("overdue:1", "due today:3", "coming up:2"), labels(p));
        assertTrue(p.shows(WidgetFill.MEALS));
    }

    @Test
    public void aChildsWidgetIsAlwaysYourDay() throws Exception {
        JSONObject root = v4();
        root.getJSONObject("viewer").put("isChild", true);
        WidgetFill.Plan p = plan(root, todos(true, true), WidgetSizes.Size.LARGE, 344, STEPS);
        assertEquals(WidgetFill.Layout.DAY, p.layout);
        assertTrue(p.tasks.isEmpty());
        assertTrue(p.taskGroups.isEmpty());
        assertEquals(1f, p.taskStep, EPS);
    }

    @Test
    public void noTasksIsAllClear() throws Exception {
        JSONObject root = v4();
        today(root).getJSONObject("tasks").put("items", new JSONArray());
        WidgetFill.Plan p = plan(root, todos(false, false), WidgetSizes.Size.MEDIUM, 224, STEPS);
        assertTrue(p.isAllClear());
        assertTrue(p.isRelaxed());
        assertEquals("all clear,", p.relaxedTitle());
        assertEquals("", p.allClearLine());
        assertEquals("all to-dos ›", p.todosFooterText());

        // With the events extra the calendar shows, under a one-line all clear.
        WidgetFill.Plan events = plan(root, todos(true, false), WidgetSizes.Size.MEDIUM, 224, STEPS);
        assertTrue(events.isAllClear());
        assertFalse(events.isRelaxed());
        assertEquals("all clear, enjoy", events.allClearLine());
        assertEquals("", events.nothingTodayLine());
    }

    @Test
    public void aSnapshotWithoutTheNewLabelsFallsBack() throws Exception {
        JSONObject root = v4();
        JSONObject labels = root.getJSONObject("labels");
        for (String key : new String[] {
                "groupOverdue", "groupToday", "groupComingUp", "allTodos", "todosAllClear", "eventsHeading"}) {
            labels.remove(key);
        }
        WidgetFill.Plan p = plan(root, todos(false, false), WidgetSizes.Size.LARGE, 344, STEPS);
        assertEquals(Arrays.asList(":1", ":2", ":2"), labels(p));
        assertEquals("", p.todosFooterText());

        today(root).getJSONObject("tasks").put("items", new JSONArray());
        WidgetFill.Plan clear = plan(root, todos(false, false), WidgetSizes.Size.LARGE, 344, STEPS);
        assertEquals("nothing on today,", clear.relaxedTitle());
    }

    @Test
    public void aMissingGroupLabelIsChargedNoHeading() throws Exception {
        // Without "due today" the list costs 15 + 2 x 19 + 5 x 19 = 148 of the medium's 165.
        JSONObject root = v4();
        root.getJSONObject("labels").remove("groupToday");
        WidgetFill.Plan p = plan(root, todos(false, false), WidgetSizes.Size.MEDIUM, 224, STEPS);
        assertEquals(Arrays.asList("overdue:1", ":2", "coming up:2"), labels(p));
        assertEquals("", p.moreText());
    }

    @Test
    public void theSnapshotCapCountsTowardMore() throws Exception {
        JSONObject root = v4();
        today(root).getJSONObject("tasks").getJSONObject("overflow").put("due", 3).put("hint", 2);
        WidgetFill.Plan p = plan(root, todos(false, false), WidgetSizes.Size.LARGE, 344, STEPS);
        // Hints are off in To-dos focus, so only the to-dos cap counts.
        assertEquals("3 more", p.todosFooterText());
    }

    @Test
    public void theSmallShowsRowsUnderTheHeaderWithNoHeadingsNoStepsAndNoExtras() throws Exception {
        WidgetFill.Plan p = plan(v4(), todos(true, true), WidgetSizes.Size.SMALL, 224, STEPS);
        assertEquals(WidgetFill.Layout.TODOS, p.layout);
        assertEquals(1f, p.taskStep, EPS);
        assertEquals(Arrays.asList(":5"), labels(p));
        assertFalse(p.shows(WidgetFill.EVENTS));
        assertFalse(p.shows(WidgetFill.MEALS));
        assertTrue(p.todayRows.isEmpty());

        // Room 120 - 66 = 54, the 15dp "more" line reserved: two rows.
        WidgetFill.Plan short_ = plan(v4(), todos(false, false), WidgetSizes.Size.SMALL, 120, STEPS);
        assertEquals(2, short_.visibleTasks.size());
        assertEquals("3 more", short_.moreText());
        // No height: three rows.
        assertEquals(3, plan(v4(), todos(false, false), WidgetSizes.Size.SMALL, 0, STEPS).visibleTasks.size());
    }

    @Test
    public void neverMoreThanSixteenTaskRows() throws Exception {
        // The legacy path with hints on can carry 32 (16 to-dos + 16 hints).
        JSONObject root = v4();
        JSONArray items = new JSONArray();
        for (int i = 0; i < 20; i++) {
            items.put(new JSONObject().put("kind", i % 2 == 0 ? "todo" : "hint")
                    .put("title", "task " + i).put("bucket", "today"));
        }
        today(root).getJSONObject("tasks").put("items", items);
        boolean[] inferred = {false, false, true, true, false, true};
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(root),
                new WidgetPrefs(inferred, WidgetPrefs.DEFAULT_OPACITY, null), WidgetSizes.Size.LARGE, 2000, SUN_NOON);
        assertEquals(WidgetFill.MAX_TASK_ROWS, p.visibleTasks.size());
        assertEquals("4 more", p.todosFooterText());
    }

    @Test
    public void aWidthCheckHoldsTheStepBackFromCuttingATitle() throws Exception {
        // The large picks x1.6 on height alone (aShortListOnTheLargeStepsToTheLargestSize).
        WidgetFill.StepWidthCheck rejects16 = (tasks, times, f) -> {
            assertEquals(5, tasks.size());
            return f < 1.5f;
        };
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(v4()), todos(false, false),
                WidgetSizes.Size.LARGE, 344, SUN_NOON, STEPS, rejects16);
        assertEquals(1.3f, p.taskStep, EPS);
        WidgetFill.Plan none = WidgetFill.plan(WidgetSnapshot.from(v4()), todos(false, false),
                WidgetSizes.Size.LARGE, 344, SUN_NOON, STEPS, (tasks, times, f) -> false);
        assertEquals(1f, none.taskStep, EPS);
        assertEquals(5, none.visibleTasks.size());
    }

    @Test
    public void theSmallHoldsTheMoreLineOnlyWhenSomethingDoesNotFit() throws Exception {
        // A 2x2 at 150dp: room 84. Four to-dos take 76, so all four show with no "more" line.
        JSONObject root = v4();
        JSONArray items = today(root).getJSONObject("tasks").getJSONArray("items");
        items.remove(items.length() - 1);
        WidgetFill.Plan four = plan(root, todos(false, false), WidgetSizes.Size.SMALL, 150, STEPS);
        assertEquals(4, four.visibleTasks.size());
        assertEquals("", four.moreText());
        // Five do not fit: the line is reserved (84 - 15 = 69), so three show and "2 more".
        WidgetFill.Plan five = plan(v4(), todos(false, false), WidgetSizes.Size.SMALL, 150, STEPS);
        assertEquals(3, five.visibleTasks.size());
        assertEquals("2 more", five.moreText());
    }
}
