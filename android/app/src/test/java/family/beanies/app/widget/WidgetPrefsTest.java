package family.beanies.app.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The widget's relayed failure tokens (#130). Pure-Java rules only: which failures the next
 * publish relays ({@link WidgetPrefs#mergeOutcome}) and how a token is named
 * ({@link WidgetPrefs#failureToken}), both of which must stay inside the app's token grammar
 * (src/services/telemetry/homeWidgetEvents.ts).
 */
public class WidgetPrefsTest {

    @Test
    public void audienceDefaultsToOurDay() {
        assertEquals(WidgetPrefs.AUDIENCE_OUR, WidgetPrefs.DEFAULT_AUDIENCE);
        boolean[] blocks = new boolean[WidgetFill.FILL_ORDER.length];
        assertEquals("our", new WidgetPrefs(null, blocks, WidgetPrefs.DEFAULT_OPACITY, null).audience);
        assertEquals("our", new WidgetPrefs("bogus", blocks, WidgetPrefs.DEFAULT_OPACITY, null).audience);
    }

    @Test
    public void aStoredMyDayIsKept() {
        boolean[] blocks = new boolean[WidgetFill.FILL_ORDER.length];
        assertEquals("my", new WidgetPrefs("my", blocks, WidgetPrefs.DEFAULT_OPACITY, null).audience);
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
