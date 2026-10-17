package family.beanies.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java reader against the committed contract examples (#134): the v3 file the app writes
 * today and the v2 file an older app may have left on disk. Read straight from
 * src/utils/__tests__/fixtures/, so a change to the TypeScript contract that this reader does not
 * follow fails here.
 */
public class WidgetSnapshotTest {

    private static final String FIXTURES = "src/utils/__tests__/fixtures/";

    @Test
    public void readsVersionsTwoAndThreeOnly() {
        assertFalse(WidgetSnapshot.isReadable(1));
        assertTrue(WidgetSnapshot.isReadable(2));
        assertTrue(WidgetSnapshot.isReadable(3));
        assertFalse(WidgetSnapshot.isReadable(4));
        assertFalse(WidgetSnapshot.isReadable(-1));
    }

    @Test
    public void aV2SnapshotParsesWithEveryV3FieldEmpty() throws Exception {
        JSONObject root = fixture("widget-snapshot.v2.json");
        assertEquals(2, root.getInt("version"));
        WidgetSnapshot s = WidgetSnapshot.from(root);
        assertTrue(WidgetSnapshot.isReadable(s.version));
        assertEquals(7, s.days.size());
        assertNull(s.weather);
        assertEquals("", s.labels.weatherAsOf);
        assertEquals("", s.labels.circleAllClear);
        for (WidgetSnapshot.DayEntry entry : s.days) {
            for (WidgetSnapshot.Day day : new WidgetSnapshot.Day[] {entry.my, entry.our}) {
                if (day == null) continue;
                assertTrue(day.handoffs.isEmpty());
                assertEquals(0, day.tasks.doneToday);
                for (WidgetSnapshot.Row row : day.rows) {
                    assertEquals("", row.shortTitle);
                    assertEquals("", row.whoFirst);
                }
            }
        }
        // The fixture's v2 content still arrives intact.
        assertEquals("2026-10-11", s.days.get(0).ymd);
        assertFalse(s.days.get(0).my.rows.isEmpty());
    }

    @Test
    public void theV3AdditionsChangeNothingAV2ReaderAlreadyRead() throws Exception {
        JSONObject v3 = fixture("widget-snapshot.v3.json");
        JSONObject stripped = new JSONObject(v3.toString());
        stripV3(stripped);
        assertEquals(v2Fields(WidgetSnapshot.from(stripped)), v2Fields(WidgetSnapshot.from(v3)));
    }

    @Test
    public void aV3SnapshotCarriesWeatherHandoffsAndTheCircleFields() throws Exception {
        WidgetSnapshot s = WidgetSnapshot.from(fixture("widget-snapshot.v3.json"));
        assertEquals(3, s.version);
        assertNotNull(s.weather);
        assertEquals(1_791_678_000_000L, s.weather.fetchedAt);
        assertEquals(1_791_681_600_000L, s.weather.ageFrom);
        assertEquals(1_791_721_200_000L, s.weather.currentUntil);
        assertEquals("partly", s.weather.currentGlyph);
        assertEquals("27°", s.weather.currentTemp);
        assertEquals(5, s.weather.days.size());
        assertEquals("2026-10-11", s.weather.days.get(0).ymd);
        assertEquals("32° / 26°", s.weather.days.get(0).range);
        assertEquals("32°", s.weather.days.get(0).high);
        assertEquals("as of {time}", s.labels.weatherAsOf);

        WidgetSnapshot.Day today = s.days.get(0).my;
        assertEquals(2, today.handoffs.size());
        assertEquals("dropoff", today.handoffs.get(0).kind);
        assertEquals("pickup", today.handoffs.get(1).kind);
        assertEquals("Max", today.handoffs.get(0).name);
        WidgetSnapshot.Row first = today.rows.get(0);
        assertEquals("Carter's", first.shortTitle);
        assertEquals("Max", first.whoFirst);
    }

    @Test
    public void weatherWithoutItsInstantsIsNoWeather() throws Exception {
        JSONObject root = fixture("widget-snapshot.v3.json");
        root.getJSONObject("weather").remove("currentUntil");
        assertNull(WidgetSnapshot.from(root).weather);
        root.put("weather", JSONObject.NULL);
        assertNull(WidgetSnapshot.from(root).weather);
    }

    @Test
    public void weatherWithANullInstantIsNoWeather() throws Exception {
        for (String key : new String[] {"fetchedAt", "ageFrom", "currentUntil"}) {
            JSONObject root = fixture("widget-snapshot.v3.json");
            root.getJSONObject("weather").put(key, JSONObject.NULL);
            assertNull(key, WidgetSnapshot.from(root).weather);
        }
    }

    @Test
    public void weatherCarriesItsHomeZone() throws Exception {
        JSONObject root = fixture("widget-snapshot.v3.json");
        root.getJSONObject("weather").put("zone", "Asia/Singapore");
        assertEquals("Asia/Singapore", WidgetSnapshot.from(root).weather.zone);
        root.getJSONObject("weather").remove("zone");
        assertNull(WidgetSnapshot.from(root).weather.zone);
    }

    /** Remove every optional v3 field, leaving the v2 shape. */
    private static void stripV3(JSONObject root) throws Exception {
        root.remove("weather");
        JSONObject labels = root.getJSONObject("labels");
        for (String key : new String[] {
                "weatherAsOf", "circleLeft", "circleAllDone", "circleAllClear", "circleToDo"}) {
            labels.remove(key);
        }
        JSONArray days = root.getJSONArray("days");
        for (int i = 0; i < days.length(); i++) {
            JSONObject entry = days.getJSONObject(i);
            for (String audience : new String[] {"my", "our"}) {
                JSONObject day = entry.optJSONObject(audience);
                if (day == null) continue;
                day.remove("handoffs");
                day.getJSONObject("tasks").remove("doneToday");
                JSONArray rows = day.getJSONArray("rows");
                for (int r = 0; r < rows.length(); r++) {
                    rows.getJSONObject(r).remove("shortTitle");
                    rows.getJSONObject(r).remove("whoFirst");
                }
            }
        }
    }

    /** Every field a v2 reader read, flattened, so two parses compare as one string. */
    private static String v2Fields(WidgetSnapshot s) {
        StringBuilder b = new StringBuilder();
        b.append(s.generatedAt).append('|').append(s.familyIdTail).append('|')
                .append(s.viewer.memberId).append(s.viewer.firstName).append(s.viewer.avatar)
                .append(s.viewer.isChild).append('|').append(s.lockScreenTitles).append('|');
        WidgetSnapshot.Labels l = s.labels;
        b.append(l.asOf).append(l.later).append(l.next).append(l.tomorrow).append(l.more)
                .append(l.nothingToday).append(l.myDay).append(l.ourDay).append(l.childsDay)
                .append(l.nothingOnToday).append(l.enjoy).append('|')
                .append(s.links.nook).append(s.links.todo).append('\n');
        for (WidgetSnapshot.DayEntry e : s.days) {
            b.append(e.ymd).append(e.numeral).append(e.weekday).append(e.month)
                    .append(e.weekdayShort).append(e.dividerDate).append('\n');
            day(b, e.my);
            day(b, e.our);
        }
        return b.toString();
    }

    private static void day(StringBuilder b, WidgetSnapshot.Day d) {
        if (d == null) {
            b.append("null\n");
            return;
        }
        b.append(d.thingsText).append('|');
        if (d.tonight != null) b.append(d.tonight.text.text).append(d.tonight.text.emphasis).append(d.tonight.link);
        b.append('\n');
        for (WidgetSnapshot.Row r : d.rows) {
            b.append(r.id).append(r.kind).append(r.todayOnly).append(r.time).append(r.endsAt)
                    .append(r.title).append(r.titleEmphasis).append(r.isDone).append(r.link);
            if (r.dot != null) b.append(r.dot.family).append(r.dot.initial).append(r.dot.color).append(r.dot.ink);
            if (r.handoff != null) b.append(r.handoff.inlineTitle).append(r.handoff.line).append(r.handoff.avatars);
            b.append('\n');
        }
        WidgetSnapshot.Tasks t = d.tasks;
        b.append(t.heading).append(t.count).append(t.countText.text).append(t.countText.emphasis)
                .append(t.overflowDue).append(t.overflowHint).append(t.link).append('\n');
        for (WidgetSnapshot.Task task : t.items) {
            b.append(task.kind).append(task.title).append(task.tag).append(task.tagAccent)
                    .append(task.timed).append(task.link).append('\n');
        }
    }

    /** A committed fixture, found by walking up from the test's working directory (android/app). */
    private static JSONObject fixture(String name) throws Exception {
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (dir != null) {
            File f = new File(dir, FIXTURES + name);
            if (f.isFile()) {
                return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            }
            dir = dir.getParentFile();
        }
        throw new IOException("fixture not found above " + System.getProperty("user.dir") + ": " + name);
    }
}
