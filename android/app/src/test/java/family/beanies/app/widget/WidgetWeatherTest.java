package family.beanies.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.TimeZone;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * The widget's weather reader (#134). The thresholds live in TypeScript and arrive as two instants;
 * these pin the comparisons at their edges (just before and exactly at `ageFrom` and
 * `currentUntil`) and the device-ymd day pick across midnight.
 */
public class WidgetWeatherTest {

    private static final long HOUR = 60L * 60L * 1000L;
    private static final long FETCHED = 1_791_678_000_000L;
    private static final long AGE_FROM = FETCHED + HOUR;
    private static final long CURRENT_UNTIL = FETCHED + 12 * HOUR;

    private TimeZone savedZone;

    @Before
    public void pinZone() {
        savedZone = TimeZone.getDefault();
        // No daylight saving, so local midnight is a fixed offset from UTC.
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Singapore"));
    }

    @After
    public void restoreZone() {
        TimeZone.setDefault(savedZone);
    }

    private static WidgetSnapshot.Weather weather() {
        return weather(null);
    }

    private static WidgetSnapshot.Weather weather(String zone) {
        return new WidgetSnapshot.Weather(FETCHED, AGE_FROM, CURRENT_UNTIL, "partly", "27°", "Partly cloudy",
                Arrays.asList(
                        new WidgetSnapshot.WeatherDay("2026-10-11", "thunder", "32°", "32° / 26°"),
                        new WidgetSnapshot.WeatherDay("2026-10-12", "rain", "30°", "30° / 25°")),
                zone);
    }

    @Test
    public void justBeforeAgeFromShowsTheTemperatureWithNoAge() {
        WidgetWeather.Shown shown = WidgetWeather.at(weather(), "2026-10-11", AGE_FROM - 1);
        assertEquals("27°", shown.temp);
        assertFalse(shown.aged);
        assertEquals("partly", shown.glyph);
        assertEquals("Partly cloudy", shown.condition);
        assertEquals("32° / 26°", shown.range);
        assertTrue(shown.hasCurrent());
        assertEquals("27°", shown.rowText());
        assertFalse(shown.soft());
        assertFalse(shown.showsAge());
    }

    @Test
    public void atAgeFromTheAgeShows() {
        WidgetWeather.Shown shown = WidgetWeather.at(weather(), "2026-10-11", AGE_FROM);
        assertEquals("27°", shown.temp);
        assertTrue(shown.aged);
        assertEquals(FETCHED, shown.fetchedAt);
        assertEquals("27°", shown.rowText());
        assertTrue(shown.soft());
        assertTrue(shown.showsAge());
    }

    @Test
    public void justBeforeCurrentUntilTheTemperatureStaysAged() {
        WidgetWeather.Shown shown = WidgetWeather.at(weather(), "2026-10-11", CURRENT_UNTIL - 1);
        assertEquals("27°", shown.temp);
        assertTrue(shown.aged);
        assertTrue(shown.hasCurrent());
    }

    @Test
    public void atCurrentUntilTheTemperatureGoesAndTheRangeStays() {
        WidgetWeather.Shown shown = WidgetWeather.at(weather(), "2026-10-11", CURRENT_UNTIL);
        assertEquals("", shown.temp);
        assertFalse(shown.aged);
        assertFalse(shown.hasCurrent());
        // The stale "now" glyph gives way to today's, as the web atom does for an old reading.
        assertEquals("thunder", shown.glyph);
        assertEquals("", shown.condition);
        assertEquals("32° / 26°", shown.range);
        // The kept row is never a lone glyph: today's high takes the temperature's place, in the
        // softer ink, and the line under it carries the age.
        assertEquals("32°", shown.rowText());
        assertTrue(shown.soft());
        assertTrue(shown.showsAge());
        assertEquals(FETCHED, shown.fetchedAt);
    }

    @Test
    public void noEntryForTodayIsNoWeather() {
        assertNull(WidgetWeather.at(weather(), "2026-10-13", AGE_FROM - 1));
        assertNull(WidgetWeather.at(null, "2026-10-11", AGE_FROM - 1));
        WidgetSnapshot.Weather noDays = new WidgetSnapshot.Weather(FETCHED, AGE_FROM, CURRENT_UNTIL,
                "partly", "27°", "Partly cloudy", Collections.<WidgetSnapshot.WeatherDay>emptyList(), null);
        assertNull(WidgetWeather.at(noDays, "2026-10-11", AGE_FROM - 1));
    }

    @Test
    public void aMalformedTodayIsNoWeatherOnceTheTemperatureGoes() {
        // A lenient decode can leave today's range or high empty. While the temperature shows it
        // carries the row; past `currentUntil` the row would be a lone glyph, so it is no weather.
        for (String[] hr : new String[][] {{"", "32° / 26°"}, {"32°", ""}}) {
            WidgetSnapshot.Weather w = new WidgetSnapshot.Weather(FETCHED, AGE_FROM, CURRENT_UNTIL,
                    "partly", "27°", "Partly cloudy",
                    Collections.singletonList(
                            new WidgetSnapshot.WeatherDay("2026-10-11", "thunder", hr[0], hr[1])),
                    null);
            WidgetWeather.Shown shown = WidgetWeather.at(w, "2026-10-11", CURRENT_UNTIL - 1);
            assertEquals("27°", shown.rowText());
            assertNull(WidgetWeather.at(w, "2026-10-11", CURRENT_UNTIL));
        }
    }

    @Test
    public void theDayIsTheHomeZonesToday() {
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
        // 15:00 on the 11th in Los Angeles is 06:00 on the 12th in Singapore.
        Calendar la = Calendar.getInstance();
        la.clear();
        la.set(2026, Calendar.OCTOBER, 11, 15, 0, 0);
        long now = la.getTimeInMillis();
        assertEquals("30° / 25°", WidgetWeather.at(weather("Asia/Singapore"), now).range);
        // An unknown id (TimeZone answers GMT for it) or none falls back to the device's day.
        assertEquals("32° / 26°", WidgetWeather.at(weather("Mars/Olympus_Mons"), now).range);
        assertEquals("32° / 26°", WidgetWeather.at(weather(null), now).range);
        assertEquals("America/Los_Angeles",
                WidgetWeather.homeZone(weather("Mars/Olympus_Mons")).getID());
        // The re-render alarm includes the home zone's midnight, not just the device's.
        Calendar sg = Calendar.getInstance(TimeZone.getTimeZone("Asia/Singapore"));
        sg.clear();
        sg.set(2026, Calendar.OCTOBER, 13, 0, 0, 0);
        WidgetSnapshot.Weather old = weather("Asia/Singapore");
        assertEquals(sg.getTimeInMillis(), WidgetWeather.nextChange(old, Math.max(now, CURRENT_UNTIL)));
    }

    @Test
    public void theDayIsPickedByTheDeviceYmdAcrossMidnight() {
        long midnight = localMidnight(2026, Calendar.OCTOBER, 12);
        WidgetWeather.Shown before = WidgetWeather.at(weather(), midnight - 1);
        WidgetWeather.Shown after = WidgetWeather.at(weather(), midnight);
        assertEquals("32° / 26°", before.range);
        assertEquals("30° / 25°", after.range);
        // Past the last day the reading carries, there is no weather at all (the peek returns).
        assertNull(WidgetWeather.at(weather(), localMidnight(2026, Calendar.OCTOBER, 13)));
    }

    @Test
    public void nextChangeIsTheNextInstantAhead() {
        assertEquals(AGE_FROM, WidgetWeather.nextChange(weather(), FETCHED));
        assertEquals(CURRENT_UNTIL, WidgetWeather.nextChange(weather(), AGE_FROM));
        // Past both instants the next change is the (home, here the device's) day turning over.
        assertEquals(localMidnight(2026, Calendar.OCTOBER, 12),
                WidgetWeather.nextChange(weather(), CURRENT_UNTIL));
        assertEquals(Long.MAX_VALUE, WidgetWeather.nextChange(null, FETCHED));
    }

    @Test
    public void aHomeMidnightBeforeTheAgeIsTheNextChange() {
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"));
        TimeZone home = TimeZone.getTimeZone("Asia/Singapore");
        Calendar c = Calendar.getInstance(home);
        c.clear();
        c.set(2026, Calendar.OCTOBER, 11, 23, 30, 0);
        long fetched = c.getTimeInMillis();
        c.set(2026, Calendar.OCTOBER, 12, 0, 0, 0);
        long homeMidnight = c.getTimeInMillis();
        // Fetched at 23:30 in Singapore: the home day turns over before the age line is due.
        WidgetSnapshot.Weather w = new WidgetSnapshot.Weather(fetched, fetched + HOUR,
                fetched + 12 * HOUR, "partly", "27°", "Partly cloudy",
                Arrays.asList(
                        new WidgetSnapshot.WeatherDay("2026-10-11", "thunder", "32°", "32° / 26°"),
                        new WidgetSnapshot.WeatherDay("2026-10-12", "rain", "30°", "30° / 25°")),
                "Asia/Singapore");
        assertEquals(homeMidnight, WidgetWeather.nextChange(w, fetched));
        assertEquals(fetched + HOUR, WidgetWeather.nextChange(w, homeMidnight));
    }

    private static long localMidnight(int year, int month, int day) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(year, month, day, 0, 0, 0);
        return c.getTimeInMillis();
    }
}
