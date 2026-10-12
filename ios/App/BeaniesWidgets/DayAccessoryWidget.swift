import SwiftUI
import WidgetKit

/// The lock-screen accessories: inline, rectangular, circular. Always the viewer's own day
/// (`my`); no picker. Respects the per-device "Show event titles on the lock screen"
/// setting (`settings.lockScreenTitles`): off → times and first names only. Inline and
/// rectangular show the next calendar item even when it falls on a later day, and then name
/// the day ("Wed 4:30pm piano"); the circular ring is today only.
struct DayAccessoryWidget: Widget {
    let kind = "DayAccessoryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AccessoryProvider()) { entry in
            DayAccessoryView(entry: entry)
        }
        .configurationDisplayName("Next up")
        .description("Today's plans, handoffs and dinner at a glance.")
        .supportedFamilies([.accessoryInline, .accessoryRectangular, .accessoryCircular])
    }
}

struct AccessoryProvider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), state: .ready(SampleSnapshot.make(now: Date())), blocks: .defaults)
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        let now = Date()
        if context.isPreview {
            completion(DayEntry(date: now, state: .ready(SampleSnapshot.make(now: now)), blocks: .defaults))
            return
        }
        let timeline = WidgetTimeline.build(blocks: .defaults, now: now, includePickups: true)
        completion(timeline.entries.first ?? DayEntry(date: now, state: .signedOut, blocks: .defaults))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        completion(WidgetTimeline.build(blocks: .defaults, now: Date(), includePickups: true))
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
            circular(day.day)
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

    /// A ring (done rows / rows) around today's row count, with the bean.
    private func circular(_ day: WSDay) -> some View {
        let total = day.rows.count
        // Progress through the day: a row is done when ticked or over (the child-view rule,
        // which reads as "how much of today is behind me" for everyone).
        let now = entry.date
        let done = day.rows.filter { $0.isDone || $0.isPast(at: now) }.count
        let progress: CGFloat = total > 0 ? CGFloat(done) / CGFloat(total) : 0
        return ZStack {
            Circle()
                .stroke(Color.white.opacity(0.28), lineWidth: 4)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
            VStack(spacing: 0) {
                BeanMark(size: 10)
                Text(String(total))
                    .font(.outfit(size: 26, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            .padding(6)
        }
        .padding(2)
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
