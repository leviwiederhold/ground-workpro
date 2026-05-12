import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let appBackgroundColor = UIColor(red: 249.0 / 255.0, green: 250.0 / 255.0, blue: 251.0 / 255.0, alpha: 1)
    private let productionAppURL = URL(string: "https://ground-workpro.vercel.app/?gw_native=1")!
    private var didInstallNativeMarker = false
    private var didLoadProductionAppURL = false

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
            loadProductionAppIfNeeded(in: webView)
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

    private func loadProductionAppIfNeeded(in webView: WKWebView) {
        guard !didLoadProductionAppURL else {
            return
        }

        if webView.url?.host == productionAppURL.host {
            didLoadProductionAppURL = true
            return
        }

        didLoadProductionAppURL = true
        webView.stopLoading()
        webView.load(URLRequest(url: productionAppURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }

    private func clearWebViewAssetCache() {
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: cacheTypes, modifiedSince: Date(timeIntervalSince1970: 0), completionHandler: {})
    }

}
