import SwiftUI
import WidgetKit

/// The to-dos section (round 9b), in a fixed place directly above the footer: a quiet
/// heading ("to-dos and lists", a hairline, "2 more" when not every task fits), then the
/// rows `WidgetFill` placed, in the snapshot's order (overdue, today, undated, later),
/// whatever their kind. Never drawn for a child.
///
/// The To-dos layout draws the same section at the top of the panel, with `groups` (each under
/// its "overdue" / "due today" / "coming up" heading), the count on the heading's right, and the
/// rows at `rowMetrics` (its Automatic step). The rows are the same `TaskRowView`s, so the
/// tinted and clear renderings behave as in Your day.
struct TaskSectionView: View {
    let section: WSTasks
    let tasks: [WSTask]
    /// Tasks that passed the switches but did not fit.
    let moreCount: Int
    let labels: WSLabels
    /// `links.todo`, for a heading or a row the snapshot left without a link.
    let fallbackLink: String
    /// The calendar's time column, so glyphs and times line up and titles share one edge.
    let leadWidth: CGFloat
    let rowHeight: CGFloat
    let size: WidgetSizeKey
    /// The heading's metrics (always Standard step).
    let m: WidgetMetrics
    /// The To-dos layout: the rows in their groups. Empty = the flat `tasks` (Your day).
    var groups: [TaskGroupPlan] = []
    /// The To-dos layout: `tasks.countText` on the heading's right, in place of "{n} more".
    var headingCount: WSText? = nil
    /// The rows' and group headings' metrics (the To-dos layout's step); nil = `m`.
    var rowMetrics: WidgetMetrics? = nil

    var body: some View {
        let rows = rowMetrics ?? m
        let link = section.link.isEmpty ? fallbackLink : section.link
        VStack(alignment: .leading, spacing: 0) {
            Link(destination: WidgetLinks.url(link, size)) {
                heading
            }
            if groups.isEmpty {
                ForEach(tasks.indices, id: \.self) { index in
                    TaskRowView(
                        task: tasks[index],
                        fallbackLink: link,
                        leadWidth: leadWidth,
                        height: rowHeight,
                        size: size,
                        m: rows
                    )
                }
            } else {
                ForEach(groups.indices, id: \.self) { index in
                    groupView(groups[index], rows: rows, link: link)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// One group: its heading (a divider, the accent for "overdue", the soft ink otherwise;
    /// none when the snapshot has no label) and its rows.
    @ViewBuilder private func groupView(_ group: TaskGroupPlan, rows: WidgetMetrics, link: String) -> some View {
        if let title = group.heading {
            DayDividerView(
                date: title,
                tomorrow: nil,
                m: rows,
                dateColor: group.isOverdue ? Color.wAccent : Color.wInkSoft
            )
        }
        ForEach(group.tasks.indices, id: \.self) { index in
            TaskRowView(
                task: group.tasks[index],
                fallbackLink: link,
                leadWidth: leadWidth,
                height: rowHeight,
                size: size,
                m: rows
            )
        }
    }

    /// Mockup `.sec9`: the heading in soft ink (a boundary, not a date), the hairline, and
    /// "{n} more" filled in.
    private var heading: some View {
        HStack(spacing: 5) {
            if !section.heading.isEmpty {
                Text(section.heading)
                    .font(.sys(size: m.s(11), weight: .semibold))
                    .foregroundStyle(Color.wInkSoft)
                    .lineLimit(1)
                    .fixedSize()
            }
            Hairline()
            if let count = headingCount {
                WidgetTextView(
                    text: count,
                    font: .sys(size: m.s(11), weight: .medium),
                    color: .wInkSoft,
                    emphasisFont: .outfit(size: m.s(11), weight: .bold),
                    emphasisColor: .wAccent
                )
                .lineLimit(1)
                .fixedSize()
            } else if moreCount > 0 {
                Text(labels.moreText(moreCount))
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkSoft)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .frame(height: m.s(WidgetFill.sectionHeadingHeight))
    }
}

/// One task: the glyph in the lead column, the title, the tag on the right ("overdue",
/// "by 5pm", "today" in the accent; a later day in quieter ink), then whose it is.
struct TaskRowView: View {
    let task: WSTask
    let fallbackLink: String
    let leadWidth: CGFloat
    let height: CGFloat
    let size: WidgetSizeKey
    let m: WidgetMetrics
    /// false on the small widget, which cannot hold `Link`s (its one target is `widgetURL`).
    var linked: Bool = true

    /// The row's design sizes at scale 1, shared by `body` and `titleFits`.
    static let spacing: CGFloat = 6
    static let textSize: CGFloat = 11
    static let dotSize: CGFloat = 14

    /// Whether `task`'s title is drawn whole in a row `rowWidth` wide whose lead column is
    /// `leadWidth`, at `scale`: the same fonts, sizes and spacings `body` draws (the tag and the
    /// member dot keep their size, the title takes what is left). For the To-dos layout's
    /// Automatic step (`WidgetFill.factorsKeepingTitles`).
    static func titleFits(_ task: WSTask, rowWidth: CGFloat, leadWidth: CGFloat, scale: CGFloat) -> Bool {
        let size = textSize * scale
        var room = rowWidth - leadWidth - spacing
        if !task.tag.isEmpty {
            let tagWidth: CGFloat
            if task.tagIsAccent {
                tagWidth = TextMeasure.systemWidth(of: [task.tag], size: size, semibold: true)
            } else {
                tagWidth = TextMeasure.width(of: [task.tag], fontName: WidgetFontName.outfitBold, size: size)
            }
            room -= spacing + tagWidth
        }
        if task.dot != nil {
            room -= spacing + dotSize * scale
        }
        return TextMeasure.systemWidth(of: [task.title], size: size, semibold: false) <= room
    }

    var body: some View {
        if linked {
            Link(destination: WidgetLinks.url(task.link.isEmpty ? fallbackLink : task.link, size)) {
                row
            }
        } else {
            row
        }
    }

    private var row: some View {
        HStack(spacing: Self.spacing) {
            TaskGlyphView(kind: task.kind, m: m)
                .frame(width: leadWidth, alignment: .leading)
            // Regular, not medium: the second cue (after the checkbox) that this is a task
            // under the day and not an event in it. Event titles stay medium.
            Text(task.title)
                .font(.sys(size: m.s(Self.textSize), weight: .regular))
                .foregroundStyle(Color.wInk)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !task.tag.isEmpty {
                tag
            }
            if let dot = task.dot {
                MemberDotView(dot: dot, diameter: m.s(Self.dotSize), m: m)
            }
        }
        .frame(height: height)
    }

    /// The word carries the meaning; the colour only sorts "now" from "later". Never Alert Red.
    @ViewBuilder private var tag: some View {
        if task.tagIsAccent {
            Text(task.tag)
                .font(.sys(size: m.s(11), weight: .semibold))
                .foregroundStyle(Color.wAccent)
                .lineLimit(1)
                .fixedSize()
        } else {
            Text(task.tag)
                .font(.outfit(size: m.s(11), weight: .bold))
                .foregroundStyle(Color.wInkSoft)
                .lineLimit(1)
                .fixedSize()
        }
    }
}

/// What a task is, at a glance: a to-do's checkbox (the purple outline of a rounded square,
/// the universal "this is a task" mark, unmistakable beside a time even on the small widget),
/// a hint's bean, a list's checklist mark. A to-do's time lives in its tag, not the glyph.
struct TaskGlyphView: View {
    let kind: WSTaskKind
    let m: WidgetMetrics

    var body: some View {
        switch kind {
        case .todo:
            checkbox
        case .hint:
            bean
        case .list:
            Image(systemName: "checklist")
                .font(.system(size: m.s(11), weight: .semibold))
                .foregroundStyle(Color.wInkSoft)
        }
    }

    private var checkbox: some View {
        RoundedRectangle(cornerRadius: m.s(2.5), style: .continuous)
            .strokeBorder(Color.wDuePurple, lineWidth: 1.6)
            .frame(width: m.s(10), height: m.s(10))
            .padding(.leading, 2)
    }

    /// The full-colour bean: the asset is template-rendered for the lock screen, so the
    /// home-screen row asks for the original art. Desaturated, not flattened, when tinted.
    @ViewBuilder private var bean: some View {
        if #available(iOS 18.0, *) {
            Image("bean")
                .renderingMode(.original)
                .resizable()
                .widgetAccentedRenderingMode(.desaturated)
                .scaledToFit()
                .frame(width: m.s(11), height: m.s(13))
        } else {
            Image("bean")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: m.s(11), height: m.s(13))
        }
    }
}
