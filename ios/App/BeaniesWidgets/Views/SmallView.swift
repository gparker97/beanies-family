import SwiftUI
import WidgetKit

/// The small widget (158pt): short weekday + numeral, the peek sitting on the panel, then
/// the handwritten count line and the next item. On a quiet day the next item comes from a
/// later day, and the day is named ("next · Wed 15"). One tap target (`widgetURL`, set by
/// the caller): small widgets cannot hold `Link`s.
///
/// Weather (#134): while there is a current temperature, the header's right side shows the
/// glyph and the temperature in the peek's place, and the panel has no peek. The peek comes
/// back with no reading, or once the reading is past `currentUntil` (the small widget has no
/// room for a range).
///
/// The To-dos layout: the header's right side holds `tasks.countText` in place of the weather
/// or the peek (both come back, exactly as in Your day, when the count is empty: only undated
/// or later to-dos); the panel holds the to-dos in the snapshot's order at Standard size with
/// no group headings, then "{n} more"; no extras. The caller's `widgetURL` opens the To-Dos page.
struct SmallView: View {
    let snapshot: WSSnapshot
    let resolved: ResolvedDay
    /// The effective switches (`WidgetFill.effective`), not the stored ones.
    let blocks: WidgetBlocks
    let layout: WidgetLayout
    let weather: WeatherGlance?
    let date: Date
    let m: WidgetMetrics

    @Environment(\.widgetRenderingMode) private var renderingMode

    static let peekHeight: CGFloat = 28

    var body: some View {
        let entry = resolved.entry
        let day = resolved.day
        let peek = PeekKind.forDay(resolved, viewer: snapshot.viewer)
        let next = WidgetFill.nextRow(resolved, blocks: blocks, at: date)
        // Only a reading with a current temperature takes the peek's place.
        let current = weather?.temp == nil ? nil : weather
        // The count takes the weather's or the peek's slot only when there is one to show.
        let showCount = layout == .todos && !day.tasks.countText.text.isEmpty

        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(entry.weekdayShort)
                        .font(.outfit(size: m.s(14), weight: .bold))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(1)
                    Text(entry.numeral)
                        .font(.outfit(size: m.s(28), weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Color.wInk)
                        .lineLimit(1)
                }
                .cardTile(blocks.background, outset: EdgeInsets(top: 0, leading: 6, bottom: 2, trailing: 6))
                if showCount {
                    Spacer(minLength: 4)
                    todosCount(day.tasks.countText)
                } else if let current, let temp = current.temp {
                    Spacer(minLength: 4)
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        WeatherGlyphView(glyph: current.glyph, size: m.s(16))
                            // Sit the glyph on the temperature's baseline, a touch below its middle.
                            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + m.s(5) }
                        Text(temp)
                            .font(.outfit(size: m.s(15), weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(current.aged ? Color.wInkSoft : Color.wInk)
                            .lineLimit(1)
                    }
                    .fixedSize()
                    .cardTile(blocks.background, outset: EdgeInsets(top: 0, leading: 4, bottom: 2, trailing: 4))
                } else {
                    // Keep the header clear of the peek.
                    Spacer(minLength: PeekView.width(peek, height: Self.peekHeight) + peek.rightInset)
                }
            }
            .frame(height: m.s(38), alignment: .leading)

            panel(day: day, next: next)
                .overlay(alignment: .topTrailing) {
                    if current == nil && !showCount {
                        PeekView(kind: peek, height: Self.peekHeight)
                            .offset(x: -peek.rightInset, y: -(Self.peekHeight - PeekView.overlap))
                    }
                }

            if resolved.stale, let asOf = StaleLabel.text(snapshot) {
                Text(asOf)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkFaint)
                    .lineLimit(1)
                    .cardTile(blocks.background, outset: EdgeInsets(top: 1, leading: 6, bottom: 1, trailing: 6))
                    .padding(.top, 3)
            }
        }
        .padding(EdgeInsets(top: 6, leading: 10, bottom: 8, trailing: 9))
    }

    /// The relaxed state only when the calendar is on and the whole week ahead is clear.
    private func panel(day: WSDay, next: NextRow?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if layout == .todos {
                todosContent(day: day)
            } else if blocks.events && next == nil
                && WidgetFill.shownRows(day.rows, blocks: blocks, today: true).isEmpty {
                MessageStateView(
                    style: .relaxed,
                    title: snapshot.labels.nothingOnToday,
                    line: snapshot.labels.enjoy,
                    image: "family-hug",
                    m: m
                )
            } else {
                // The small widget has no fill budget (a fixed set of lines), so a bigger Text size
                // drops lines in order of least value before anything would clip: the "next" label,
                // then the count line. `ViewThatFits` falls back to the last, most compact candidate.
                // At Standard with a default Dynamic Type size the first fits, so that look is
                // unchanged; at an accessibility size the label may now drop where it used to clip.
                ViewThatFits(in: .vertical) {
                    panelContent(day: day, next: next, showNextLabel: true, showCount: true)
                    panelContent(day: day, next: next, showNextLabel: false, showCount: true)
                    panelContent(day: day, next: next, showNextLabel: false, showCount: false)
                }
            }
        }
        .padding(EdgeInsets(top: 8, leading: 9, bottom: 8, trailing: 8))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(renderingMode == .fullColor ? Color.wPanel : Color.primary.opacity(0.08))
        }
    }

    /// The panel's lines below the header: the count line, then the next item (label, time, title).
    /// Either of the first two can be left out so `ViewThatFits` can pick what fits.
    @ViewBuilder private func panelContent(
        day: WSDay, next: NextRow?, showNextLabel: Bool, showCount: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // The count line speaks for the events, so it is only said with them on (Android
            // blanks it the same way): hidden events are neither "nothing" nor counted.
            if showCount && blocks.events {
                Text(day.thingsText)
                    .font(.caveat(size: m.s(19)))
                    .foregroundStyle(Color.wAccent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
            if let next {
                if showNextLabel {
                    Text(nextLabel(next))
                        .font(.sys(size: m.s(11)))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    nextLead(next.row)
                    if let dot = next.row.dot {
                        MemberDotView(dot: dot, diameter: m.s(14), m: m)
                    }
                }
                Text(title(of: next.row))
                    .font(.sys(size: m.s(12), weight: .medium))
                    .foregroundStyle(Color.wInk)
                    .lineLimit(1)
            }
        }
    }

    // MARK: the To-dos layout

    /// The count in the header's right slot, "**5** due today", which may wrap to two lines.
    /// Only drawn when the text is not empty (`showCount`).
    private func todosCount(_ text: WSText) -> some View {
        WidgetTextView(
            text: text,
            font: .sys(size: m.s(11)),
            color: .wInkSoft,
            emphasisFont: .outfit(size: m.s(15), weight: .bold),
            emphasisColor: .wAccent
        )
        .lineLimit(2)
        .multilineTextAlignment(.trailing)
        .minimumScaleFactor(0.8)
        .cardTile(blocks.background, outset: EdgeInsets(top: 0, leading: 4, bottom: 2, trailing: 4))
    }

    /// All clear when the day has no tasks to show (never decided by how many fit), else the
    /// rows that fit the panel's real height.
    @ViewBuilder private func todosContent(day: WSDay) -> some View {
        let tasks = WidgetFill.shownTasks(day.tasks.items, blocks: blocks, child: resolved.isChild)
        if tasks.isEmpty {
            MessageStateView(
                style: .relaxed,
                title: WidgetFill.allClearTitle(snapshot.labels),
                line: snapshot.labels.enjoy,
                image: "family-hug",
                m: m
            )
        } else {
            let overflow = WidgetFill.cappedTasks(day.tasks, blocks: blocks, child: resolved.isChild)
            GeometryReader { proxy in
                todoRows(tasks, overflow: overflow, height: proxy.size.height)
            }
        }
    }

    /// The rows at Standard (the small widget never steps), unlinked (one tap target), then
    /// "{n} more" at the foot when not all fit.
    private func todoRows(_ tasks: [WSTask], overflow: Int, height: CGFloat) -> some View {
        let rowHeight = m.s(19)
        let moreHeight = m.s(15)
        let fill = smallFill(count: tasks.count, overflow: overflow, height: height, rowHeight: rowHeight, moreHeight: moreHeight)
        let shown = Array(tasks.prefix(fill.shownPerGroup.first ?? 0))
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(shown.indices, id: \.self) { index in
                TaskRowView(
                    task: shown[index],
                    fallbackLink: snapshot.links.todo,
                    leadWidth: m.s(14),
                    height: rowHeight,
                    size: .small,
                    m: m,
                    linked: false
                )
            }
            Spacer(minLength: 0)
            if fill.more > 0 {
                Text(snapshot.labels.moreText(fill.more))
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkFaint)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .frame(height: moreHeight)
            }
        }
    }

    /// `WidgetFill.todosFill` as one group with no headings and one factor. The "{n} more" line
    /// is only held when something does not fit, so a list that fits exactly is not cut by one.
    private func smallFill(
        count: Int, overflow: Int, height: CGFloat, rowHeight: CGFloat, moreHeight: CGFloat
    ) -> TodosFillResult {
        let withoutMore = WidgetFill.todosFill(
            height: height, heading: 0, row: rowHeight, groupHeadings: [0], reserve: 0,
            groupSizes: [count], stepFactors: [1], overflow: overflow, noHeightRows: 3
        )
        if withoutMore.more == 0 { return withoutMore }
        return WidgetFill.todosFill(
            height: height, heading: 0, row: rowHeight, groupHeadings: [0], reserve: moreHeight,
            groupSizes: [count], stepFactors: [1], overflow: overflow, noHeightRows: 3
        )
    }

    /// "next", or "next · Wed 15" when the item is on a later day.
    private func nextLabel(_ next: NextRow) -> String {
        guard let later = next.laterDay, !later.dividerDate.isEmpty else { return snapshot.labels.next }
        return "\(snapshot.labels.next) · \(later.dividerDate)"
    }

    /// The time, big; a trip or a birthday shows its glyph instead.
    @ViewBuilder private func nextLead(_ row: WSRow) -> some View {
        switch row.kind {
        case .trip:
            RowGlyph(systemName: "airplane", size: m.s(16))
        case .birthday:
            RowGlyph(systemName: "birthday.cake", size: m.s(16))
        case .event:
            if !row.time.isEmpty {
                Text(row.time)
                    .font(.outfit(size: m.s(20), weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.wInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }

    private func title(of row: WSRow) -> String {
        if blocks.whosWhere, let inline = row.handoff?.inlineTitle, !inline.isEmpty { return inline }
        return row.title
    }
}
