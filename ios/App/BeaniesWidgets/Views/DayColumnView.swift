import SwiftUI

/// The slim left column on medium and large: the date at the top (a link to the Nook), the
/// weather under the month (#134), and at its foot the audience label (large, "my day" only)
/// and the to-dos count.
///
/// Nothing here may clip at a bigger Text size, so the lines below the weather's glyph +
/// temperature row drop in a fixed order until the column fits: the range (or the age)
/// first, then "my day", then the count. The glyph + temperature row is outside that
/// choice, so it never drops. Android draws the same order from `WidgetFill.dateColumnLines`.
struct DayColumnView: View {
    let entry: WSDayEntry
    let labels: WSLabels
    let links: WSLinks
    /// The to-dos block when the count is on and non-zero (`FillPlan.taskCount`).
    let taskCount: WSTasks?
    /// nil = no weather (off, no town, no reading for today, or a v2 snapshot).
    let weather: WeatherGlance?
    let showAudienceLabel: Bool
    let size: WidgetSizeKey
    let m: WidgetMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Link(destination: WidgetLinks.url(links.nook, size)) {
                VStack(alignment: .leading, spacing: 0) {
                    // 32pt Outfit Bold, line height ~0.86, tracking -0.02em, ink in both modes.
                    Text(entry.numeral)
                        .font(.outfit(size: m.s(32), weight: .bold))
                        .tracking(-0.02 * m.s(32))
                        .monospacedDigit()
                        .foregroundStyle(Color.wInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.vertical, -m.s(6))
                        .padding(.leading, -1)
                    Text(entry.weekday)
                        .font(.outfit(size: m.s(11), weight: .semibold))
                        .foregroundStyle(Color.wAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(m.standardFloor(0.85))
                        .padding(.top, 5)
                    Text(entry.month)
                        .font(.sys(size: m.s(11)))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(m.standardFloor(0.85))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let weather {
                weatherRow(weather)
                    .padding(.top, m.s(6))
            }

            // Candidates in drop order; `ViewThatFits` takes the first whose lines fit and
            // falls back to the last (no optional line at all).
            ViewThatFits(in: .vertical) {
                lines(detail: true, audience: true, count: true)
                lines(detail: false, audience: true, count: true)
                lines(detail: false, audience: false, count: true)
                lines(detail: false, audience: false, count: false)
            }
        }
    }

    // MARK: weather

    /// The row that always stays: glyph 14pt + the temperature (Outfit 13 bold). Once the
    /// reading is past `currentUntil`: today's day glyph + today's range, or today's high
    /// when the range does not fit the 52pt column (Android shows the high), in the soft ink.
    private func weatherRow(_ weather: WeatherGlance) -> some View {
        HStack(alignment: .center, spacing: 3) {
            WeatherGlyphView(glyph: weather.glyph, size: m.s(14))
            if let temp = weather.temp {
                rowText(temp, soft: weather.aged)
                    .minimumScaleFactor(m.standardFloor(0.7))
            } else {
                ViewThatFits(in: .horizontal) {
                    rowText(weather.range, soft: true)
                    rowText(weather.high, soft: true)
                        .minimumScaleFactor(m.standardFloor(0.7))
                }
            }
        }
    }

    private func rowText(_ text: String, soft: Bool) -> some View {
        Text(text)
            .font(.outfit(size: m.s(13), weight: .bold))
            .monospacedDigit()
            .foregroundStyle(soft ? Color.wInkSoft : Color.wInk)
            .lineLimit(1)
    }

    /// The droppable line under it: today's range while the reading is fresh; the age from
    /// `ageFrom` on (the range is in the row once past `currentUntil`).
    private var weatherDetail: String? {
        guard let weather else { return nil }
        if let age = weather.age { return age }
        guard weather.temp != nil, !weather.range.isEmpty else { return nil }
        return weather.range
    }

    // MARK: lines

    /// One candidate: the weather's detail line under the row, then the foot.
    private func lines(detail: Bool, audience: Bool, count: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if detail, let text = weatherDetail {
                Text(text)
                    .font(.sys(size: m.s(11)))
                    .foregroundStyle(Color.wInkSoft)
                    // The age may take two lines ("as of / 7:40am"); the range keeps to one.
                    .lineLimit(weather?.age != nil ? 2 : 1)
                    .minimumScaleFactor(m.standardFloor(0.85))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 1)
            }

            // Keep the foot off the lines above however tall the type grows.
            Spacer(minLength: m.s(8))

            VStack(alignment: .leading, spacing: 7) {
                if audience && showAudienceLabel {
                    Text(labels.myDay)
                        .font(.sys(size: m.s(11), weight: .medium))
                        .foregroundStyle(Color.wInkSoft)
                        .lineLimit(1)
                        .minimumScaleFactor(m.standardFloor(0.85))
                }
                if count, let tasks = taskCount {
                    Link(destination: WidgetLinks.url(tasks.link.isEmpty ? links.todo : tasks.link, size)) {
                        WidgetTextView(
                            text: tasks.countText,
                            font: .sys(size: m.s(11)),
                            color: .wInkSoft,
                            emphasisFont: .outfit(size: m.s(11), weight: .bold),
                            emphasisColor: .wInk
                        )
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.bottom, 1)
        }
    }
}
