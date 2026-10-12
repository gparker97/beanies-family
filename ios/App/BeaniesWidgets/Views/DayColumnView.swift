import SwiftUI

/// The slim left column on medium and large: the date at the top (a link to the Nook),
/// and at its foot the audience label (large, "my day" only) and the to-dos count.
struct DayColumnView: View {
    let entry: WSDayEntry
    let labels: WSLabels
    let links: WSLinks
    /// The to-dos block when the count is on and non-zero (`FillPlan.taskCount`).
    let taskCount: WSTasks?
    let showAudienceLabel: Bool
    let size: WidgetSizeKey
    let m: WidgetMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Link(destination: WidgetLinks.url(links.nook, size)) {
                VStack(alignment: .leading, spacing: 0) {
                    // 32pt Outfit Bold, line height ~0.86, tracking -0.02em, ink in both modes.
                    Text(entry.numeral)
                        .font(.outfit(size: m.s(32), weight: .bold))
                        .tracking(-0.02 * m.s(32))
                        .monospacedDigit()
                        .foregroundStyle(Color.wInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.vertical, -m.s(6))
                        .padding(.leading, -1)
                    Text(entry.weekday)
                        .font(.outfit(size: m.s(11), weight: .semibold))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .padding(.top, 5)
                    Text(entry.month)
                        .font(.sys(size: m.s(11)))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Keep the foot off the month however tall the type grows.
            Spacer(minLength: m.s(8))

            VStack(alignment: .leading, spacing: 7) {
                if showAudienceLabel {
                    Text(labels.myDay)
                        .font(.sys(size: m.s(11), weight: .medium))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                if let tasks = taskCount {
                    Link(destination: WidgetLinks.url(tasks.link.isEmpty ? links.todo : tasks.link, size)) {
                        WidgetTextView(
                            text: tasks.countText,
                            font: .sys(size: m.s(11)),
                            color: .wInkSoft,
                            emphasisFont: .outfit(size: m.s(11), weight: .bold),
                            emphasisColor: .wInk
                        )
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.bottom, 1)
        }
    }
}
