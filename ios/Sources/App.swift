import UIKit
import WebKit

/* Проявка — native shell, step 1.
   The editor itself is the same web app as on the site; the shell gives it:
   - its own persistent storage (documents survive, no home-screen shortcut to lose),
   - a calm restart if the web process dies (instead of Safari's white flash),
   - native sharing / saving of exported files,
   - Apple Pencil double-tap / squeeze forwarded to the page. */

let appURL = URL(string: "https://itanaro.github.io/proyavka/?app=1")!
let bgColor = UIColor(red: 0x17/255, green: 0x18/255, blue: 0x1b/255, alpha: 1)

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.backgroundColor = bgColor
        w.rootViewController = EditorViewController()
        w.makeKeyAndVisible()
        window = w
    }
}

final class EditorViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIPencilInteractionDelegate {
    var web: WKWebView!
    var incoming: (name: String, handle: FileHandle, url: URL)?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bgColor

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.limitsNavigationsToAppBoundDomains = true
        cfg.applicationNameForUserAgent = "ProyavkaApp/1"
        cfg.allowsInlineMediaPlayback = true
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = false
        cfg.userContentController.add(self, name: "proyavka")

        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = bgColor
        web.scrollView.backgroundColor = bgColor
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }
        web.navigationDelegate = self
        web.uiDelegate = self
        view.addSubview(web)

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        view.addInteraction(pencil)

        web.load(URLRequest(url: appURL))
    }

    // the web process was killed (memory): reload quietly; the page's own crash detector notes it
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: appURL))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retryLater() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retryLater() }
    private func retryLater() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.web.url == nil || self.web.isLoading == false else { return }
            if self.web.url == nil { self.web.load(URLRequest(url: appURL)) }
        }
    }

    // links to other sites open outside the app
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, let h = u.host, h != "itanaro.github.io", u.scheme == "https" || u.scheme == "http" {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    // alert / confirm from the page
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    // files from the page arrive in chunks: begin {name} → chunk {b64}… → end; then the share sheet
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let op = m["op"] as? String else { return }
        switch op {
        case "begin":
            let name = (m["name"] as? String ?? "proyavka.png").replacingOccurrences(of: "/", with: "_")
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("out", isDirectory: true)
            try? FileManager.default.removeItem(at: dir)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            if let h = try? FileHandle(forWritingTo: url) { incoming = (name, h, url) }
        case "chunk":
            if let b = m["b64"] as? String, let d = Data(base64Encoded: b) { incoming?.handle.write(d) }
        case "end":
            guard let f = incoming else { return }
            try? f.handle.close(); incoming = nil
            share(f.url)
        default: break
        }
    }

    private func share(_ url: URL) {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.completionWithItemsHandler = { [weak self] _, done, _, _ in
            self?.web.evaluateJavaScript("window.pvShareDone && pvShareDone(\(done ? "true" : "false"))")
        }
        if let p = vc.popoverPresentationController {
            p.sourceView = view
            p.sourceRect = CGRect(x: view.bounds.midX, y: 60, width: 1, height: 1)
            p.permittedArrowDirections = .up
        }
        present(vc, animated: true)
    }

    // Apple Pencil: double-tap (and squeeze on Pencil Pro) → the page decides what to do
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        web.evaluateJavaScript("window.pvPencil && pvPencil('tap')")
    }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { web.evaluateJavaScript("window.pvPencil && pvPencil('squeeze')") }
    }
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        web.evaluateJavaScript("window.pvPencil && pvPencil('tap')")
    }
}
