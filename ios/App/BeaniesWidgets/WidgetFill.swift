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
    /// The To-dos layout: event rows held for the Upcoming events extra before the to-dos take
    /// the room (medium 1, large 3), plus their heading.
    var eventSlot: Int
    /// The To-dos layout: task rows shown when the host reports no height (medium 4, large 10).
    var noHeightTaskRows: Int
    /// The To-dos layout: a task row's width inside the panel (the panel's width less its side
    /// padding), for the Automatic step's title check. 0 = unknown, and then nothing steps.
    var taskRowWidth: CGFloat
}

/// Which layout one render uses, decided once by `WidgetFill.effective`. `day` is the calendar
/// on top and the to-dos above the footer; `todos` is the to-dos section from the top.
enum WidgetLayout {
    case day
    case todos
}

/// The To-dos layout's groups, from `WSTask.bucket`, as on the To-Dos page.
enum TaskGroupKind {
    case overdue
    /// `today`.
    case today
    /// `undated` and `later`.
    case comingUp
}

/// One run of tasks in the snapshot's order. `kind` is nil only for a first run whose bucket is
/// unrecognised or empty (any later one joins the run before it).
struct TaskRun {
    var kind: TaskGroupKind?
    var tasks: [WSTask]
}

/// One group the To-dos layout draws: its heading (nil = the snapshot has no label for it, or
/// the run has no group) and the rows that fit.
struct TaskGroupPlan {
    var heading: String?
    /// The heading is the accent; the others are the soft ink.
    var isOverdue: Bool
    var tasks: [WSTask]
}

/// `WidgetFill.todosFill`'s answer: the step factor (1 = Standard), the rows shown per group
/// (parallel to the group sizes it was given), and "N more".
struct TodosFillResult {
    var step: CGFloat
    var shownPerGroup: [Int]
    var more: Int
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
    /// The To-dos layout with no tasks but events under them: "all clear, enjoy" on one line.
    case allClear
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
    /// Tasks that passed the switches but did not fit: the heading's "{n} more" (the footer's,
    /// in the To-dos layout).
    var moreTasks = 0
    /// The layout this plan was built for (`WidgetFill.effective`).
    var layout: WidgetLayout = .day
    /// The To-dos layout's Automatic step for the task rows and group headings (1 = Standard).
    var taskStep: CGFloat = 1
    /// The To-dos layout: `tasks` in their groups. Empty in Your day.
    var taskGroups: [TaskGroupPlan] = []
    /// The To-dos layout: `tasks.countText` at the right of the section heading; nil when the
    /// snapshot's is empty (nothing due today) or in Your day.
    var taskHeadingCount: WSText? = nil
    /// The To-dos layout: "next up" over today's events, when any are placed.
    var eventsHeading: String? = nil
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
///
/// The To-dos layout (`WidgetLayout.todos`) runs the to-dos FIRST (`todosFill`, which may hold a
/// small slot for the Upcoming events extra), then (a) and (c) in the room left with nothing
/// reserved, and never (d). Your day (`.day`) is exactly the four steps above.
enum WidgetFill {
    // Design costs in points at scale 1 (mockup round 9b).
    /// `.cav9`: the handwritten "nothing on today" line.
    static let nothingLineHeight: CGFloat = 19
    /// `.dv9`: a look-ahead day's divider (also the To-dos layout's group and "next up" headings).
    static let dividerHeight: CGFloat = 15
    /// `.sec9`: the to-dos section heading.
    static let sectionHeadingHeight: CGFloat = 13
    /// The relaxed "nothing on today, / enjoy" state with the hug.
    static let messageHeight: CGFloat = 46
    /// Task rows on one widget, whatever fits: the snapshot caps to-dos+lists and hints at 16
    /// EACH, so a widget with hints on can carry 32. Mirrors Android `WidgetFill.MAX_TASK_ROWS`.
    static let maxTaskRows = 16
    /// The To-dos focus's Automatic steps, before the `WidgetMetrics.taskStepMax` clamp.
    static let taskSteps: [CGFloat] = [1.0, 1.3, 1.6]
    /// The fill's comparison slack: the stepped sums are floats. Mirrors Android
    /// `WidgetFill.FIT_EPSILON_DP`.
    static let fitEpsilon: CGFloat = 0.01

    // MARK: the focus

    /// The switches one render uses, and its layout, from the STORED picker values. Called once
    /// per render, in `DayWidgetView`, where the resolved day (and so the viewer) is known:
    /// `WidgetBlocks` is built before any snapshot exists, and the small widget never calls
    /// `plan`. Every reader downstream keeps reading the switches; nothing else learns about
    /// Focus. `focus`, `textSize` and the extras are copied through unchanged, so the result
    /// still says what was STORED (`taskStepFactors` reads that). Mirrors Android
    /// `WidgetFill.effective`.
    ///   child viewer                         -> stored switches, Your day (a child has no to-dos)
    ///   focus To-dos                         -> events = todosEvents, meals = todosMeals, due on,
    ///                                           who's where, trips and birthdays, hints off; To-dos
    ///   Your day, events and trips and birthdays off, to-dos on
    ///                                        -> stored switches, To-dos (the old to-dos-only widget)
    ///   otherwise                            -> stored switches, Your day
    static func effective(_ stored: WidgetBlocks, isChild: Bool) -> (blocks: WidgetBlocks, layout: WidgetLayout) {
        if isChild {
            return (stored, .day)
        }
        if stored.focus == .todos {
            var blocks = stored
            blocks.events = stored.todosEvents
            blocks.whosWhere = false
            blocks.meals = stored.todosMeals
            blocks.due = true
            blocks.comingUp = false
            blocks.hint = false
            return (blocks, .todos)
        }
        if !stored.events && !stored.comingUp && stored.due {
            return (stored, .todos)
        }
        return (stored, .day)
    }

    /// The step factors `todosFill` may pick from. `[1]` unless the STORED focus is To-dos and
    /// the stored Text size is Automatic: the inferred to-dos-only widget never steps (it keeps
    /// its fixed size on both platforms). `plan` is only called for medium and large, and the
    /// small widget passes `[1]` itself. Each factor is relative to `scale`, clamped the same way
    /// as `WidgetMetrics.init`, so accessibility text never compounds past `taskStepMax`.
    static func taskStepFactors(_ blocks: WidgetBlocks, scale: CGFloat) -> [CGFloat] {
        guard blocks.focus == .todos, blocks.isAutomaticTextSize, scale > 0 else { return [1.0] }
        return taskSteps.map { factor in
            WidgetMetrics.steppedScale(scale, by: factor) / scale
        }
    }

    /// The step factors at which no title that is whole at x1 would be cut: a factor above 1 is
    /// kept only when `fits` says so; x1 always stays. Titles already too long at x1 never block
    /// a step (they are cut either way). Filters `todosFill`'s input so the fill stays numbers
    /// only. Mirrors Android `WidgetFill.widthAllowedSteps`.
    static func factorsKeepingTitles(_ factors: [CGFloat], fits: (CGFloat) -> Bool) -> [CGFloat] {
        let kept = factors.filter { factor in factor <= 1 || fits(factor) }
        return kept.isEmpty ? [1.0] : kept
    }

    static func plan(
        resolved: ResolvedDay, blocks: WidgetBlocks, layout: WidgetLayout, labels: WSLabels,
        spec: FillSpec, at date: Date
    ) -> FillPlan {
        var plan = FillPlan()
        plan.layout = layout
        var remaining = spec.bodyHeight
        let scale = spec.scale
        let day = resolved.day
        let child = resolved.isChild
        let todos = layout == .todos

        // The To-dos layout leaves out today's events that are already over: its calendar has
        // no scroll position, so medium's one event row would otherwise be a finished morning.
        let shownToday = shownRows(day.rows, blocks: blocks, today: true)
        let todayRows = todos
            ? shownToday.filter { $0.kind != .event || !$0.isPast(at: date) }
            : shownToday
        let lookAhead = lookAheadDays(resolved, blocks: blocks)
        let tasks = shownTasks(day.tasks.items, blocks: blocks, child: child)
        let calendarOn = blocks.events || blocks.comingUp
        // What the snapshot's per-switch cap left out, for the switches that are on.
        let capped = cappedTasks(day.tasks, blocks: blocks, child: child)

        // The footer and the date column cost nothing from the body budget.
        if spec.hasFooter, blocks.meals, let tonight = day.tonight, !tonight.text.isEmpty {
            // An empty WidgetText is never drawn.
            plan.tonight = tonight
        }
        if spec.hasDateColumn, blocks.due, isAllowed(.due, child: child),
           day.tasks.count > 0, !day.tasks.countText.text.isEmpty {
            plan.taskCount = day.tasks
        }

        if todos {
            // All clear is the day having no tasks to show: never how many rows fit (a widget
            // with to-dos due always shows one), and never gated on the events switch, which
            // is off by default in the To-dos focus.
            if tasks.isEmpty {
                // The section heading row stays over the all clear, as in the mockup.
                let sectionCost = sectionHeadingHeight * scale
                if remaining >= sectionCost {
                    plan.taskSection = day.tasks
                    remaining -= sectionCost
                }
                if todayRows.isEmpty, lookAhead.isEmpty {
                    if remaining >= messageHeight * scale { plan.relaxed = true }
                    return plan
                }
                // The Upcoming events extra has rows: they show under a one-line all clear.
                let cost = nothingLineHeight * scale
                if remaining >= cost {
                    plan.nothingLine = .allClear
                    remaining -= cost
                }
            } else {
                let used = placeTodos(
                    tasks, into: &plan, day: day, todayRows: todayRows, lookAhead: lookAhead,
                    blocks: blocks, labels: labels, spec: spec, height: remaining, overflow: capped
                )
                remaining -= used
            }
        } else if blocks.events, todayRows.isEmpty, lookAhead.isEmpty, tasks.isEmpty {
            // "Nothing on" is only ever said with the events switch on: hidden events are not nothing.
            if remaining >= messageHeight * scale { plan.relaxed = true }
            return plan
        }

        // (a) Today first, in full where it fits.
        if calendarOn {
            if todayRows.isEmpty {
                // The To-dos layout never says "nothing on today": its events are an extra.
                let cost = nothingLineHeight * scale
                if !todos, blocks.events, remaining >= cost {
                    plan.nothingLine = tasks.isEmpty ? .clear : .withTasks
                    remaining -= cost
                }
            } else {
                // The To-dos layout heads today's events with "next up", drawn only with a row
                // under it. Without the label (an older snapshot) the rows go in unheaded.
                var placeToday = true
                if todos, let heading = labels.eventsHeading, !heading.isEmpty {
                    let nextUpCost = dividerHeight * scale
                    if remaining >= nextUpCost + spec.rowHeight {
                        plan.eventsHeading = heading
                        remaining -= nextUpCost
                    } else {
                        placeToday = false
                    }
                }
                if placeToday {
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
        }
        plan.inlineHandoffs = blocks.whosWhere

        // (b) Hold the to-dos section's minimum before the look-ahead may take the room. The
        // To-dos layout has already placed its to-dos, so it holds nothing.
        let headingCost = sectionHeadingHeight * scale
        let reserved: CGFloat = (tasks.isEmpty || todos)
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

        // (d) The tasks take everything left. Not in the To-dos layout: they went first.
        if !todos, !tasks.isEmpty, remaining >= headingCost + spec.rowHeight {
            remaining -= headingCost
            for task in tasks {
                if remaining < spec.rowHeight { break }
                plan.tasks.append(task)
                remaining -= spec.rowHeight
            }
            plan.taskSection = day.tasks
            // Plus what the snapshot's per-switch cap left out (`capped`).
            plan.moreTasks = capped + tasks.count - plan.tasks.count
        }
        return plan
    }

    // MARK: the To-dos layout

    /// The To-dos layout's section, placed before anything else: `todosFill` picks the step and
    /// the rows per group, and the plan gets the groups, the step, "N more" and the heading's
    /// count. Returns the height it used, at the chosen step.
    private static func placeTodos(
        _ tasks: [WSTask], into plan: inout FillPlan, day: WSDay, todayRows: [WSRow],
        lookAhead: [(WSDayEntry, [WSRow])], blocks: WidgetBlocks, labels: WSLabels, spec: FillSpec,
        height: CGFloat, overflow: Int
    ) -> CGFloat {
        let scale = spec.scale
        let sectionCost = sectionHeadingHeight * scale
        let groupCost = dividerHeight * scale
        let runs = taskRuns(tasks)
        let headings: [String?] = runs.map { run in groupLabel(run.kind, labels: labels) }

        // The Upcoming events extra's slot, held first: one heading and up to `eventSlot` rows.
        // Only this slot can push a to-do off the widget (it then counts toward "N more").
        var reserve: CGFloat = 0
        if blocks.events {
            var available = todayRows.filter { $0.kind == .event }.count
            for (_, rows) in lookAhead {
                available += rows.count
            }
            if available > 0 {
                reserve = groupCost + spec.rowHeight * CGFloat(Swift.min(spec.eventSlot, available))
            }
        }

        // A step is only taken if it cuts no title that is whole at x1, so the check measures the
        // day's shown tasks (at most `maxTaskRows`) the way `TaskRowView` draws them, with the
        // lead column at its widest possible (every event time that could be drawn).
        var factors = taskStepFactors(blocks, scale: scale)
        if factors.count > 1 {
            if spec.taskRowWidth > 0 {
                var times: [String] = []
                for row in todayRows where !row.time.isEmpty {
                    times.append(row.time)
                }
                for (_, rows) in lookAhead {
                    for row in rows where !row.time.isEmpty {
                        times.append(row.time)
                    }
                }
                let lead = AgendaPanelView.timeColumnWidth(times, child: false, scale: scale)
                let rowWidth = spec.taskRowWidth
                let wholeAtStandard = Array(tasks.prefix(maxTaskRows)).filter { task in
                    TaskRowView.titleFits(task, rowWidth: rowWidth, leadWidth: lead, scale: scale)
                }
                let fits: (CGFloat) -> Bool = { factor in
                    let stepped = WidgetMetrics.steppedScale(scale, by: factor)
                    return wholeAtStandard.allSatisfy { task in
                        TaskRowView.titleFits(task, rowWidth: rowWidth, leadWidth: lead, scale: stepped)
                    }
                }
                factors = factorsKeepingTitles(factors, fits: fits)
            } else {
                factors = [1.0]
            }
        }

        let fill = todosFill(
            height: height,
            heading: sectionCost,
            row: spec.rowHeight,
            groupHeadings: headings.map { (label: String?) -> CGFloat in label == nil ? 0 : groupCost },
            reserve: reserve,
            groupSizes: runs.map { run in run.tasks.count },
            stepFactors: factors,
            overflow: overflow,
            noHeightRows: spec.noHeightTaskRows
        )

        var used = sectionCost
        for (index, run) in runs.enumerated() {
            let count = fill.shownPerGroup[index]
            if count == 0 { continue }
            let shown = Array(run.tasks.prefix(count))
            plan.taskGroups.append(
                TaskGroupPlan(heading: headings[index], isOverdue: run.kind == TaskGroupKind.overdue, tasks: shown)
            )
            plan.tasks.append(contentsOf: shown)
            if headings[index] != nil {
                used += groupCost * fill.step
            }
            used += spec.rowHeight * fill.step * CGFloat(count)
        }
        plan.taskSection = day.tasks
        plan.taskStep = fill.step
        plan.moreTasks = fill.more
        if !day.tasks.countText.text.isEmpty {
            plan.taskHeadingCount = day.tasks.countText
        }
        return used
    }

    /// The To-dos fill: how many task rows show, at which step. Numbers only (it never reads the
    /// snapshot or the OS), so it is the same function as Android's `WidgetFill.todosFill` line
    /// for line, and Android's `WidgetFillTest` vectors prove its logic. They do not prove iOS's
    /// numbers: the constants differ (here the heading is 13 and a group heading is a 15pt
    /// divider; Android's are 15 and 19).
    ///   - height: the room for the section (H). 0 or less = a host that reports no height:
    ///     Standard size and `noHeightRows` rows.
    ///   - heading: the section heading row; never stepped.
    ///   - row: one task row at step 1.
    ///   - groupHeadings: each group's heading at step 1, parallel to `groupSizes`; 0 for a
    ///     group drawn without one (its label is missing, or the run has no group).
    ///   - reserve: room held for the Upcoming events slot, taken before any to-do.
    ///   - stepFactors: the factors to try (`taskStepFactors`); `[1]` never steps.
    ///   - overflow: tasks the snapshot's cap already left out, added to "N more".
    /// Every task fits at the largest factor whose cost (heading + each shown group's heading x f
    /// + rows x row x f + reserve) is within H, with at most `maxTaskRows`. Else, at step 1,
    /// rows go in order while they fit (a group heading only with a row of its own under it),
    /// never past `maxTaskRows`, and never fewer than one: a day with tasks never looks clear.
    static func todosFill(
        height: CGFloat,
        heading: CGFloat,
        row: CGFloat,
        groupHeadings: [CGFloat],
        reserve: CGFloat,
        groupSizes: [Int],
        stepFactors: [CGFloat],
        overflow: Int,
        noHeightRows: Int
    ) -> TodosFillResult {
        let total = groupSizes.reduce(0, +)
        var result = TodosFillResult(
            step: 1, shownPerGroup: Array(repeating: 0, count: groupSizes.count), more: overflow + total
        )
        if total == 0 { return result }

        func groupHeading(_ index: Int) -> CGFloat {
            index < groupHeadings.count ? groupHeadings[index] : 0
        }

        // No height reported: a fixed count at Standard, mirroring the Your day fallback.
        if height <= 0 {
            var left = Swift.max(1, Swift.min(noHeightRows, maxTaskRows))
            var shown = 0
            for index in groupSizes.indices {
                let take = Swift.min(Swift.max(0, groupSizes[index]), left)
                result.shownPerGroup[index] = take
                left -= take
                shown += take
            }
            result.more = overflow + total - shown
            return result
        }

        // Everything at the largest step that fits.
        if total <= maxTaskRows {
            var best: CGFloat = 0
            for factor in stepFactors {
                var cost = heading + reserve + CGFloat(total) * row * factor
                for index in groupSizes.indices where groupSizes[index] > 0 {
                    cost += groupHeading(index) * factor
                }
                if cost <= height + fitEpsilon && factor > best {
                    best = factor
                }
            }
            if best > 0 {
                result.step = best
                result.shownPerGroup = groupSizes
                result.more = overflow
                return result
            }
        }

        // Not everything fits: rows in order at Standard while they fit. The first row is always
        // taken, so a day with tasks never looks clear.
        var used = heading + reserve
        var shown = 0
        filling: for index in groupSizes.indices where groupSizes[index] > 0 {
            for rowIndex in 0 ..< groupSizes[index] {
                if shown >= maxTaskRows { break filling }
                let need = row + (rowIndex == 0 ? groupHeading(index) : 0)
                if shown > 0 && used + need > height + fitEpsilon { break filling }
                used += need
                result.shownPerGroup[index] += 1
                shown += 1
            }
        }
        result.more = overflow + total - shown
        return result
    }

    /// The group a bucket belongs to; nil for an unrecognised or empty one.
    static func taskGroupKind(_ bucket: String) -> TaskGroupKind? {
        switch bucket {
        case "overdue": return .overdue
        case "today": return .today
        case "undated", "later": return .comingUp
        default: return nil
        }
    }

    /// The tasks split into runs. The snapshot already orders them bucket-first (overdue, today,
    /// undated, later), so grouping is a run-length split, not a sort. A task whose bucket is
    /// unrecognised or empty joins the run before it, with no heading of its own.
    static func taskRuns(_ tasks: [WSTask]) -> [TaskRun] {
        var runs: [TaskRun] = []
        for task in tasks {
            let kind = taskGroupKind(task.bucket)
            if !runs.isEmpty && (kind == nil || kind == runs[runs.count - 1].kind) {
                runs[runs.count - 1].tasks.append(task)
            } else {
                runs.append(TaskRun(kind: kind, tasks: [task]))
            }
        }
        return runs
    }

    /// A group's heading from the snapshot; nil (no heading) when the label is missing or empty.
    static func groupLabel(_ kind: TaskGroupKind?, labels: WSLabels) -> String? {
        let label: String?
        switch kind {
        case .some(.overdue): label = labels.groupOverdue
        case .some(.today): label = labels.groupToday
        case .some(.comingUp): label = labels.groupComingUp
        case .none: label = nil
        }
        guard let text = label, !text.isEmpty else { return nil }
        return text
    }

    /// The empty To-dos layout's title: "all clear,", or the existing "nothing on today," in a
    /// snapshot from before the label.
    static func allClearTitle(_ labels: WSLabels) -> String {
        if let title = labels.todosAllClear, !title.isEmpty { return title }
        return labels.nothingOnToday
    }

    /// How many tasks the snapshot's per-switch cap left out, for the switches that are on: the
    /// part of "N more" that was never in `items`.
    static func cappedTasks(_ tasks: WSTasks, blocks: WidgetBlocks, child: Bool) -> Int {
        let dueCap = blocks.due ? tasks.overflowDue : 0
        let hintCap = (blocks.hint && isAllowed(.hint, child: child)) ? tasks.overflowHint : 0
        return dueCap + hintCap
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
