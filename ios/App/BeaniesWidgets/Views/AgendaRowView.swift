import SwiftUI
import WidgetKit

/// One calendar row: time, title, member dot (or, in the child view, a tick when done). A trip
/// or a birthday puts its glyph in the time column instead, in the accent, and a trip bolds
/// its `titleEmphasis` ("day 3 of 6"). Past rows (`endsAt` before the entry date) go faint
/// and struck through.
struct AgendaRowView: View {
    let row: WSRow
    let past: Bool
    /// "Who's where" is on: a same-person handoff replaces the title ("piano, Jo drives").
    let showInlineHandoff: Bool
    let timeWidth: CGFloat
    let height: CGFloat
    let child: Bool
    let size: WidgetSizeKey
    let m: WidgetMetrics

    var body: some View {
        Link(destination: WidgetLinks.url(row.link, size)) {
            HStack(spacing: child ? m.s(10) : 6) {
                lead
                    .frame(width: timeWidth, alignment: .leading)
                titleText
                    .frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
            .frame(height: height)
        }
    }

    /// A child's row reads as done once it is over (or is explicitly done): their day is a
    /// list of things to get through, so finished means ticked (mockup 2g). Adults keep the
    /// faint, struck-through past styling instead.
    private var childDone: Bool { row.isDone || past }

    private var title: String {
        if showInlineHandoff, let inline = row.handoff?.inlineTitle, !inline.isEmpty { return inline }
        return row.title
    }

    /// The time column: the time, or a trip's plane / a birthday's cake.
    @ViewBuilder private var lead: some View {
        switch row.kind {
        case .trip:
            RowGlyph(systemName: "airplane", size: m.s(child ? 17 : 12))
        case .birthday:
            RowGlyph(systemName: "birthday.cake", size: m.s(child ? 17 : 12))
        case .event:
            timeText
        }
    }

    // Adult times use proportional digits, the same figures `AgendaPanelView.timeWidth`
    // measures; tabular digits widened "10:15am" past the measured column. The column is
    // left-aligned, so tabular figures bought nothing. The child view keeps them (62pt floor).
    @ViewBuilder private var timeText: some View {
        if child {
            Text(row.time)
                .font(.outfit(size: m.s(19), weight: .bold))
                .monospacedDigit()
                .foregroundStyle(childDone ? Color.wInkSoft : Color.wInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        } else if past {
            // Same face as the time column is measured in (AgendaPanelView.timeWidth), or a
            // past "10:15am" no longer fits and truncates; past rows differ only by ink.
            Text(row.time)
                .font(.outfit(size: m.s(11), weight: .semibold))
                .foregroundStyle(Color.wInkFaint)
                .lineLimit(1)
        } else {
            Text(row.time)
                .font(.outfit(size: m.s(11), weight: .semibold))
                .foregroundStyle(Color.wInk)
                .lineLimit(1)
        }
    }

    @ViewBuilder private var titleText: some View {
        if child {
            WidgetTextView(
                text: titleWithEmphasis,
                font: .outfit(size: m.s(19), weight: .bold),
                color: childDone ? .wInkSoft : .wInk,
                emphasisFont: .outfit(size: m.s(19), weight: .bold),
                emphasisColor: .wAccent
            )
            .lineLimit(1)
            .truncationMode(.tail)
        } else if past {
            Text(title)
                .strikethrough(true, color: Color.wInkFaint)
                .font(.sys(size: m.s(11), weight: .medium))
                .foregroundStyle(Color.wInkFaint)
                .lineLimit(1)
                .truncationMode(.tail)
        } else {
            WidgetTextView(
                text: titleWithEmphasis,
                font: .sys(size: m.s(11), weight: .medium),
                color: .wInk,
                emphasisFont: .outfit(size: m.s(11), weight: .bold),
                emphasisColor: .wAccent
            )
            .lineLimit(1)
            .truncationMode(.tail)
        }
    }

    /// The title with a trip's "day 3 of 6" bolded in the accent. An inline handoff title
    /// replaces the whole title, so it carries no emphasis.
    private var titleWithEmphasis: WSText {
        let shown = title
        return WSText(text: shown, emphasis: shown == row.title ? row.titleEmphasis : nil)
    }

    @ViewBuilder private var trailing: some View {
        if child {
            if childDone { ChildTickView(diameter: m.s(18)) }
        } else if let dot = row.dot {
            MemberDotView(dot: dot, diameter: m.s(14), m: m)
        }
    }
}

/// A trip's or a birthday's glyph in the time column, in the accent (accent-lift on dark).
struct RowGlyph: View {
    let systemName: String
    let size: CGFloat

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Color.wAccent)
            .frame(height: size)
    }
}

/// A look-ahead day's divider: "Wed 15" in the accent, "tomorrow" in soft ink when the day
/// is the device's tomorrow, then a hairline to the right edge (mockup `.dv9`).
struct DayDividerView: View {
    let date: String
    let tomorrow: String?
    let m: WidgetMetrics

    var body: some View {
        HStack(spacing: 5) {
            Text(date)
                .font(.outfit(size: m.s(11), weight: .bold))
                .foregroundStyle(Color.wAccent)
                .lineLimit(1)
                .fixedSize()
            if let tomorrow {
                Text(tomorrow)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkSoft)
                    .lineLimit(1)
                    .fixedSize()
            }
            Hairline()
                .padding(.leading, 2)
        }
        .frame(height: m.s(WidgetFill.dividerHeight))
    }
}

/// The 1pt rule after a divider or the to-dos heading. A boundary, never text, so the
/// faint ink is thinned rather than given a token of its own.
struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(Color.wInkFaint.opacity(0.45))
            .frame(height: 1)
            .frame(maxWidth: .infinity)
    }
}

/// The handoff sub-line under a row when different people drop off and pick up:
/// up to two avatars in the time slot, then "Sam drops off, Jo picks up 12:30".
struct HandoffSubLineView: View {
    let handoff: WSHandoff
    let line: String
    let timeWidth: CGFloat
    let link: String
    let size: WidgetSizeKey
    let m: WidgetMetrics
    /// The row's own column gap, so the line starts under the title (child rows use 10).
    var spacing: CGFloat = 6

    var body: some View {
        Link(destination: WidgetLinks.url(link, size)) {
            HStack(spacing: spacing) {
                HStack(spacing: -2) {
                    ForEach(Array(handoff.avatars.prefix(2).enumerated()), id: \.offset) { pair in
                        AvatarCircle(name: pair.element, diameter: m.s(13))
                    }
                }
                .frame(width: timeWidth, alignment: .leading)
                Text(line)
                    .font(.sys(size: m.s(11), weight: .medium))
                    .foregroundStyle(Color.wInkSoft)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: m.s(15))
        }
        // Pulled up 4pt so it reads as part of the row above.
        .padding(.top, -m.s(4))
    }
}

/// A member's coloured initial, or the family hug icon. Colour is never the only signal:
/// the initial is always there, and in the tinted/clear modes the fill becomes a ring.
struct MemberDotView: View {
    let dot: WSDot
    let diameter: CGFloat
    let m: WidgetMetrics

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode

    private var fullColor: Bool { renderingMode == .fullColor }

    var body: some View {
        switch dot {
        case .member(let initial, let color, let ink):
            memberDot(
                initial: initial,
                fill: Color.fromHex(color) ?? Color.wLineStrong,
                ink: Color.fromHex(ink) ?? Color.white
            )
        case .family:
            familyDot
        }
    }

    private func memberDot(initial: String, fill: Color, ink: Color) -> some View {
        ZStack {
            if fullColor {
                Circle().fill(fill)
                // Dark adds a line-strong ring so a slate dot does not vanish into the panel.
                if colorScheme == .dark {
                    Circle().strokeBorder(Color.wLineStrong, lineWidth: 1.5)
                }
            } else {
                Circle().strokeBorder(Color.primary, lineWidth: 1)
            }
            Text(initial)
                .font(.outfit(size: m.s(10), weight: .bold))
                .foregroundStyle(fullColor ? ink : Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(1)
        }
        .frame(width: diameter, height: diameter)
    }

    private var familyDot: some View {
        Image("family-hug")
            .resizable()
            .scaledToFit()
            .padding(diameter * 0.1)
            .frame(width: diameter, height: diameter)
            .background {
                Circle().fill(fullColor ? Color.wFamilyChip : Color.clear)
            }
            .overlay {
                if !fullColor {
                    Circle().strokeBorder(Color.primary, lineWidth: 1)
                }
            }
    }
}

/// A person's beanie in a small ringed circle (the handoff sub-line).
struct AvatarCircle: View {
    let name: String
    let diameter: CGFloat

    var body: some View {
        Image(WidgetAvatarAsset.name(name))
            .resizable()
            .scaledToFill()
            .frame(width: diameter, height: diameter)
            .background { Circle().fill(Color.wRaised) }
            .clipShape(Circle())
            .overlay { Circle().strokeBorder(Color.wLineStrong, lineWidth: 1.25) }
    }
}

/// The child view's green tick on a done item.
struct ChildTickView: View {
    let diameter: CGFloat

    var body: some View {
        Image(systemName: "checkmark.circle.fill")
            .resizable()
            .scaledToFit()
            .symbolRenderingMode(.palette)
            .foregroundStyle(Color.white, Color.wTickGreen)
            .frame(width: diameter, height: diameter)
    }
}
