import SwiftUI
import WidgetKit

/// The lock-screen accessories: inline, rectangular, circular. Always the viewer's own day
/// (`my`). Respects the per-device "Show event titles on the lock screen" setting
/// (`settings.lockScreenTitles`): off → times and first names only. Inline and rectangular
/// show the next calendar item even when it falls on a later day, and then name the day
/// ("Wed 4:30pm piano"). The circle's picker (`AccessoryConfigIntent`) chooses what it shows.
///
/// The `kind` predates the picker (it was a `StaticConfiguration`) and must never change:
/// WidgetKit keeps placed accessories across the switch by `kind` and hands them the intent's
/// defaults.
struct DayAccessoryWidget: Widget {
    let kind = "DayAccessoryWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: AccessoryConfigIntent.self, provider: AccessoryProvider()) { entry in
            DayAccessoryView(entry: entry)
        }
        .configurationDisplayName("Next up")
        .description("Today's plans, handoffs and dinner at a glance.")
        .supportedFamilies([.accessoryInline, .accessoryRectangular, .accessoryCircular])
    }
}

struct AccessoryProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), state: .ready(SampleSnapshot.make(now: Date())), blocks: .defaults)
    }

    func snapshot(for configuration: AccessoryConfigIntent, in context: Context) async -> DayEntry {
        let now = Date()
        let blocks = WidgetBlocks(configuration)
        if context.isPreview {
            return DayEntry(date: now, state: .ready(SampleSnapshot.make(now: now)), blocks: blocks)
        }
        return WidgetTimeline.build(blocks: blocks, now: now, includePickups: true).entries.first
            ?? DayEntry(date: now, state: .signedOut, blocks: blocks)
    }

    // P2.0 spike step 3: no entries are added for the circle's countdown hour, on purpose.
    // The ring must animate from `ProgressView(timerInterval:)` alone; P2.2 adds each row's
    // `startsAt - 3600` and `startsAt` instants for the time and word swap.
    func timeline(for configuration: AccessoryConfigIntent, in context: Context) async -> Timeline<DayEntry> {
        WidgetTimeline.build(blocks: WidgetBlocks(configuration), now: Date(), includePickups: true)
    }
}

struct DayAccessoryView: View {
    let entry: DayEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .containerBackground(for: .widget) {
                Color.clear
            }
            .widgetURL(link)
    }

    // MARK: state

    private var resolved: (WSSnapshot, ResolvedDay)? {
        guard case .ready(let snapshot) = entry.state,
              let day = DayResolver.resolve(snapshot, at: entry.date, audience: .my)
        else { return nil }
        return (snapshot, day)
    }

    /// The same search the small widget uses (`WidgetFill.nextRow`), with every block on.
    private func nextRow(_ day: ResolvedDay) -> NextRow? {
        WidgetFill.nextRow(day, blocks: entry.blocks, at: entry.date)
    }

    private var isSignedOut: Bool {
        if case .signedOut = entry.state { return true }
        return false
    }

    private var link: URL {
        if let pair = resolved {
            if let next = nextRow(pair.1) { return WidgetLinks.url(next.row.link, .accessory) }
            return WidgetLinks.url(pair.0.links.nook, .accessory)
        }
        if isSignedOut {
            return WidgetLinks.url(WidgetLinks.signedOut, .accessory)
        }
        return WidgetLinks.url(WidgetLinks.nookFallback, .accessory)
    }

    @ViewBuilder private var content: some View {
        if let pair = resolved {
            ready(pair.0, pair.1)
        } else if isSignedOut {
            message(String(localized: "widget_open_beanies"), String(localized: "widget_sign_in_to_see"))
        } else {
            message(String(localized: "widget_refresh"), nil)
        }
    }

    // MARK: views

    @ViewBuilder private func message(_ title: String, _ line: String?) -> some View {
        switch family {
        case .accessoryInline:
            Text(title)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                BeanMark(size: 22)
            }
        default:
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                if let line {
                    Text(line)
                        .font(.system(size: 13))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private func ready(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> some View {
        switch family {
        case .accessoryInline:
            Text(inlineText(snapshot, day))
        case .accessoryCircular:
            circular(snapshot, day)
        default:
            let lines = rectangularLines(snapshot, day)
            VStack(alignment: .leading, spacing: 1) {
                Text(lines.first)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                if !lines.second.isEmpty {
                    Text(lines.second)
                        .font(.system(size: 13))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The next pick-up the viewer does today, else the next calendar item ("4:30pm piano",
    /// "Wed 4:30pm piano"; titles off: "4:30pm Max"), else "Sat 11 · 6 things on today".
    private func inlineText(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> String {
        let nowMs = entry.date.timeIntervalSince1970 * 1000
        if let pickup = day.day.pickups.first(where: { $0.at > nowMs }), !pickup.text.isEmpty {
            return pickup.text
        }
        if let next = nextRow(day) {
            let label = snapshot.settings.lockScreenTitles ? next.row.title : next.row.who
            let text = [when(next), label].filter { !$0.isEmpty }.joined(separator: " ")
            if !text.isEmpty { return text }
        }
        return "\(day.entry.weekdayShort) \(day.entry.numeral) · \(day.day.thingsText)"
    }

    /// Line 1 "<time> <title>", lines 2-3 the handoff line or who. Titles off: time and
    /// first names only, never a title or handoff text. A later day's item names the day.
    private func rectangularLines(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> (first: String, second: String) {
        guard let next = nextRow(day) else {
            return ("\(day.entry.weekdayShort) \(day.entry.numeral)", day.day.thingsText)
        }
        let row = next.row
        let time = when(next)
        if snapshot.settings.lockScreenTitles {
            let first = [time, row.title].filter { !$0.isEmpty }.joined(separator: " ")
            let handoffLine = row.handoff?.line ?? ""
            return (first, handoffLine.isEmpty ? row.who : handoffLine)
        }
        if time.isEmpty { return (row.who, "") }
        return (time, row.who)
    }

    /// The item's time, prefixed with the short weekday when it is on a later day ("Wed 4:30pm",
    /// or "Wed" alone for an untimed trip or birthday).
    private func when(_ next: NextRow) -> String {
        let day = next.laterDay?.weekdayShort ?? ""
        return [day, next.row.time].filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The circle, by the picker's choice. Every option falls back to Next up when it has
    /// nothing of its own to show.
    @ViewBuilder private func circular(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> some View {
        switch entry.blocks.circleShow {
        case .nextUp:
            nextUpCircle(snapshot, day)
        case .nextHandoff, .todosLeft, .thingsLeft:
            // P2.2: Next handoff (car + time + name), To-dos left (count + done ring) and
            // Things left (count + the day's progress ring) need the v3 snapshot fields
            // (`handoffs`, `doneToday`, the circle labels). The spike shows Next up for all.
            nextUpCircle(snapshot, day)
        }
    }

    /// Next up: the next item's time, big, with one word under it (the title's first word,
    /// or who, when titles are off) and a ring that fills over the hour before it starts. A
    /// later day's item names the day above. Untimed (trips, birthdays, all-day): the glyph
    /// in place of the time, and no ring. Nothing left this week: a tick and "all clear".
    private func nextUpCircle(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> some View {
        let next = nextRow(day)
        let start = next.flatMap { next -> Date? in
            guard let startsAt = next.row.startsAt, !next.row.time.isEmpty else { return nil }
            return Date(timeIntervalSince1970: startsAt / 1000)
        }
        return ZStack {
            AccessoryWidgetBackground()
            if let start {
                // Empty before the hour starts, full from the start on. The system animates
                // it on its own, with no timeline entries (spike step 3 proves this).
                ProgressView(
                    timerInterval: start.addingTimeInterval(-3600)...start,
                    countsDown: false,
                    label: { EmptyView() },
                    currentValueLabel: { EmptyView() }
                )
                .progressViewStyle(.circular)
                .widgetAccentable()
            }
            if let next {
                VStack(spacing: 0) {
                    if let later = next.laterDay, !later.weekdayShort.isEmpty {
                        Text(later.weekdayShort)
                            .font(.system(size: 10, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    if start != nil {
                        Text(next.row.time)
                            .font(.outfit(size: 17, weight: .bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    } else {
                        circleGlyph(next.row.kind)
                    }
                    let word = circleWord(next.row, titles: snapshot.settings.lockScreenTitles)
                    if !word.isEmpty {
                        Text(word)
                            .font(.system(size: 11, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
                .padding(7)
            } else {
                VStack(spacing: 1) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 17, weight: .bold))
                        .widgetAccentable()
                    // P2.2: `labels.circleAllClear` from the snapshot replaces this native key.
                    Text(String(localized: "widget_all_clear"))
                        .font(.system(size: 11, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .padding(7)
            }
        }
    }

    /// One word under the circle's time: the title's first word, or who when titles are off,
    /// each falling back to the other.
    private func circleWord(_ row: WSRow, titles: Bool) -> String {
        // P2.2: the v3 snapshot's `row.shortTitle` (an `Intl.Segmenter` first word, right
        // for CJK) and `row.whoFirst` replace these two; v2 snapshots keep this fallback.
        let title = row.title.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
        let who = row.who
        return titles ? (title.isEmpty ? who : title) : (who.isEmpty ? title : who)
    }

    /// An untimed item's glyph in the time's place: the rows' plane and cake (in the
    /// lock-screen tint, not the accent), else the bean.
    @ViewBuilder private func circleGlyph(_ kind: WSRowKind) -> some View {
        switch kind {
        case .trip:
            Image(systemName: "airplane")
                .font(.system(size: 17, weight: .semibold))
        case .birthday:
            Image(systemName: "birthday.cake")
                .font(.system(size: 17, weight: .semibold))
        case .event:
            BeanMark(size: 16)
        }
    }
}

/// The bean silhouette (asset `bean`, template rendering) in the lock-screen tint.
struct BeanMark: View {
    let size: CGFloat

    var body: some View {
        Image("bean")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}
