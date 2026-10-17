import AppIntents
import WidgetKit

/// What the lock-screen circle shows (#134). The raw values are the stored keys: relabel
/// freely, and add a case rather than reusing one when a meaning changes, so a placed circle
/// never carries an old choice over to a new meaning. Titles and subtitles are keys in
/// Localizable.xcstrings (en + zh-Hans).
enum CircleShowOption: String, AppEnum {
    case nextUp
    case nextHandoff
    case todosLeft
    case thingsLeft

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Show"
    static var caseDisplayRepresentations: [CircleShowOption: DisplayRepresentation] = [
        .nextUp: DisplayRepresentation(title: "Next up", subtitle: "When your next thing starts"),
        .nextHandoff: DisplayRepresentation(title: "Next handoff", subtitle: "When you next drop off or pick up"),
        .todosLeft: DisplayRepresentation(title: "To-dos left", subtitle: "How many are due today"),
        .thingsLeft: DisplayRepresentation(title: "Things left", subtitle: "How much of today is still to come"),
    ]
}

/// The lock-screen accessories' picker ("Edit Widget"). One widget kind serves inline,
/// rectangular and circular, and only the circle has a choice to make, so the summary lists
/// `show` for `.accessoryCircular` alone. A circle placed while this widget was still a
/// `StaticConfiguration` (same `kind`) is handed the default, Next up.
struct AccessoryConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Next up"
    static var description: IntentDescription? = IntentDescription("Today's plans, handoffs and dinner at a glance.")

    @Parameter(title: "Show", default: .nextUp)
    var show: CircleShowOption

    // P2.0 spike step 2: inline and rectangular must show no parameter. If they still do on a
    // device, drop the `When` for a plain summary and retitle the parameter "Circle shows".
    static var parameterSummary: some ParameterSummary {
        When(widgetFamily: .equalTo, .accessoryCircular) {
            Summary("Next up") {
                \.$show
            }
        } otherwise: {
            Summary("Next up")
        }
    }
}

extension WidgetBlocks {
    /// The lock-screen widget's blocks: every switch on (it has no block picker), plus the
    /// circle's choice.
    init(_ configuration: AccessoryConfigIntent) {
        self = .defaults
        circleShow = configuration.show
    }
}
