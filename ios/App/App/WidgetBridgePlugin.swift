import Foundation
import Capacitor
import WidgetKit

/**
 * Hands the home-screen widgets their data (#130, ADR-042). The JS side is
 * `src/services/native/widgetBridgePlugin.ts`, driven by `useWidgetSnapshot`; Android's
 * counterpart is `WidgetBridgePlugin.java`.
 *
 * WHY A FILE IN THE APP GROUP. The widget extension is a separate process that runs while
 * beanies is not running at all, and it cannot reach the WebView or the encrypted cache.
 * The app computes the day in JS (the same rules as the Nook and the beanie wall), and this
 * plugin writes it as plain JSON into the App Group container; the widgets only paint it.
 * The file is wiped at sign-out (`clear`, sign-out step `clearWidgetSnapshot`).
 *
 * THE ROUND TRIP IS ALSO THE ONLY DIAGNOSTIC CHANNEL. The extension cannot log. When it
 * cannot read the file it leaves a short token in the App Group UserDefaults
 * (`WidgetSnapshotStore.swift`); `publish` reads it, clears it, and returns it as
 * `readOutcome` so the JS side can send it to the `home-widget` firehose. The same goes for
 * the placements (which sizes are on the home screen): only the app can ask WidgetCenter.
 */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    /// Must match `App.entitlements`, the widget extension's entitlements, the portal
    /// identifier and `WidgetSnapshotStore.swift` (check-ios-sources.mjs Guard 2).
    private static let appGroup = "group.family.beanies.app"

    /// Where the widgets read the snapshot inside the group container (Guard 2 pair).
    private static let snapshotPath = "Widgets/snapshot.json"

    /// App Group UserDefaults key the extension leaves a read failure in (Guard 2 pair).
    private static let readOutcomeKey = "widget-read-outcome"

    private static func snapshotURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(snapshotPath)
    }

    /**
     * Write the snapshot atomically, reload every widget, and report placements plus any
     * read failure the extension recorded since the last publish.
     *
     * Resolves `{ placements: { "ios-medium": 1, ... }, readOutcome?: "read_failed|..." }`.
     * A failure to LIST placements resolves (with empty placements and a
     * `placements_failed;` token) rather than rejecting: the snapshot is already on disk and
     * the widgets have it.
     */
    @objc func publish(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing json", "write_failed")
            return
        }
        guard let file = Self.snapshotURL() else {
            // Missing entitlement or an unregistered group: reject loudly rather than
            // resolve, or a signing misconfiguration would look like a working widget.
            call.reject("App group \(Self.appGroup) is unavailable", "app_group_unavailable")
            return
        }

        do {
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            // Readable after the first unlock, so the widget can render on a locked phone
            // once the person has unlocked it since boot.
            try Data(json.utf8).write(
                to: file,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            call.reject("Could not write the widget snapshot: \(error.localizedDescription)", "write_failed", error)
            return
        }

        WidgetCenter.shared.reloadAllTimelines()

        let readOutcome = Self.consumeReadOutcome()
        WidgetCenter.shared.getCurrentConfigurations { result in
            var payload: [String: Any] = [:]
            var tokens: [String] = []
            if let readOutcome { tokens.append(readOutcome) }

            switch result {
            case .success(let widgets):
                var counts: [String: Int] = [:]
                for widget in widgets {
                    if let key = Self.sizeKey(for: widget.family) {
                        counts[key, default: 0] += 1
                    }
                }
                payload["placements"] = counts
            case .failure(let error):
                payload["placements"] = [String: Int]()
                tokens.append("placements_failed;code=\((error as NSError).code)")
            }

            if !tokens.isEmpty { payload["readOutcome"] = tokens.joined(separator: "|") }
            call.resolve(payload)
        }
    }

    /**
     * Delete the snapshot (sign-out) and reload, so every placed widget shows "open beanies".
     * An absent file is success. A delete that throws rejects `write_failed`: family content
     * may then remain on the home screen, and the sign-out runner reports it.
     */
    @objc func clear(_ call: CAPPluginCall) {
        guard let file = Self.snapshotURL() else {
            call.reject("App group \(Self.appGroup) is unavailable", "app_group_unavailable")
            return
        }
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: file.path) {
            do {
                try fileManager.removeItem(at: file)
            } catch {
                call.reject(
                    "Could not delete the widget snapshot; family content may remain on the home screen: \(error.localizedDescription)",
                    "write_failed",
                    error
                )
                return
            }
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// Read and DELETE the extension's last read-failure token (later token wins there).
    private static func consumeReadOutcome() -> String? {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
        let value = defaults.string(forKey: readOutcomeKey)
        defaults.removeObject(forKey: readOutcomeKey)
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// The `WIDGET_SIZES` key for a placed widget (src/types/widgetSnapshot.ts).
    private static func sizeKey(for family: WidgetFamily) -> String? {
        switch family {
        case .systemSmall: return "ios-small"
        case .systemMedium: return "ios-medium"
        case .systemLarge: return "ios-large"
        default: break
        }
        if #available(iOS 16.0, *) {
            switch family {
            case .accessoryCircular, .accessoryRectangular, .accessoryInline:
                return "ios-accessory"
            default:
                break
            }
        }
        return nil
    }
}
