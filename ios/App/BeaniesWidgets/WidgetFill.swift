import CoreGraphics
import Foundation

/// The six picker switches. Each one shows or hides a KIND of row; none decides where a row
/// goes (round 9b): the calendar is always on top and the to-dos section sits in a fixed
/// place under it.
///
/// MIRRORED CONSTANT: keep in the same order as `WIDGET_FILL_ORDER` in
/// src/types/widgetSnapshot.ts (and `WidgetFill.java` on Android).
enum WidgetBlockKind: String, CaseIterable {
    case events, whosWhere, meals, due, comingUp, hint
}

/// The switches in the picker's order (`WIDGET_FILL_ORDER`). Kept as the mirror even though
/// round 9b fills by section, not by switch: the order is the contract the three platforms
/// share.
let widgetFillOrder: [WidgetBlockKind] = [.events, .whosWhere, .meals, .due, .comingUp, .hint]

/// The space one widget has, in points, already scaled by `WidgetMetrics`.
struct FillSpec {
    /// Height left for the calendar and the to-dos section, after the fixed chrome (padding,
    /// the peek drop, panel padding, footer) is taken off.
    var bodyHeight: CGFloat
    /// Today's rows the design shows at most (medium 5, large 9). The look-ahead has no cap
    /// of its own: it takes the room that is left.
    var maxRows: Int
    var rowHeight: CGFloat
    /// A handoff sub-line: 15 tall, pulled up 4.
    var subLineHeight: CGFloat
    /// Task rows the to-dos section keeps before the look-ahead may use the room (medium 2,
    /// large 4).
    var taskReserve: Int
    /// Medium and large have the "tonight" footer.
    var hasFooter: Bool
    /// Medium and large (not the child view) have the date column whose foot shows the count.
    var hasDateColumn: Bool
    var scale: CGFloat
}

/// One line of the calendar section.
enum CalendarItem {
    case row(WSRow)
    /// A look-ahead day's divider ("Wed 15" and, for the device's tomorrow, "tomorrow").
    case divider(WSDayEntry, isTomorrow: Bool)
}

/// The calendar's first line when today has no rows.
enum NothingLine {
    /// "nothing on today": tasks are waiting underneath.
    case withTasks
    /// "nothing on today, enjoy".
    case clear
}

/// What one widget will show. Built ONCE per render by `WidgetFill.plan`; views only paint it.
struct FillPlan {
    /// The calendar, top to bottom: today's rows, then each look-ahead day's divider and rows.
    var calendar: [CalendarItem] = []
    var nothingLine: NothingLine? = nil
    /// Today's rows whose handoff sub-line fits under them.
    var subLineIds: Set<String> = []
    /// "Who's where" is on: rows may show `handoff.inlineTitle` instead of `title`.
    var inlineHandoffs = false
    /// The whole week's calendar is empty and there are no tasks: the relaxed hug state.
    var relaxed = false
    var tonight: WSTonight? = nil
    /// The to-dos block for the foot of the date column, when the count is on.
    var taskCount: WSTasks? = nil
    /// The to-dos section (heading and link), when at least one task fits.
    var taskSection: WSTasks? = nil
    var tasks: [WSTask] = []
    /// Tasks that passed the switches but did not fit: the heading's "{n} more".
    var moreTasks = 0
}

/// The next calendar item, for the small widget and the lock screen.
struct NextRow {
    let row: WSRow
    /// The later day it falls on; nil when it is today's.
    let laterDay: WSDayEntry?
}

/// What the lock-screen circle shows, decided once (`WidgetFill.circle`) so its face and its
/// tap target always agree. Every option that has nothing of its own lands on `nextUp`.
enum CirclePick {
    /// The next calendar item; nil = nothing in the rest of the week ("all clear").
    case nextUp(NextRow?)
    /// The viewer's next drop-off or pick-up today.
    case nextHandoff(WSDayHandoff)
    /// To-dos due now (`tasks.count`) and done today (`tasks.doneToday`).
    case todosLeft(count: Int, done: Int)
    /// Today's calendar items still to come, of all of today's.
    case thingsLeft(left: Int, total: Int)
}

/// Who gets the room, for every size, in one place. iOS cannot scroll, so the calendar and
/// the to-dos share ONE budget:
///   (a) today's calendar rows (or the "nothing on today" line) and their handoff sub-lines;
///   (b) then, when there are tasks, the section heading plus `taskReserve` rows are held;
///   (c) the look-ahead fills the room between: a divider plus at least one row each time,
///       stopping at the first day whose divider and first row do not fit;
///   (d) the tasks take everything left (at least the reserved rows), "N more" for the rest.
/// Anything that does not fit is DROPPED whole, never squeezed.
enum WidgetFill {
    // Design costs in points at scale 1 (mockup round 9b).
    /// `.cav9`: the handwritten "nothing on today" line.
    static let nothingLineHeight: CGFloat = 19
    /// `.dv9`: a look-ahead day's divider.
    static let dividerHeight: CGFloat = 15
    /// `.sec9`: the to-dos section heading.
    static let sectionHeadingHeight: CGFloat = 13
    /// The relaxed "nothing on today, / enjoy" state with the hug.
    static let messageHeight: CGFloat = 46

    static func plan(resolved: ResolvedDay, blocks: WidgetBlocks, spec: FillSpec, at date: Date) -> FillPlan {
        var plan = FillPlan()
        var remaining = spec.bodyHeight
        let scale = spec.scale
        let day = resolved.day
        let child = resolved.isChild

        let todayRows = shownRows(day.rows, blocks: blocks, today: true)
        let lookAhead = lookAheadDays(resolved, blocks: blocks)
        let tasks = shownTasks(day.tasks.items, blocks: blocks, child: child)
        let calendarOn = blocks.events || blocks.comingUp

        // The footer and the date column cost nothing from the body budget.
        if spec.hasFooter, blocks.meals, let tonight = day.tonight, !tonight.text.isEmpty {
            // An empty WidgetText is never drawn.
            plan.tonight = tonight
        }
        if spec.hasDateColumn, blocks.due, isAllowed(.due, child: child),
           day.tasks.count > 0, !day.tasks.countText.text.isEmpty {
            plan.taskCount = day.tasks
        }

        // "Nothing on" is only ever said with the events switch on: hidden events are not nothing.
        if blocks.events, todayRows.isEmpty, lookAhead.isEmpty, tasks.isEmpty {
            if remaining >= messageHeight * scale { plan.relaxed = true }
            return plan
        }

        // (a) Today first, in full where it fits.
        if calendarOn {
            if todayRows.isEmpty {
                let cost = nothingLineHeight * scale
                if blocks.events, remaining >= cost {
                    plan.nothingLine = tasks.isEmpty ? .clear : .withTasks
                    remaining -= cost
                }
            } else {
                // Trips and birthdays (never past) stay pinned first; only the events are windowed,
                // and to what fits by height, so a finished morning never hides the afternoon.
                var placed: [WSRow] = []
                let pinned = todayRows.filter { $0.kind != .event }
                let events = todayRows.filter { $0.kind == .event }
                let fit = spec.rowHeight > 0 ? Int(remaining / spec.rowHeight) : 0
                let limit = Swift.min(spec.maxRows, fit)
                let keptPinned = Array(pinned.prefix(limit))
                let eventLimit = Swift.max(0, limit - keptPinned.count)
                for row in keptPinned + window(events, limit: eventLimit, at: date) {
                    if remaining < spec.rowHeight { break }
                    placed.append(row)
                    remaining -= spec.rowHeight
                }
                plan.calendar = placed.map { CalendarItem.row($0) }
                if blocks.whosWhere {
                    for row in placed {
                        guard let line = row.handoff?.line, !line.isEmpty else { continue }
                        if remaining < spec.subLineHeight { break }
                        plan.subLineIds.insert(row.id)
                        remaining -= spec.subLineHeight
                    }
                }
            }
        }
        plan.inlineHandoffs = blocks.whosWhere

        // (b) Hold the to-dos section's minimum before the look-ahead may take the room.
        let headingCost = sectionHeadingHeight * scale
        let reserved: CGFloat = tasks.isEmpty
            ? 0
            : headingCost + spec.rowHeight * CGFloat(Swift.min(spec.taskReserve, tasks.count))

        // (c) The look-ahead: a divider is never drawn without a row under it.
        var lookAheadRoom = remaining - reserved
        let dividerCost = dividerHeight * scale
        let tomorrow = DayResolver.tomorrowYmd(after: date)
        days: for (entry, rows) in lookAhead {
            if lookAheadRoom < dividerCost + spec.rowHeight { break }
            plan.calendar.append(.divider(entry, isTomorrow: entry.ymd == tomorrow))
            lookAheadRoom -= dividerCost
            remaining -= dividerCost
            for row in rows {
                if lookAheadRoom < spec.rowHeight { break days }
                plan.calendar.append(.row(row))
                lookAheadRoom -= spec.rowHeight
                remaining -= spec.rowHeight
            }
        }

        // (d) The tasks take everything left.
        if !tasks.isEmpty, remaining >= headingCost + spec.rowHeight {
            remaining -= headingCost
            for task in tasks {
                if remaining < spec.rowHeight { break }
                plan.tasks.append(task)
                remaining -= spec.rowHeight
            }
            plan.taskSection = day.tasks
            // Plus what the snapshot's per-switch cap left out, for the switches that are on.
            let capped = (blocks.due ? day.tasks.overflowDue : 0)
                + (blocks.hint && isAllowed(.hint, child: child) ? day.tasks.overflowHint : 0)
            plan.moreTasks = capped + tasks.count - plan.tasks.count
        }
        return plan
    }

    // MARK: what the switches show

    /// The calendar rows a switch setting shows: events ← `events`, trips and birthdays ←
    /// `comingUp`. A `todayOnly` row (a trip in progress) is never shown under a later day.
    static func shownRows(_ rows: [WSRow], blocks: WidgetBlocks, today: Bool) -> [WSRow] {
        rows.filter { row in
            if !today && row.todayOnly { return false }
            switch row.kind {
            case .event: return blocks.events
            case .trip, .birthday: return blocks.comingUp
            }
        }
    }

    /// The tasks a switch setting shows: to-dos and lists ← `due`, hints ← `hint`. Order is
    /// the snapshot's.
    static func shownTasks(_ tasks: [WSTask], blocks: WidgetBlocks, child: Bool) -> [WSTask] {
        tasks.filter { task in
            switch task.kind {
            case .todo, .list: return blocks.due && isAllowed(.due, child: child)
            case .hint: return blocks.hint && isAllowed(.hint, child: child)
            }
        }
    }

    /// The later days that have at least one shown row, in order. A day with none is skipped.
    static func lookAheadDays(_ resolved: ResolvedDay, blocks: WidgetBlocks) -> [(WSDayEntry, [WSRow])] {
        resolved.later.compactMap { later -> (WSDayEntry, [WSRow])? in
            let rows = shownRows(later.day.rows, blocks: blocks, today: false)
            return rows.isEmpty ? nil : (later.entry, rows)
        }
    }

    /// The next calendar item: today's next timed row that is not over, else today's first
    /// untimed row, else the first shown row of the next later day that has one. Timed rows
    /// win because a trip in progress or a birthday is pinned FIRST in today's rows and is
    /// never past, so it would otherwise hide the 4:30pm piano all day.
    static func nextRow(_ resolved: ResolvedDay, blocks: WidgetBlocks, at date: Date) -> NextRow? {
        let today = shownRows(resolved.day.rows, blocks: blocks, today: true)
        if let row = today.first(where: { $0.startsAt != nil && !$0.isPast(at: date) })
            ?? today.first(where: { $0.startsAt == nil }) {
            return NextRow(row: row, laterDay: nil)
        }
        if let first = lookAheadDays(resolved, blocks: blocks).first, let row = first.1.first {
            return NextRow(row: row, laterDay: first.0)
        }
        return nil
    }

    // MARK: the lock-screen circle

    /// The viewer's next drop-off or pick-up today (the first `handoffs.at` after now). nil
    /// when there is none left, or the snapshot is v2 (no `handoffs`).
    static func nextHandoff(_ resolved: ResolvedDay, at date: Date) -> WSDayHandoff? {
        let nowMs = date.timeIntervalSince1970 * 1000
        return (resolved.day.handoffs ?? [])
            .filter { $0.at > nowMs }
            .min { $0.at < $1.at }
    }

    /// Today's shown calendar rows, and how many are still to come: not past and not done.
    /// The complement is the old circle's progress ring ("how much of today is behind me",
    /// the child-view rule that a ticked or finished row is done).
    static func thingsLeft(_ resolved: ResolvedDay, blocks: WidgetBlocks, at date: Date) -> (left: Int, total: Int) {
        let rows = shownRows(resolved.day.rows, blocks: blocks, today: true)
        let left = rows.filter { !$0.isDone && !$0.isPast(at: date) }.count
        return (left, rows.count)
    }

    /// The circle's choice, with the one fallback path: an option shows Next up when it has
    /// nothing of its own, when the viewer is a child (To-dos left: a child has no to-dos), or
    /// when the snapshot is v2 (the option's field or label is absent, and an English default
    /// would be wrong in zh).
    static func circle(
        _ resolved: ResolvedDay, labels: WSLabels, show: CircleShowOption, blocks: WidgetBlocks, at date: Date
    ) -> CirclePick {
        switch show {
        case .nextUp:
            break
        case .nextHandoff:
            if let handoff = nextHandoff(resolved, at: date) { return .nextHandoff(handoff) }
        case .todosLeft:
            let tasks = resolved.day.tasks
            if !resolved.isChild, labels.circleToDo != nil, let done = tasks.doneToday, tasks.count + done > 0 {
                return .todosLeft(count: tasks.count, done: done)
            }
        case .thingsLeft:
            let things = thingsLeft(resolved, blocks: blocks, at: date)
            if things.total > 0, labels.circleLeft != nil, labels.circleAllDone != nil {
                return .thingsLeft(left: things.left, total: things.total)
            }
        }
        return .nextUp(nextRow(resolved, blocks: blocks, at: date))
    }

    /// The circle's word under a Next up time: the title's first word (`shortTitle`), falling
    /// back to the first name (`whoFirst`). With lock-screen titles off it is the first name
    /// only, never a title word: the setting exists to keep titles off the lock screen. nil
    /// when there is no word (a v2 snapshot has neither field): the time or glyph stands alone.
    static func circleWord(_ row: WSRow, titles: Bool) -> String? {
        let candidates = titles ? [row.shortTitle, row.whoFirst] : [row.whoFirst]
        return candidates.compactMap { $0 }.first { !$0.isEmpty }
    }

    /// A child sees no to-dos and no hints (the snapshot omits them too; this is the
    /// renderer refusing to paint them if it ever did not).
    static func isAllowed(_ kind: WidgetBlockKind, child: Bool) -> Bool {
        guard child else { return true }
        return kind != .due && kind != .hint
    }

    /// Which rows to offer when there are more than fit: keep at most one finished row for
    /// context before the first upcoming one, so a busy afternoon does not show only the
    /// morning. Untimed rows (no `endsAt`) are never past.
    static func window(_ rows: [WSRow], limit: Int, at date: Date) -> ArraySlice<WSRow> {
        guard limit > 0 else { return [] }
        guard rows.count > limit else { return rows[...] }
        let firstUpcoming = rows.firstIndex { !$0.isPast(at: date) } ?? rows.count
        let start = Swift.max(0, Swift.min(firstUpcoming - 1, rows.count - limit))
        return rows[start ..< start + limit]
    }
}
