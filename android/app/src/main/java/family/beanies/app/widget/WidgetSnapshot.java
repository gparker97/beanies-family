package family.beanies.app.widget;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Java mirror of the home-screen widget snapshot contract (#130, ADR-042).
 *
 * ⚠️ THE SOURCE OF TRUTH IS src/types/widgetSnapshot.ts. This file only READS that shape; the
 * Swift mirror is ios/App/BeaniesWidgets/WidgetSnapshotStore.swift and the committed examples are
 * src/utils/__tests__/fixtures/widget-snapshot.v3.json (written today) and widget-snapshot.v2.json
 * (the older shape this reader must still accept; WidgetSnapshotTest parses both). Every field is
 * read with an opt* default so an OPTIONAL field added on the TS side is safe here (unknown keys
 * are ignored), and every v3 addition is optional, so a v2 file parses to exactly what it did
 * before v3 with those fields empty. A rename, removal or retype bumps WIDGET_SNAPSHOT_VERSION,
 * and {@link WidgetSnapshotStore} then shows "open beanies to refresh" for a version outside
 * {@link #MIN_VERSION}..{@link #MAX_VERSION} rather than guessing.
 *
 * Native only paints: there is no audience decision, no translation and no colour computation
 * in any class here.
 */
final class WidgetSnapshot {

    /**
     * Mirrors WIDGET_SNAPSHOT_READABLE_VERSIONS in src/types/widgetSnapshot.ts: the app WRITES
     * the last (WIDGET_SNAPSHOT_VERSION, 3) and this reader accepts every version from the first.
     * v3 (#134) is v2 plus optional fields only (weather, labels.weatherAsOf / circle*, a day's
     * handoffs, tasks.doneToday, a row's shortTitle / whoFirst). Swift: `supportedVersions = 2...3`.
     */
    static final int MIN_VERSION = 2;
    static final int MAX_VERSION = 3;

    /** A version this reader can paint ({@link WidgetSnapshotStore} rejects any other). */
    static boolean isReadable(int version) {
        return version >= MIN_VERSION && version <= MAX_VERSION;
    }

    final int version;
    final String generatedAt;
    final String familyIdTail;
    final Viewer viewer;
    final boolean lockScreenTitles;
    final Labels labels;
    final Links links;
    /** Today and the six days after it as of {@link #generatedAt}, ascending. */
    final List<DayEntry> days;
    /**
     * v3: the home town's weather, or null when Show Weather is off, no town is set, there is no
     * reading, or the file is v2. What a widget draws from it is decided by {@link WidgetWeather}.
     */
    final Weather weather;

    private WidgetSnapshot(JSONObject o) {
        version = o.optInt("version", -1);
        generatedAt = str(o, "generatedAt");
        familyIdTail = str(o, "familyIdTail");
        viewer = new Viewer(obj(o, "viewer"));
        JSONObject settings = obj(o, "settings");
        lockScreenTitles = settings.optBoolean("lockScreenTitles", true);
        labels = new Labels(obj(o, "labels"));
        links = new Links(obj(o, "links"));
        List<DayEntry> parsed = new ArrayList<>();
        JSONArray arr = o.optJSONArray("days");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject d = arr.optJSONObject(i);
                if (d != null) parsed.add(new DayEntry(d));
            }
        }
        days = Collections.unmodifiableList(parsed);
        JSONObject w = o.optJSONObject("weather");
        weather = w == null ? null : Weather.from(w);
    }

    /** Parse an already-validated root object. Never throws on a missing field. */
    static WidgetSnapshot from(JSONObject root) {
        return new WidgetSnapshot(root);
    }

    static final class Viewer {
        final String memberId;
        final String firstName;
        /** 'father' | 'mother' | 'neutral' | 'boy' | 'girl' | 'dog' (WidgetAvatar). */
        final String avatar;
        final boolean isChild;

        Viewer(JSONObject o) {
            memberId = str(o, "memberId");
            firstName = str(o, "firstName");
            avatar = str(o, "avatar");
            isChild = o.optBoolean("isChild", false);
        }
    }

    static final class Labels {
        final String asOf;
        final String later;
        final String next;
        /** "tomorrow", beside the divider of the day after the device's today. */
        final String tomorrow;
        /** "{n} more", beside the to-dos heading when not every task fits. */
        final String more;
        /** "nothing on today": the calendar's first line when today has no rows. */
        final String nothingToday;
        final String myDay;
        final String ourDay;
        final String childsDay;
        final String nothingOnToday;
        final String enjoy;
        /** v3: "as of {time}" beside a weather reading old enough to show its age; "" in v2. */
        final String weatherAsOf;
        /** v3, the lock-screen circle (iOS only today): "left", "all done", "all clear", "to do". */
        final String circleLeft;
        final String circleAllDone;
        final String circleAllClear;
        final String circleToDo;

        Labels(JSONObject o) {
            asOf = str(o, "asOf");
            later = str(o, "later");
            next = str(o, "next");
            tomorrow = str(o, "tomorrow");
            more = str(o, "more");
            nothingToday = str(o, "nothingToday");
            myDay = str(o, "myDay");
            ourDay = str(o, "ourDay");
            childsDay = str(o, "childsDay");
            nothingOnToday = str(o, "nothingOnToday");
            enjoy = str(o, "enjoy");
            weatherAsOf = str(o, "weatherAsOf");
            circleLeft = str(o, "circleLeft");
            circleAllDone = str(o, "circleAllDone");
            circleAllClear = str(o, "circleAllClear");
            circleToDo = str(o, "circleToDo");
        }
    }

    static final class Links {
        final String nook;
        final String todo;

        Links(JSONObject o) {
            nook = str(o, "nook");
            todo = str(o, "todo");
        }
    }

    static final class DayEntry {
        /** Local calendar date, "2026-10-11". */
        final String ymd;
        final String numeral;
        final String weekday;
        final String month;
        final String weekdayShort;
        /** "Sun 12": this day's divider in the look-ahead (and the small widget's "next · Sun 12"). */
        final String dividerDate;
        final Day my;
        /** null for a child session. */
        final Day our;

        DayEntry(JSONObject o) {
            ymd = str(o, "ymd");
            numeral = str(o, "numeral");
            weekday = str(o, "weekday");
            month = str(o, "month");
            weekdayShort = str(o, "weekdayShort");
            dividerDate = str(o, "dividerDate");
            JSONObject m = o.optJSONObject("my");
            JSONObject u = o.optJSONObject("our");
            my = m == null ? null : new Day(m);
            our = u == null ? null : new Day(u);
        }
    }

    /** One audience's view of one day (WidgetDay). */
    static final class Day {
        /** The calendar section: trips, birthdays, timed events, untimed events. */
        final List<Row> rows;
        /** "tonight: **tacos**, Sam cooks"; null when nothing is planned. */
        final Linked tonight;
        final Tasks tasks;
        final String thingsText;
        /** v3: the viewer's own timed drop-offs and pick-ups, ascending (my day only); empty in v2. */
        final List<DayHandoff> handoffs;

        Day(JSONObject o) {
            List<Row> r = new ArrayList<>();
            JSONArray arr = o.optJSONArray("rows");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject row = arr.optJSONObject(i);
                    if (row != null) r.add(new Row(row));
                }
            }
            rows = Collections.unmodifiableList(r);
            JSONObject t = o.optJSONObject("tonight");
            tonight = t == null ? null : new Linked(t);
            tasks = new Tasks(obj(o, "tasks"));
            thingsText = str(o, "thingsText");
            List<DayHandoff> h = new ArrayList<>();
            JSONArray harr = o.optJSONArray("handoffs");
            if (harr != null) {
                for (int i = 0; i < harr.length(); i++) {
                    JSONObject item = harr.optJSONObject(i);
                    if (item != null && item.has("at") && !item.isNull("at")) h.add(new DayHandoff(item));
                }
            }
            handoffs = Collections.unmodifiableList(h);
        }
    }

    /** v3: one of the viewer's own drop-offs or pick-ups (WidgetDayHandoff). */
    static final class DayHandoff {
        /** Epoch ms: the activity's start for a drop-off, its end for a pick-up. */
        final long at;
        /** 'dropoff' | 'pickup'. */
        final String kind;
        /** The first name of the person dropped off or collected; "" when nobody else is assigned. */
        final String name;
        final String link;

        DayHandoff(JSONObject o) {
            at = o.optLong("at", 0L);
            kind = str(o, "kind");
            name = str(o, "name");
            link = str(o, "link");
        }
    }

    /** One agenda row (WidgetRow). */
    static final class Row {
        final String id;
        /** 'event' | 'trip' | 'birthday' (WidgetRowKind). */
        final String kind;
        /** Shown only on the day the widget treats as today, never under a look-ahead divider. */
        final boolean todayOnly;
        final String time;
        /** Epoch ms of the end (or the start), or null when untimed. Past = endsAt < now. */
        final Long endsAt;
        final String title;
        /** A substring of `title` to bold in the accent ("day 3 of 6"); "" when none. */
        final String titleEmphasis;
        /** v3: the title's first word (the lock-screen circle's word); "" in v2 or for a blank title. */
        final String shortTitle;
        /** v3: the first assignee's first name; "" in v2 or when nobody is assigned. */
        final String whoFirst;
        final Dot dot;
        final boolean isDone;
        final Handoff handoff;
        final String link;

        Row(JSONObject o) {
            id = str(o, "id");
            kind = str(o, "kind");
            todayOnly = o.optBoolean("todayOnly", false);
            time = str(o, "time");
            endsAt = o.isNull("endsAt") || !o.has("endsAt") ? null : o.optLong("endsAt");
            title = str(o, "title");
            titleEmphasis = str(o, "titleEmphasis");
            shortTitle = str(o, "shortTitle");
            whoFirst = str(o, "whoFirst");
            JSONObject d = o.optJSONObject("dot");
            dot = d == null ? null : new Dot(d);
            isDone = o.optBoolean("isDone", false);
            JSONObject h = o.optJSONObject("handoff");
            handoff = h == null ? null : new Handoff(h);
            link = str(o, "link");
        }

        boolean isPast(long now) {
            return endsAt != null && endsAt < now;
        }

        /** A trip or a birthday: the "comingUp" block, drawn with a glyph where a time would be. */
        boolean isComingUp() {
            return "trip".equals(kind) || "birthday".equals(kind);
        }
    }

    /** WidgetDot: a member initial on the member's colour, or the family hug icon. */
    static final class Dot {
        final boolean family;
        final String initial;
        /** #RRGGBB, or "" when absent. */
        final String color;
        final String ink;

        Dot(JSONObject o) {
            family = "family".equals(o.optString("kind", ""));
            initial = str(o, "initial");
            color = str(o, "color");
            ink = str(o, "ink");
        }
    }

    static final class Handoff {
        /** Same person drops off and picks up: "piano, Jo drives". */
        final String inlineTitle;
        /** Different people: "Sam drops off, Jo picks up 12:30". */
        final String line;
        final List<String> avatars;

        Handoff(JSONObject o) {
            inlineTitle = str(o, "inlineTitle");
            line = str(o, "line");
            List<String> a = new ArrayList<>();
            JSONArray arr = o.optJSONArray("avatars");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    String v = arr.optString(i, "");
                    if (!v.isEmpty()) a.add(v);
                }
            }
            avatars = Collections.unmodifiableList(a);
        }
    }

    /** The to-dos section of one day (WidgetTasks). Empty for a child. */
    static final class Tasks {
        /** Already in display order, capped per switch by the builder (`MAX_WIDGET_TASKS`, 16). */
        final List<Task> items;
        /** How many the builder's per-switch cap left out: to-dos and lists, and hints. */
        final int overflowDue;
        final int overflowHint;
        /** "to-dos" or "to-dos and lists". */
        final String heading;
        final int count;
        /** "**4** for you today"; text "" when count is 0. */
        final Text countText;
        /** v3: to-dos completed today among those that would count in {@link #count}; 0 in v2. */
        final int doneToday;
        final String link;

        Tasks(JSONObject o) {
            List<Task> l = new ArrayList<>();
            JSONArray arr = o.optJSONArray("items");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject item = arr.optJSONObject(i);
                    if (item != null) l.add(new Task(item));
                }
            }
            items = Collections.unmodifiableList(l);
            JSONObject overflow = obj(o, "overflow");
            overflowDue = Math.max(0, overflow.optInt("due", 0));
            overflowHint = Math.max(0, overflow.optInt("hint", 0));
            heading = str(o, "heading");
            count = o.optInt("count", 0);
            countText = new Text(obj(o, "countText"));
            doneToday = Math.max(0, o.optInt("doneToday", 0));
            link = str(o, "link");
        }
    }

    /** One row of the to-dos section (WidgetTask). */
    static final class Task {
        /** 'todo' | 'hint' | 'list' (WidgetTaskKind). */
        final String kind;
        final String title;
        /** "overdue", "by 5pm", "Thu 16", or "" for an undated task. */
        final String tag;
        /** The tag in the accent ('accent') or quieter ink ('soft'). */
        final boolean tagAccent;
        /** The to-do has a due time: the ring is filled. */
        final boolean timed;
        final Dot dot;
        final String link;

        Task(JSONObject o) {
            kind = str(o, "kind");
            title = str(o, "title");
            tag = str(o, "tag");
            tagAccent = "accent".equals(str(o, "tagTone"));
            timed = o.optBoolean("timed", false);
            JSONObject d = o.optJSONObject("dot");
            dot = d == null ? null : new Dot(d);
            link = str(o, "link");
        }

        /** A helpful hint or reminder: the "hint" block. To-dos and lists belong to "due". */
        boolean isHint() {
            return "hint".equals(kind);
        }
    }

    /** WidgetText: text plus an optional emphasised substring (bold, first occurrence). */
    static final class Text {
        final String text;
        final String emphasis;

        Text(JSONObject o) {
            this(str(o, "text"), str(o, "emphasis"));
        }

        Text(String text, String emphasis) {
            this.text = text;
            this.emphasis = emphasis;
        }
    }

    /** Text + link: `tonight` (WidgetText & { link }). */
    static final class Linked {
        final Text text;
        final String link;

        /** `{ text: string, emphasis?: string, link }`. */
        Linked(JSONObject o) {
            text = new Text(o);
            link = str(o, "link");
        }
    }

    /**
     * v3: the home town's weather (WidgetWeather), already formatted in the family's unit. The
     * staleness rules travel as two instants ({@link #ageFrom}, {@link #currentUntil}) so this
     * reader holds no threshold of its own; {@link WidgetWeather} compares them with the clock.
     */
    static final class Weather {
        /** Epoch ms the reading arrived (the publishing device's clock). */
        final long fetchedAt;
        /** From here the age is shown ("as of {time}") and the temperature softens. */
        final long ageFrom;
        /** From here the current temperature is hidden; today's range stays. */
        final long currentUntil;
        /** The WeatherGlyph kind of the conditions now ("partly"). */
        final String currentGlyph;
        /** "55°". */
        final String currentTemp;
        /** The translated condition word ("Partly cloudy"). */
        final String currentCondition;
        /**
         * The home-zone days, ascending; picked by today's ymd in {@link #zone} (the device's own
         * zone when that is absent or unknown), never by position.
         */
        final List<WeatherDay> days;
        /** The family's home zone (IANA id, "Asia/Singapore"), or null when the snapshot has none. */
        final String zone;

        Weather(long fetchedAt, long ageFrom, long currentUntil, String currentGlyph,
                String currentTemp, String currentCondition, List<WeatherDay> days, String zone) {
            this.fetchedAt = fetchedAt;
            this.ageFrom = ageFrom;
            this.currentUntil = currentUntil;
            this.currentGlyph = currentGlyph;
            this.currentTemp = currentTemp;
            this.currentCondition = currentCondition;
            this.days = Collections.unmodifiableList(new ArrayList<>(days));
            this.zone = zone;
        }

        /**
         * Null when an instant is missing or null: without them no rule can be applied, and a
         * reading that cannot say how old it is must not be drawn as current.
         */
        static Weather from(JSONObject o) {
            if (!hasInstant(o, "fetchedAt") || !hasInstant(o, "ageFrom")
                    || !hasInstant(o, "currentUntil")) {
                return null;
            }
            JSONObject current = obj(o, "current");
            List<WeatherDay> parsed = new ArrayList<>();
            JSONArray arr = o.optJSONArray("days");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject d = arr.optJSONObject(i);
                    if (d != null) {
                        parsed.add(new WeatherDay(
                                str(d, "ymd"), str(d, "glyph"), str(d, "high"), str(d, "range")));
                    }
                }
            }
            String zone = str(o, "zone");
            return new Weather(o.optLong("fetchedAt", 0L), o.optLong("ageFrom", 0L),
                    o.optLong("currentUntil", 0L), str(current, "glyph"), str(current, "temp"),
                    str(current, "condition"), parsed, zone.isEmpty() ? null : zone);
        }

        /** Present and not JSON null, the same guard {@link DayHandoff}'s `at` gets. */
        private static boolean hasInstant(JSONObject o, String key) {
            return o.has(key) && !o.isNull(key);
        }
    }

    /** v3: one home-zone day of the forecast (WidgetWeatherDay). `low` is not drawn on its own. */
    static final class WeatherDay {
        /** "2026-10-11" in the family's home zone. */
        final String ymd;
        final String glyph;
        /** "57°": the date column's row once the current temperature is gone. */
        final String high;
        /** "57° / 49°". */
        final String range;

        WeatherDay(String ymd, String glyph, String high, String range) {
            this.ymd = ymd;
            this.glyph = glyph;
            this.high = high;
            this.range = range;
        }
    }

    /** A string field, "" when absent, null or not a string. */
    private static String str(JSONObject o, String key) {
        if (o == null || o.isNull(key)) return "";
        Object v = o.opt(key);
        return v instanceof String ? (String) v : "";
    }

    /** A nested object, or an empty one so every opt* below it falls back to its default. */
    private static JSONObject obj(JSONObject o, String key) {
        JSONObject v = o == null ? null : o.optJSONObject(key);
        return v == null ? new JSONObject() : v;
    }
}
