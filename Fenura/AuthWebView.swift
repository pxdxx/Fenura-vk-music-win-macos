import AppKit
import WebKit

enum KateOAuth {
    static var authorizeURL: URL {
        var components = URLComponents(string: "https://oauth.vk.com/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: KateClient.clientID),
            URLQueryItem(name: "scope", value: "audio,offline"),
            URLQueryItem(name: "redirect_uri", value: "https://oauth.vk.com/blank.html"),
            URLQueryItem(name: "display", value: "page"),
            URLQueryItem(name: "response_type", value: "token"),
            URLQueryItem(name: "v", value: KateClient.version)
        ]
        return components.url!
    }

    static func session(from rawURL: String) -> VKSession? {
        guard rawURL.contains("access_token=") else { return nil }
        let payload = rawURL.split(separator: "#", maxSplits: 1).last.map(String.init)
            ?? rawURL.split(separator: "?", maxSplits: 1).last.map(String.init)
            ?? rawURL
        var values: [String: String] = [:]
        for pair in payload.split(separator: "&") {
            let item = pair.split(separator: "=", maxSplits: 1)
            guard item.count == 2 else { continue }
            let key = String(item[0])
            let value = String(item[1]).removingPercentEncoding ?? String(item[1])
            values[key] = value
        }
        guard let token = values["access_token"], token.count > 20 else { return nil }
        let userId = Int(values["user_id"] ?? "") ?? 0
        return VKSession(token: token, userId: userId, userAgent: MusicClient.userAgent)
    }
}

@MainActor
final class VKLoginWindowController: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let shared = VKLoginWindowController()

    var onSession: ((VKSession) -> Void)?
    var onStatus: ((String) -> Void)?

    private var window: NSWindow?
    private var webView: WKWebView?
    private var popupWindows: [NSWindow] = []
    private var cookieWatcher: Timer?
    private var finished = false
    private var finishing = false

    func present() {
        finished = false
        finishing = false
        if window == nil {
            build()
        }
        onStatus?("Войдите в ВКонтакте в отдельном окне")
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if webView?.url == nil {
            webView?.load(URLRequest(url: URL(string: "https://vk.ru")!))
        }
        startWatching()
    }

    func dismiss() {
        cookieWatcher?.invalidate()
        cookieWatcher = nil
        popupWindows.forEach { $0.close() }
        popupWindows.removeAll()
        window?.orderOut(nil)
    }

    private func build() {
        let script = WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController.addUserScript(script)
        config.userContentController.add(self, name: "fenura")

        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 980, height: 720), configuration: config)
        view.customUserAgent = MusicClient.userAgent
        view.navigationDelegate = self
        view.uiDelegate = self
        webView = view

        let window = NSWindow(
            contentRect: NSRect(x: 120, y: 80, width: 980, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Fenura Sync"
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.center()
        self.window = window
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any] {
            if let hash = body["hash"] as? String { consume(hash) }
            if let url = body["url"] as? String { consume(url) }
        } else if let url = message.body as? String {
            consume(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url?.absoluteString {
            consume(url)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let url = webView.url?.absoluteString {
            consume(url)
            onStatus?(prettyStatus(url))
        }
        finishIfLoggedIn()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        configuration.userContentController.add(self, name: "fenura")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
        let width = CGFloat(windowFeatures.width?.doubleValue ?? 520)
        let height = CGFloat(windowFeatures.height?.doubleValue ?? 720)
        let child = WKWebView(frame: NSRect(x: 0, y: 0, width: max(width, 420), height: max(height, 560)), configuration: configuration)
        child.navigationDelegate = self
        child.uiDelegate = self
        child.customUserAgent = webView.customUserAgent

        let popup = NSWindow(
            contentRect: child.frame,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        popup.title = "ВКонтакте"
        popup.isReleasedWhenClosed = false
        popup.contentView = child
        popup.center()
        popup.makeKeyAndOrderFront(nil)
        popupWindows.append(popup)
        onStatus?("Дополнительное окно ВКонтакте…")
        return child
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let index = popupWindows.firstIndex(where: { $0.contentView === webView }) {
            popupWindows[index].close()
            popupWindows.remove(at: index)
        }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    private func consume(_ raw: String) {
        guard !finished else { return }
        if let session = KateOAuth.session(from: raw) {
            complete(session)
        }
    }

    private func startWatching() {
        cookieWatcher?.invalidate()
        cookieWatcher = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.finishIfLoggedIn()
            }
        }
    }

    private func finishIfLoggedIn() {
        guard !finished, !finishing else { return }
        webView?.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let loggedIn = cookies.contains { cookie in
                let domain = cookie.domain.lowercased()
                return cookie.name.contains("remixsid")
                    && cookie.value.count > 10
                    && (domain.contains("vk.com") || domain.contains("vk.ru"))
            }
            guard loggedIn else { return }
            let url = self.webView?.url?.absoluteString ?? ""
            guard self.looksLoggedIn(url) else { return }
            Task { @MainActor in
                self.completeFromCookies()
            }
        }
    }

    private func looksLoggedIn(_ url: String) -> Bool {
        if url.contains("not_robot") || url.contains("captcha") { return false }
        if url.contains("/login") || url.contains("act=login") { return false }
        if url.contains("id.vk.") && (url.contains("auth") || url.contains("login")) { return false }
        return url.contains("vk.ru") || url.contains("vk.com")
    }

    private func completeFromCookies() {
        guard !finished, !finishing else { return }
        finishing = true
        onStatus?("Вход есть, открываем библиотеку…")
        let session = VKSession(
            token: "pending-\(UUID().uuidString)",
            userId: 0,
            userAgent: MusicClient.userAgent
        )
        complete(session)
    }

    private func complete(_ session: VKSession) {
        guard !finished else { return }
        finished = true
        cookieWatcher?.invalidate()
        cookieWatcher = nil
        onSession?(session)
        dismiss()
    }

    private func prettyStatus(_ url: String) -> String {
        if url.contains("blank.html") { return "Получаем доступ…" }
        if url.contains("captcha") || url.contains("not_robot") { return "Пройдите проверку «я не робот»" }
        if url.contains("id.vk.") { return "Войдите по QR или паролю в окне Fenura Sync" }
        return "Войдите в ВКонтакте в окне Fenura Sync"
    }

    private static let bridge = """
    (function() {
      const post = () => {
        try { window.webkit.messageHandlers.fenura.postMessage({ url: String(location.href), hash: String(location.hash) }); } catch (e) {}
      };
      post();
      window.addEventListener('hashchange', post);
      window.addEventListener('popstate', post);
      setInterval(post, 400);
    })();
    """
}
