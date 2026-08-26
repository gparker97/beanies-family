import Capacitor
import UIKit

/**
 * The app's Capacitor bridge controller, and the ONE place iOS registers its own plugins.
 *
 * WHY THIS FILE EXISTS. Plugins that live in the APP target — as opposed to an npm package —
 * are not discovered automatically. Capacitor finds package plugins from the generated
 * registration; anything defined here has to be handed to the bridge explicitly, in
 * `capacitorDidLoad`. Android has always done the equivalent in `MainActivity.onCreate`
 * (`registerPlugin(ShareIntentPlugin.class)` and friends); iOS had no counterpart at all, so
 * the storyboard pointed straight at the stock `CAPBridgeViewController` and nothing was
 * ever registered.
 *
 * THE FAILURE THIS FIXES IS SILENT AT EVERY LAYER, which is why it survived two releases:
 * the Swift compiles, the app launches, `Capacitor.isPluginAvailable(...)` simply answers
 * false, and the JS treats that as "this device does not support it". On device that reads
 * as a share that does nothing (#64) and as a phone without Face ID (#74) — a device
 * limitation rather than a missing registration. Compiling the files, which is what the
 * earlier fix did, was necessary and not sufficient.
 *
 * TO ADD A PLUGIN: register it below AND in `MainActivity.java`. `check-ios-sources.mjs`
 * fails the release if the two sides disagree.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Order is irrelevant; keep it matching MainActivity.java so the two read as a pair.
        bridge?.registerPluginInstance(BiometricKeystorePlugin())
        bridge?.registerPluginInstance(ShareIntentPlugin())
    }
}
