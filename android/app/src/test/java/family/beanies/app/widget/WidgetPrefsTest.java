package family.beanies.app.widget;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

/**
 * The widget's stored choices and relayed failure tokens (#130). Pure-Java rules only (no
 * SharedPreferences round trip: the suite is plain JVM): the defaults, the stored keys and their
 * parsers, the configuration screen's radio tables (2026-11-11), which failures the next publish
 * relays ({@link WidgetPrefs#mergeOutcome}) and how a token is named
 * ({@link WidgetPrefs#failureToken}), both of which must stay inside the app's token grammar
 * (src/services/telemetry/homeWidgetEvents.ts).
 */
public class WidgetPrefsTest {

    @Test
    public void unknownOpacityAndMissingTextSizeReadAsTheDefaults() {
        boolean[] blocks = new boolean[WidgetFill.FILL_ORDER.length];
        WidgetPrefs prefs = new WidgetPrefs(blocks, 13, null);
        assertEquals(WidgetPrefs.DEFAULT_OPACITY, prefs.opacity);
        // Automatic since 2026-11-11: Standard everywhere but the To-dos layout.
        assertEquals(WidgetPrefs.TextSize.AUTO, prefs.textSize);
        assertEquals(WidgetPrefs.Focus.DAY, prefs.focus);
        assertFalse(prefs.todosEvents);
        assertFalse(prefs.todosMeals);
    }

    @Test
    public void theFullConstructorKeepsEveryChoiceAndDefaultsANullFocus() {
        boolean[] blocks = {true, false, true, false, true, false};
        WidgetPrefs prefs = new WidgetPrefs(blocks, 40, WidgetPrefs.TextSize.LARGER,
                WidgetPrefs.Focus.TODOS, true, false);
        assertArrayEquals(blocks, prefs.blocks);
        assertEquals(40, prefs.opacity);
        assertEquals(WidgetPrefs.TextSize.LARGER, prefs.textSize);
        assertEquals(WidgetPrefs.Focus.TODOS, prefs.focus);
        assertTrue(prefs.todosEvents);
        assertFalse(prefs.todosMeals);
        // The blocks are copied: a later change to the caller's array is not a stored choice.
        blocks[1] = true;
        assertFalse(prefs.blocks[1]);
        assertEquals(WidgetPrefs.Focus.DAY, new WidgetPrefs(blocks, 70, null, null, false, false).focus);
    }

    @Test
    public void textSizeKeysAreStoredForeverAndUnknownReadsAsAutomatic() {
        assertEquals("automatic", WidgetPrefs.TextSize.AUTO.key);
        assertEquals("standard", WidgetPrefs.TextSize.STANDARD.key);
        assertEquals("large", WidgetPrefs.TextSize.LARGE.key);
        assertEquals("larger", WidgetPrefs.TextSize.LARGER.key);
        for (WidgetPrefs.TextSize t : WidgetPrefs.TextSize.values()) {
            assertSame(t, WidgetPrefs.TextSize.fromKey(t.key));
        }
        assertSame(WidgetPrefs.TextSize.AUTO, WidgetPrefs.TextSize.fromKey(null));
        assertSame(WidgetPrefs.TextSize.AUTO, WidgetPrefs.TextSize.fromKey("huge"));
        assertSame(WidgetPrefs.TextSize.AUTO, WidgetPrefs.TextSize.DEFAULT);
        // Automatic draws at Standard's factor; only the To-dos fill reads the difference.
        assertEquals(1f, WidgetPrefs.TextSize.AUTO.factor, 0f);
        assertSame(WidgetPrefs.TextSize.AUTO, WidgetPrefs.TextSize.values()[0]);
    }

    @Test
    public void focusKeysAreStoredForeverAndUnknownReadsAsYourDay() {
        assertEquals("day", WidgetPrefs.Focus.DAY.key);
        assertEquals("todos", WidgetPrefs.Focus.TODOS.key);
        assertSame(WidgetPrefs.Focus.DAY, WidgetPrefs.Focus.fromKey("day"));
        assertSame(WidgetPrefs.Focus.TODOS, WidgetPrefs.Focus.fromKey("todos"));
        assertSame(WidgetPrefs.Focus.DAY, WidgetPrefs.Focus.fromKey(null));
        assertSame(WidgetPrefs.Focus.DAY, WidgetPrefs.Focus.fromKey("TODOS"));
    }

    @Test
    public void everyTextSizeHasExactlyOneRadio() {
        assertTableComplete(WidgetPrefs.TextSize.values(), WidgetConfigIds.TEXT_SIZES, WidgetConfigIds.TEXT_SIZE_IDS);
        // Automatic is the first radio on the screen.
        assertSame(WidgetPrefs.TextSize.AUTO, WidgetConfigIds.TEXT_SIZES[0]);
        assertSame(WidgetPrefs.TextSize.STANDARD,
                WidgetConfigIds.valueOf(WidgetConfigIds.TEXT_SIZES, WidgetConfigIds.TEXT_SIZE_IDS, -1,
                        WidgetPrefs.TextSize.STANDARD));
    }

    @Test
    public void everyFocusHasExactlyOneRadio() {
        assertTableComplete(WidgetPrefs.Focus.values(), WidgetConfigIds.FOCUSES, WidgetConfigIds.FOCUS_IDS);
        assertSame(WidgetPrefs.Focus.DAY, WidgetConfigIds.FOCUSES[0]);
    }

    private static <T> void assertTableComplete(T[] all, T[] values, int[] ids) {
        assertEquals(all.length, values.length);
        assertEquals(all.length, ids.length);
        Set<Integer> seen = new HashSet<>();
        for (T value : all) {
            int id = WidgetConfigIds.idOf(values, ids, value);
            assertNotEquals("no radio for " + value, 0, id);
            assertTrue("two values share a radio: " + value, seen.add(id));
            assertSame(value, WidgetConfigIds.valueOf(values, ids, id, null));
        }
    }

    @Test
    public void mergeStartsFromNothing() {
        assertEquals("list_failed;X", WidgetPrefs.mergeOutcome("", "list_failed;X"));
        assertEquals("list_failed;X", WidgetPrefs.mergeOutcome(null, "list_failed;X"));
    }

    @Test
    public void mergeIgnoresAnEmptyToken() {
        assertEquals("a", WidgetPrefs.mergeOutcome("a", null));
        assertEquals("a", WidgetPrefs.mergeOutcome("a", ""));
        assertEquals("", WidgetPrefs.mergeOutcome(null, null));
    }

    @Test
    public void mergeKeepsEachFailureOnceAndMovesARepeatToNewest() {
        assertEquals("a|b", WidgetPrefs.mergeOutcome("a", "b"));
        assertEquals("b|a", WidgetPrefs.mergeOutcome("a|b", "a"));
        assertEquals("a", WidgetPrefs.mergeOutcome("a", "a"));
    }

    @Test
    public void mergeDropsTheOldestOnceFourAreHeld() {
        // The newest failure always survives: a new one is never crowded out by stale ones.
        assertEquals("b|c|d|e", WidgetPrefs.mergeOutcome("a|b|c|d", "e"));
        assertEquals("a|c|d|b", WidgetPrefs.mergeOutcome("a|b|c|d", "b"));
    }

    @Test
    public void failureTokenNamesTheRootCause() {
        RuntimeException wrapped = new RuntimeException(new IllegalStateException("binder"));
        assertEquals("reload_failed;IllegalStateException",
                WidgetPrefs.failureToken("reload_failed", wrapped));
    }

    @Test
    public void aRenderFailureNamesItsCause() {
        // DayWidgetProvider's render catch: `render_failed;<root cause>` (homeWidgetEvents.ts
        // accepts it beside the bare token released builds still send).
        assertEquals("render_failed;NullPointerException",
                WidgetPrefs.failureToken("render_failed", new RuntimeException(new NullPointerException())));
    }

    @Test
    public void failureTokenStaysInsideTheGrammar() {
        // Anonymous class: empty simple name.
        RuntimeException anonymous = new RuntimeException() {};
        assertEquals("list_failed;Unknown", WidgetPrefs.failureToken("list_failed", anonymous));
        // Digits stripped, then at most 40 characters.
        assertEquals("list_failed;HttpFailureException",
                WidgetPrefs.failureToken("list_failed", new Http2FailureException()));
        assertEquals(40, WidgetPrefs.failureToken("x", new AVeryLongExceptionNameThatRunsWellPastFortyCharactersException())
                .substring(2).length());
    }

    private static final class Http2FailureException extends RuntimeException {}

    private static final class AVeryLongExceptionNameThatRunsWellPastFortyCharactersException
            extends RuntimeException {}
}
