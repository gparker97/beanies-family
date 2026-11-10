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

/// One day after today (the look-ahead).
struct LaterDay {
    let entry: WSDayEntry
    let day: WSDay
}

/// The day an entry shows, chosen once per render.
struct ResolvedDay {
    let entry: WSDayEntry
    let day: WSDay
    /// The days after `entry` in the snapshot, ascending.
    let later: [LaterDay]
    let isChild: Bool
    /// Content stays, plus "as of HH:MM": the snapshot is over 24h old, or it has no day
    /// for the entry's date (its last day is before today).
    let stale: Bool
}

/// Instants as the widgets print them.
enum WidgetClock {
    /// The device's short time, lowercased so "6:30 PM" sits with the rows' "10:15am" style
    /// (a no-op for zh): the stale label, the weather's age and the circle's handoff time.
    static func time(_ date: Date) -> String {
        DateFormatter.localizedString(from: date, dateStyle: .none, timeStyle: .short).lowercased()
    }

    /// "as of" stamps: the time alone reads as "today", so an instant from another day names
    /// the day instead ("Oct 15"). The stale label and the weather's age.
    static func stamp(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? time(date) : date.formatted(.dateTime.month(.abbreviated).day())
    }
}

enum DayResolver {
    /// Local calendar date in the snapshot's `ymd` form ("2026-10-11").
    static func ymd(_ date: Date) -> String {
        ymd(date, calendar: Calendar.current)
    }

    /// The calendar date in `zone`, same form. For the weather, whose days are the home
    /// zone's (`WidgetWeather`), not the device's.
    static func ymd(_ date: Date, in zone: TimeZone) -> String {
        var calendar = Calendar.current
        calendar.timeZone = zone
        return ymd(date, calendar: calendar)
    }

    private static func ymd(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
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

    /// The day an entry shows. `ownDay`: the lock screen's projection, the viewer's own day
    /// only (`viewersOwnDay`), for today and every look-ahead day alike; else the one view the
    /// home screen shows (`shownDay`).
    static func resolve(_ snapshot: WSSnapshot, at date: Date, ownDay: Bool = false) -> ResolvedDay? {
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
        let pick = { (dayEntry: WSDayEntry) -> WSDay in
            ownDay ? DayResolver.viewersOwnDay(dayEntry) : DayResolver.shownDay(dayEntry)
        }
        let later = snapshot.days[(index + 1)...].map { next in
            LaterDay(entry: next, day: pick(next))
        }
        return ResolvedDay(entry: entry, day: pick(entry), later: later, isChild: isChild, stale: stale)
    }

    /// The home screen's day: one view per day (v4). A v2/v3 snapshot carries `my` + `our`:
    /// the family view is `our`, and a child's snapshot only has `my`. A day with none is empty.
    private static func shownDay(_ entry: WSDayEntry) -> WSDay {
        entry.view ?? entry.our ?? entry.my ?? WSDay() // remove with v3
    }

    /// The lock screen's day: only the viewer's own, since it is readable without unlocking.
    /// v4's `view` narrowed to the rows marked `mine` (a row without the mark is left out), with
    /// `ownThingsText` in place of the family's count. `pickups` and `handoffs` are the viewer's
    /// own on every view, and the to-dos are not calendar rows, so they stay as they are. A
    /// v2/v3 snapshot's `my` is already the viewer's own day (a child's too); a missing one is
    /// an empty day, never the family's.
    private static func viewersOwnDay(_ entry: WSDayEntry) -> WSDay {
        guard let view = entry.view else { return entry.my ?? WSDay() } // remove with v3
        var own = view
        own.rows = view.rows.filter { $0.mine == true }
        own.thingsText = view.ownThingsText ?? view.thingsText
        return own
    }
}

/// One timeline policy for every widget kind.
enum WidgetTimeline {
    /// Instants per timeline (row ends, the circle's countdown hours, the weather's two
    /// thresholds). When a busy day has more, the timeline ends at the last one kept and
    /// `.atEnd` asks for the next batch, so the afternoon is never left to midnight.
    static let maxRowEntries = 12

    /// `lockScreen`: the accessory's extra instants (its pick-up line, and the circle's
    /// countdown hour before each item and handoff). The home-screen widget changes at none
    /// of them, so it does not spend entries on them.
    static func build(blocks: WidgetBlocks, now: Date, lockScreen: Bool) -> Timeline<DayEntry> {
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
            let dates = entryDates(snapshot, now: now, lockScreen: lockScreen)
            let entries = dates.map { DayEntry(date: $0, state: .ready(snapshot), blocks: blocks) }
            return Timeline(entries: entries, policy: .atEnd)
        }
    }

    /// now, each remaining row end today, the 24h staleness instant, the weather's `ageFrom`
    /// and `currentUntil` and the home zone's next midnight, on the lock screen the circle's countdown instants (each upcoming
    /// row's and handoff's start minus an hour, and the start itself), all capped, and the
    /// next local midnight. Midnight is what rolls the look-ahead without the app: that entry
    /// resolves the snapshot's next day as today, so its divider leaves the look-ahead, the
    /// following day becomes "tomorrow", and its to-dos (built as if it were today) take
    /// over. `.atEnd` then asks for a fresh timeline just after midnight.
    static func entryDates(_ snapshot: WSSnapshot, now: Date, lockScreen: Bool) -> [Date] {
        let midnight = nextMidnight(after: now)
        var instants: [Date] = []
        func ms(_ value: Double, plus seconds: TimeInterval = 0) -> Date {
            Date(timeIntervalSince1970: value / 1000 + seconds)
        }
        // The lock screen's instants come from the viewer's own day, the day it paints.
        if let resolved = DayResolver.resolve(snapshot, at: now, ownDay: lockScreen) {
            // +1s: a row is past when `endsAt < now`, so the entry lands just after the end.
            for row in resolved.day.rows {
                if let endsAt = row.endsAt { instants.append(ms(endsAt, plus: 1)) }
            }
            if lockScreen {
                for pickup in resolved.day.pickups where pickup.at > 0 {
                    instants.append(ms(pickup.at, plus: 1))
                }
                // The circle's countdown hour: the ring animates on its own, but the face
                // (the time, the word, the next handoff) is redrawn as each hour starts and ends.
                for row in resolved.day.rows {
                    if let startsAt = row.startsAt {
                        instants.append(ms(startsAt, plus: -3600))
                        instants.append(ms(startsAt))
                    }
                }
                for handoff in resolved.day.handoffs ?? [] where handoff.at > 0 {
                    instants.append(ms(handoff.at, plus: -3600))
                    instants.append(ms(handoff.at, plus: 1))
                }
            }
        }
        if let generated = snapshot.generatedDate {
            instants.append(generated.addingTimeInterval(24 * 3600 + 1))
        }
        if let weather = snapshot.weather {
            // `WidgetWeather` switches AT these instants (`now >= ageFrom`), so no +1s.
            instants.append(ms(weather.ageFrom))
            instants.append(ms(weather.currentUntil))
            // The home zone's next midnight: `WidgetWeather` picks today by the home zone's
            // date, so a home zone that rolls over before the device does repaints that day's
            // weather then, not at the device's midnight. Mirrors Android.
            if let homeZone = weather.homeZone {
                instants.append(nextMidnight(after: now, in: homeZone))
            }
        }
        let upcoming = Set(instants.filter { $0 > now && $0 < midnight }).sorted()
        var dates: [Date] = [now]
        dates.append(contentsOf: upcoming.prefix(maxRowEntries))
        // Over the cap, end at the last instant kept (`.atEnd` rebuilds from there) rather
        // than at midnight, which would freeze the rest of the day.
        if upcoming.count <= maxRowEntries { dates.append(midnight) }
        return dates
    }

    /// The start of the next day in `zone` (the device's when nil).
    static func nextMidnight(after date: Date, in zone: TimeZone? = nil) -> Date {
        var calendar = Calendar.current
        if let zone { calendar.timeZone = zone }
        let startOfToday = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? date.addingTimeInterval(24 * 3600)
    }
}
