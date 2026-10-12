import Foundation
import WidgetKit

/// The placement size a link is opened from. The raw values are the fixed set in
/// `WIDGET_SIZES` (src/types/widgetSnapshot.ts); `inboundLinkBridge` logs `w` only when it
/// is one of them.
enum WidgetSizeKey: String {
    case small = "ios-small"
    case medium = "ios-medium"
    case large = "ios-large"
    case accessory = "ios-accessory"

    init(family: WidgetFamily) {
        switch family {
        case .systemSmall: self = .small
        case .systemMedium: self = .medium
        case .systemLarge, .systemExtraLarge: self = .large
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: self = .accessory
        @unknown default: self = .medium
        }
    }
}

/// Every URL a widget opens goes through here, so every one carries `&w=<size>`.
enum WidgetLinks {
    /// The signed-out state's target (no snapshot exists, so it cannot come from one).
    static let signedOut = "https://app.beanies.family/welcome?src=widget"
    /// The unreadable state's target, and the fallback for a missing or malformed link.
    static let nookFallback = "https://app.beanies.family/nook?src=widget"

    /// `raw` with `w=<size>` appended to its query. Snapshot links are absolute https URLs
    /// that already carry `src=widget`; anything else (empty, unparseable, another scheme)
    /// falls back to the Nook so a tap always lands somewhere sensible.
    static func url(_ raw: String?, _ size: WidgetSizeKey) -> URL {
        if let raw, let url = tagged(raw, size) { return url }
        if let url = tagged(nookFallback, size) { return url }
        return URL(string: "https://app.beanies.family/nook")!
    }

    private static func tagged(_ raw: String, _ size: WidgetSizeKey) -> URL? {
        guard !raw.isEmpty,
              var components = URLComponents(string: raw),
              components.scheme?.lowercased() == "https"
        else { return nil }
        // Append to the percent-encoded query as-is, so the app's own encoding of the
        // existing parameters is never re-written.
        let tag = "w=\(size.rawValue)"
        if let query = components.percentEncodedQuery, !query.isEmpty {
            components.percentEncodedQuery = query + "&" + tag
        } else {
            components.percentEncodedQuery = tag
        }
        return components.url
    }
}
