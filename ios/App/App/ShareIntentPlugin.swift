import Foundation
import Capacitor

/**
 * Hands documents shared from other apps to the WebView (#64). Android's counterpart is
 * `ShareIntentPlugin.java`; the JS side is `src/services/share/iosShareAdapter.ts`.
 *
 * WHY A CONTAINER AND NOT AN EVENT. On iOS a share goes to the Share EXTENSION, which is a
 * separate process that may run while beanies is not running at all. The only thing the two
 * share is the app group container: the extension writes each item there and exits, and the
 * app collects them the next time it becomes active. There is no intent to deliver and no
 * launch callback to hook, which is why this plugin has one method and no listeners.
 *
 * READ-THEN-DELETE, UNCONDITIONALLY. Every file is removed as it is read, and a file that
 * cannot be read is removed too. If a poison item were left behind it would be retried on
 * every single launch, and one bad share would wedge every future share behind it.
 *
 * SECURITY. The extension is invocable by any app on the device, so nothing here is trusted.
 * The read is size-capped so a hostile sender cannot exhaust memory, the sender's declared
 * type is passed through for information only (the JS side re-decides from the resolved
 * bytes), and the filename is sanitised on the JS side before it reaches storage.
 */
@objc(ShareIntentPlugin)
public class ShareIntentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareIntentPlugin"
    public let jsName = "ShareIntent"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consume", returnType: CAPPluginReturnPromise)
    ]

    /// Must match `App.entitlements`, the extension's entitlements, and the portal identifier.
    private static let appGroup = "group.family.beanies.app"

    /// Subdirectory the extension writes into, so nothing else in the group is touched.
    private static let inboxName = "ShareInbox"

    /// Matches the JS-side per-file cap (`AI_PICKER_MAX_BYTES`). Bounds a hostile sender.
    private static let maxBytes = 25 * 1024 * 1024

    /// The container the extension and the app both address.
    static func inboxURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(inboxName, isDirectory: true)
    }

    /**
     * Return every document the extension left, oldest first, and empty the inbox.
     *
     * Resolves with an empty list when there is nothing pending — the app calls this on every
     * activation, so "nothing shared" is the common case and is not an error.
     */
    @objc func consume(_ call: CAPPluginCall) {
        guard let inbox = Self.inboxURL() else {
            // The app group is missing from the entitlements or unregistered in the portal.
            // Reject rather than resolve empty: silently returning nothing here would look
            // exactly like "no shares pending" and hide a signing misconfiguration forever.
            call.reject("App group \(Self.appGroup) is unavailable", "app_group_unavailable")
            return
        }

        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: inbox,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            // No inbox yet simply means nothing has ever been shared.
            call.resolve(["files": []])
            return
        }

        // Oldest first, so a multi-item share reaches the model in the order it was sent.
        let ordered = entries.sorted { lhs, rhs in
            let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            return l < r
        }

        var files: [[String: String]] = []
        for url in ordered {
            // Deleted whatever happens below — see the read-then-delete note in the header.
            defer { try? fm.removeItem(at: url) }

            guard let attrs = try? fm.attributesOfItem(atPath: url.path),
                  let size = attrs[.size] as? Int,
                  size > 0, size <= Self.maxBytes,
                  let data = try? Data(contentsOf: url) else { continue }

            files.append([
                "name": url.lastPathComponent,
                // Informational only; the JS side decides from the bytes.
                "type": Self.mimeType(for: url.pathExtension),
                "data": data.base64EncodedString()
            ])
        }

        call.resolve(["files": files])
    }

    /// The extension preserves the real extension, so this only has to cover what it accepts.
    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "pdf": return "application/pdf"
        default: return ""
        }
    }
}
