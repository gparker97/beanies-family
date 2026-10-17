import SwiftUI
import WidgetKit

/// The lock-screen accessories: inline, rectangular, circular. Always the viewer's own day
/// (`my`). Respects the per-device "Show event titles on the lock screen" setting
/// (`settings.lockScreenTitles`): off → times and first names only. Inline and rectangular
/// show the next calendar item even when it falls on a later day, and then name the day
/// ("Wed 4:30pm piano"). Inline and rectangular also carry the current temperature when
/// there is one (#134); the circle never does. The circle's picker (`AccessoryConfigIntent`)
/// chooses what it shows (`WidgetFill.circle`).
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
        return WidgetTimeline.build(blocks: blocks, now: now, lockScreen: true).entries.first
            ?? DayEntry(date: now, state: .signedOut, blocks: blocks)
    }

    // The countdown ring animates from `ProgressView(timerInterval:)` alone; the timeline adds
    // each item's and handoff's start minus an hour and the start itself, so the face is
    // redrawn as each countdown begins and ends (`WidgetTimeline.entryDates`).
    func timeline(for configuration: AccessoryConfigIntent, in context: Context) async -> Timeline<DayEntry> {
        WidgetTimeline.build(blocks: WidgetBlocks(configuration), now: Date(), lockScreen: true)
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
            if family == .accessoryCircular {
                return WidgetLinks.url(circleLink(circlePick(pair.0, pair.1), pair.0), .accessory)
            }
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
                if isSignedOut {
                    // Signed out: the bean and "sign in" (native: no snapshot exists).
                    VStack(spacing: 2) {
                        BeanMark(size: 18)
                        circleWordText(String(localized: "widget_sign_in"))
                    }
                    .padding(7)
                } else {
                    BeanMark(size: 22)
                }
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
            inlineText(snapshot, day)
        case .accessoryCircular:
            circular(snapshot, day)
        default:
            let lines = rectangularLines(snapshot, day)
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(lines.first)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // The current temperature at line one's trailing edge; never the range.
                    if let temp = currentWeather(snapshot)?.temp {
                        Text(temp)
                            .font(.system(size: 15, weight: .semibold))
                            .monospacedDigit()
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                if !lines.second.isEmpty {
                    Text(lines.second)
                        .font(.system(size: 13))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The reading as of this entry, or nil (`WidgetWeather`: off, no town, none for today, v2).
    private func currentWeather(_ snapshot: WSSnapshot) -> WeatherGlance? {
        WidgetWeather.glance(snapshot.weather, labels: snapshot.labels, at: entry.date)
    }

    /// The inline line, led by the weather glyph and the current temperature when there is
    /// one ("☁ 27° · 4:30pm piano"). Concatenated `Text`, the only way an inline accessory
    /// draws an image beside its words. The glyph is an SF Symbol, not the wx asset: an image
    /// inside `Text` cannot be resized (no `.resizable()`/`.frame`), so the 24x24 asset would
    /// draw at its intrinsic size in the ~15pt line, while a symbol scales with the font.
    private func inlineText(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> Text {
        let line = Text(inlineLine(snapshot, day))
        guard let weather = currentWeather(snapshot), let temp = weather.temp else { return line }
        return Text(Image(systemName: weather.glyph.symbolName)) + Text(" \(temp) · ") + line
    }

    /// The next pick-up the viewer does today, else the next calendar item ("4:30pm piano",
    /// "Wed 4:30pm piano"; titles off: "4:30pm Max"), else "Sat 11 · 6 things on today".
    private func inlineLine(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> String {
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

    // MARK: the circle

    /// What the circle shows (`WidgetFill.circle`): the picker's choice, or Next up when the
    /// choice has nothing of its own. Read by both the face and the tap target.
    private func circlePick(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> CirclePick {
        WidgetFill.circle(day, labels: snapshot.labels, show: entry.blocks.circleShow, blocks: entry.blocks, at: entry.date)
    }

    /// The circle's tap target: the item or the handoff's activity, the to-dos page, or the Nook.
    private func circleLink(_ pick: CirclePick, _ snapshot: WSSnapshot) -> String {
        switch pick {
        case .nextUp(let next): return next?.row.link ?? snapshot.links.nook
        case .nextHandoff(let handoff): return handoff.link
        case .todosLeft: return snapshot.links.todo
        case .thingsLeft: return snapshot.links.nook
        }
    }

    /// The circle, by `circlePick`. The four faces share one layout (`circleFace`: the ring,
    /// then an optional line above, the lead, and a word under it).
    @ViewBuilder private func circular(_ snapshot: WSSnapshot, _ day: ResolvedDay) -> some View {
        switch circlePick(snapshot, day) {
        case .nextUp(let next):
            nextUpCircle(snapshot, next)
        case .nextHandoff(let handoff):
            // Car + time + the child's name, counting down over the hour before it.
            let at = Date(timeIntervalSince1970: handoff.at / 1000)
            circleFace(ring: .countdown(to: at), above: nil, word: handoff.name) {
                VStack(spacing: 0) {
                    circleSymbol("car.fill")
                    circleBig(WidgetClock.time(at))
                }
            }
        case .todosLeft(let count, let done):
            // Checkbox + how many are due now + "to do"; the ring is done today of the total.
            circleFace(
                ring: .progress(Double(done) / Double(count + done)),
                above: nil,
                word: snapshot.labels.circleToDo
            ) {
                VStack(spacing: 0) {
                    circleSymbol("checkmark.square")
                    circleBig(String(count))
                }
            }
        case .thingsLeft(let left, let total):
            // Calendar + how many are still to come + "left"; the ring is how much of today is
            // behind (the old circle's ring). None left: a tick and "all done".
            let progress = Double(total - left) / Double(total)
            if left == 0 {
                circleFace(ring: .progress(progress), above: nil, word: snapshot.labels.circleAllDone) {
                    circleTick()
                }
            } else {
                circleFace(ring: .progress(progress), above: nil, word: snapshot.labels.circleLeft) {
                    VStack(spacing: 0) {
                        circleSymbol("calendar")
                        circleBig(String(left))
                    }
                }
            }
        }
    }

    /// Next up: the next item's time, big, with one word under it (`WidgetFill.circleWord`) and
    /// a ring that fills over the hour before it starts. A later day's item names the day
    /// above. Untimed (trips, birthdays, all-day): the glyph in place of the time, and no ring.
    /// Nothing left this week: a tick and "all clear" (the native key only for a v2 snapshot).
    @ViewBuilder private func nextUpCircle(_ snapshot: WSSnapshot, _ next: NextRow?) -> some View {
        if let next {
            let start: Date? = {
                guard let startsAt = next.row.startsAt, !next.row.time.isEmpty else { return nil }
                return Date(timeIntervalSince1970: startsAt / 1000)
            }()
            let ring: CircleRing = start.map { CircleRing.countdown(to: $0) } ?? .absent
            circleFace(
                ring: ring,
                above: next.laterDay?.weekdayShort,
                word: WidgetFill.circleWord(next.row, titles: snapshot.settings.lockScreenTitles)
            ) {
                if start != nil {
                    circleBig(next.row.time)
                } else {
                    circleGlyph(next.row.kind)
                }
            }
        } else {
            circleFace(
                ring: .absent,
                above: nil,
                word: snapshot.labels.circleAllClear ?? String(localized: "widget_all_clear")
            ) {
                circleTick()
            }
        }
    }

    /// The ring behind a face.
    private enum CircleRing {
        /// No ring (an untimed item, "all clear").
        case absent
        /// Empty before the final hour, full at the instant (`ProgressView(timerInterval:)`).
        case countdown(to: Date)
        /// A fixed share, 0...1.
        case progress(Double)
    }

    /// The one circle layout: the background, the ring, then (top to bottom) the optional
    /// short line above, the lead (a time, a count, a glyph or a tick) and the word under it.
    private func circleFace<Lead: View>(
        ring: CircleRing, above: String?, word: String?, @ViewBuilder lead: () -> Lead
    ) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            circleRing(ring)
            VStack(spacing: 0) {
                if let above, !above.isEmpty {
                    Text(above)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                lead()
                if let word, !word.isEmpty {
                    circleWordText(word)
                }
            }
            .padding(7)
        }
    }

    @ViewBuilder private func circleRing(_ ring: CircleRing) -> some View {
        switch ring {
        case .absent:
            EmptyView()
        case .countdown(let start):
            // Empty before the hour starts, full from the start on. The system animates it on
            // its own between timeline entries.
            ProgressView(
                timerInterval: start.addingTimeInterval(-3600)...start,
                countsDown: false,
                label: { EmptyView() },
                currentValueLabel: { EmptyView() }
            )
            .progressViewStyle(.circular)
            .widgetAccentable()
        case .progress(let value):
            // The old circle's hand-drawn ring: a faint track and the share in the accent.
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.28), lineWidth: 4)
                Circle()
                    .trim(from: 0, to: CGFloat(Swift.min(1, Swift.max(0, value))))
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .widgetAccentable()
            }
            .padding(2)
        }
    }

    /// The big line: a time or a count.
    private func circleBig(_ text: String) -> some View {
        Text(text)
            .font(.outfit(size: 17, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }

    /// The small word under the lead.
    private func circleWordText(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }

    /// The option's small symbol above a time or a count (car, checkbox, calendar).
    private func circleSymbol(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 10, weight: .semibold))
    }

    /// The "nothing left" tick, in the accent.
    private func circleTick() -> some View {
        Image(systemName: "checkmark")
            .font(.system(size: 17, weight: .bold))
            .widgetAccentable()
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
