import UIKit
import WebKit

/// Hosts the SEND web app full screen. Only SEND's own origin runs inside the app;
/// every other link opens in Safari. Camera and microphone are granted to SEND's origin only.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    static let background = UIColor(red: 11/255, green: 16/255, blue: 32/255, alpha: 1)
    private let home: URL = {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "SENDAppURL") as? String) ?? "https://syndo.makz.space"
        return URL(string: raw) ?? URL(string: "https://syndo.makz.space")!
    }()
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let offline = UIStackView()
    private var progressObserver: NSKeyValueObservation?
    private var downloadPaths: [ObjectIdentifier: URL] = [:]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        config.applicationNameForUserAgent = "SENDiOS/\(version)"
        // The page asks for push through this; only SEND's own main frame is listened to (checked below).
        config.userContentController.add(WeakHandler(self), name: "sendNative")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.background
        webView.scrollView.backgroundColor = Self.background
        // The page lays itself out around the notch and home bar (viewport-fit=cover), so no extra insets.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.progressTintColor = UIColor(red: 0.42, green: 0.55, blue: 1, alpha: 1)
        progress.trackTintColor = .clear
        view.addSubview(progress)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        progressObserver = webView.observe(\.estimatedProgress) { [weak self] web, _ in
            self?.progress.setProgress(Float(web.estimatedProgress), animated: true)
            self?.progress.isHidden = web.estimatedProgress >= 1
        }
        buildOffline()
        Push.shared.send = { [weak self] reply in self?.toPage(reply) }
        Push.shared.open = { [weak self] path in self?.navigate(path) }
        webView.load(URLRequest(url: home))
    }

    func open(_ url: URL) {
        if isOurs(url) { loadViewIfNeeded(); webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
    }

    private func isOurs(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", let host = url.host else { return false }
        return host == home.host && (url.port == nil || url.port == 443)
    }

    // MARK: Bridge to the page (push notifications)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https", message.frameInfo.securityOrigin.host == home.host,
              let body = message.body as? [String: Any], let type = body["type"] as? String, ["push:enable", "push:sync"].contains(type) else { return }
        Push.shared.handle(type)
    }
    private func toPage(_ reply: [String: Any]) {
        guard isOurs(webView.url), let data = try? JSONSerialization.data(withJSONObject: reply), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__sendNativePush && window.__sendNativePush(\(json))")
    }
    /// Opens a SEND path inside the running app (no reload), falling back to a page load.
    private func navigate(_ path: String) {
        guard let url = URL(string: path, relativeTo: home)?.absoluteURL, isOurs(url) else { return }
        guard let quoted = try? JSONSerialization.data(withJSONObject: [path]), let arg = String(data: quoted, encoding: .utf8) else { return }
        webView.evaluateJavaScript("(function(u){if(window.__sendNavigate){window.__sendNavigate(u);return true}return false})(\(arg)[0])") { [weak self] done, _ in
            if (done as? Bool) != true { self?.webView.load(URLRequest(url: url)) }
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if isOurs(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
        // Subframes from other sites (for example embedded videos) may load; top-level navigation goes to Safari.
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if ["http", "https", "mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if !response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") { decisionHandler(.download) } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    // target=_blank links: ours load here, others open in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { if isOurs(url) { webView.load(action.request) } else { UIApplication.shared.open(url) } }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { offline.isHidden = true; Push.shared.flush() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { offline.isHidden = false }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: Camera and microphone

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // iOS still shows its own camera and microphone prompt the first time.
        decisionHandler(origin.protocol == "https" && origin.host == home.host ? .grant : .deny)
    }

    // MARK: Alerts from the page

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    // MARK: Downloads: saved to a temporary file, then handed to the share sheet (Save to Files, Photos, AirDrop...)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = suggestedFilename.replacingOccurrences(of: "/", with: "_")
        let target = folder.appendingPathComponent(name.isEmpty ? "download" : name)
        downloadPaths[ObjectIdentifier(download)] = target
        completionHandler(target)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadPaths.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(share, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadPaths.removeValue(forKey: ObjectIdentifier(download))
    }

    // MARK: Offline screen

    private func buildOffline() {
        let title = UILabel(); title.text = "SEND is unreachable"; title.font = .boldSystemFont(ofSize: 20); title.textColor = .white
        let body = UILabel(); body.text = "Check your connection and try again."; body.textColor = UIColor(white: 0.75, alpha: 1); body.numberOfLines = 0; body.textAlignment = .center
        let retry = UIButton(type: .system)
        retry.setTitle("Try again", for: .normal); retry.titleLabel?.font = .boldSystemFont(ofSize: 17)
        retry.setTitleColor(.white, for: .normal); retry.backgroundColor = UIColor(red: 0.24, green: 0.42, blue: 1, alpha: 1)
        retry.layer.cornerRadius = 12; retry.contentEdgeInsets = UIEdgeInsets(top: 12, left: 28, bottom: 12, right: 28)
        retry.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.offline.isHidden = true
            if self.webView.url == nil { self.webView.load(URLRequest(url: self.home)) } else { self.webView.reload() }
        }, for: .touchUpInside)
        [title, body, retry].forEach(offline.addArrangedSubview)
        offline.axis = .vertical; offline.alignment = .center; offline.spacing = 14; offline.isHidden = true
        offline.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(offline)
        NSLayoutConstraint.activate([
            offline.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            offline.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            offline.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }
}

/// Keeps the web view's script handler from holding the controller alive.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
