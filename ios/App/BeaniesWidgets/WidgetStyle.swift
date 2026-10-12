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

/// One scale factor for the whole widget, from the Dynamic Type setting. Text sizes, row
/// heights and the fill budget all multiply by it, so bigger text means FEWER rows rather
/// than clipped rows. Never below 1: 11pt is the floor at the default size.
struct WidgetMetrics {
    let scale: CGFloat

    init(_ size: DynamicTypeSize) {
        switch size {
        case .xSmall, .small, .medium, .large: scale = 1.0
        case .xLarge: scale = 1.08
        case .xxLarge: scale = 1.16
        case .xxxLarge: scale = 1.24
        default: scale = 1.3 // accessibility sizes; capped so a row still fits the widget
        }
    }

    init(scale: CGFloat) { self.scale = scale }

    /// A design size in points, scaled.
    func s(_ points: CGFloat) -> CGFloat { points * scale }
}

/// The beanie art for a person; unknown names fall back to `neutral`.
enum WidgetAvatarAsset {
    static let known: Set<String> = ["father", "mother", "neutral", "boy", "girl", "dog"]

    static func name(_ raw: String?) -> String {
        guard let raw, known.contains(raw) else { return "neutral" }
        return raw
    }
}
