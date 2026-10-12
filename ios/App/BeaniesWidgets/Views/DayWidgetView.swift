import SwiftUI
import WidgetKit

/// The home-screen widget's root: picks the state, then the size.
struct DayWidgetView: View {
    let entry: DayEntry

    @Environment(\.widgetFamily) private var family
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        content
            // The card at the picker's opacity (100 / 70 / 40); the panel inside is untouched.
            .containerBackground(for: .widget) {
                Color.wRaised.opacity(entry.blocks.background.opacity)
            }
    }

    @ViewBuilder private var content: some View {
        let size = WidgetSizeKey(family: family)
        let m = WidgetMetrics(dynamicTypeSize)
        switch entry.state {
        case .signedOut:
            MessageStateView(
                style: .prompt,
                title: String(localized: "widget_open_beanies"),
                line: String(localized: "widget_sign_in_to_see"),
                image: "covering-eyes",
                link: WidgetLinks.url(WidgetLinks.signedOut, size),
                m: m
            )
        case .unreadable:
            refreshState(size: size, m: m)
        case .ready(let snapshot):
            if let resolved = DayResolver.resolve(snapshot, at: entry.date, audience: entry.blocks.audience) {
                Group {
                    if family == .systemSmall {
                        SmallView(snapshot: snapshot, resolved: resolved, blocks: entry.blocks, date: entry.date, m: m)
                    } else {
                        DayLayoutView(
                            snapshot: snapshot,
                            resolved: resolved,
                            blocks: entry.blocks,
                            date: entry.date,
                            size: size,
                            m: m
                        )
                    }
                }
                // Any tap outside an item opens the Nook.
                .widgetURL(WidgetLinks.url(snapshot.links.nook, size))
            } else {
                refreshState(size: size, m: m)
            }
        }
    }

    /// File present but unreadable, undecodable or an unknown version: never "sign in".
    private func refreshState(size: WidgetSizeKey, m: WidgetMetrics) -> some View {
        MessageStateView(
            style: .prompt,
            title: String(localized: "widget_refresh"),
            line: nil,
            image: "covering-eyes",
            link: WidgetLinks.url(WidgetLinks.nookFallback, size),
            m: m
        )
    }
}

/// Medium and large (placement E, round 9b): the 52pt date column, the agenda panel 13pt
/// down with the peek on its edge (the calendar on top, the to-dos section above the
/// footer), then the footer. The large is the same layout, taller. A child session swaps the
/// column for a "<Name>'s day" header and bigger rows.
struct DayLayoutView: View {
    let snapshot: WSSnapshot
    let resolved: ResolvedDay
    let blocks: WidgetBlocks
    let date: Date
    let size: WidgetSizeKey
    let m: WidgetMetrics

    private var isLarge: Bool { size == .large }
    private var child: Bool { resolved.isChild }
    private var insets: EdgeInsets {
        EdgeInsets(top: 8, leading: 10, bottom: isLarge ? 7 : 6, trailing: 9)
    }
    private var rowHeight: CGFloat {
        m.s(child ? (isLarge ? 28 : 26) : (isLarge ? 20 : 19))
    }
    /// The panel's drop below the top padding (13pt; the peek lives there), or the child header.
    private var headerHeight: CGFloat { child ? m.s(38) : 13 }
    private static let panelPadding: CGFloat = 4 + 3

    var body: some View {
        GeometryReader { proxy in
            layout(plan(forHeight: proxy.size.height))
        }
    }

    /// The fill budget is the real widget height (it differs by device) minus the fixed chrome.
    private func plan(forHeight height: CGFloat) -> FillPlan {
        let chrome = insets.top + insets.bottom + headerHeight + Self.panelPadding + m.s(16)
        let spec = FillSpec(
            bodyHeight: Swift.max(0, height - chrome),
            maxRows: isLarge ? (child ? 8 : 9) : (child ? 3 : 5),
            rowHeight: rowHeight,
            subLineHeight: m.s(11),
            taskReserve: isLarge ? 4 : 2,
            hasFooter: true,
            hasDateColumn: !child,
            scale: m.scale
        )
        return WidgetFill.plan(resolved: resolved, blocks: blocks, spec: spec, at: date)
    }

    private func layout(_ plan: FillPlan) -> some View {
        let peek = PeekKind.forDay(resolved, viewer: snapshot.viewer)
        return VStack(alignment: .leading, spacing: 0) {
            if child {
                ChildHeaderView(
                    numeral: resolved.entry.numeral,
                    title: snapshot.labels.childsDay,
                    reservedTrailing: PeekView.width(peek, height: AgendaPanelView.peekHeight) + peek.rightInset,
                    m: m
                )
                .frame(height: headerHeight)
            }
            HStack(alignment: .top, spacing: 8) {
                if !child {
                    DayColumnView(
                        entry: resolved.entry,
                        labels: snapshot.labels,
                        links: snapshot.links,
                        taskCount: plan.taskCount,
                        showAudienceLabel: isLarge && resolved.audience == .my,
                        size: size,
                        m: m
                    )
                    .frame(width: 52)
                    .frame(maxHeight: .infinity, alignment: .top)
                }
                VStack(alignment: .leading, spacing: 0) {
                    AgendaPanelView(
                        plan: plan,
                        labels: snapshot.labels,
                        links: snapshot.links,
                        date: date,
                        peek: peek,
                        child: child,
                        rowHeight: rowHeight,
                        size: size,
                        m: m
                    )
                    .padding(.top, child ? 0 : headerHeight)
                    FooterView(
                        tonight: plan.tonight,
                        asOf: resolved.stale ? StaleLabel.text(snapshot) : nil,
                        later: snapshot.labels.later,
                        nook: snapshot.links.nook,
                        size: size,
                        m: m
                    )
                }
            }
            // Both sizes fill the widget: the panel takes its exact budget, so the to-dos
            // section lands above the footer and the column's count at its foot.
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(insets)
    }
}

/// The child view's header: the numeral beside "<Name>'s day".
struct ChildHeaderView: View {
    let numeral: String
    let title: String
    /// Space kept clear for the peek rising from the panel below.
    let reservedTrailing: CGFloat
    let m: WidgetMetrics

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(numeral)
                .font(.outfit(size: m.s(32), weight: .bold))
                .tracking(-0.02 * m.s(32))
                .monospacedDigit()
                .foregroundStyle(Color.wInk)
                .lineLimit(1)
                .padding(.vertical, -m.s(6))
            Text(title)
                .font(.outfit(size: m.s(20), weight: .bold))
                .foregroundStyle(Color.wInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: reservedTrailing)
        }
    }
}

/// "as of 07:12": `labels.asOf` with {time} from `generatedAt` in the device's short format.
enum StaleLabel {
    static func text(_ snapshot: WSSnapshot) -> String? {
        guard let generated = snapshot.generatedDate else { return nil }
        // A time alone reads as "this morning"; a snapshot from another day names the day.
        // Lowercased so "12:40 AM" matches the rows' "10:15am" style (no-op for zh).
        let when = Calendar.current.isDateInToday(generated)
            ? DateFormatter.localizedString(from: generated, dateStyle: .none, timeStyle: .short).lowercased()
            : generated.formatted(.dateTime.month(.abbreviated).day())
        return snapshot.labels.asOf.replacingOccurrences(of: "{time}", with: when)
    }
}
