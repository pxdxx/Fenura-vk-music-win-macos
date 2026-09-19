import SwiftUI
import WebKit

struct CaptchaSheet: View {
    let url: URL
    let onToken: (String) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Подтвердите, что это вы")
                    .font(.fenura(14, weight: .semibold))
                    .foregroundStyle(FenuraTheme.text)
                Spacer()
                Button("Закрыть", action: onClose)
                    .buttonStyle(.plain)
                    .foregroundStyle(FenuraTheme.muted)
            }
            .padding(16)

            CaptchaWebView(url: url, onToken: onToken)
                .frame(minWidth: 420, minHeight: 520)
        }
        .background(FenuraTheme.ink)
    }
}

struct CaptchaWebView: NSViewRepresentable {
    let url: URL
    let onToken: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onToken: onToken)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(context.coordinator, name: "fenura")
        config.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url != url {
            context.coordinator.reset()
            nsView.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let onToken: (String) -> Void
        private var sent = false

        init(onToken: @escaping (String) -> Void) {
            self.onToken = onToken
        }

        func reset() {
            sent = false
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if let body = message.body as? [String: Any], let token = body["success_token"] as? String {
                finish(token)
            } else if let token = message.body as? String {
                finish(token)
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url, let token = Self.token(in: url) {
                finish(token)
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let url = webView.url, let token = Self.token(in: url) {
                finish(token)
            }
        }

        private func finish(_ token: String) {
            guard !sent, !token.isEmpty else { return }
            sent = true
            DispatchQueue.main.async {
                self.onToken(token)
            }
        }

        static func token(in url: URL) -> String? {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            return items.first(where: { $0.name == "success_token" || $0.name == "successToken" })?.value
        }
    }

    private static let bridgeScript = """
    (function() {
      const send = (token) => {
        if (!token) return;
        try { window.webkit.messageHandlers.fenura.postMessage({ success_token: String(token) }); } catch (e) {}
      };
      const pick = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (typeof value === 'object') {
          send(value.success_token || value.successToken || (value.response && value.response.success_token));
        }
      };
      const originalFetch = window.fetch;
      window.fetch = async function() {
        const response = await originalFetch.apply(this, arguments);
        try { pick(await response.clone().text()); } catch (e) {}
        return response;
      };
      const open = XMLHttpRequest.prototype.open;
      const sendXHR = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function() {
        this.addEventListener('load', function() { pick(this.responseText); });
        return open.apply(this, arguments);
      };
    })();
    """
}
