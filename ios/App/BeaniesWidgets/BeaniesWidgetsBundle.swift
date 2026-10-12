import SwiftUI
import WidgetKit

/// The widget extension's entry point (#130). The app publishes the day as a JSON snapshot
/// into the App Group (`WidgetBridgePlugin.swift`); these widgets only paint it.
@main
struct BeaniesWidgetsBundle: WidgetBundle {
    var body: some Widget {
        DayWidget()
        DayAccessoryWidget()
    }
}
