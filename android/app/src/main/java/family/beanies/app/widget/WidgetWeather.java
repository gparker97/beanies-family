package family.beanies.app.widget;

/**
 * What a widget draws of the home town's weather at a given instant (#134, ADR-043). A pure
 * reader of the snapshot's {@link WidgetSnapshot.Weather}, mirrored by iOS `WidgetWeather.swift`.
 *
 * NO THRESHOLDS LIVE HERE. The 1h "show the age" and 12h "hide the temperature" rules are defined
 * once, in src/utils/weather/weatherReading.ts, and travel in the snapshot as two instants, so a
 * rule change is a TypeScript-only edit. This class only compares the device clock with them:
 *  - {@code now < ageFrom}: the temperature, no age;
 *  - {@code ageFrom <= now < currentUntil}: the temperature in the softer ink, and the age
 *    (`labels.weatherAsOf`, filled with {@code fetchedAt}) in place of today's range;
 *  - {@code now >= currentUntil}: no temperature; today's glyph (not the stale "now" one) and
 *    today's high (a temperature-width token, so it fits where the temperature did) take its
 *    place in the row, softer, and the age moves to the line under it. The kept row is never a
 *    lone glyph.
 * The day is the snapshot entry for the DEVICE's local ymd (the same "today" every widget uses,
 * {@link WidgetFill#ymd}); a reading with no entry for it is no weather at all, so the small
 * widget's peek returns, the native form of the web atom's `unavailable`.
 *
 * Pure Java (no android.*), JVM-tested in WidgetWeatherTest.
 */
final class WidgetWeather {

    private WidgetWeather() {}

    /** The weather one render draws. */
    static final class Shown {
        /** The WeatherGlyph kind: the conditions now while a temperature shows, else today's. */
        final String glyph;
        /** "55°", or "" once the reading is past `currentUntil`. */
        final String temp;
        /** The reading is old enough to show its age: softer ink, the age line instead of the range. */
        final boolean aged;
        /** Today's "57° / 49°" ("" when the snapshot carries none). */
        final String range;
        /** Today's "57°": the row's text once the temperature is gone. */
        final String high;
        /** The condition word for the glyph's content description; "" when no temperature shows. */
        final String condition;
        /** When the reading arrived: what the age line names. */
        final long fetchedAt;

        Shown(String glyph, String temp, boolean aged, String range, String high, String condition,
                long fetchedAt) {
            this.glyph = glyph;
            this.temp = temp;
            this.aged = aged;
            this.range = range;
            this.high = high;
            this.condition = condition;
            this.fetchedAt = fetchedAt;
        }

        /** A current temperature shows: the small widget's header slot takes it over the peek. */
        boolean hasCurrent() {
            return !temp.isEmpty();
        }

        /** The always-kept row's text: the temperature, or today's high once it is gone. */
        String rowText() {
            return hasCurrent() ? temp : high;
        }

        /** The row's text is in the softer ink: an aged temperature, or the high standing in for one. */
        boolean soft() {
            return aged || !hasCurrent();
        }

        /**
         * The line under the row carries the age rather than the range: while the reading is
         * aged, and once the temperature is gone (the row then shows today's high).
         */
        boolean showsAge() {
            return aged || !hasCurrent();
        }
    }

    /** {@link #at(WidgetSnapshot.Weather, String, long)} for the device's own today. */
    static Shown at(WidgetSnapshot.Weather weather, long now) {
        return at(weather, WidgetFill.ymd(now, 0), now);
    }

    /**
     * What to draw at {@code now} on the day {@code todayYmd}, or null when there is no weather:
     * none in the snapshot (off, no town, no reading, or a v2 file), or no entry for that day.
     */
    static Shown at(WidgetSnapshot.Weather weather, String todayYmd, long now) {
        if (weather == null || todayYmd == null) return null;
        WidgetSnapshot.WeatherDay today = null;
        for (WidgetSnapshot.WeatherDay day : weather.days) {
            if (todayYmd.equals(day.ymd)) {
                today = day;
                break;
            }
        }
        if (today == null) return null;
        boolean current = now < weather.currentUntil && !weather.currentTemp.isEmpty();
        boolean aged = current && now >= weather.ageFrom;
        String glyph = current && !weather.currentGlyph.isEmpty() ? weather.currentGlyph : today.glyph;
        return new Shown(glyph, current ? weather.currentTemp : "", aged, today.range, today.high,
                current ? weather.currentCondition : "", weather.fetchedAt);
    }

    /**
     * The next instant after {@code now} at which {@link #at} changes on its own (the age appears,
     * or the temperature goes), or {@link Long#MAX_VALUE} when neither is ahead. The provider's
     * re-render alarm takes the earliest of this, midnight (the day pick) and its other instants.
     */
    static long nextChange(WidgetSnapshot.Weather weather, long now) {
        if (weather == null) return Long.MAX_VALUE;
        long at = Long.MAX_VALUE;
        if (weather.ageFrom > now) at = weather.ageFrom;
        if (weather.currentUntil > now) at = Math.min(at, weather.currentUntil);
        return at;
    }
}
