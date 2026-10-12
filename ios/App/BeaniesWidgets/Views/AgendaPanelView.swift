import SwiftUI
import WidgetKit

/// The agenda panel (medium and large), in two sections that are always in the same place
/// (round 9b): the calendar from the top (today's rows or the "nothing on today" line, then
/// the look-ahead days under their dividers) and the to-dos section directly above the
/// footer. Only what `WidgetFill` placed is here. The peek holds the panel's top-right edge.
struct AgendaPanelView: View {
    let plan: FillPlan
    let labels: WSLabels
    let links: WSLinks
    let date: Date
    let peek: PeekKind
    let child: Bool
    let rowHeight: CGFloat
    let size: WidgetSizeKey
    let m: WidgetMetrics

    @Environment(\.widgetRenderingMode) private var renderingMode

    static let peekHeight: CGFloat = 22

    /// The widest visible time in this widget (min 31; the child view's bigger type, min 62).
    /// Trip and birthday rows put a glyph there instead, so they never widen it.
    private var timeWidth: CGFloat {
        let times = plan.calendar.compactMap { item -> String? in
            if case .row(let row) = item, !row.time.isEmpty { return row.time }
            return nil
        }
        if child {
            return Swift.max(m.s(62), TextMeasure.width(of: times, fontName: WidgetFontName.outfitBold, size: m.s(19)))
        }
        return Swift.max(m.s(31), TextMeasure.width(of: times, fontName: WidgetFontName.outfitSemiBold, size: m.s(11)))
    }

    var body: some View {
        let timeColumn = timeWidth
        VStack(alignment: .leading, spacing: 0) {
            if plan.relaxed {
                MessageStateView(
                    style: .relaxed,
                    title: labels.nothingOnToday,
                    line: labels.enjoy,
                    image: "family-hug",
                    m: m
                )
                .frame(height: m.s(WidgetFill.messageHeight))
            }
            if let nothing = plan.nothingLine {
                Text(nothingText(nothing))
                    .font(.caveat(size: m.s(16)))
                    .foregroundStyle(Color.wAccent)
                    .lineLimit(1)
                    .frame(height: m.s(WidgetFill.nothingLineHeight), alignment: .leading)
            }
            ForEach(Array(plan.calendar.enumerated()), id: \.offset) { pair in
                calendarItem(pair.element, timeColumn: timeColumn)
            }
            Spacer(minLength: 0)
            if let section = plan.taskSection, !plan.tasks.isEmpty {
                TaskSectionView(
                    section: section,
                    tasks: plan.tasks,
                    moreCount: plan.moreTasks,
                    labels: labels,
                    fallbackLink: links.todo,
                    leadWidth: timeColumn,
                    rowHeight: rowHeight,
                    size: size,
                    m: m
                )
            }
        }
        .padding(EdgeInsets(top: 4, leading: 6, bottom: 3, trailing: 6))
        // The panel fills its exact budget on both sizes, so the to-dos section sits on the
        // footer and the room between it and the calendar stays empty.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(renderingMode == .fullColor ? Color.wPanel : Color.primary.opacity(0.08))
        }
        .overlay(alignment: .topTrailing) {
            PeekView(kind: peek, height: Self.peekHeight)
                .offset(x: -peek.rightInset, y: -(Self.peekHeight - PeekView.overlap))
        }
    }

    /// "nothing on today" when tasks wait underneath, else "nothing on today, enjoy".
    private func nothingText(_ line: NothingLine) -> String {
        switch line {
        case .withTasks: return labels.nothingToday
        case .clear: return "\(labels.nothingOnToday) \(labels.enjoy)"
        }
    }

    @ViewBuilder private func calendarItem(_ item: CalendarItem, timeColumn: CGFloat) -> some View {
        switch item {
        case .divider(let entry, let isTomorrow):
            DayDividerView(
                date: entry.dividerDate,
                tomorrow: isTomorrow ? labels.tomorrow : nil,
                m: m
            )
        case .row(let row):
            AgendaRowView(
                row: row,
                past: row.isPast(at: date),
                showInlineHandoff: plan.inlineHandoffs,
                timeWidth: timeColumn,
                height: rowHeight,
                child: child,
                size: size,
                m: m
            )
            if plan.subLineIds.contains(row.id), let handoff = row.handoff, let line = handoff.line {
                HandoffSubLineView(
                    handoff: handoff,
                    line: line,
                    timeWidth: timeColumn,
                    link: row.link,
                    size: size,
                    m: m,
                    spacing: child ? m.s(10) : 6
                )
            }
        }
    }
}

/// The footer under the panel: "tonight: **tacos**, Sam cooks" (meals block) or, when the
/// snapshot is stale, "as of 07:12", and "later ›" (the Nook) on the right.
struct FooterView: View {
    let tonight: WSTonight?
    let asOf: String?
    let later: String
    let nook: String
    let size: WidgetSizeKey
    let m: WidgetMetrics

    var body: some View {
        HStack(spacing: 8) {
            leading
            Spacer(minLength: 0)
            Link(destination: WidgetLinks.url(nook, size)) {
                Text(later)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkFaint)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .frame(height: m.s(16), alignment: .bottom)
    }

    @ViewBuilder private var leading: some View {
        if let tonight, let asOf {
            // Stale beats dinner: drop "tonight" rather than squeeze both.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    tonightView(tonight)
                    asOfView(asOf)
                }
                asOfView(asOf)
            }
        } else if let asOf {
            asOfView(asOf)
        } else if let tonight {
            tonightView(tonight)
        }
    }

    private func tonightView(_ tonight: WSTonight) -> some View {
        Link(destination: WidgetLinks.url(tonight.link.isEmpty ? nook : tonight.link, size)) {
            WidgetTextView(
                text: tonight.asText,
                font: .sys(size: m.s(11)),
                color: .wInkSoft,
                emphasisFont: .outfit(size: m.s(11), weight: .bold),
                emphasisColor: .wInk
            )
            .lineLimit(1)
        }
    }

    private func asOfView(_ text: String) -> some View {
        Text(text)
            .font(.sys(size: m.s(11), weight: .medium))
            .foregroundStyle(Color.wInkFaint)
            .lineLimit(1)
            .fixedSize()
    }
}
