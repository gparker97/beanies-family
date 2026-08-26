import UIKit
import Social
import UniformTypeIdentifiers

/**
 * The Share Extension (#64): beanies in the iOS share sheet for photos, screenshots and PDFs.
 *
 * Deliberately HEADLESS. It shows no compose UI, writes each shared item into the app group
 * container and completes immediately, so the user is returned to whatever app they came
 * from. The reading, the consent gate and the review form all happen in the app itself when
 * it next becomes active — an extension is a short-lived, memory-constrained process and is
 * the wrong place to run an AI call or ask for consent.
 *
 * The app group is the ONLY channel to the app (`ShareIntentPlugin.swift` drains it), and the
 * identifier below must match `App.entitlements`, this target's entitlements, and the
 * identifier registered in the Developer portal.
 */
class ShareViewController: UIViewController {

    private static let appGroup = "group.family.beanies.app"
    private static let inboxName = "ShareInbox"

    /// Matches the plugin's cap and the JS `AI_PICKER_MAX_BYTES`.
    private static let maxBytes = 25 * 1024 * 1024

    override func viewDidLoad() {
        super.viewDidLoad()
        // No UI: the sheet dismisses as soon as the items are written.
        view.backgroundColor = .clear
        Task { await handleShare() }
    }

    private func handleShare() async {
        defer { extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }

        guard let inbox = inboxURL() else {
            // Nothing can be written without the group. Completing the request anyway is the
            // right call: failing loudly here would mean an error sheet on top of the user's
            // own app, and the app can say nothing arrived.
            NSLog("[beanies-share] app group \(Self.appGroup) unavailable — dropping share")
            return
        }

        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        // A batch id keeps one share's files together and ordered; the plugin sorts by
        // modification date, and writing sequentially preserves the order they were sent.
        for item in items {
            for provider in item.attachments ?? [] {
                await write(provider, to: inbox)
            }
        }
    }

    /// Resolve one attachment to a file URL and copy it into the inbox.
    private func write(_ provider: NSItemProvider, to inbox: URL) async {
        // Ask for the types we accept, most specific first. `loadFileRepresentation` gives a
        // temporary URL we must copy out of before returning.
        for type in [UTType.image, UTType.pdf] {
            guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { continue }

            let url: URL? = await withCheckedContinuation { continuation in
                provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                    guard let url else {
                        continuation.resume(returning: nil)
                        return
                    }
                    // Copy INSIDE the callback: the temporary file is deleted the moment it
                    // returns, so resuming with the original URL would hand back a dead path.
                    let destination = inbox.appendingPathComponent(
                        Self.uniqueName(for: url)
                    )
                    do {
                        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
                        guard size > 0, size <= Self.maxBytes else {
                            // Over-cap items are dropped here rather than written and then
                            // rejected in the app, which would cost a pointless copy.
                            NSLog("[beanies-share] dropping oversized item (\(size) bytes)")
                            continuation.resume(returning: nil)
                            return
                        }
                        try FileManager.default.copyItem(at: url, to: destination)
                        continuation.resume(returning: destination)
                    } catch {
                        NSLog("[beanies-share] could not stage a shared item: \(error)")
                        continuation.resume(returning: nil)
                    }
                }
            }
            if url != nil { return } // written; do not also try the next type
        }
    }

    /// A collision-free name that KEEPS the real extension — the plugin maps it to a MIME.
    private static func uniqueName(for url: URL) -> String {
        let ext = url.pathExtension.isEmpty ? "dat" : url.pathExtension
        return "\(UUID().uuidString).\(ext)"
    }

    private func inboxURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
            .appendingPathComponent(Self.inboxName, isDirectory: true)
    }
}
