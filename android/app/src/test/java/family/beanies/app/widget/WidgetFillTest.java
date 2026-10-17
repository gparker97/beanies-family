package family.beanies.app.widget;

import static family.beanies.app.widget.WidgetFill.COLUMN_AGE;
import static family.beanies.app.widget.WidgetFill.COLUMN_AUDIENCE;
import static family.beanies.app.widget.WidgetFill.COLUMN_DUE;
import static family.beanies.app.widget.WidgetFill.COLUMN_STALE;
import static family.beanies.app.widget.WidgetFill.COLUMN_WEATHER;
import static family.beanies.app.widget.WidgetFill.COLUMN_WEATHER_SUB;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The date column's line budget (#134): RemoteViews has no ViewThatFits, so
 * {@link WidgetFill#dateColumnLines} decides which optional lines fit a placed height. Heights
 * are the portrait heights a host reports (the Pixel Launcher, 2026-10-12: a two-row 4x2 reports
 * 224dp, a three-row 4x3 344dp), passed the way the renderer has them: divided by the effective
 * text scale ({@code WidgetSizes.layoutHeightDp}). Scales: Standard 1.0, Large 1.15, Larger 1.3.
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
    public void largeDropsTheTwoLineAgeBeforeTheCount() {
        int flags = MEDIUM_WEATHER | COLUMN_AGE | COLUMN_STALE;
        assertEquals(flags & ~COLUMN_WEATHER_SUB, lines(MEDIUM_DP, LARGE, flags));
    }

    @Test
    public void largerKeepsTheRangeAndCountUntilTheSnapshotIsStale() {
        assertEquals(MEDIUM_WEATHER, lines(MEDIUM_DP, LARGER, MEDIUM_WEATHER));
        // Stale: the "as of" line is never dropped, so the range goes, then the count. The
        // weather row stays whatever happens.
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
        // The pre-#134 column at Larger: a stale line and the count, three lines each (the
        // layout's note), still fit a two-row widget, so a v2 snapshot loses nothing.
        int flags = COLUMN_STALE | COLUMN_DUE;
        assertEquals(flags, lines(MEDIUM_DP, LARGER, flags));
    }

    @Test
    public void aThreeRowWidgetKeepsEverythingAtLarger() {
        int all = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AGE | COLUMN_STALE | COLUMN_AUDIENCE
                | COLUMN_DUE;
        assertEquals(all, lines(LARGE_DP, LARGER, all));
        assertEquals(all, lines(LARGE_DP, STANDARD, all));
    }

    @Test
    public void linesDropInThePlansOrder() {
        int flags = COLUMN_WEATHER | COLUMN_WEATHER_SUB | COLUMN_AUDIENCE | COLUMN_DUE;
        // Range/age first...
        assertEquals(COLUMN_WEATHER | COLUMN_AUDIENCE | COLUMN_DUE, lines(240, LARGER, flags));
        // ...then the audience...
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
}
