import Foundation
import WidgetKit

/// What an entry has to paint. The unreadable token is not carried: it has already been
/// recorded for the app by `WidgetSnapshotStore`.
enum ReadState {
    case ready(WSSnapshot)
    case signedOut
    case unreadable
}

struct DayEntry: TimelineEntry {
    let date: Date
    let state: ReadState
    let blocks: WidgetBlocks
}

/// One day after today, in the audience the widget shows (the look-ahead).
struct LaterDay {
    let entry: WSDayEntry
    let day: WSDay
}

/// The day an entry shows, chosen once per render.
struct ResolvedDay {
    let entry: WSDayEntry
    let day: WSDay
    /// The days after `entry` in the snapshot, ascending, in the same audience as `day`.
    let later: [LaterDay]
    /// The audience actually shown (a child, or a missing `our`, falls back to `my`).
    let audience: WidgetAudienceOption
    let isChild: Bool
    /// Content stays, plus "as of HH:MM": the snapshot is over 24h old, or it has no day
    /// for the entry's date (its last day is before today).
    let stale: Bool
}

enum DayResolver {
    /// Local calendar date in the snapshot's `ymd` form ("2026-10-11").
    static func ymd(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The device's tomorrow, for the "tomorrow" beside a look-ahead divider. Judged at render
    /// time, so a widget that rolled past midnight without the app never calls the wrong day
    /// tomorrow.
    static func tomorrowYmd(after date: Date) -> String {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))
            ?? date.addingTimeInterval(24 * 3600)
        return ymd(tomorrow)
    }

    static func resolve(_ snapshot: WSSnapshot, at date: Date, audience: WidgetAudienceOption) -> ResolvedDay? {
        guard !snapshot.days.isEmpty else { return nil }
        let today = ymd(date)

        var stale = false
        let index: Int
        if let match = snapshot.days.firstIndex(where: { $0.ymd == today }) {
            index = match
        } else {
            // Past the snapshot's last day, or a snapshot from days ago: show the latest day
            // that is not in the future, flagged.
            stale = true
            index = snapshot.days.lastIndex(where: { $0.ymd < today }) ?? 0
        }
        let entry = snapshot.days[index]
        if let generated = snapshot.generatedDate, date.timeIntervalSince(generated) > 24 * 3600 {
            stale = true
        }

        let isChild = snapshot.viewer.isChild
        let wanted: WidgetAudienceOption = isChild ? .my : audience
        let day: WSDay
        let shown: WidgetAudienceOption
        if wanted == .our, let our = entry.our {
            day = our
            shown = .our
        } else if let my = entry.my {
            day = my
            shown = .my
        } else {
            // A missing "my day" is an empty day, never the family's view (same as Android).
            day = WSDay()
            shown = .my
        }
        // The look-ahead keeps the audience actually shown; a later day without it is empty.
        let later = snapshot.days[(index + 1)...].map { next in
            LaterDay(entry: next, day: (shown == .our ? next.our : next.my) ?? WSDay())
        }
        return ResolvedDay(
            entry: entry, day: day, later: later, audience: shown, isChild: isChild, stale: stale
        )
    }
}

/// One timeline policy for every widget kind.
enum WidgetTimeline {
    /// Row-end entries per timeline (the past styling flips at each without a refresh).
    static let maxRowEntries = 12

    static func build(blocks: WidgetBlocks, now: Date, includePickups: Bool) -> Timeline<DayEntry> {
        switch WidgetSnapshotStore.read() {
        case .unreadable:
            // Usually transient (a read before first unlock): retry without waiting for the app.
            let entry = DayEntry(date: now, state: .unreadable, blocks: blocks)
            return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(15 * 60)))

        case .signedOut:
            // The app reloads every timeline when it publishes, so this only needs a
            // daily heartbeat; `.atEnd` on a single `now` entry would spin.
            let entries = [now, nextMidnight(after: now)].map {
                DayEntry(date: $0, state: .signedOut, blocks: blocks)
            }
            return Timeline(entries: entries, policy: .atEnd)

        case .ready(let snapshot):
            let dates = entryDates(snapshot, audience: blocks.audience, now: now, includePickups: includePickups)
            let entries = dates.map { DayEntry(date: $0, state: .ready(snapshot), blocks: blocks) }
            return Timeline(entries: entries, policy: .atEnd)
        }
    }

    /// now, each remaining row end today (capped), the 24h staleness instant, and the next
    /// local midnight. Midnight is what rolls the look-ahead without the app: that entry
    /// resolves the snapshot's next day as today, so its divider leaves the look-ahead, the
    /// following day becomes "tomorrow", and its to-dos (built as if it were today) take
    /// over. `.atEnd` then asks for a fresh timeline just after midnight.
    static func entryDates(_ snapshot: WSSnapshot, audience: WidgetAudienceOption, now: Date, includePickups: Bool) -> [Date] {
        let midnight = nextMidnight(after: now)
        var instants: [Date] = []
        if let resolved = DayResolver.resolve(snapshot, at: now, audience: audience) {
            // +1s: a row is past when `endsAt < now`, so the entry lands just after the end.
            for row in resolved.day.rows {
                if let endsAt = row.endsAt { instants.append(Date(timeIntervalSince1970: endsAt / 1000 + 1)) }
            }
            if includePickups {
                for pickup in resolved.day.pickups where pickup.at > 0 {
                    instants.append(Date(timeIntervalSince1970: pickup.at / 1000 + 1))
                }
            }
        }
        if let generated = snapshot.generatedDate {
            instants.append(generated.addingTimeInterval(24 * 3600 + 1))
        }
        let upcoming = Set(instants.filter { $0 > now && $0 < midnight }).sorted().prefix(maxRowEntries)
        var dates: [Date] = [now]
        dates.append(contentsOf: upcoming)
        dates.append(midnight)
        return dates
    }

    static func nextMidnight(after date: Date) -> Date {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? date.addingTimeInterval(24 * 3600)
    }
}
