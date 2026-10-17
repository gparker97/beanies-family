import SwiftUI
import UIKit

/// SwiftUI views of the shared dynamic brand tokens (ios/App/Shared/BeaniesBrand.swift).
/// Each resolves against the widget's own colour scheme.
extension Color {
    static let wRaised = Color(uiColor: Brand.raised)
    static let wPanel = Color(uiColor: Brand.panel)
    static let wInk = Color(uiColor: Brand.ink)
    static let wInkSoft = Color(uiColor: Brand.inkSoft)
    static let wInkFaint = Color(uiColor: Brand.inkFaint)
    static let wLineStrong = Color(uiColor: Brand.lineStrong)
    static let wAccent = Color(uiColor: Brand.accentText)
    static let wDuePurple = Color(uiColor: Brand.duePurple)
    static let wTickGreen = Color(uiColor: Brand.tickGreen)
    static let wFamilyChip = Color(uiColor: Brand.familyChip)

    /// `#RRGGBB` from the snapshot (member colours are resolved in JS; native never
    /// computes one). Nil when malformed, so the caller can choose a neutral fallback.
    static func fromHex(_ value: String?) -> Color? {
        guard var hex = value?.trimmingCharacters(in: .whitespaces), !hex.isEmpty else { return nil }
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return nil }
        return Color(uiColor: Brand.hex(rgb))
    }
}

/// A see-through card (Background 70% / 40%) never carries readable text: the text that sits
/// outside the agenda panel (the date column, the small header, the child header) gets its own
/// near-solid tile in the card colour, drawn just outside its frame so the layout does not move.
/// At 100% nothing is drawn, so the solid widget is exactly as before; in the system's tinted or
/// clear appearance the card is stripped anyway, so the tile is skipped there too.
struct CardTile: ViewModifier {
    let background: WidgetBackgroundOption
    let outset: EdgeInsets

    @Environment(\.widgetRenderingMode) private var renderingMode

    func body(content: Content) -> some View {
        content.background {
            if background != .solid && renderingMode == .fullColor {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.wRaised.opacity(0.95))
                    .padding(EdgeInsets(
                        top: -outset.top, leading: -outset.leading,
                        bottom: -outset.bottom, trailing: -outset.trailing
                    ))
            }
        }
    }
}

extension View {
    func cardTile(_ background: WidgetBackgroundOption, outset: EdgeInsets) -> some View {
        modifier(CardTile(background: background, outset: outset))
    }
}

/// One scale factor for the whole widget, from the Dynamic Type setting. Text sizes, row
/// heights and the fill budget all multiply by it, so bigger text means FEWER rows rather
/// than clipped rows. Never below 1: 11pt is the floor at the default size. The widget's Text
/// size choice multiplies the Dynamic Type scale, within `maxScale`.
struct WidgetMetrics {
    /// The ceiling on the effective scale (Dynamic Type × the Text size choice): the accessibility
    /// cap, so a row still fits the widget. Mirrors Android `WidgetSizes.TEXT_SCALE_MAX`
    /// (android/.../widget/WidgetSizes.java); change both.
    static let maxScale: CGFloat = 1.3

    /// The absolute effective scale every design size multiplies by.
    let scale: CGFloat

    /// No default for `textSize`, so the compiler finds every place that builds metrics.
    init(_ size: DynamicTypeSize, textSize: WidgetTextSizeOption) {
        let system: CGFloat
        switch size {
        case .xSmall, .small, .medium, .large: system = 1.0
        case .xLarge: system = 1.08
        case .xxLarge: system = 1.16
        case .xxxLarge: system = 1.24
        default: system = Self.maxScale // accessibility sizes
        }
        // Bigger up to the ceiling, never smaller, never past what Dynamic Type alone does.
        scale = max(system, min(system * textSize.factor, Self.maxScale))
    }

    /// A design size in points, scaled.
    func s(_ points: CGFloat) -> CGFloat { points * scale }

    /// A `minimumScaleFactor` that keeps the Standard floor at any scale: text in a fixed-width
    /// column may shrink back to `factor` of its Standard size, so "Wednesday" fits the 52pt date
    /// column at Larger exactly as it does at Standard. (Not `floor`, which would shadow Foundation's.)
    func standardFloor(_ factor: CGFloat) -> CGFloat { factor / scale }
}

/// The beanie art for a person; unknown names fall back to `neutral`.
enum WidgetAvatarAsset {
    static let known: Set<String> = ["father", "mother", "neutral", "boy", "girl", "dog"]

    static func name(_ raw: String?) -> String {
        guard let raw, known.contains(raw) else { return "neutral" }
        return raw
    }
}

/// A weather glyph at a fixed size: the full-colour image (its own light and dark
/// appearances) in the full-colour rendering, the template one in the system's tinted and
/// clear renderings, where a colour image would be flattened into a blob.
struct WeatherGlyphView: View {
    let glyph: WSWeatherGlyph
    let size: CGFloat

    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        if renderingMode == .fullColor {
            Image(glyph.asset)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            Image(glyph.monoAsset)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        }
    }
}
