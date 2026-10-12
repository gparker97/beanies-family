import SwiftUI
import WidgetKit

/// The to-dos section (round 9b), in a fixed place directly above the footer: a quiet
/// heading ("to-dos and lists", a hairline, "2 more" when not every task fits), then the
/// rows `WidgetFill` placed, in the snapshot's order (overdue, today, undated, later),
/// whatever their kind. Never drawn for a child.
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
    let m: WidgetMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Link(destination: WidgetLinks.url(section.link.isEmpty ? fallbackLink : section.link, size)) {
                heading
            }
            ForEach(tasks.indices, id: \.self) { index in
                TaskRowView(
                    task: tasks[index],
                    fallbackLink: section.link.isEmpty ? fallbackLink : section.link,
                    leadWidth: leadWidth,
                    height: rowHeight,
                    size: size,
                    m: m
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            if moreCount > 0 {
                Text(labels.more.replacingOccurrences(of: "{n}", with: String(moreCount)))
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

    var body: some View {
        Link(destination: WidgetLinks.url(task.link.isEmpty ? fallbackLink : task.link, size)) {
            HStack(spacing: 6) {
                TaskGlyphView(kind: task.kind, timed: task.timed, m: m)
                    .frame(width: leadWidth, alignment: .leading)
                Text(task.title)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInk)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !task.tag.isEmpty {
                    tag
                }
                if let dot = task.dot {
                    MemberDotView(dot: dot, diameter: m.s(14), m: m)
                }
            }
            .frame(height: height)
        }
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

/// What a task is, at a glance (mockup 9c): a to-do's purple ring (filled when it has a
/// time), a hint's bean, a list's checklist mark.
struct TaskGlyphView: View {
    let kind: WSTaskKind
    let timed: Bool
    let m: WidgetMetrics

    var body: some View {
        switch kind {
        case .todo:
            ring
        case .hint:
            bean
        case .list:
            Image(systemName: "checklist")
                .font(.system(size: m.s(11), weight: .semibold))
                .foregroundStyle(Color.wInkSoft)
        }
    }

    private var ring: some View {
        ZStack {
            if timed {
                Circle().fill(Color.wDuePurple)
            } else {
                Circle().strokeBorder(Color.wDuePurple, lineWidth: 1.6)
            }
        }
        .frame(width: m.s(9), height: m.s(9))
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
