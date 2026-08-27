import UIKit
import Social
import UniformTypeIdentifiers
import UserNotifications

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
 * The known workaround is to walk the responder chain for `UIApplication`. beanies ships
 * it, on greg's explicit decision, prompted by ChatGPT doing the same - see
 * `openContainingApp` for the technique, the risk, and the one-method remediation. The
 * notification below is its fallback and remains the sanctioned path.
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

    // ── Brand tokens ──────────────────────────────────────────────────────────────
    //
    // Hand-written because an extension is a separate process and cannot reach the app's
    // theme. Kept to the CIG palette exactly; see docs/brand/beanies-cig-v2.html.
    private enum Brand {
        static let orange = UIColor(red: 0.945, green: 0.365, blue: 0.133, alpha: 1) // #F15D22
        static let terracotta = UIColor(red: 0.902, green: 0.494, blue: 0.133, alpha: 1) // #E67E22
        static let slate = UIColor(red: 0.173, green: 0.243, blue: 0.314, alpha: 1) // #2C3E50
        static let silk = UIColor(red: 0.682, green: 0.839, blue: 0.945, alpha: 1) // #AED6F1
        static let cloud = UIColor(red: 0.973, green: 0.976, blue: 0.980, alpha: 1) // #F8F9FA

        /// Outfit is not in the extension bundle. SF Rounded is the closest system face —
        /// geometric and friendly where the default SF is neutral — so the sheet reads as
        /// beanies rather than as a system dialog. Falls back gracefully if unavailable.
        static func font(_ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
            let base = UIFont.systemFont(ofSize: size, weight: weight)
            guard let rounded = base.fontDescriptor.withDesign(.rounded) else { return base }
            return UIFont(descriptor: rounded, size: size)
        }
    }

    /// What was captured, as the sheet needs to show it. Assembled from the share itself —
    /// no network, no AI, nothing that could make the user wait.
    private struct Capture {
        var headline: String
        /// The label under the headline, e.g. "photo" or a site name.
        var source: String
        /// What to CALL it in a sentence. Separate from `source` because a link's source is
        /// its site ("youtube.com"), which does not read as a noun in "read this ___".
        var noun: String
        var thumbnail: UIImage?
    }

    private let card = UIView()
    private let mark = UIImageView()
    private let titleLabel = UILabel()
    private let pod = UIView()
    private let podThumb = UIImageView()
    private let podHeadline = UILabel()
    private let podSource = UILabel()
    private let bodyLabel = UILabel()
    private let doneButton = UIButton(type: .system)

    /// What was captured, held so the button's notification can name it. Nil until staged.
    private var captured: Capture?

    /// Whether beanies may post notifications. Decided once, before the card is drawn, so
    /// the copy never promises a banner that will not appear.
    private var canNotify = false

    /// The app's custom scheme (`CFBundleURLTypes` in ios/App/App/Info.plist).
    private static let urlScheme = "family.beanies.app"

    /// Everything `trace` has recorded this run, so later calls add to it rather than
    /// overwrite it.
    private var traced: [String: String] = [:]

    /// Retained so `viewDidLayoutSubviews` can resize it — CALayers do not participate in
    /// autolayout, so a rotation would otherwise leave the wash the wrong size.
    private var backdropGradient: CAGradientLayer?

    override func viewDidLoad() {
        super.viewDidLoad()
        // Deep Slate rather than black: even the scrim is brand.
        buildBackdrop()
        buildCard()
        showCapturing()
        Task { await handleShare() }
    }

    /**
     * The ground the card sits on.
     *
     * It was a translucent scrim, which composited over the system sheet's own grey and read
     * as exactly that — grey. An extension sheet covers the whole screen, so this is beanies'
     * screen for the moment it is up, and it should look like it: a soft Cloud White to Sky
     * Silk wash, with the wordmark above the card so the app is NAMED rather than merely
     * implied by its colours.
     */
    private func buildBackdrop() {
        let gradient = CAGradientLayer()
        gradient.colors = [Brand.cloud.cgColor, Brand.silk.withAlphaComponent(0.55).cgColor]
        gradient.locations = [0.0, 1.0]
        gradient.frame = UIScreen.main.bounds
        view.layer.insertSublayer(gradient, at: 0)
        view.backgroundColor = Brand.cloud
        backdropGradient = gradient

        let wordmark = UILabel()
        wordmark.text = "beanies.family"
        wordmark.font = Brand.font(15, .semibold)
        wordmark.textColor = Brand.slate.withAlphaComponent(0.55)
        wordmark.textAlignment = .center
        wordmark.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(wordmark)
        NSLayoutConstraint.activate([
            wordmark.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            wordmark.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18)
        ])
    }

    /// The gradient needs its frame kept in step with rotation; a CALayer does not autolayout.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        backdropGradient?.frame = view.bounds
    }

    /**
     * The sheet.
     *
     * Built in code rather than a storyboard deliberately: it is one card, and a storyboard
     * would put the copy somewhere nobody reviewing this file would see it.
     *
     * NOT translated, unlike the rest of the app. An extension is a separate process with no
     * access to the translation store, and shipping a second copy of the string catalogue to
     * localise a handful of words is the worse trade. Every screen after this one lives in
     * the app, which is fully translated.
     */
    private func buildCard() {
        card.backgroundColor = Brand.cloud
        card.layer.cornerRadius = 28 // squircle, per the CIG — never sharp corners
        card.layer.cornerCurve = .continuous
        card.layer.shadowColor = Brand.slate.cgColor
        card.layer.shadowOpacity = 0.18
        card.layer.shadowRadius = 24
        card.layer.shadowOffset = CGSize(width: 0, height: 8)
        card.alpha = 0
        card.transform = CGAffineTransform(translationX: 0, y: 12)
        card.translatesAutoresizingMaskIntoConstraints = false

        // The beanies family itself, bundled into the extension (BeaniesFamily.png in this
        // target's Resources — an extension cannot reach the app's asset catalogue). This
        // replaced a row of four drawn beans: with the wordmark on the backdrop, two brand
        // marks on one small sheet was one accessory too many.
        mark.image = UIImage(named: "BeaniesFamily")
        mark.contentMode = .scaleAspectFit
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.heightAnchor.constraint(equalToConstant: 72).isActive = true
        // If the asset ever failed to bundle, the sheet should still read correctly rather
        // than leaving a 72pt hole.
        mark.isHidden = mark.image == nil

        titleLabel.font = Brand.font(24, .bold)
        titleLabel.textColor = Brand.orange
        titleLabel.textAlignment = .center

        // The captured item, INSET on Sky Silk — the thing you shared, visibly held inside
        // the pod rather than described in prose.
        pod.backgroundColor = Brand.silk.withAlphaComponent(0.34)
        pod.layer.cornerRadius = 18
        pod.layer.cornerCurve = .continuous
        pod.isHidden = true
        pod.translatesAutoresizingMaskIntoConstraints = false

        podThumb.contentMode = .scaleAspectFill
        podThumb.clipsToBounds = true
        podThumb.layer.cornerRadius = 12
        podThumb.layer.cornerCurve = .continuous
        podThumb.isHidden = true
        podThumb.translatesAutoresizingMaskIntoConstraints = false
        podThumb.widthAnchor.constraint(equalToConstant: 44).isActive = true
        podThumb.heightAnchor.constraint(equalToConstant: 44).isActive = true

        podHeadline.font = Brand.font(15, .semibold)
        podHeadline.textColor = Brand.slate
        podHeadline.numberOfLines = 2

        podSource.font = Brand.font(13, .regular)
        podSource.textColor = Brand.slate.withAlphaComponent(0.62)

        let podText = UIStackView(arrangedSubviews: [podHeadline, podSource])
        podText.axis = .vertical
        podText.spacing = 2

        let podRow = UIStackView(arrangedSubviews: [podThumb, podText])
        podRow.axis = .horizontal
        podRow.spacing = 12
        podRow.alignment = .center
        podRow.translatesAutoresizingMaskIntoConstraints = false
        pod.addSubview(podRow)
        NSLayoutConstraint.activate([
            podRow.topAnchor.constraint(equalTo: pod.topAnchor, constant: 14),
            podRow.bottomAnchor.constraint(equalTo: pod.bottomAnchor, constant: -14),
            podRow.leadingAnchor.constraint(equalTo: pod.leadingAnchor, constant: 14),
            podRow.trailingAnchor.constraint(equalTo: pod.trailingAnchor, constant: -14)
        ])

        bodyLabel.font = Brand.font(14, .regular)
        bodyLabel.textColor = Brand.slate.withAlphaComponent(0.78)
        bodyLabel.textAlignment = .center
        bodyLabel.numberOfLines = 0

        doneButton.backgroundColor = Brand.orange
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.titleLabel?.font = Brand.font(16, .semibold)
        doneButton.layer.cornerRadius = 16 // rounded-2xl
        doneButton.layer.cornerCurve = .continuous
        doneButton.isHidden = true
        doneButton.addTarget(self, action: #selector(dismissSheet), for: .touchUpInside)
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        doneButton.heightAnchor.constraint(equalToConstant: 50).isActive = true

        let stack = UIStackView(arrangedSubviews: [mark, titleLabel, pod, bodyLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .fill
        stack.setCustomSpacing(14, after: mark)
        stack.setCustomSpacing(18, after: bodyLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        mark.setContentHuggingPriority(.required, for: .vertical)

        view.addSubview(card)
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 26),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22)
        ])

        UIView.animate(withDuration: 0.26, delay: 0.02, options: [.curveEaseOut]) {
            self.card.alpha = 1
            self.card.transform = .identity
        }
    }

    @MainActor private func showCapturing() {
        titleLabel.text = "counting beans..."
        bodyLabel.text = "catching what you shared."
    }

    /// The item landed. Say what it is, and be precise: it is captured, NOT saved.
    @MainActor private func showCaptured(_ capture: Capture, count: Int) {
        captured = capture
        titleLabel.text = "got it"
        podHeadline.text = capture.headline
        podSource.text = count > 1 ? "\(capture.source) - \(count) items" : capture.source
        podThumb.image = capture.thumbnail
        podThumb.isHidden = capture.thumbnail == nil
        pod.isHidden = false

        // One line, because the button attempts one thing: open beanies. Where iOS refuses
        // that, a notification takes the user to the same place - a degraded version of the
        // same promise rather than a different one, so the sentence stays true either way.
        // It NAMES the thing, so this is about the photo or link just shared, not about "it".
        bodyLabel.text = "tap below to open beanies.family and read this \(capture.noun)."
        doneButton.setTitle("process in beanies", for: .normal)
        doneButton.isHidden = false
    }

    /// Nothing usable. Heritage Orange, never Alert Red — red is for destructive actions
    /// only, and failing to read a file is not one.
    @MainActor private func showUnsupported() {
        titleLabel.text = "can't read that"
        bodyLabel.text = "beanies takes photos, PDFs and links. this one isn't one of those."
        doneButton.setTitle("close", for: .normal)
        doneButton.isHidden = false
    }

    /// The ONLY way out. The sheet stays up until it is tapped, so there is time to read
    /// what was captured — an auto-dismissing card was the previous version's mistake.
    ///
    /// Posts the notification on the way, when there is something to announce and beanies is
    /// allowed to. That notification is the ONE sanctioned route back into the app: iOS
    /// forbids an extension from opening its container, but it will happily launch it when
    /// the user taps a notification.
    @objc private func dismissSheet() {
        doneButton.isEnabled = false
        Task {
            // Ask iOS to open beanies. Unlike the first attempt this reports REAL success -
            // see `openContainingApp` - so the notification fallback is driven by what
            // actually happened rather than by whether a selector existed.
            let opened = await openContainingApp()
            trace(["opened_directly": opened ? "yes" : "no"])
            if !opened, canNotify, let capture = captured {
                await postImportNotification(for: capture)
            }
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    /**
     * Ask iOS to foreground beanies. UNSUPPORTED — read all of this before touching it.
     *
     * `NSExtensionContext.open` is documented for the Today and iMessage extension points
     * only; we shipped it, measured `stage=declined`, and removed it. This instead walks the
     * responder chain for `UIApplication`, which is the technique behind every app that
     * appears to open itself from a share sheet. Apple's engineer on it: "This could result
     * in app review issues - if they discovered it." Shipped on greg's explicit decision.
     *
     * ⚠️ IF APP REVIEW REJECTS beanies FOR THIS, DELETE THIS METHOD AND ITS ONE CALLER.
     * `dismissSheet` then falls back to the notification, which is sanctioned and works.
     *
     * ATTEMPT 2. Attempt 1 (build 51) used the DEPRECATED two-argument `openURL:`, did not
     * check that the responder was actually `UIApplication`, and tore the extension down
     * immediately afterwards. Something answered the selector and did nothing, so it
     * reported success on a share that opened nothing (`opened_directly=yes`) and that false
     * positive suppressed the notification. Three fixes here:
     *
     *   1. `openURL:options:completionHandler:`, the method that is not deprecated.
     *   2. The responder must BE `UIApplication`, checked by class.
     *   3. The result comes from the completion handler, so success is observed rather than
     *      assumed - and the request is not completed until it arrives.
     *
     * The three-argument selector cannot go through `perform`, which takes at most two, so
     * it is called through a function pointer. That is only safe because the signature is
     * fixed public API and `responds(to:)` gates it; if either stops being true this must
     * go back to being unreachable rather than being "fixed" by loosening the guard.
     */
    private func openContainingApp() async -> Bool {
        guard let url = URL(string: "\(Self.urlScheme)://share"),
              let applicationClass = NSClassFromString("UIApplication")
        else { return false }

        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.isKind(of: applicationClass), current.responds(to: selector) {
                return await withCheckedContinuation { continuation in
                    var resumed = false
                    let finish: (Bool) -> Void = { ok in
                        guard !resumed else { return }
                        resumed = true
                        continuation.resume(returning: ok)
                    }

                    typealias OpenURL = @convention(c) (
                        NSObject, Selector, NSURL, NSDictionary, @escaping (Bool) -> Void
                    ) -> Void
                    let implementation = current.method(for: selector)
                    let open = unsafeBitCast(implementation, to: OpenURL.self)
                    open(current, selector, url as NSURL, [:] as NSDictionary) { finish($0) }

                    // If the handler never fires we would hang the sheet open forever, so
                    // treat silence as failure and let the notification take over.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { finish(false) }
                }
            }
            responder = current.next
        }
        NSLog("[beanies-share] UIApplication is not in the responder chain — using the notification")
        return false
    }

    /**
     * Ask whether beanies may post notifications. Authorization belongs to the CONTAINING
     * APP and extensions inherit it, so this is a read, never a request — an extension has
     * no business raising a permission prompt on top of somebody else's app.
     */
    private func notificationsAllowed() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        default: return false
        }
    }

    /**
     * Announce the capture so one tap gets the user into beanies.
     *
     * It deliberately carries NO deep-link payload and needs no handler in the app. The tap
     * only has to LAUNCH beanies; `iosShareAdapter` already drains the app-group inbox on
     * launch and on resume, so the item is picked up and routed to its review surface by the
     * path every other platform already uses. Adding a routing payload here would be a
     * second way to do the same thing, and a second thing to keep in step.
     *
     * A fresh identifier per share, so several shares stack rather than replacing each other.
     */
    private func postImportNotification(for capture: Capture) async {
        let content = UNMutableNotificationContent()
        // An INSTRUCTION, not a status. "ready to import" told the user something was true
        // and left them to work out that tapping was the point; this asks for the tap, which
        // is the only thing that gets them back into the app.
        content.title = "tap to import into beanies.family"
        // The item's own name, so the notification is worth reading rather than generic.
        content.body = capture.headline
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "beanies-share-\(UUID().uuidString)",
            content: content,
            trigger: nil // immediate
        )
        do {
            try await UNUserNotificationCenter.current().add(request)
            trace(["stage": "notified", "notif": "posted"])
        } catch {
            // Never fatal: the item is already staged, so the app still finds it on next
            // launch. Recorded so a silently-failing notification is diagnosable.
            NSLog("[beanies-share] could not post the import notification: \(error)")
            trace(["stage": "notify_failed", "notif": "\(error)"])
        }
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
            await showUnsupported()
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
            await showUnsupported()
            return
        }

        trace([
            "stage": "staged",
            "items": String(items.count),
            "offered": offeredTypes.joined(separator: ","),
            "staged": String(staged)
        ])

        // iOS will not let us take the user to the app (see the header), so the next best
        // thing is to be specific: show WHAT was captured, and what happens next. The sheet
        // now stays up until they dismiss it.
        // Resolved BEFORE the card renders: `showCaptured` picks its copy and its button
        // label from this, and the whole point is not to promise a banner that cannot appear.
        canNotify = await notificationsAllowed()
        trace(["notif_allowed": canNotify ? "yes" : "no"])

        let capture = await describe(items)
        await showCaptured(capture, count: staged)
        // Deliberately NOT completing here. Completing tears the extension down, so doing it
        // now would close the sheet the instant it appeared — which is the whole complaint
        // this card exists to answer. `dismissSheet` owns the exit, on the user's tap.
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
        // MERGE, never replace. The notification outcome is recorded after the staging
        // outcome, and an overwriting trace would erase the `offered=` types that are the
        // whole reason this file exists.
        traced.merge(fields) { _, new in new }
        let line = traced.keys.sorted().map { "\($0)=\(traced[$0] ?? "")" }.joined(separator: ";")
        do {
            try Data(line.utf8).write(to: root.appendingPathComponent(Self.traceName))
        } catch {
            // Diagnostics must never break the share itself.
            NSLog("[beanies-share] could not record the run trace: \(error)")
        }
    }

    /**
     * Describe the share for the card, from what is already in hand.
     *
     * Strictly local: no network and no AI, so nothing here can make the user wait or send
     * anything off the device before they have seen what beanies took. `attributedContentText`
     * is where most senders put the human title — it is how a YouTube share can name the
     * video rather than showing a bare URL.
     */
    private func describe(_ items: [NSExtensionItem]) async -> Capture {
        let providers = items.flatMap { $0.attachments ?? [] }
        let titleText = items.compactMap { $0.attributedContentText?.string ?? $0.attributedTitle?.string }
            .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

        guard let provider = providers.first else {
            return Capture(headline: titleText ?? "your item", source: "shared", noun: "item", thumbnail: nil)
        }

        let types = provider.registeredTypeIdentifiers
        let isImage = types.contains { $0.hasPrefix("public.image") || $0.contains("jpeg") || $0.contains("png") || $0.contains("heic") }
        let isPDF = types.contains { $0.contains("pdf") }

        // A thumbnail only for pictures, where it is the fastest possible confirmation that
        // beanies took the RIGHT one. `loadPreviewImage` is best-effort by design.
        var thumbnail: UIImage?
        if isImage {
            thumbnail = await withCheckedContinuation { continuation in
                provider.loadPreviewImage(options: [:]) { item, _ in
                    continuation.resume(returning: item as? UIImage)
                }
            }
        }

        if isImage {
            return Capture(headline: titleText ?? "a photo", source: "photo", noun: "photo", thumbnail: thumbnail)
        }
        if isPDF {
            return Capture(headline: titleText ?? "a document", source: "PDF", noun: "document", thumbnail: nil)
        }
        // A link, or text carrying one. Name the site rather than echoing a long URL.
        let host = titleText.flatMap { text -> String? in
            guard let match = text.split(separator: " ").compactMap({ URL(string: String($0)) }).first,
                  let host = match.host
            else { return nil }
            return host.replacingOccurrences(of: "www.", with: "")
        }
        return Capture(headline: titleText ?? "a link", source: host ?? "link", noun: "link", thumbnail: nil)
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
