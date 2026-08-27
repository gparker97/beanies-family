import UIKit
import Social
import UniformTypeIdentifiers

/**
 * The Share Extension (#64): beanies in the iOS share sheet for photos, screenshots and PDFs.
 *
 * Deliberately HEADLESS. It shows no compose UI: it writes each shared item into the app
 * group container, asks iOS to open beanies, and completes. The reading, the consent gate
 * and the review form all happen in the app itself — an extension is a short-lived,
 * memory-constrained process and is the wrong place to run an AI call or ask for consent.
 *
 * WHY IT DOES NOT OPEN THE APP, AND MUST NOT TRY. Android opens beanies on a share, and the
 * obvious expectation is that iOS does too. It cannot. An Apple Frameworks engineer, on the
 * developer forums: "There's no supported way for you to launch your app directly from App
 * Extensions, except Today and Widgets ... with the APIs currently available."
 * `NSExtensionContext.open` is documented for Today widgets only, and from here it does
 * exactly what the documentation implies — it returns false. We shipped it as a best-effort
 * attempt and the device confirmed it: `stage=declined`, every time.
 *
 * The known workaround is to walk the responder chain looking for something with a normal
 * `openURL`. The same engineer on that: "This could result in app review issues - if they
 * discovered it." beanies has already had one Guideline 2.1 round; an undocumented trick in
 * the review queue is a bad trade for saving a tap.
 *
 * So the extension does the honest thing instead: it CONFIRMS, visibly, that the item was
 * captured and says where it went. The complaint was never really "the app did not open" —
 * it was that a sheet rose, fell back, and nothing appeared to happen. A confirmation fixes
 * that; opening the app was only ever one way to achieve it.
 *
 * The app group is the ONLY channel to the app (`ShareIntentPlugin.swift` drains it), and the
 * identifier below must match `App.entitlements`, this target's entitlements, and the
 * identifier registered in the Developer portal.
 */
class ShareViewController: UIViewController {

    private static let appGroup = "group.family.beanies.app"
    private static let inboxName = "ShareInbox"

    /// Group-root file recording what this run did. Read + cleared by the app.
    private static let traceName = "share-open-outcome"

    /// Matches the plugin's cap and the JS `AI_PICKER_MAX_BYTES`.
    private static let maxBytes = 25 * 1024 * 1024

    /// How long the confirmation stays up. Long enough to read six words, short enough that
    /// it never feels like something to dismiss.
    private static let confirmationSeconds: TimeInterval = 1.4

    private let card = UIView()
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        buildConfirmation()
        Task { await handleShare() }
    }

    /**
     * A small confirmation card, hidden until there is something to say.
     *
     * Built in code rather than a storyboard because it is twelve lines of layout and a
     * storyboard would put the copy somewhere the reviewer of this file cannot see it.
     *
     * NOT translated, unlike the rest of the app: an extension is a separate process with no
     * access to the translation store, and shipping a second copy of the string catalogue
     * into it to localise six words is a worse trade than English. The app itself, which is
     * where every subsequent screen happens, is fully translated.
     */
    private func buildConfirmation() {
        // Cloud White on Deep Slate-ish shadow, Heritage Orange for the title - the brand
        // palette, hand-written here because an extension cannot reach the app's theme.
        card.backgroundColor = UIColor(red: 0.973, green: 0.976, blue: 0.980, alpha: 1) // #F8F9FA
        card.layer.cornerRadius = 20
        card.layer.cornerCurve = .continuous
        card.alpha = 0
        card.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        titleLabel.textColor = UIColor(red: 0.945, green: 0.365, blue: 0.133, alpha: 1) // #F15D22
        titleLabel.textAlignment = .center

        detailLabel.font = .systemFont(ofSize: 14, weight: .regular)
        detailLabel.textColor = UIColor(red: 0.173, green: 0.243, blue: 0.314, alpha: 1) // #2C3E50
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(card)
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24)
        ])
    }

    /// Show the card, hold it briefly, then finish. Always resolves, so the caller can
    /// complete the request immediately afterwards.
    @MainActor
    private func confirm(title: String, detail: String) async {
        titleLabel.text = title
        detailLabel.text = detail
        UIView.animate(withDuration: 0.18) { self.card.alpha = 1 }
        try? await Task.sleep(nanoseconds: UInt64(Self.confirmationSeconds * 1_000_000_000))
    }

    private func handleShare() async {
        guard let inbox = inboxURL() else {
            // Nothing can be written without the group, and the marker cannot be written
            // either — it lives in the same container. The app side is what makes this
            // visible: `ShareIntentPlugin.consume` REJECTS with `app_group_unavailable`
            // rather than resolving empty, precisely so a signing misconfiguration cannot
            // masquerade as "nothing was shared".
            //
            // Completing the request anyway is the right call: failing loudly here would put
            // an error sheet on top of the user's own app.
            NSLog("[beanies-share] app group \(Self.appGroup) unavailable — dropping share")
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }

        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        // A batch id keeps one share's files together and ordered; the plugin sorts by
        // modification date, and writing sequentially preserves the order they were sent.
        // Every type identifier the sender offered, whether or not we accept it. This is
        // the one fact that distinguishes "the sender gave us something unsupported" from
        // "we failed to read something we do support", and it cannot be recovered later.
        var offeredTypes: [String] = []
        var staged = 0
        for item in items {
            for provider in item.attachments ?? [] {
                offeredTypes.append(contentsOf: provider.registeredTypeIdentifiers)
                if await write(provider, to: inbox) { staged += 1 }
            }
        }

        // Nothing staged. SAY SO rather than closing silently — an unsupported item and a
        // broken extension look identical when both just dismiss.
        guard staged > 0 else {
            NSLog("[beanies-share] no supported item in this share — nothing staged")
            trace([
                "stage": "nothing_staged",
                "items": String(items.count),
                "offered": offeredTypes.joined(separator: ","),
                "staged": "0"
            ])
            await confirm(
                title: "beanies can't read that",
                detail: "Try a photo, a PDF, or a link."
            )
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }

        trace([
            "stage": "staged",
            "items": String(items.count),
            "offered": offeredTypes.joined(separator: ","),
            "staged": String(staged)
        ])

        // Tell the user where it went. iOS will not let us take them there (see the header),
        // so the next best thing is to be specific about what happens next.
        await confirm(
            title: staged == 1 ? "Saved to beanies" : "Saved \(staged) to beanies",
            detail: "Open beanies to finish adding it."
        )

        // ALWAYS last: completing tears the extension down, so anything after it may not run.
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    /**
     * Record WHAT HAPPENED on this run, for `ShareIntentPlugin` to read, delete and report
     * to the diagnostics firehose.
     *
     * An extension cannot reach `logEvent` — separate process, no WebView — so without this
     * "the share silently did nothing" is exactly as unanswerable from the logs as it is on
     * device. The first version recorded ONLY whether the app was opened, which meant every
     * path that returned earlier than that wrote nothing at all: an absent marker could mean
     * the container was unreachable, or that no item was staged, or that the extension never
     * ran. Three very different faults, one indistinguishable silence.
     *
     * So it is now written at EVERY exit that can reach the container, and carries the
     * offered attachment TYPE IDENTIFIERS — the field that says whether a sender is handing
     * over something the ladder in `write` does not accept, which is otherwise pure guesswork.
     *
     * Written to the group ROOT, deliberately NOT the inbox, so it can never be mistaken for
     * a shared document. Content is a compact `k=v;` string: type identifiers and counts
     * only, never the shared content itself.
     */
    private func trace(_ fields: [String: String]) {
        guard let root = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
        else { return }
        let line = fields.keys.sorted().map { "\($0)=\(fields[$0] ?? "")" }.joined(separator: ";")
        do {
            try Data(line.utf8).write(to: root.appendingPathComponent(Self.traceName))
        } catch {
            // Diagnostics must never break the share itself.
            NSLog("[beanies-share] could not record the run trace: \(error)")
        }
    }

    /// Resolve one attachment to a file URL and copy it into the inbox. Returns whether it
    /// actually staged something — the caller only opens the app if at least one item landed.
    @discardableResult
    private func write(_ provider: NSItemProvider, to inbox: URL) async -> Bool {
        // Ask for the types we accept, most specific first. `loadFileRepresentation` gives a
        // temporary URL we must copy out of before returning.
        // Ordered: a file representation is preferred, and `UTType.url` is last so a share
        // carrying BOTH a file and a URL writes only the file. The `return` after a
        // successful write is what guarantees one item per attachment.
        // Ordered most specific first. `plainText` is LAST and is the catch-all for the
        // very common case of a sender that hands a link over as text rather than as a URL
        // attachment — the app's orchestrator already normalises text/plain and pulls the
        // URL out of it, exactly as it does for Android, so the two platforms stay identical.
        for type in [UTType.image, UTType.pdf, UTType.url, UTType.plainText] {
            guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { continue }

            // A web URL has no file representation — load it as an item and write the
            // absolute string as a .txt, which `ShareIntentPlugin` maps to text/plain.
            // Text: write it verbatim as a .txt. No URL validation here on purpose — the
            // orchestrator owns extracting a link from prose and reports a text share with
            // no link in it properly, whereas silently dropping it here would look like the
            // share never happened.
            if type == .plainText {
                let wrote: Bool = await withCheckedContinuation { continuation in
                    provider.loadItem(forTypeIdentifier: type.identifier) { item, _ in
                        let text = (item as? String) ?? (item as? URL)?.absoluteString
                        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                              let data = text.data(using: .utf8)
                        else {
                            continuation.resume(returning: false)
                            return
                        }
                        do {
                            try data.write(to: inbox.appendingPathComponent("\(UUID().uuidString).txt"))
                            continuation.resume(returning: true)
                        } catch {
                            NSLog("[beanies-share] could not stage shared text: \(error)")
                            continuation.resume(returning: false)
                        }
                    }
                }
                if wrote { return true }
                continue
            }

            if type == .url {
                let wrote: Bool = await withCheckedContinuation { continuation in
                    provider.loadItem(forTypeIdentifier: type.identifier) { item, _ in
                        // `public.url` is a SUPERTYPE of `public.file-url`, so any attachment
                        // that is neither image nor PDF — a .docx or .zip from Files — also
                        // matches here. Without this guard its sandbox PATH was written as
                        // the shared "link", and the app then reported "No Link Found" for
                        // what is really an unsupported-file problem. Only a WEB url is a
                        // link; a file URL falls through to the unsupported path, where it
                        // belongs.
                        guard let url = item as? URL,
                              !url.isFileURL,
                              let scheme = url.scheme?.lowercased(),
                              scheme == "https" || scheme == "http",
                              let data = url.absoluteString.data(using: .utf8)
                        else {
                            continuation.resume(returning: false)
                            return
                        }
                        let destination = inbox.appendingPathComponent("\(UUID().uuidString).txt")
                        do {
                            try data.write(to: destination)
                            continuation.resume(returning: true)
                        } catch {
                            NSLog("[beanies-share] could not stage a shared link: \(error)")
                            continuation.resume(returning: false)
                        }
                    }
                }
                if wrote { return true }
                continue
            }

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
            if url != nil { return true } // written; do not also try the next type
        }
        return false
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
