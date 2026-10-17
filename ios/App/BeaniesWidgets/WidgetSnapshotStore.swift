import Foundation

// ═══════════════════════════════════════════════════════════════════════════════════
// The widget snapshot: a Codable mirror of `src/types/widgetSnapshot.ts` (v2 and v3) and
// the one reader of the file the app writes (`WidgetBridgePlugin.swift`).
//
// ⚠️ CROSS-PLATFORM CONTRACT. The TS file is the source of truth; the committed example is
// `src/utils/__tests__/fixtures/widget-snapshot.v3.json` (`widget-snapshot.v2.json` is the
// older shape this reader still accepts). Every key below must match the TS field name
// exactly. Adding an OPTIONAL field there is safe (unknown keys are ignored here).
// Renaming/removing/retyping a field bumps `WIDGET_SNAPSHOT_VERSION` there and
// `supportedVersions` here in the same change.
//
// v3 (#134) is v2 plus optional fields only: `weather`, the `labels.weatherAsOf` and
// `labels.circle*` strings, `days[].my.handoffs`, `tasks.doneToday`, `rows[].shortTitle` and
// `rows[].whoFirst`. Each is an optional here, and nil means "a v2 file": every renderer that
// reads one has a v2 path (no weather, the circle falls back to Next up).
//
// TOLERANT BY DESIGN. Only `version`, `generatedAt` and `days` are required; every other
// field decodes leniently with a sensible default, and one malformed array element (a row,
// a task, a day) is dropped on its own rather than failing the whole file. A widget that
// shows four good rows beats one that shows "open beanies to refresh" because of a fifth.
// ═══════════════════════════════════════════════════════════════════════════════════

/// Pre-rendered text with an optional emphasised substring ("tonight: **tacos**, Sam cooks").
struct WSText {
    var text: String = ""
    var emphasis: String? = nil
}

/// `tonight`: a WidgetText plus its link.
struct WSTonight {
    var text: String = ""
    var emphasis: String? = nil
    var link: String = ""

    var asText: WSText { WSText(text: text, emphasis: emphasis) }
}

/// What a row in the to-dos section is. `todo` and `list` belong to the `due` switch,
/// `hint` to the `hint` switch.
enum WSTaskKind: String {
    case todo, hint, list
}

/// One row of the to-dos section. The snapshot already orders them (overdue, today,
/// undated, later), whatever the kind.
struct WSTask {
    var id: String = ""
    var kind: WSTaskKind = .todo
    /// `overdue` | `today` | `undated` | `later`. Informational: `items` is already in order.
    var bucket: String = ""
    var title: String = ""
    /// "overdue", "by 5pm", "today", "Thu 16", or '' for an undated task.
    var tag: String = ""
    /// The tag in the accent ("overdue", "today") or in quieter ink (a later day).
    var tagIsAccent = false
    /// The to-do has a due time: the ring is filled.
    var timed = false
    var dot: WSDot? = nil
    var link: String = ""
}

/// The to-dos section of one day.
struct WSTasks {
    var items: [WSTask] = []
    /// How many the snapshot's per-switch cap left out (`due`: to-dos and lists, `hint`: hints).
    var overflowDue = 0
    var overflowHint = 0
    /// "to-dos" or "to-dos and lists".
    var heading: String = ""
    /// Due now (overdue or today, plus undated on "my day"): the date column's count.
    var count = 0
    var countText = WSText()
    /// v3: to-dos completed today among those `count` would count; nil in a v2 file.
    var doneToday: Int? = nil
    var link: String = ""
}

struct WSPickup {
    /// Epoch ms.
    var at: Double = 0
    var text: String = ""
}

/// The coloured initial beside a row, or the family hug icon.
enum WSDot {
    case member(initial: String, color: String, ink: String)
    case family
}

struct WSHandoff {
    var inlineTitle: String? = nil
    var line: String? = nil
    /// `WidgetAvatar` names (father/mother/neutral/boy/girl/dog), drop-off first.
    var avatars: [String] = []
}

/// What a calendar row is. `event` belongs to the `events` switch, `trip` and `birthday`
/// to `comingUp`. An unknown kind (a newer app) paints as a plain event.
enum WSRowKind: String {
    case event, trip, birthday
}

struct WSRow {
    var id: String = ""
    var kind: WSRowKind = .event
    /// Shown only on the day the widget treats as today, never under a look-ahead divider.
    var todayOnly = false
    var time: String = ""
    /// Epoch ms, nil when untimed.
    var startsAt: Double? = nil
    /// Epoch ms, nil when untimed. "Past" is `endsAt < now` on the device clock.
    var endsAt: Double? = nil
    var title: String = ""
    /// A substring of `title` to bold in the accent ("day 3 of 6"); absent or not found = plain.
    var titleEmphasis: String? = nil
    var who: String = ""
    /// v3: the title's first word ("swimming"), the circle's word with titles on.
    var shortTitle: String? = nil
    /// v3: the first assignee's first name ("Max"), the circle's word with titles off.
    var whoFirst: String? = nil
    var dot: WSDot? = nil
    var isDone = false
    var handoff: WSHandoff? = nil
    var link: String = ""

    func isPast(at date: Date) -> Bool {
        guard let endsAt else { return false }
        return endsAt / 1000 < date.timeIntervalSince1970
    }
}

struct WSDay {
    /// The calendar: trips, birthdays, then timed and untimed events.
    var rows: [WSRow] = []
    var tonight: WSTonight? = nil
    /// The to-dos section, built as if this day were today. Empty for a child.
    var tasks = WSTasks()
    var thingsText: String = ""
    var pickups: [WSPickup] = []
    /// v3: the viewer's own drop-offs and pick-ups, ascending (my day only). nil in a v2
    /// file, which the circle's Next handoff treats like an empty list.
    var handoffs: [WSDayHandoff]? = nil
}

/// v3: one of the viewer's own drop-offs or pick-ups, for the circle's Next handoff.
struct WSDayHandoff {
    /// Epoch ms: the activity's start for a drop-off, its end for a pick-up.
    var at: Double = 0
    var kind: WSDayHandoffKind = .dropoff
    /// The first name of the person dropped off or collected; '' when nobody else is on it.
    var name: String = ""
    var link: String = ""
}

enum WSDayHandoffKind: String {
    case dropoff, pickup
}

struct WSDayEntry {
    var ymd: String = ""
    var numeral: String = ""
    var weekday: String = ""
    var month: String = ""
    var weekdayShort: String = ""
    /// "Wed 15": this day's look-ahead divider. "tomorrow" is added at render time from the
    /// device clock, never stored, so a widget that rolled past midnight stays right.
    var dividerDate: String = ""
    var my: WSDay? = nil
    var our: WSDay? = nil
}

/// Labels native composes at render time. The English defaults are used only if the app
/// ever ships a snapshot that omits one (a contract violation), never in normal use.
struct WSLabels {
    var asOf: String = "as of {time}"
    var later: String = "later ›"
    var next: String = "next"
    var tomorrow: String = "tomorrow"
    /// "{n} more": the to-dos section heading when not every task fits.
    var more: String = "{n} more"
    /// The calendar's first line when today is empty and there are tasks.
    var nothingToday: String = "nothing on today"
    var myDay: String = "my day"
    var ourDay: String = "our day"
    var childsDay: String = ""
    var nothingOnToday: String = "nothing on today,"
    var enjoy: String = "enjoy"
    // v3, no English default: nil means a v2 file, and each reader has its own v2 path (no
    // age line; the circle falls back to Next up, whose "all clear" has a native key).
    /// "as of {time}" beside a weather reading old enough to show its age.
    var weatherAsOf: String? = nil
    /// The circle: "left" (Things left), "all done", "all clear" (Next up), "to do".
    var circleLeft: String? = nil
    var circleAllDone: String? = nil
    var circleAllClear: String? = nil
    var circleToDo: String? = nil
}

struct WSLinks {
    var nook: String = WidgetLinks.nookFallback
    var todo: String = WidgetLinks.nookFallback
}

struct WSViewer {
    var memberId: String = ""
    var firstName: String = ""
    var avatar: String = "neutral"
    var isChild = false
}

struct WSSettings {
    var lockScreenTitles = true
}

/// The nine weather glyphs (`WeatherGlyph`, src/types/weather.ts). Each has two bundled
/// images: `wx-<kind>` in full colour (with a dark appearance) and `wx-<kind>-mono`, a
/// template for the tinted, clear and lock-screen renderings.
enum WSWeatherGlyph: String {
    case sunny, partly, cloudy, rain, thunder, snow, fog, night, nightPartly
}

/// v3: one home-zone day of the forecast, already in the family's unit.
struct WSWeatherDay {
    var ymd: String = ""
    var glyph: WSWeatherGlyph = .cloudy
    var high: String = ""
    var low: String = ""
    /// "57° / 49°"
    var range: String = ""
}

/// v3: the home town's weather. The staleness thresholds travel as instants (epoch ms), so
/// this side holds no copy of them; `WidgetWeather` only compares the device clock.
struct WSWeather {
    var fetchedAt: Double = 0
    /// From here the age is shown ("as of 7:40am") and the temperature softens.
    var ageFrom: Double = 0
    /// From here the current temperature is hidden and only the day's range stays.
    var currentUntil: Double = 0
    var currentGlyph: WSWeatherGlyph = .cloudy
    /// "55°"
    var currentTemp: String = ""
    var currentCondition: String = ""
    /// The home-zone today and the days after it, ascending.
    var days: [WSWeatherDay] = []
    /// The home zone's IANA id ("Asia/Singapore"), the zone `days[].ymd` are dated in; nil
    /// in a file from before the field (`WidgetWeather` then falls back to the device zone).
    var zone: String? = nil
}

struct WSSnapshot {
    var version: Int = 2
    var generatedAt: String = ""
    var familyIdTail: String = ""
    var viewer = WSViewer()
    var settings = WSSettings()
    var labels = WSLabels()
    var links = WSLinks()
    /// Today and the next six days, ascending.
    var days: [WSDayEntry] = []
    /// v3: nil when Show Weather is off, no town is set, there is no reading, or the file is v2.
    var weather: WSWeather? = nil

    var generatedDate: Date? { WSDates.parse(generatedAt) }
}

enum WSDates {
    /// JS `toISOString()` ("2026-10-11T07:12:00.000Z"), with or without fractional seconds.
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

// MARK: - Lenient decoding

/// Decodes one array element without letting a malformed element fail the whole array.
private struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

private extension KeyedDecodingContainer {
    /// The value if present and well-typed, else `fallback`.
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key, _ fallback: @autoclosure () -> T) -> T {
        if let value = try? decodeIfPresent(type, forKey: key) { return value }
        return fallback()
    }

    /// The value if present and well-typed, else nil (null, missing and malformed alike).
    func opt<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        try? decodeIfPresent(type, forKey: key)
    }

    /// Every well-formed element; a malformed one is dropped, a missing array is empty.
    func list<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        guard let items = try? decodeIfPresent([Lossy<T>].self, forKey: key) else { return [] }
        return items.compactMap { $0.value }
    }
}

extension WSText: Decodable {
    private enum CodingKeys: String, CodingKey { case text, emphasis }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.lenient(String.self, .text, "")
        emphasis = c.opt(String.self, .emphasis)
    }
}

extension WSTonight: Decodable {
    private enum CodingKeys: String, CodingKey { case text, emphasis, link }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.lenient(String.self, .text, "")
        emphasis = c.opt(String.self, .emphasis)
        link = c.lenient(String.self, .link, "")
    }
}

extension WSTask: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, bucket, title, tag, tagTone, timed, dot, link
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(String.self, .id, UUID().uuidString)
        // An unknown kind (a newer app) paints as a to-do and follows the `due` switch.
        kind = WSTaskKind(rawValue: c.lenient(String.self, .kind, "")) ?? .todo
        bucket = c.lenient(String.self, .bucket, "")
        title = c.lenient(String.self, .title, "")
        tag = c.lenient(String.self, .tag, "")
        tagIsAccent = c.lenient(String.self, .tagTone, "") == "accent"
        timed = c.lenient(Bool.self, .timed, false)
        dot = c.opt(WSDot.self, .dot)
        link = c.lenient(String.self, .link, "")
    }
}

extension WSTasks: Decodable {
    private enum CodingKeys: String, CodingKey { case items, overflow, heading, count, countText, doneToday, link }
    private enum OverflowKeys: String, CodingKey { case due, hint }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.list(WSTask.self, .items)
        if let o = try? c.nestedContainer(keyedBy: OverflowKeys.self, forKey: .overflow) {
            overflowDue = Swift.max(0, (try? o.decode(Int.self, forKey: .due)) ?? 0)
            overflowHint = Swift.max(0, (try? o.decode(Int.self, forKey: .hint)) ?? 0)
        }
        heading = c.lenient(String.self, .heading, "")
        count = c.lenient(Int.self, .count, 0)
        countText = c.lenient(WSText.self, .countText, WSText())
        doneToday = c.opt(Int.self, .doneToday).map { Swift.max(0, $0) }
        link = c.lenient(String.self, .link, "")
    }
}

extension WSPickup: Decodable {
    private enum CodingKeys: String, CodingKey { case at, text }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = c.lenient(Double.self, .at, 0)
        text = c.lenient(String.self, .text, "")
    }
}

extension WSDot: Decodable {
    private enum CodingKeys: String, CodingKey { case kind, initial, color, ink }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = c.lenient(String.self, .kind, "")
        switch kind {
        case "family":
            self = .family
        case "member":
            self = .member(
                initial: c.lenient(String.self, .initial, ""),
                color: c.lenient(String.self, .color, ""),
                ink: c.lenient(String.self, .ink, "")
            )
        default:
            // An unknown kind is dropped (the row keeps no dot), not a failed file.
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "unknown dot kind"
            )
        }
    }
}

extension WSHandoff: Decodable {
    private enum CodingKeys: String, CodingKey { case inlineTitle, line, avatars }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        inlineTitle = c.opt(String.self, .inlineTitle)
        line = c.opt(String.self, .line)
        avatars = c.list(String.self, .avatars)
    }
}

extension WSRow: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, todayOnly, time, startsAt, endsAt, title, titleEmphasis, who, shortTitle, whoFirst
        case dot, isDone, handoff, link
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(String.self, .id, UUID().uuidString)
        kind = WSRowKind(rawValue: c.lenient(String.self, .kind, "")) ?? .event
        todayOnly = c.lenient(Bool.self, .todayOnly, false)
        time = c.lenient(String.self, .time, "")
        startsAt = c.opt(Double.self, .startsAt)
        endsAt = c.opt(Double.self, .endsAt)
        title = c.lenient(String.self, .title, "")
        titleEmphasis = c.opt(String.self, .titleEmphasis)
        who = c.lenient(String.self, .who, "")
        shortTitle = c.opt(String.self, .shortTitle)
        whoFirst = c.opt(String.self, .whoFirst)
        dot = c.opt(WSDot.self, .dot)
        isDone = c.lenient(Bool.self, .isDone, false)
        handoff = c.opt(WSHandoff.self, .handoff)
        link = c.lenient(String.self, .link, "")
    }
}

extension WSDay: Decodable {
    private enum CodingKeys: String, CodingKey {
        case rows, tonight, tasks, thingsText, pickups, handoffs
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rows = c.list(WSRow.self, .rows)
        tonight = c.opt(WSTonight.self, .tonight)
        tasks = c.lenient(WSTasks.self, .tasks, WSTasks())
        thingsText = c.lenient(String.self, .thingsText, "")
        pickups = c.list(WSPickup.self, .pickups)
        // Present (even empty) = a v3 file; absent stays nil.
        handoffs = c.contains(.handoffs) ? c.list(WSDayHandoff.self, .handoffs) : nil
    }
}

extension WSDayHandoff: Decodable {
    private enum CodingKeys: String, CodingKey { case at, kind, name, link }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Required: a handoff with no instant or an unknown kind is dropped on its own.
        at = try c.decode(Double.self, forKey: .at)
        guard let parsed = WSDayHandoffKind(rawValue: c.lenient(String.self, .kind, "")) else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown handoff kind")
        }
        kind = parsed
        name = c.lenient(String.self, .name, "")
        link = c.lenient(String.self, .link, "")
    }
}

extension WSWeatherGlyph {
    /// An unknown glyph (a newer app) paints as cloudy, the web's fallback for an unknown code.
    init(lenient raw: String?) {
        self = raw.flatMap(WSWeatherGlyph.init(rawValue:)) ?? .cloudy
    }
}

extension WSWeatherDay: Decodable {
    private enum CodingKeys: String, CodingKey { case ymd, glyph, high, low, range }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Required: the day is picked by `ymd`, so one without it can never be shown.
        ymd = try c.decode(String.self, forKey: .ymd)
        glyph = WSWeatherGlyph(lenient: c.opt(String.self, .glyph))
        high = c.lenient(String.self, .high, "")
        low = c.lenient(String.self, .low, "")
        range = c.lenient(String.self, .range, "")
    }
}

extension WSWeather: Decodable {
    private enum CodingKeys: String, CodingKey { case fetchedAt, ageFrom, currentUntil, current, days, zone }
    private enum CurrentKeys: String, CodingKey { case glyph, temp, condition }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Required: without the instants the staleness rules cannot be applied, and a
        // reading that cannot be judged is not shown (`weather` becomes nil, nothing else).
        fetchedAt = try c.decode(Double.self, forKey: .fetchedAt)
        ageFrom = try c.decode(Double.self, forKey: .ageFrom)
        currentUntil = try c.decode(Double.self, forKey: .currentUntil)
        let current = try c.nestedContainer(keyedBy: CurrentKeys.self, forKey: .current)
        currentGlyph = WSWeatherGlyph(lenient: current.opt(String.self, .glyph))
        currentTemp = current.lenient(String.self, .temp, "")
        currentCondition = current.lenient(String.self, .condition, "")
        days = c.list(WSWeatherDay.self, .days)
        zone = c.opt(String.self, .zone)
    }
}

extension WSDayEntry: Decodable {
    private enum CodingKeys: String, CodingKey {
        case ymd, numeral, weekday, month, weekdayShort, dividerDate, my, our
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Required: a day the widget cannot place on the calendar is useless.
        ymd = try c.decode(String.self, forKey: .ymd)
        numeral = c.lenient(String.self, .numeral, "")
        weekday = c.lenient(String.self, .weekday, "")
        month = c.lenient(String.self, .month, "")
        weekdayShort = c.lenient(String.self, .weekdayShort, "")
        dividerDate = c.lenient(String.self, .dividerDate, "")
        my = c.opt(WSDay.self, .my)
        our = c.opt(WSDay.self, .our)
    }
}

extension WSLabels: Decodable {
    private enum CodingKeys: String, CodingKey {
        case asOf, later, next, tomorrow, more, nothingToday, myDay, ourDay, childsDay
        case nothingOnToday, enjoy, weatherAsOf, circleLeft, circleAllDone, circleAllClear, circleToDo
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = WSLabels()
        asOf = c.lenient(String.self, .asOf, d.asOf)
        later = c.lenient(String.self, .later, d.later)
        next = c.lenient(String.self, .next, d.next)
        tomorrow = c.lenient(String.self, .tomorrow, d.tomorrow)
        more = c.lenient(String.self, .more, d.more)
        nothingToday = c.lenient(String.self, .nothingToday, d.nothingToday)
        myDay = c.lenient(String.self, .myDay, d.myDay)
        ourDay = c.lenient(String.self, .ourDay, d.ourDay)
        childsDay = c.lenient(String.self, .childsDay, d.childsDay)
        nothingOnToday = c.lenient(String.self, .nothingOnToday, d.nothingOnToday)
        enjoy = c.lenient(String.self, .enjoy, d.enjoy)
        weatherAsOf = c.opt(String.self, .weatherAsOf)
        circleLeft = c.opt(String.self, .circleLeft)
        circleAllDone = c.opt(String.self, .circleAllDone)
        circleAllClear = c.opt(String.self, .circleAllClear)
        circleToDo = c.opt(String.self, .circleToDo)
    }
}

extension WSLinks: Decodable {
    private enum CodingKeys: String, CodingKey { case nook, todo }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let nookLink = c.lenient(String.self, .nook, WidgetLinks.nookFallback)
        nook = nookLink
        todo = c.lenient(String.self, .todo, nookLink)
    }
}

extension WSViewer: Decodable {
    private enum CodingKeys: String, CodingKey { case memberId, firstName, avatar, isChild }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        memberId = c.lenient(String.self, .memberId, "")
        firstName = c.lenient(String.self, .firstName, "")
        avatar = c.lenient(String.self, .avatar, "neutral")
        isChild = c.lenient(Bool.self, .isChild, false)
    }
}

extension WSSettings: Decodable {
    private enum CodingKeys: String, CodingKey { case lockScreenTitles }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lockScreenTitles = c.lenient(Bool.self, .lockScreenTitles, true)
    }
}

extension WSSnapshot: Decodable {
    private enum CodingKeys: String, CodingKey {
        case version, generatedAt, familyIdTail, viewer, settings, labels, links, days, weather
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The three required fields: without them there is nothing trustworthy to paint.
        version = try c.decode(Int.self, forKey: .version)
        generatedAt = try c.decode(String.self, forKey: .generatedAt)
        let dayItems = try c.decode([Lossy<WSDayEntry>].self, forKey: .days)
        days = dayItems.compactMap { $0.value }
        familyIdTail = c.lenient(String.self, .familyIdTail, "")
        viewer = c.lenient(WSViewer.self, .viewer, WSViewer())
        settings = c.lenient(WSSettings.self, .settings, WSSettings())
        labels = c.lenient(WSLabels.self, .labels, WSLabels())
        links = c.lenient(WSLinks.self, .links, WSLinks())
        weather = c.opt(WSWeather.self, .weather)
    }
}

// MARK: - Reader

/// What a read produced. The three outcomes are never conflated: in particular a locked
/// device (the file exists but cannot be read before first unlock) is `.unreadable`, never
/// `.signedOut`, because only `fileExists` decides signed-out.
enum SnapshotReadOutcome {
    case ready(WSSnapshot)
    case signedOut
    /// The token relayed to the app (and so to the `home-widget` firehose).
    case unreadable(String)
}

enum WidgetSnapshotStore {
    /// Must match `App.entitlements`, `BeaniesWidgets.entitlements`, the portal identifier
    /// and `WidgetBridgePlugin.swift`. `check-ios-sources.mjs` Guard 2 enforces the pair.
    private static let appGroup = "group.family.beanies.app"

    /// Where the app writes the snapshot inside the group container (Guard 2 pair).
    private static let snapshotPath = "Widgets/snapshot.json"

    /// App Group UserDefaults key the plugin reads and clears on the next publish (Guard 2 pair).
    private static let readOutcomeKey = "widget-read-outcome"

    /// The schema versions this build understands (`WIDGET_SNAPSHOT_READABLE_VERSIONS`); the
    /// upper bound is the one the app writes (`WIDGET_SNAPSHOT_VERSION`).
    static let supportedVersions = 2...3

    /// Read the snapshot. Never throws, never crashes.
    static func read() -> SnapshotReadOutcome {
        let fileManager = FileManager.default
        guard let root = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            // The extension is missing the App Group entitlement. Nothing can be read OR
            // recorded; the token keeps the `read_failed` prefix the app side expects.
            return .unreadable("read_failed;no_container")
        }
        let file = root.appendingPathComponent(snapshotPath)
        guard fileManager.fileExists(atPath: file.path) else { return .signedOut }

        let data: Data
        do {
            data = try Data(contentsOf: file)
        } catch {
            // Includes a before-first-unlock read of a protected file. Heals on its own;
            // the timeline retries in 15 minutes.
            return record("read_failed")
        }
        return decode(data)
    }

    /// Decode bytes into an outcome. Separate from `read()` so the logic is testable.
    static func decode(_ data: Data) -> SnapshotReadOutcome {
        struct VersionProbe: Decodable { let version: Int }
        let decoder = JSONDecoder()

        guard let probe = try? decoder.decode(VersionProbe.self, from: data) else {
            return record("decode_failed;v=0")
        }
        guard supportedVersions.contains(probe.version) else {
            // A newer (or a much older) app wrote a shape this extension does not know. Do not
            // guess; the token names the version it saw, so the firehose shows the mismatch.
            return record("decode_failed;v=\(probe.version)")
        }
        guard let snapshot = try? decoder.decode(WSSnapshot.self, from: data) else {
            return record("decode_failed;v=\(probe.version)")
        }
        return .ready(snapshot)
    }

    /// Leave the failure token for the app to relay (later token wins), then report it.
    private static func record(_ token: String) -> SnapshotReadOutcome {
        UserDefaults(suiteName: appGroup)?.set(token, forKey: readOutcomeKey)
        return .unreadable(token)
    }
}
