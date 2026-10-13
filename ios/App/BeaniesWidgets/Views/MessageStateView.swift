import SwiftUI
import WidgetKit

/// The one view for every "no agenda" state:
/// - `.prompt`  signed out ("open beanies" / "sign in to see your day") and unreadable
///              ("open beanies to refresh"): the covering-eyes beanie beside the words.
/// - `.relaxed` nothing on today ("nothing on today," / "enjoy"): handwritten, with the
///              family hug in the corner.
struct MessageStateView: View {
    enum Style {
        case prompt
        case relaxed
    }

    let style: Style
    let title: String
    let line: String?
    let image: String
    /// The whole-widget tap target, when this view IS the widget (signed out, unreadable).
    var link: URL? = nil
    let m: WidgetMetrics

    var body: some View {
        if let link {
            content.widgetURL(link)
        } else {
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch style {
        case .prompt:
            HStack(alignment: .center, spacing: 10) {
                Image(image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.outfit(size: m.s(16), weight: .bold))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    if let line {
                        Text(line)
                            .font(.sys(size: m.s(11)))
                            .foregroundStyle(Color.wInkSoft)
                            .lineLimit(2)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .relaxed:
            ZStack(alignment: .bottomTrailing) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caveat(size: m.s(19.5)))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if let line {
                        Text(line)
                            .font(.outfit(size: m.s(14), weight: .semibold))
                            .foregroundStyle(Color.wInk)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                Image(image)
                    .resizable()
                    .scaledToFit()
                    .frame(height: m.s(34))
            }
        }
    }
}
