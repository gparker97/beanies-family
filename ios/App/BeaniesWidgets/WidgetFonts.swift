import SwiftUI
import UIKit

/// The bundled faces (Info.plist `UIAppFonts`; without that list `Font.custom` silently
/// falls back to SF). PostScript names, not file names:
///   Outfit-SemiBold.ttf → "Outfit-SemiBold"  (CSS weight 600)
///   Outfit-Bold.ttf     → "Outfit-Bold"      (CSS weight 700)
///   Caveat-Bold.ttf     → "CaveatRoman-Bold" (the small widget's handwritten line only)
///
/// Every size here is FIXED (`fixedSize:`): the widget scales text itself through
/// `WidgetMetrics`, so text, row heights and the fill budget grow together and a large
/// Dynamic Type setting drops rows instead of clipping them.
enum WidgetFontName {
    static let outfitSemiBold = "Outfit-SemiBold"
    static let outfitBold = "Outfit-Bold"
    static let caveatBold = "CaveatRoman-Bold"
}

extension Font {
    /// Outfit at 600 (`.semibold` or lighter) or 700 (`.bold` or heavier).
    static func outfit(size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .custom(WidgetFontName.uiName(for: weight), fixedSize: size)
    }

    /// Caveat Bold, for the handwritten count line and the "nothing on today" state.
    static func caveat(size: CGFloat) -> Font {
        .custom(WidgetFontName.caveatBold, fixedSize: size)
    }

    /// The system face (SF / the Inter stand-in) at a fixed size.
    static func sys(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

extension WidgetFontName {
    static func uiName(for weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: return outfitBold
        default: return outfitSemiBold
        }
    }
}

/// Measures text the way the widget will draw it, for the time column's width (the widest
/// visible time in this widget). Uses the same bundled face; SF if it failed to register.
enum TextMeasure {
    static func width(of strings: [String], fontName: String, size: CGFloat) -> CGFloat {
        let font = UIFont(name: fontName, size: size) ?? UIFont.systemFont(ofSize: size, weight: .semibold)
        let widest = strings
            .map { ($0 as NSString).size(withAttributes: [.font: font]).width }
            .max() ?? 0
        // +2: monospaced-digit rendering can be a hair wider than the proportional measure.
        return ceil(widest) + 2
    }
}
