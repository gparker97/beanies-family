import SwiftUI
import WidgetKit

/// The agenda panel (medium and large), in two sections that are always in the same place
/// (round 9b): the calendar from the top (today's rows or the "nothing on today" line, then
/// the look-ahead days under their dividers) and the to-dos section directly above the
/// footer. Only what `WidgetFill` placed is here. The peek holds the panel's top-right edge.
///
/// The To-dos layout (`plan.layout == .todos`) draws the to-dos section FIRST, in its groups and
/// at its Automatic step, then the calendar ("next up" over today's events) in the room left.
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

    /// The panel's padding around its rows. `DayLayoutView` takes the sides off the panel's
    /// width for the To-dos layout's title check.
    static let contentInsets = EdgeInsets(top: 4, leading: 6, bottom: 3, trailing: 6)

    /// The widest visible time in this widget (min 31; the child view's bigger type, min 62).
    /// Trip and birthday rows put a glyph there instead, so they never widen it.
    private var timeWidth: CGFloat {
        let times = plan.calendar.compactMap { item -> String? in
            if case .row(let row) = item, !row.time.isEmpty { return row.time }
            return nil
        }
        return Self.timeColumnWidth(times, child: child, scale: m.scale)
    }

    /// The time column for `times` at `scale`. Also `WidgetFill`'s widest-case lead column for
    /// the To-dos layout's title check, before the calendar is placed.
    static func timeColumnWidth(_ times: [String], child: Bool, scale: CGFloat) -> CGFloat {
        if child {
            return Swift.max(62 * scale, TextMeasure.width(of: times, fontName: WidgetFontName.outfitBold, size: 19 * scale))
        }
        return Swift.max(31 * scale, TextMeasure.width(of: times, fontName: WidgetFontName.outfitSemiBold, size: 11 * scale))
    }

    var body: some View {
        let timeColumn = timeWidth
        VStack(alignment: .leading, spacing: 0) {
            // With no tasks (all clear) the plan still sets the section: its heading row is drawn
            // alone, over the relaxed block or the one-line all clear.
            if plan.layout == .todos, let section = plan.taskSection {
                todosSection(section, timeColumn: timeColumn)
            }
            if plan.relaxed {
                MessageStateView(
                    style: .relaxed,
                    title: plan.layout == .todos ? WidgetFill.allClearTitle(labels) : labels.nothingOnToday,
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
            if let heading = plan.eventsHeading {
                DayDividerView(date: heading, tomorrow: nil, m: m, dateColor: Color.wInkSoft)
            }
            ForEach(Array(plan.calendar.enumerated()), id: \.offset) { pair in
                calendarItem(pair.element, timeColumn: timeColumn)
            }
            Spacer(minLength: 0)
            if plan.layout == .day, let section = plan.taskSection, !plan.tasks.isEmpty {
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
        .padding(Self.contentInsets)
        // The panel fills its exact budget on both sizes, so the to-dos section sits on the
        // footer and the room between it and the calendar stays empty (in the To-dos layout,
        // the room under the calendar).
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

    /// "nothing on today" when tasks wait underneath, else "nothing on today, enjoy"; the
    /// To-dos layout's "all clear, enjoy" over the Upcoming events extra.
    private func nothingText(_ line: NothingLine) -> String {
        switch line {
        case .withTasks: return labels.nothingToday
        case .clear: return "\(labels.nothingOnToday) \(labels.enjoy)"
        case .allClear: return "\(WidgetFill.allClearTitle(labels)) \(labels.enjoy)"
        }
    }

    /// The To-dos layout's section: the heading at Standard with the count on its right ("N
    /// more" moves to the footer), the groups and rows at the plan's step. The fill charged
    /// `rowHeight x taskStep` per row, so that is the height drawn. The lead column does not
    /// step (as on Android): it is the width the title check measured with (`taskLeadWidth`),
    /// else the calendar's time column. The stepped glyph still fits in it.
    private func todosSection(_ section: WSTasks, timeColumn: CGFloat) -> some View {
        let rows = m.stepped(plan.taskStep)
        return TaskSectionView(
            section: section,
            tasks: plan.tasks,
            moreCount: 0,
            labels: labels,
            fallbackLink: links.todo,
            leadWidth: plan.taskLeadWidth ?? timeColumn,
            rowHeight: rowHeight * plan.taskStep,
            size: size,
            m: m,
            groups: plan.taskGroups,
            headingCount: plan.taskHeadingCount,
            rowMetrics: rows
        )
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
/// snapshot is stale, "as of 07:12", and on the right "later ›" (the calendar on today) or, in
/// the To-dos layout, "{n} more" / "all to-dos ›" (the To-Dos page).
struct FooterView: View {
    let tonight: WSTonight?
    let asOf: String?
    /// nil or empty draws nothing on the right.
    let trailing: String?
    let trailingLink: String
    /// The calendar on today: the fallback for a tonight line without a link.
    let nook: String
    let size: WidgetSizeKey
    let m: WidgetMetrics

    var body: some View {
        HStack(spacing: 8) {
            leading
            Spacer(minLength: 0)
            if let trailing, !trailing.isEmpty {
                Link(destination: WidgetLinks.url(trailingLink, size)) {
                    Text(trailing)
                        .font(.sys(size: m.s(11), weight: .medium))
                        .foregroundStyle(Color.wInkFaint)
                        .lineLimit(1)
                        .fixedSize()
                }
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
