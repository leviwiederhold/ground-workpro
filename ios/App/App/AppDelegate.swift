import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let appBackgroundColor = UIColor(red: 249.0 / 255.0, green: 250.0 / 255.0, blue: 251.0 / 255.0, alpha: 1)

    /// Used only if capacitor.config.json is missing or unreadable, which should
    /// not happen in a synced build.
    private static let fallbackServerURL = "https://ground-workpro.vercel.app"

    /// Dedicated native login route. Must match NATIVE_LOGIN_ROUTE in
    /// src/lib/auth/loginFlow.ts.
    private static let nativeLoginPath = "/native/login"

    /// The URL this build loads.
    ///
    /// Read from the bundled capacitor.config.json that `npx cap sync ios`
    /// generates, so `CAPACITOR_SERVER_URL=<preview> npx cap sync ios` actually
    /// takes effect. This was previously a hardcoded production URL, which meant
    /// the WebView force-loaded production and silently overrode any synced
    /// preview URL — testing a PR deployment on device was impossible.
    private lazy var appURL: URL = AppDelegate.resolveAppURL()

    private var didInstallNativeMarker = false
    private var didLoadAppURL = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        clearWebViewAssetCache()
        window?.backgroundColor = appBackgroundColor
        DispatchQueue.main.async { [weak self] in
            self?.configureWebViewBackground()
        }
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
        configureWebViewBackground()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func configureWebViewBackground() {
        window?.backgroundColor = appBackgroundColor
        window?.rootViewController?.view.backgroundColor = appBackgroundColor
        configureWebView(in: window?.rootViewController?.view)
    }

    private func configureWebView(in view: UIView?) {
        guard let view = view else {
            return
        }

        if let webView = view as? WKWebView {
            installNativeMarker(in: webView)
            loadAppIfNeeded(in: webView)
            webView.isOpaque = false
            webView.backgroundColor = appBackgroundColor
            webView.scrollView.backgroundColor = appBackgroundColor
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.contentInset = .zero
            webView.scrollView.scrollIndicatorInsets = .zero
        }

        view.subviews.forEach { configureWebView(in: $0) }
    }

    private func installNativeMarker(in webView: WKWebView) {
        guard !didInstallNativeMarker else {
            return
        }

        didInstallNativeMarker = true
        let source = """
        window.__GROUNDWORK_NATIVE_APP__ = true;
        window.__GROUNDWORK_NATIVE_PLATFORM__ = 'ios';
        try { window.localStorage.setItem('groundwork.nativeApp', '1'); } catch (error) {}
        """
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(script)
        webView.evaluateJavaScript(source, completionHandler: nil)
    }

    /// Resolve the server URL from the bundled Capacitor config, appending the
    /// `gw_native=1` marker the web app uses for native-runtime detection.
    private static func resolveAppURL() -> URL {
        let configuredURL = readConfiguredServerURL() ?? fallbackServerURL

        guard var components = URLComponents(string: configuredURL), components.host != nil else {
            // Unparseable config value — fall back rather than crash on launch.
            return URL(string: "\(fallbackServerURL)/?gw_native=1")!
        }

        // The native app opens the DEDICATED native login route. The route is the
        // authoritative native/web distinction: /native/login always renders the
        // native provider UI, so the buttons no longer depend on runtime
        // detection, bridge timing, or origin-scoped storage. If the user already
        // has a session, that route redirects into the dashboard itself.
        components.path = nativeLoginPath

        // The marker is kept only as a FALLBACK diagnostic signal (it still lets
        // plugin-availability checks and preview diagnostics identify the app).
        // It is no longer what decides whether the native UI renders.
        var queryItems = components.queryItems ?? []
        if !queryItems.contains(where: { $0.name == "gw_native" }) {
            queryItems.append(URLQueryItem(name: "gw_native", value: "1"))
        }
        components.queryItems = queryItems

        return components.url ?? URL(string: "\(fallbackServerURL)\(nativeLoginPath)?gw_native=1")!
    }

    /// `server.url` from ios/App/App/capacitor.config.json (written by cap sync).
    private static func readConfiguredServerURL() -> String? {
        guard
            let configURL = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
            let data = try? Data(contentsOf: configURL),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let server = root["server"] as? [String: Any],
            let urlString = server["url"] as? String,
            !urlString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }

        return urlString
    }

    /// Debug-only startup diagnostics.
    ///
    /// Prints the resolved server URL and the native-runtime detection result so
    /// a device build can be confirmed to be pointing at the intended
    /// deployment. Compiled out of Release, and prints no tokens or secrets —
    /// only the origin the app loads, which is not sensitive.
    private func logStartupDiagnostics(webView: WKWebView) {
        #if DEBUG
        let configured = AppDelegate.readConfiguredServerURL() ?? "(none — using fallback)"
        NSLog("[Groundwork] Loading app at %@", appURL.absoluteString)
        NSLog("[Groundwork] capacitor.config.json server.url: %@", configured)
        NSLog("[Groundwork] Bundle identifier: %@", Bundle.main.bundleIdentifier ?? "(unknown)")

        // Native-runtime detection is a JS-side decision (isNativeAppRuntime);
        // read back what the web app will actually see.
        let probe = """
        JSON.stringify({
          marker: window.__GROUNDWORK_NATIVE_APP__ === true,
          platform: window.__GROUNDWORK_NATIVE_PLATFORM__ || null,
          capacitorNative: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
          href: window.location.href
        })
        """
        webView.evaluateJavaScript(probe) { result, error in
            if let error = error {
                NSLog("[Groundwork] Native runtime probe failed: %@", error.localizedDescription)
            } else if let result = result {
                NSLog("[Groundwork] Native runtime detection: %@", String(describing: result))
            }
        }
        #endif
    }

    private func loadAppIfNeeded(in webView: WKWebView) {
        guard !didLoadAppURL else {
            return
        }

        // Capacitor loads `server.url` at the ORIGIN ROOT, so at startup the
        // WebView is on "/" rather than the native login route. Send it to
        // /native/login explicitly. This runs once (guarded by didLoadAppURL), so
        // it only applies at launch and never yanks an authenticated user out of
        // an app route they have navigated to.
        if webView.url?.host == appURL.host && webView.url?.path == AppDelegate.nativeLoginPath {
            didLoadAppURL = true
            logStartupDiagnostics(webView: webView)
            return
        }

        didLoadAppURL = true
        webView.stopLoading()
        webView.load(URLRequest(url: appURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        logStartupDiagnostics(webView: webView)
    }

    private func clearWebViewAssetCache() {
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: cacheTypes, modifiedSince: Date(timeIntervalSince1970: 0), completionHandler: {})
    }

}
