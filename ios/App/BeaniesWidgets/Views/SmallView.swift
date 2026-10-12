import SwiftUI
import WidgetKit

/// The small widget (158pt): short weekday + numeral, the peek sitting on the panel, then
/// the handwritten count line and the next item. On a quiet day the next item comes from a
/// later day, and the day is named ("next · Wed 15"). One tap target (`widgetURL`, set by
/// the caller): small widgets cannot hold `Link`s.
struct SmallView: View {
    let snapshot: WSSnapshot
    let resolved: ResolvedDay
    let blocks: WidgetBlocks
    let date: Date
    let m: WidgetMetrics

    @Environment(\.widgetRenderingMode) private var renderingMode

    static let peekHeight: CGFloat = 28

    var body: some View {
        let entry = resolved.entry
        let day = resolved.day
        let peek = PeekKind.forDay(resolved, viewer: snapshot.viewer)
        let next = WidgetFill.nextRow(resolved, blocks: blocks, at: date)

        VStack(alignment: .leading, spacing: 0) {
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
                // Keep the header clear of the peek.
                Spacer(minLength: PeekView.width(peek, height: Self.peekHeight) + peek.rightInset)
            }
            .frame(height: 38, alignment: .leading)

            panel(day: day, next: next)
                .overlay(alignment: .topTrailing) {
                    PeekView(kind: peek, height: Self.peekHeight)
                        .offset(x: -peek.rightInset, y: -(Self.peekHeight - PeekView.overlap))
                }

            if resolved.stale, let asOf = StaleLabel.text(snapshot) {
                Text(asOf)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkFaint)
                    .lineLimit(1)
                    .padding(.top, 3)
            }
        }
        .padding(EdgeInsets(top: 6, leading: 10, bottom: 8, trailing: 9))
    }

    /// The relaxed state only when the calendar is on and the whole week ahead is clear.
    private func panel(day: WSDay, next: NextRow?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if blocks.events && next == nil
                && WidgetFill.shownRows(day.rows, blocks: blocks, today: true).isEmpty {
                MessageStateView(
                    style: .relaxed,
                    title: snapshot.labels.nothingOnToday,
                    line: snapshot.labels.enjoy,
                    image: "family-hug",
                    m: m
                )
            } else {
                // The count line speaks for the events, so it is only said with them on (Android
                // blanks it the same way): hidden events are neither "nothing" nor counted.
                if blocks.events {
                    Text(day.thingsText)
                        .font(.caveat(size: m.s(19)))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 0)
                if let next {
                    Text(nextLabel(next))
                        .font(.sys(size: m.s(11)))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
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
        .padding(EdgeInsets(top: 8, leading: 9, bottom: 8, trailing: 8))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(renderingMode == .fullColor ? Color.wPanel : Color.primary.opacity(0.08))
        }
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
