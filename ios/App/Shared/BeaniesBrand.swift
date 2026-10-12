import UIKit

// ── Brand tokens, shared by every iOS target ──────────────────────────────────────
//
// Compiled into THREE targets (App, ShareExtension, BeaniesWidgets): an extension is a
// separate process and cannot reach the app's web theme, so the palette is hand-written
// here once instead of once per target. Kept to the CIG exactly; see
// docs/brand/beanies-cig-v2.html (slides 8-9 are the dark-mode authority) and
// packages/brand/theme.css for the token values.
//
// UIKit only, on purpose: the Share Extension is a UIKit target. SwiftUI reads these as
// `Color(uiColor:)` in the widget target (`WidgetStyle.swift`). Fonts other than the share
// sheet's SF Rounded live in the widget target too, because only that target bundles them.
//
// The App Group identifier is deliberately NOT here. Each file that addresses the group
// keeps its own `private static let appGroup`, and `scripts/check-ios-sources.mjs`
// (Guard 2) proves the copies agree. Moving it into a shared file would let that guard pass
// on "absent everywhere" and stop checking anything.
enum Brand {
    // Fixed (light-only) palette used by the Share Extension sheet.
    static let orange = UIColor(red: 0.945, green: 0.365, blue: 0.133, alpha: 1) // #F15D22
    static let terracotta = UIColor(red: 0.902, green: 0.494, blue: 0.133, alpha: 1) // #E67E22
    static let slate = UIColor(red: 0.173, green: 0.243, blue: 0.314, alpha: 1) // #2C3E50
    static let silk = UIColor(red: 0.682, green: 0.839, blue: 0.945, alpha: 1) // #AED6F1
    static let cloud = UIColor(red: 0.973, green: 0.976, blue: 0.980, alpha: 1) // #F8F9FA

    /// Outfit is not in the Share Extension bundle. SF Rounded is the closest system face —
    /// geometric and friendly where the default SF is neutral — so the sheet reads as
    /// beanies rather than as a system dialog. Falls back gracefully if unavailable.
    static func font(_ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard let rounded = base.fontDescriptor.withDesign(.rounded) else { return base }
        return UIFont(descriptor: rounded, size: size)
    }

    // ── The CIG elevation ladder and ink scale, as DYNAMIC colours ──────────────────
    //
    // One token per role, each carrying its own light/dark pair, resolved by the trait
    // collection of whatever draws it (a SwiftUI widget resolves them against its own
    // colour scheme). Accents get LIGHTER on dark, never darker.

    /// surface-ground: page background.
    static let ground = dynamic(light: 0xF8F9FA, dark: 0x151E27)
    /// surface-raised: the widget container.
    static let raised = dynamic(light: 0xFFFFFF, dark: 0x1E2A36)
    /// The agenda panel and chips (surface-overlay on dark).
    static let panel = dynamic(light: 0xEEF6FC, dark: 0x26343F)
    /// surface-hover. There is no distinct light value in the widget spec; the panel tint stands in.
    static let hover = dynamic(light: 0xEEF6FC, dark: 0x2F3E4B)
    /// Numerals, times, titles.
    static let ink = dynamic(light: 0x2C3E50, dark: 0xF2F5F7)
    /// Month, footer, labels, meta.
    static let inkSoft = dynamic(light: 0x506B7A, dark: 0xC3CED6)
    /// "later ›", "as of", past rows.
    static let inkFaint = dynamic(light: 0x506B7A, dark: 0x9AA9B4)
    /// The 1.5pt ring around member dots on dark, and avatar rings.
    static let lineStrong = dynamic(light: 0x7A8A97, dark: 0x7A8A97)
    /// Heritage Orange as TEXT: the darker text variant on light, accent-lift on dark.
    static let accentText = dynamic(light: 0xD14D1A, dark: 0xFF8B5E)
    /// The timed due-line marker.
    static let duePurple = dynamic(light: 0x9B59B6, dark: 0xCB95DD)
    /// The child view's done tick.
    static let tickGreen = dynamic(light: 0x27AE60, dark: 0x5FD08A)
    /// The circle behind the family hug icon.
    static let familyChip = dynamic(light: 0xDAEEF9, dark: 0x2F3E4B)

    /// `0xRRGGBB` → opaque sRGB colour.
    static func hex(_ rgb: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }

    /// A colour that follows the drawing context's light/dark appearance.
    static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        let lightColor = hex(light)
        let darkColor = hex(dark)
        return UIColor { traits in
            traits.userInterfaceStyle == .dark ? darkColor : lightColor
        }
    }
}
