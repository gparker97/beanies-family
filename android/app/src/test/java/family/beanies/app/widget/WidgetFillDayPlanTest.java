package family.beanies.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONObject;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;

/**
 * Characterisation of {@link WidgetFill#plan} for the Your day layout, written against the code
 * BEFORE the To-dos focus (2026-11-11) and kept unmodified after it: the 5-argument `plan(...)`
 * overload stays for exactly this reason, so "Your day is unchanged" is proven, not asserted.
 *
 * Driven from the committed v4 fixture, whose times are UTC (the 8:30am row ends 09:30Z), so the
 * device zone is pinned to UTC for the run. Heights are the Pixel Launcher's portrait heights
 * (a two-row 4x2 reports 224dp, a three-row 4x3 344dp) at Standard text.
 */
public class WidgetFillDayPlanTest {

    /** 2026-10-11T12:00Z: Sunday, the fixture's first day, 11h20m after it was generated. */
    private static final long SUN_NOON = 1_791_720_000_000L;
    private static final long DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long TUE_NOON = SUN_NOON + 2 * DAY_MS;
    private static final long SAT_NOON = SUN_NOON + 6 * DAY_MS;

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

    /** Blocks in FILL_ORDER: events, whosWhere, meals, due, comingUp, hint. */
    private static boolean[] blocks(boolean events, boolean whosWhere, boolean meals,
            boolean due, boolean comingUp, boolean hint) {
        return new boolean[] {events, whosWhere, meals, due, comingUp, hint};
    }

    private static final boolean[] ALL_ON = blocks(true, true, true, true, true, true);

    private static WidgetFill.Plan plan(JSONObject root, boolean[] blocks, WidgetSizes.Size size,
            float heightDp, long now) {
        WidgetPrefs prefs = new WidgetPrefs(blocks, WidgetPrefs.DEFAULT_OPACITY, null);
        WidgetFill.Plan p = WidgetFill.plan(WidgetSnapshot.from(root), prefs, size, heightDp, now);
        assertNotNull(p);
        return p;
    }

    private static WidgetFill.Plan plan(boolean[] blocks, WidgetSizes.Size size, float heightDp, long now)
            throws Exception {
        return plan(WidgetFixtures.fixture("widget-snapshot.v4.json"), blocks, size, heightDp, now);
    }

    private static List<String> rowTitles(List<WidgetSnapshot.Row> rows) {
        List<String> out = new ArrayList<>();
        for (WidgetSnapshot.Row r : rows) out.add(r.title);
        return out;
    }

    private static List<String> taskTitles(List<WidgetSnapshot.Task> tasks) {
        List<String> out = new ArrayList<>();
        for (WidgetSnapshot.Task t : tasks) out.add(t.title);
        return out;
    }

    private static List<String> laterYmds(WidgetFill.Plan p) {
        List<String> out = new ArrayList<>();
        for (WidgetFill.LaterDay d : p.laterDays) out.add(d.entry.ymd + ":" + d.rows.size() + (d.isTomorrow ? "t" : ""));
        return out;
    }

    @Test
    public void everythingOnMediumKeepsTheTwoRowSlot() throws Exception {
        WidgetFill.Plan p = plan(ALL_ON, WidgetSizes.Size.MEDIUM, 224, SUN_NOON);
        assertEquals("2026-10-11", p.entry.ymd);
        assertFalse(p.stale);
        assertFalse(p.isChild);
        assertEquals(Arrays.asList("pancakes with grandpa", "Carter's party",
                "swimming lesson at Tampines pool", "Biscuit to the vet", "piano",
                "soccer practice", "bedtime story"), rowTitles(p.todayRows));
        assertEquals(Arrays.asList("2026-10-12:2t", "2026-10-14:1", "2026-10-15:1", "2026-10-16:1"),
                laterYmds(p));
        assertEquals(6, p.tasks.size());
        assertEquals(Arrays.asList("buy birthday candles", "pack swim bag"), taskTitles(p.visibleTasks));
        assertFalse(p.isRelaxed());
        assertEquals("", p.nothingTodayLine());
        assertEquals("4 more", p.moreText());
    }

    @Test
    public void everythingOnLargeKeepsTheFourRowSlot() throws Exception {
        WidgetFill.Plan p = plan(ALL_ON, WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertEquals(4, p.visibleTasks.size());
        assertEquals("2 more", p.moreText());
    }

    @Test
    public void aHostWithNoHeightGetsTheSlotAlone() throws Exception {
        assertEquals(2, plan(ALL_ON, WidgetSizes.Size.MEDIUM, 0, SUN_NOON).visibleTasks.size());
        assertEquals(4, plan(ALL_ON, WidgetSizes.Size.LARGE, 0, SUN_NOON).visibleTasks.size());
    }

    @Test
    public void theSmallHasNoTaskRows() throws Exception {
        WidgetFill.Plan p = plan(ALL_ON, WidgetSizes.Size.SMALL, 170, SUN_NOON);
        assertTrue(p.visibleTasks.isEmpty());
        assertEquals(6, p.tasks.size());
        assertFalse(p.isRelaxed());
        // The next timed row not yet ended at noon: the 8:30am row ended 09:30Z.
        WidgetFill.Next next = p.next(SUN_NOON);
        assertNotNull(next);
        assertEquals("Carter's party", next.row.title);
    }

    @Test
    public void whosWhereSubLinesTakeRoomFromTheTasks() throws Exception {
        // Calendar 133 + 171 (+ 30 for two handoff lines): at 500dp the spare is 92 (4 rows) with
        // who's where on, 122 (6 rows) with it off.
        assertEquals(4, plan(ALL_ON, WidgetSizes.Size.LARGE, 500, SUN_NOON).visibleTasks.size());
        assertEquals(6, plan(blocks(true, false, true, true, true, true),
                WidgetSizes.Size.LARGE, 500, SUN_NOON).visibleTasks.size());
    }

    @Test
    public void eventsOffLeavesTripsAndBirthdaysAndFreesRoomForTasks() throws Exception {
        boolean[] noEvents = blocks(false, true, true, true, true, true);
        WidgetFill.Plan large = plan(noEvents, WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertTrue(large.todayRows.isEmpty());
        assertEquals(Arrays.asList("2026-10-15:1", "2026-10-16:1"), laterYmds(large));
        assertEquals(6, large.visibleTasks.size());
        assertEquals("", large.moreText());
        // Hidden events are not "nothing", and the events switch gates the relaxed state.
        assertEquals("", large.nothingTodayLine());
        assertFalse(large.isRelaxed());

        WidgetFill.Plan medium = plan(noEvents, WidgetSizes.Size.MEDIUM, 224, SUN_NOON);
        assertEquals(3, medium.visibleTasks.size());
        assertEquals("3 more", medium.moreText());
    }

    @Test
    public void theLegacyToDosOnlyWidget() throws Exception {
        // Events and trips/birthdays off, to-dos on: today's Your day path (bottom-pinned).
        boolean[] todosOnly = blocks(false, false, false, true, false, false);
        WidgetFill.Plan p = plan(todosOnly, WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertTrue(p.todayRows.isEmpty());
        assertTrue(p.laterDays.isEmpty());
        assertEquals(Arrays.asList("buy birthday candles", "pack swim bag", "return library book",
                "groceries, 2 left", "call the plumber"), taskTitles(p.visibleTasks));
        assertFalse(p.isRelaxed());
        assertEquals("", p.nothingTodayLine());
        assertEquals("", p.moreText());
    }

    @Test
    public void tasksOffLeavesTheCalendarAlone() throws Exception {
        WidgetFill.Plan p = plan(blocks(true, true, true, false, false, false),
                WidgetSizes.Size.MEDIUM, 224, SUN_NOON);
        assertTrue(p.tasks.isEmpty());
        assertTrue(p.visibleTasks.isEmpty());
        assertEquals(7, p.todayRows.size());
        assertEquals(Arrays.asList("2026-10-12:2t", "2026-10-14:1"), laterYmds(p));
        assertFalse(p.isRelaxed());
        assertEquals("", p.moreText());
    }

    @Test
    public void anEmptyTodayWritesTheNothingLine() throws Exception {
        WidgetFill.Plan p = plan(ALL_ON, WidgetSizes.Size.MEDIUM, 224, TUE_NOON);
        assertEquals("2026-10-13", p.entry.ymd);
        assertTrue(p.todayRows.isEmpty());
        assertEquals(Arrays.asList("2026-10-14:1t", "2026-10-15:1", "2026-10-16:1"), laterYmds(p));
        assertEquals(2, p.visibleTasks.size());
        assertEquals("nothing on today", p.nothingTodayLine());
        assertEquals("3 more", p.moreText());

        WidgetFill.Plan noTasks = plan(blocks(true, true, true, false, true, false),
                WidgetSizes.Size.MEDIUM, 224, TUE_NOON);
        assertFalse(noTasks.isRelaxed());
        assertEquals("nothing on today, enjoy", noTasks.nothingTodayLine());
    }

    @Test
    public void aClearWeekWithNoTasksIsRelaxed() throws Exception {
        WidgetFill.Plan p = plan(blocks(true, true, true, false, false, false),
                WidgetSizes.Size.MEDIUM, 224, SAT_NOON);
        assertEquals("2026-10-17", p.entry.ymd);
        assertTrue(p.stale);
        assertTrue(p.todayRows.isEmpty());
        assertTrue(p.laterDays.isEmpty());
        assertTrue(p.isRelaxed());
        assertEquals("", p.nothingTodayLine());
        assertEquals("", p.moreText());
    }

    @Test
    public void theSnapshotCapCountsTowardMore() throws Exception {
        JSONObject root = WidgetFixtures.fixture("widget-snapshot.v4.json");
        JSONObject overflow = root.getJSONArray("days").getJSONObject(0).getJSONObject("view")
                .getJSONObject("tasks").getJSONObject("overflow");
        overflow.put("due", 3);
        overflow.put("hint", 2);
        assertEquals("9 more", plan(root, ALL_ON, WidgetSizes.Size.MEDIUM, 224, SUN_NOON).moreText());
        // Only the switches that are on count their cap.
        assertEquals("6 more", plan(root, blocks(true, true, true, true, true, false),
                WidgetSizes.Size.MEDIUM, 224, SUN_NOON).moreText());
    }

    @Test
    public void aChildSeesNoTasksWhateverTheSwitches() throws Exception {
        JSONObject root = WidgetFixtures.fixture("widget-snapshot.v4.json");
        root.getJSONObject("viewer").put("isChild", true);
        WidgetFill.Plan p = plan(root, ALL_ON, WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertTrue(p.isChild);
        assertTrue(p.tasks.isEmpty());
        assertFalse(p.shows(WidgetFill.DUE));
        assertFalse(p.shows(WidgetFill.HINT));
        assertTrue(p.shows(WidgetFill.EVENTS));
        assertEquals(7, p.todayRows.size());

        // The child's to-dos-only widget: nothing to show, so a clear week relaxes it only when
        // the events switch is on (it is off here).
        WidgetFill.Plan todosOnly = plan(root, blocks(false, false, false, true, false, false),
                WidgetSizes.Size.LARGE, 344, SUN_NOON);
        assertTrue(todosOnly.tasks.isEmpty());
        assertFalse(todosOnly.isRelaxed());
    }
}
