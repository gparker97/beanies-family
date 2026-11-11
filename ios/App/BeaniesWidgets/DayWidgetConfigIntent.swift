import AppIntents
import WidgetKit

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

/// How big the widget's text is, on top of the phone's own text size: Automatic (the default),
/// Standard (today's look), Large, Larger. Never smaller than Standard, and never past
/// `WidgetMetrics.maxScale` overall (the rule is `WidgetMetrics.init`). Bigger text shows fewer
/// rows, never clipped ones. Android's configuration screen has the same four
/// (`WidgetPrefs.TextSize`).
///
/// Automatic draws at Standard's scale everywhere. Only the To-dos focus on medium and large
/// reads the difference: a short list steps up (`WidgetFill.taskStepFactors`). The raw values
/// are stored keys, so a widget with Standard, Large or Larger stored keeps it.
enum WidgetTextSizeOption: String, AppEnum {
    case automatic
    case standard
    case large
    case larger

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Text size"
    static var caseDisplayRepresentations: [WidgetTextSizeOption: DisplayRepresentation] = [
        .automatic: "Automatic",
        .standard: "Standard",
        .large: "Large",
        .larger: "Larger",
    ]

    var factor: CGFloat {
        switch self {
        case .automatic: return 1.0
        case .standard: return 1.0
        case .large: return 1.15
        case .larger: return 1.3
        }
    }
}

/// What the home-screen widget is about: Your day (the calendar, then the to-dos; the
/// default) or To-dos (the to-dos from the top, grouped). The raw values are stored keys
/// (Android `WidgetPrefs.Focus` keys are the same words): never rename one.
enum WidgetFocusOption: String, AppEnum {
    case day
    case todos

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Focus"
    static var caseDisplayRepresentations: [WidgetFocusOption: DisplayRepresentation] = [
        .day: "Your day",
        .todos: "To-dos",
    ]
}

/// The per-widget picker ("Edit Widget"). Titles are keys in Localizable.xcstrings
/// (en + zh-Hans): they render before any snapshot exists, so they cannot come from one.
/// Defaults: everything on (`WIDGET_DEFAULT_BLOCKS` in src/types/widgetSnapshot.ts). Each
/// switch shows or hides a kind of row and only ever fills room that would otherwise be
/// empty, so nothing competes for space by being on. The property names are the stored
/// keys: relabel freely, and give a switch a new key only when its meaning changes (see
/// `tripsAndBirthdays`), so an old stored value never carries over to a new meaning.
///
/// Focus is the first row. To-dos swaps the six part switches for its own two extras, both
/// off by default and on their OWN keys (`todosEvents`, `todosMeals`): reusing `events` and
/// `meals` would carry their stored "on" into the To-dos focus. Each focus keeps its values.
struct DayWidgetConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Your day"
    static var description: IntentDescription? = IntentDescription("Today's plans, handoffs and dinner at a glance.")

    @Parameter(title: "Focus", default: .day)
    var focus: WidgetFocusOption

    /// To-dos focus: the next events under the to-dos.
    @Parameter(title: "Upcoming events", default: false)
    var todosEvents: Bool

    /// To-dos focus: tonight's meal in the footer.
    @Parameter(title: "Tonight's meal", default: false)
    var todosMeals: Bool

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

    /// Automatic by default: it equals Standard outside the To-dos focus, so a widget placed
    /// before the option existed looks the same whichever value iOS hands it.
    @Parameter(title: "Text size", default: .automatic)
    var textSize: WidgetTextSizeOption

    // The Edit Widget sheet lists the rows named here, in this order. If iOS does not swap
    // them for a widget intent, every row stays visible and each focus reads only its own.
    static var parameterSummary: some ParameterSummary {
        When(\.$focus, .equalTo, WidgetFocusOption.todos) {
            Summary("Your day") {
                \.$focus
                \.$todosEvents
                \.$todosMeals
                \.$background
                \.$textSize
            }
        } otherwise: {
            Summary("Your day") {
                \.$focus
                \.$events
                \.$whosWhere
                \.$meals
                \.$due
                \.$tripsAndBirthdays
                \.$hint
                \.$background
                \.$textSize
            }
        }
    }
}

/// The picker's choices as a plain value, so the views and the fill logic never touch the
/// App Intent type (and the lock-screen widget, whose only choice is the circle's, can use
/// the defaults).
struct WidgetBlocks: Equatable {
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
    /// The STORED focus and its two extras. Nothing here is resolved: `WidgetFill.effective`
    /// turns them into the switches a render uses, once the viewer is known. The defaults
    /// (Your day, extras off) keep `defaults` and the lock-screen widget on Your day.
    var focus: WidgetFocusOption = .day
    var todosEvents: Bool = false
    var todosMeals: Bool = false

    /// The stored Text size is Automatic (the lock-screen widget's Standard is not).
    var isAutomaticTextSize: Bool { textSize == .automatic }

    static let defaults = WidgetBlocks(
        events: true, whosWhere: true, meals: true, due: true, comingUp: true, hint: true
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
            events: configuration.events,
            whosWhere: configuration.whosWhere,
            meals: configuration.meals,
            due: configuration.due,
            comingUp: configuration.tripsAndBirthdays,
            hint: configuration.hint,
            background: configuration.background,
            textSize: configuration.textSize,
            focus: configuration.focus,
            todosEvents: configuration.todosEvents,
            todosMeals: configuration.todosMeals
        )
    }
}

extension WidgetBlocks {
    /// The lock-screen widget's blocks: every switch on (it has no block picker), plus the
    /// circle's choice. Here rather than beside the intent, because `AccessoryConfigIntent.swift`
    /// is also compiled into the app, which has no `WidgetBlocks`.
    init(_ configuration: AccessoryConfigIntent) {
        self = .defaults
        circleShow = configuration.show
    }
}
