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
 * Swift mirror is ios/App/BeaniesWidgets/WidgetSnapshotStore.swift and the committed example is
 * src/utils/__tests__/fixtures/widget-snapshot.v2.json. Every field is read with an opt* default
 * so an OPTIONAL field added on the TS side is safe here (unknown keys are ignored). A rename,
 * removal or retype bumps WIDGET_SNAPSHOT_VERSION, and {@link WidgetSnapshotStore} then shows
 * "open beanies to refresh" for a version it does not know rather than guessing.
 *
 * Native only paints: there is no audience decision, no translation and no colour computation
 * in any class here.
 */
final class WidgetSnapshot {

    /** Mirrors WIDGET_SNAPSHOT_VERSION in src/types/widgetSnapshot.ts. */
    static final int VERSION = 2;

    final int version;
    final String generatedAt;
    final String familyIdTail;
    final Viewer viewer;
    final boolean lockScreenTitles;
    final Labels labels;
    final Links links;
    /** Today and the six days after it as of {@link #generatedAt}, ascending. */
    final List<DayEntry> days;

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
