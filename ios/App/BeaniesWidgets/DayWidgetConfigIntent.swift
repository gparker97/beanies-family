import AppIntents
import WidgetKit

/// Whose day a widget shows. A child session only ever publishes `my`, and the widget then
/// shows the child's day whatever is chosen here.
enum WidgetAudienceOption: String, AppEnum {
    case my
    case our

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Whose day"
    static var caseDisplayRepresentations: [WidgetAudienceOption: DisplayRepresentation] = [
        .my: "My day",
        .our: "Our day",
    ]
}

/// How solid the widget's card is, in percent. The same three choices as Android's
/// configuration screen (`WidgetPrefs.OPACITIES`). Only the card thins; the agenda panel and
/// every readable string stay as they are, so ink contrast holds over any wallpaper. Moot in
/// the system's tinted / clear appearance, which strips the card entirely.
enum WidgetBackgroundOption: String, AppEnum {
    case solid
    case lighter
    case light

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Background"
    static var caseDisplayRepresentations: [WidgetBackgroundOption: DisplayRepresentation] = [
        .solid: "100%",
        .lighter: "70%",
        .light: "40%",
    ]

    var opacity: Double {
        switch self {
        case .solid: return 1.0
        case .lighter: return 0.7
        case .light: return 0.4
        }
    }
}

/// How big the widget's text is, on top of the phone's own text size: Standard (today's look),
/// Large, Larger. Never smaller than Standard, and never past `WidgetMetrics.maxScale` overall
/// (the rule is `WidgetMetrics.init`). Bigger text shows fewer rows, never clipped ones. Android's
/// configuration screen has the same three (`WidgetPrefs.TextSize`).
enum WidgetTextSizeOption: String, AppEnum {
    case standard
    case large
    case larger

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Text size"
    static var caseDisplayRepresentations: [WidgetTextSizeOption: DisplayRepresentation] = [
        .standard: "Standard",
        .large: "Large",
        .larger: "Larger",
    ]

    var factor: CGFloat {
        switch self {
        case .standard: return 1.0
        case .large: return 1.15
        case .larger: return 1.3
        }
    }
}

/// The per-widget picker ("Edit Widget"). Titles are keys in Localizable.xcstrings
/// (en + zh-Hans): they render before any snapshot exists, so they cannot come from one.
/// Defaults: everything on (`WIDGET_DEFAULT_BLOCKS` in src/types/widgetSnapshot.ts). Each
/// switch shows or hides a kind of row and only ever fills room that would otherwise be
/// empty, so nothing competes for space by being on. The property names are the stored
/// keys: relabel freely, and give a switch a new key only when its meaning changes (see
/// `tripsAndBirthdays`), so an old stored value never carries over to a new meaning.
struct DayWidgetConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Your day"
    static var description: IntentDescription? = IntentDescription("Today's plans, handoffs and dinner at a glance.")

    @Parameter(title: "Whose day", default: .my)
    var audience: WidgetAudienceOption

    @Parameter(title: "Events", default: true)
    var events: Bool

    @Parameter(title: "Who's where", default: true)
    var whosWhere: Bool

    @Parameter(title: "Meals", default: true)
    var meals: Bool

    /// To-dos and lists (the to-dos section).
    @Parameter(title: "To-dos and lists", default: true)
    var due: Bool

    /// Trips and birthdays (the calendar). A NEW stored key on purpose: round 9b changed this
    /// switch from the old "coming up" chips (off by default) to calendar rows (on), so a widget
    /// set up on the old key must not carry its "off" over. `WidgetBlocks.comingUp` keeps the
    /// shared name (`WIDGET_FILL_ORDER`).
    @Parameter(title: "Trips and birthdays", default: true)
    var tripsAndBirthdays: Bool

    @Parameter(title: "Helpful hint", default: true)
    var hint: Bool

    /// 70% by default: a little wallpaper shows through, the text stays on solid tiles. Same
    /// default as Android (`WidgetPrefs.DEFAULT_OPACITY`).
    @Parameter(title: "Background", default: .lighter)
    var background: WidgetBackgroundOption

    @Parameter(title: "Text size", default: .standard)
    var textSize: WidgetTextSizeOption
}

/// The picker's choices as a plain value, so the views and the fill logic never touch the
/// App Intent type (and the lock-screen widget, whose only choice is the circle's, can use
/// the defaults).
struct WidgetBlocks: Equatable {
    var audience: WidgetAudienceOption
    var events: Bool
    var whosWhere: Bool
    var meals: Bool
    var due: Bool
    var comingUp: Bool
    var hint: Bool
    /// The card's opacity choice; not a block, but it rides with the picker's other values.
    var background: WidgetBackgroundOption = .lighter
    /// The text-size choice; the lock-screen widget (no text-size picker) keeps Standard.
    var textSize: WidgetTextSizeOption = .standard
    /// The lock-screen circle's choice (`AccessoryConfigIntent`); the home-screen widget
    /// never reads it.
    var circleShow: CircleShowOption = .nextUp

    static let defaults = WidgetBlocks(
        audience: .my, events: true, whosWhere: true, meals: true, due: true, comingUp: true, hint: true
    )

    func isOn(_ kind: WidgetBlockKind) -> Bool {
        switch kind {
        case .events: return events
        case .whosWhere: return whosWhere
        case .meals: return meals
        case .due: return due
        case .comingUp: return comingUp
        case .hint: return hint
        }
    }
}

extension WidgetBlocks {
    init(_ configuration: DayWidgetConfigIntent) {
        self.init(
            audience: configuration.audience,
            events: configuration.events,
            whosWhere: configuration.whosWhere,
            meals: configuration.meals,
            due: configuration.due,
            comingUp: configuration.tripsAndBirthdays,
            hint: configuration.hint,
            background: configuration.background,
            textSize: configuration.textSize
        )
    }
}
