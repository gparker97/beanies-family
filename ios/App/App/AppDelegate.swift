import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    /// Reset the Capacitor bridge WKWebView's zoom back to 1 after an OAuth/deep-link
    /// return (see `scheduleWebViewZoomReset`). No-op when the webview isn't zoomed, so
    /// it never fights legitimate state; never disables pinch-zoom.
    private func resetWebViewZoom() {
        guard let webView = findBridgeWebView() else { return }
        let scrollView = webView.scrollView
        if abs(scrollView.zoomScale - 1.0) > 0.01 {
            scrollView.setZoomScale(1.0, animated: false)
        }
    }

    /// Locate the Capacitor bridge WKWebView from the window's view-controller tree
    /// (handles the bridge VC being presented-over or nested as a child).
    private func findBridgeWebView() -> WKWebView? {
        func bridge(from vc: UIViewController?) -> CAPBridgeViewController? {
            guard let vc = vc else { return nil }
            if let b = vc as? CAPBridgeViewController { return b }
            if let b = bridge(from: vc.presentedViewController) { return b }
            for child in vc.children {
                if let b = bridge(from: child) { return b }
            }
            return nil
        }
        return bridge(from: window?.rootViewController)?.webView
    }

    /// The full-page Google OAuth redirect navigates the SHARED WKWebView out to
    /// accounts.google.com — whose sub-16px inputs make iOS zoom the webview's
    /// scrollView — and returns to the app via a deep link (custom scheme / Universal
    /// Link). WKWebView retains that accumulated zoomScale across the return, and
    /// re-asserting the viewport meta from JS does NOT reset it, so the app came back
    /// stuck-zoomed with pinch unable to recover it (only a force-quit fixed it). We
    /// reset zoom ONLY on these deep-link returns — not on every foreground, which
    /// would silently discard a user's intentional pinch-zoom. An immediate pass plus
    /// one delayed pass catch the case where the webview re-settles just after the
    /// return. We deliberately do NOT add user-scalable=no / maximum-scale to the
    /// viewport meta: that would disable pinch-zoom entirely (a WCAG 1.4.4 regression)
    /// and is itself the classic "can't pinch back out" trap.
    private func scheduleWebViewZoomReset() {
        resetWebViewZoom()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.resetWebViewZoom()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        let handled = ApplicationDelegateProxy.shared.application(app, open: url, options: options)
        // OAuth/Drive redirect returns via this deep link — reset any zoom Google's
        // sign-in page left on the shared webview (see scheduleWebViewZoomReset).
        scheduleWebViewZoomReset()
        return handled
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        let handled = ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
        // OAuth/Drive redirect can return via a Universal Link — reset any zoom
        // Google's sign-in page left on the shared webview (see scheduleWebViewZoomReset).
        scheduleWebViewZoomReset()
        return handled
    }

}
