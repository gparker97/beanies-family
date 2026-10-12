import SwiftUI
import WidgetKit

/// The home-screen widget: small, medium, large, with the per-widget picker.
struct DayWidget: Widget {
    let kind = "DayWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: DayWidgetConfigIntent.self, provider: DayProvider()) { entry in
            DayWidgetView(entry: entry)
        }
        .configurationDisplayName("Your day")
        .description("Today's plans, handoffs and dinner at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        // The views lay out their own padding (placement E's exact numbers).
        .contentMarginsDisabled()
    }
}

struct DayProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), state: .ready(SampleSnapshot.make(now: Date())), blocks: .defaults)
    }

    func snapshot(for configuration: DayWidgetConfigIntent, in context: Context) async -> DayEntry {
        let now = Date()
        let blocks = WidgetBlocks(configuration)
        // The gallery shows the built-in sample; a placed widget shows the real day.
        if context.isPreview {
            return DayEntry(date: now, state: .ready(SampleSnapshot.make(now: now)), blocks: blocks)
        }
        return WidgetTimeline.build(blocks: blocks, now: now, includePickups: false).entries.first
            ?? DayEntry(date: now, state: .signedOut, blocks: blocks)
    }

    func timeline(for configuration: DayWidgetConfigIntent, in context: Context) async -> Timeline<DayEntry> {
        WidgetTimeline.build(blocks: WidgetBlocks(configuration), now: Date(), includePickups: false)
    }
}
