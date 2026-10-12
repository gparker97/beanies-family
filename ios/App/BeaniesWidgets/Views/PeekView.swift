import SwiftUI
import UIKit
import WidgetKit

/// Who peeks over the agenda panel's top-right edge: the family on "our day", the viewer
/// alone on "my day" (and a child sees themself).
enum PeekKind {
    case family
    /// A `WidgetAvatar` asset name.
    case solo(String)

    static func forDay(_ resolved: ResolvedDay, viewer: WSViewer) -> PeekKind {
        resolved.audience == .our ? .family : .solo(viewer.avatar)
    }

    /// Inset from the panel's right edge (mockup `.pk8` 6pt, `.pk8.solo` 12pt).
    var rightInset: CGFloat {
        switch self {
        case .family: return 6
        case .solo: return 12
        }
    }
}

/// The peek art. Its bottom sits `overlap` points below the panel's top edge (the fingers
/// hold the edge) and the heads rise into the widget's top padding; callers place it with
/// `.overlay(alignment: .topTrailing)` + `offset(x: -rightInset, y: -(height - overlap))`.
/// Nothing is ever drawn under it: the first row starts below the hands.
struct PeekView: View {
    let kind: PeekKind
    let height: CGFloat

    static let overlap: CGFloat = 2

    /// The family art is 192:89; a solo peek is a 30:22 window onto the avatar's head.
    static func width(_ kind: PeekKind, height: CGFloat) -> CGFloat {
        switch kind {
        case .family: return height * 192 / 89
        case .solo: return height * 30 / 22
        }
    }

    var body: some View {
        switch kind {
        case .family:
            PeekImage(name: "peek-family")
                .frame(width: Self.width(kind, height: height), height: height)
        case .solo(let raw):
            let name = WidgetAvatarAsset.name(raw)
            let width = Self.width(kind, height: height)
            PeekImage(name: name)
                .frame(width: width, height: width * PeekImage.aspect(of: name))
                .padding(.top, height / 22)
                .frame(width: width, height: height, alignment: .top)
                .clipped()
        }
    }
}

/// The image itself, desaturated (not tinted flat) in the accented and clear modes.
struct PeekImage: View {
    let name: String

    var body: some View {
        if #available(iOS 18.0, *) {
            Image(name)
                .resizable()
                .widgetAccentedRenderingMode(.desaturated)
        } else {
            Image(name)
                .resizable()
        }
    }

    /// height / width of the bundled art, so a solo peek keeps its proportions.
    static func aspect(of name: String) -> CGFloat {
        guard let image = UIImage(named: name), image.size.width > 0 else { return 1 }
        return image.size.height / image.size.width
    }
}
