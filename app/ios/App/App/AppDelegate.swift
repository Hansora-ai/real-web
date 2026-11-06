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

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// Hansora: the app's main screen (used by Main.storyboard).
// - Swipe from the left edge goes back (iPhone gesture).
// - Page changes slide like a native app. Every screen is its own web page, so the web view can't slide two pages
//   itself. Instead: when a link is tapped, the page sends "leave" and a picture of the current screen is put in front
//   (no loading or black screen is ever seen). When the next page is ready it sends "ready"; a picture of it slides in
//   from the right over the old one (Back: the old one slides away to the right; bottom-bar tabs: a quick fade), then
//   both pictures are removed and the live page is there. Messages come from app-shim.js (§6), name "hansoraNav".
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private var oldPage: UIView?
    private var kind = "push"
    private var fallback: DispatchWorkItem?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
        webView?.configuration.userContentController.add(HansoraWeakScriptHandler(self), name: "hansoraNav")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let phase = body["phase"] as? String else { return }
        if phase == "leave" {
            cover(kind: (body["kind"] as? String) ?? "push")
        } else if phase == "ready" {
            reveal()
        }
    }

    // A picture of the current screen goes in front while the next page loads. Apple's own web-page picture
    // (takeSnapshot) is used; the page waits for our answer before it opens the next page, so the picture is
    // always in place first.
    private func cover(kind: String) {
        guard let webView = webView else { return }
        if let stale = oldPage { stale.removeFromSuperview(); oldPage = nil }
        self.kind = kind
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = false
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self = self else { return }
            if let image = image {
                let shot = UIImageView(image: image)
                shot.frame = webView.bounds
                shot.isUserInteractionEnabled = false
                webView.addSubview(shot)
                self.oldPage = shot
                self.fallback?.cancel()
                let work = DispatchWorkItem { [weak self] in self?.reveal() }
                self.fallback = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: work) // never stay covered
            }
            webView.evaluateJavaScript("window.__hansoraGo && window.__hansoraGo()", completionHandler: nil)
        }
    }

    // The next page is ready: slide a picture of it in, then show the live page.
    private func reveal() {
        fallback?.cancel()
        fallback = nil
        guard let webView = webView, let old = oldPage else { return }
        oldPage = nil
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self = self, let image = image else {
                UIView.animate(withDuration: 0.15, animations: { old.alpha = 0 }, completion: { _ in old.removeFromSuperview() })
                return
            }
            self.slide(from: old, to: image, in: webView)
        }
    }

    private func slide(from old: UIView, to image: UIImage, in webView: WKWebView) {
        let fresh = UIImageView(image: image)
        fresh.frame = webView.bounds
        fresh.isUserInteractionEnabled = false
        let width = webView.bounds.width
        let finish: (Bool) -> Void = { _ in
            old.removeFromSuperview()
            fresh.removeFromSuperview()
        }
        switch kind {
        case "tab":
            webView.insertSubview(fresh, belowSubview: old)
            UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut], animations: { old.alpha = 0 }, completion: finish)
        case "back":
            webView.insertSubview(fresh, belowSubview: old)
            fresh.transform = CGAffineTransform(translationX: -width * 0.3, y: 0)
            addEdgeShadow(to: old)
            UIView.animate(withDuration: 0.34, delay: 0, options: [.curveEaseOut], animations: {
                old.transform = CGAffineTransform(translationX: width, y: 0)
                fresh.transform = .identity
            }, completion: finish)
        default:
            webView.addSubview(fresh)
            fresh.transform = CGAffineTransform(translationX: width, y: 0)
            addEdgeShadow(to: fresh)
            UIView.animate(withDuration: 0.34, delay: 0, options: [.curveEaseOut], animations: {
                fresh.transform = .identity
                old.transform = CGAffineTransform(translationX: -width * 0.3, y: 0)
                old.alpha = 0.7
            }, completion: finish)
        }
    }

    private func addEdgeShadow(to view: UIView) {
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.35
        view.layer.shadowRadius = 12
        view.layer.shadowOffset = CGSize(width: -4, height: 0)
        view.layer.shadowPath = UIBezierPath(rect: view.bounds).cgPath
    }
}

// Keeps the web view from holding the screen in memory forever (WKUserContentController keeps its handlers).
@MainActor
final class HansoraWeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
