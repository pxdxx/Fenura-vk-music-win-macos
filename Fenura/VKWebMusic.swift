import Foundation
import AppKit
import WebKit

final class VKWebMusic: @unchecked Sendable {
    func audios(cookies: String, ownerId: Int, playlistId: Int? = nil, accessKey: String? = nil) async throws -> [Track] {
        let pageTracks = try await VKPageBridge.shared.loadAudios(ownerId: ownerId, playlistId: playlistId)
        if !pageTracks.isEmpty { return pageTracks }

        var params: [String: String] = [
            "act": "load_section",
            "owner_id": "\(ownerId)",
            "playlist_id": "\(playlistId ?? -1)",
            "offset": "0",
            "type": "playlist",
            "is_loading_all": "1",
            "al": "1"
        ]
        if let accessKey, !accessKey.isEmpty, accessKey.count < 24 {
            params["access_hash"] = accessKey
        }
        let json = try await post(
            urls: ["https://vk.ru/al_audio.php", "https://m.vk.ru/audio"],
            params: params,
            cookies: cookies
        )
        let tracks = Self.tracks(in: json)
        if tracks.isEmpty { throw VKAPIError.api("Сайт VK не вернул список треков") }
        return tracks
    }

    func search(cookies: String, query: String, ownerId: Int) async throws -> [Track] {
        if let page = try? await VKPageBridge.shared.search(query: query), !page.isEmpty {
            return page
        }
        let json = try await post(
            urls: ["https://vk.ru/al_audio.php", "https://m.vk.ru/audio"],
            params: [
                "act": "section",
                "al": "1",
                "owner_id": "\(ownerId)",
                "section": "search",
                "q": query
            ],
            cookies: cookies
        )
        return Self.tracks(in: json)
    }

    func playlists(cookies: String, ownerId: Int) async throws -> [Playlist] {
        let json = try await post(
            urls: ["https://vk.ru/al_audio.php"],
            params: [
                "act": "section",
                "al": "1",
                "owner_id": "\(ownerId)",
                "section": "all"
            ],
            cookies: cookies
        )
        return Self.playlists(in: json)
    }

    func sectionTracks(cookies: String, ownerId: Int, section: String) async throws -> [Track] {
        let json = try await post(
            urls: ["https://vk.ru/al_audio.php"],
            params: [
                "act": "section",
                "al": "1",
                "owner_id": "\(ownerId)",
                "section": section
            ],
            cookies: cookies
        )
        return Self.tracks(in: json)
    }

    func reloadURL(cookies: String, track: Track) async throws -> String {
        let key = Self.reloadKey(for: track)
        return try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask {
                (try? await VKPageBridge.shared.reload(track: track)) ?? ""
            }
            group.addTask {
                let json = try await self.post(
                    urls: ["https://m.vk.ru/audio", "https://vk.ru/al_audio.php"],
                    params: ["act": "reload_audio", "ids": key, "al": "1"],
                    cookies: cookies
                )
                return Self.tracks(in: json).first?.url ?? ""
            }
            for try await url in group {
                if !url.isEmpty {
                    group.cancelAll()
                    return url
                }
            }
            throw VKAPIError.api("У трека нет ссылки на воспроизведение")
        }
    }

    static func reloadKey(for track: Track) -> String {
        if let access = track.accessKey, access.contains("\(track.ownerId)_\(track.audioId)") {
            return access
        }
        if let access = track.accessKey, !access.isEmpty {
            return "\(track.ownerId)_\(track.audioId)_\(access)"
        }
        return "\(track.ownerId)_\(track.audioId)"
    }

    private func post(urls: [String], params: [String: String], cookies: String) async throws -> [String: Any] {
        applyCookies(cookies)
        var last: Error = VKAPIError.empty
        for url in urls {
            do {
                let json = try await sessionPost(url: url, params: params, cookies: cookies)
                if !Self.tracks(in: json).isEmpty || json["data"] != nil || json["payload"] != nil {
                    return json
                }
            } catch {
                last = error
            }
        }
        throw last
    }

    private func applyCookies(_ header: String) {
        let extra = "remixaudio_show_alert_today=0; remixmdevice=1920/1080/2/!!-!!!!"
        let raw = header.isEmpty ? extra : header + "; " + extra
        for pair in raw.split(separator: ";") {
            let item = pair.split(separator: "=", maxSplits: 1)
            guard item.count == 2 else { continue }
            let name = item[0].trimmingCharacters(in: .whitespaces)
            let value = item[1].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            for domain in [".vk.ru", ".vk.com", "m.vk.ru", "vk.ru", "vk.com"] {
                if let cookie = HTTPCookie(properties: [
                    .domain: domain,
                    .path: "/",
                    .name: name,
                    .value: value,
                    .secure: "TRUE"
                ]) {
                    HTTPCookieStorage.shared.setCookie(cookie)
                }
            }
        }
    }

    private func sessionPost(url: String, params: [String: String], cookies: String) async throws -> [String: Any] {
        guard let endpoint = URL(string: url) else { throw VKAPIError.transport("Некорректный URL") }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = true
        request.setValue(MusicClient.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        if !cookies.isEmpty {
            request.setValue(cookies + "; remixaudio_show_alert_today=0; remixmdevice=1920/1080/2/!!-!!!!", forHTTPHeaderField: "Cookie")
        }
        request.setValue("https://vk.ru/audio", forHTTPHeaderField: "Referer")
        request.setValue("https://vk.ru", forHTTPHeaderField: "Origin")
        request.httpBody = params
            .map { "\(Self.formEncode($0.key))=\(Self.formEncode($0.value))" }
            .joined(separator: "&")
            .data(using: .utf8)
        let (data, _) = try await URLSession.shared.data(for: request)
        guard let text = String(data: data, encoding: .utf8), let json = Self.parseAjax(text) else {
            throw VKAPIError.empty
        }
        return json
    }

    static func parseAjax(_ text: String) -> [String: Any]? {
        if let data = text.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let dict = object as? [String: Any] {
            return dict
        }
        if let start = text.range(of: "<!json>") {
            let rest = text[start.upperBound...]
            if let end = rest.range(of: "<!>") {
                let jsonText = String(rest[..<end.lowerBound])
                if let data = jsonText.data(using: .utf8),
                   let object = try? JSONSerialization.jsonObject(with: data) {
                    if let dict = object as? [String: Any] { return dict }
                    if let list = object as? [Any] { return ["list": list] }
                }
            }
        }
        if let start = text.firstIndex(of: "{"),
           let data = String(text[start...]).data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let dict = object as? [String: Any] {
            return dict
        }
        return nil
    }

    static func tracks(in json: [String: Any]) -> [Track] {
        var found: [Track] = []
        var seen = Set<String>()
        walk(json) { value in
            if let item = value as? [String: Any], let track = track(fromObject: item), seen.insert(track.id).inserted {
                found.append(track)
            } else if let item = value as? [Any], let track = track(fromArray: item), seen.insert(track.id).inserted {
                found.append(track)
            }
        }
        return found
    }

    static func playlists(in json: [String: Any]) -> [Playlist] {
        var playlists: [Playlist] = []
        var seen = Set<String>()
        walk(json) { value in
            guard let item = value as? [String: Any] else { return }
            let id = intValue(item["id"] ?? item["playlist_id"])
            let owner = intValue(item["owner_id"])
            let title = item["title"] as? String
            guard let id, let owner, let title, !title.isEmpty else { return }
            let playlist = Playlist(
                ownerId: owner,
                playlistId: id,
                title: title,
                subtitle: item["description"] as? String ?? "",
                count: intValue(item["count"] ?? item["size"]) ?? 0,
                artworkURL: nil,
                accessKey: item["access_hash"] as? String ?? item["access_key"] as? String
            )
            if seen.insert(playlist.id).inserted {
                playlists.append(playlist)
            }
        }
        return playlists
    }

    static func walk(_ value: Any, visit: (Any) -> Void) {
        visit(value)
        if let dict = value as? [String: Any] {
            for item in dict.values { walk(item, visit: visit) }
        } else if let array = value as? [Any] {
            for item in array { walk(item, visit: visit) }
        }
    }

    static func track(fromObject item: [String: Any]) -> Track? {
        guard let audioId = intValue(item["id"] ?? item["audio_id"]),
              let ownerId = intValue(item["owner_id"]),
              let title = item["title"] as? String,
              !title.isEmpty else { return nil }
        let artist = (item["artist"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Unknown"
        return Track(
            ownerId: ownerId,
            audioId: audioId,
            artist: artist,
            title: title,
            duration: intValue(item["duration"]) ?? 0,
            url: cleanURL(item["url"] as? String),
            artworkURL: cover(from: item),
            accessKey: item["access_key"] as? String,
            isAdded: false
        )
    }

    static func track(fromArray item: [Any]) -> Track? {
        guard item.count >= 6,
              let audioId = intValue(item[0]),
              let ownerId = intValue(item[1]) else { return nil }
        let title = item[safe: 3] as? String ?? ""
        let artist = item[safe: 4] as? String ?? ""
        guard !title.isEmpty || !artist.isEmpty else { return nil }
        let hashes = item[safe: 13] as? String ?? ""
        return Track(
            ownerId: ownerId,
            audioId: audioId,
            artist: artist.isEmpty ? "Unknown" : artist,
            title: title.isEmpty ? "Без названия" : title,
            duration: intValue(item[safe: 5]) ?? 0,
            url: cleanURL(item[safe: 2] as? String),
            artworkURL: coverURL(item[safe: 14] as? String),
            accessKey: reloadId(ownerId: ownerId, audioId: audioId, hashes: hashes),
            isAdded: false
        )
    }

    static func reloadId(ownerId: Int, audioId: Int, hashes: String) -> String {
        let parts = hashes.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        if parts.count >= 2 {
            return "\(ownerId)_\(audioId)_\(parts[parts.count - 2])_\(parts[parts.count - 1])"
        }
        return "\(ownerId)_\(audioId)"
    }

    static func cleanURL(_ raw: String?) -> String {
        guard var raw, !raw.contains("audio_api_unavailable") else { return "" }
        raw = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("//") { raw = "https:" + raw }
        guard raw.hasPrefix("http") else { return "" }
        return raw
    }

    static func cover(from item: [String: Any]) -> URL? {
        if let thumb = item["thumb"] as? [String: Any] {
            for key in ["photo_1200", "photo_600", "photo_300", "photo_270"] {
                if let value = thumb[key] as? String, let url = URL(string: value) { return url }
            }
        }
        if let album = item["album"] as? [String: Any], let thumb = album["thumb"] as? [String: Any] {
            for key in ["photo_600", "photo_300"] {
                if let value = thumb[key] as? String, let url = URL(string: value) { return url }
            }
        }
        return nil
    }

    static func coverURL(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        return raw.split(separator: ",").map(String.init).last.flatMap(URL.init(string:))
    }

    static func intValue(_ value: Any?) -> Int? {
        if let number = value as? Int { return number }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    static func formEncode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._*")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

@MainActor
final class VKPageBridge: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    static let shared = VKPageBridge()

    private var webView: WKWebView!
    private var hostWindow: NSWindow?
    private var ready: CheckedContinuation<Void, Error>?
    private var captured: [[String: Any]] = []

    private override init() {
        super.init()
        let script = WKUserScript(source: Self.interceptor, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(script)
        config.userContentController.add(self, name: "fenuraAudio")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 980, height: 720), configuration: config)
        view.customUserAgent = MusicClient.userAgent
        view.navigationDelegate = self
        webView = view
        attach()
    }

    private var lastKey = ""
    private var lastTracks: [Track] = []
    private var lastLoad = Date.distantPast

    func loadAudios(ownerId: Int, playlistId: Int?) async throws -> [Track] {
        let key = "\(ownerId)_\(playlistId ?? 0)"
        if lastKey == key, Date().timeIntervalSince(lastLoad) < 90, !lastTracks.isEmpty {
            return lastTracks
        }
        attach()
        captured = []
        dumpDebug(extra: "start owner=\(ownerId)")
        let target = playlistId == nil
            ? "https://vk.ru/music/playlist/\(ownerId)_15"
            : "https://vk.ru/music/playlist/\(ownerId)_\(playlistId!)"
        try await open(target)
        try await resolveVKGate()
        var tracks = await waitForTracks(limit: 6)
        if tracks.isEmpty {
            tracks = try await pullFromPage(ownerId: ownerId)
        }
        if !tracks.isEmpty {
            lastKey = key
            lastTracks = tracks
            lastLoad = Date()
        }
        dumpDebug(extra: "owner=\(ownerId) tracks=\(tracks.count) captured=\(captured.count)")
        return tracks
    }

    func search(query: String) async throws -> [Track] {
        attach()
        captured = []
        try await open("https://vk.ru/audio?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query)")
        return await waitForTracks(limit: 5)
    }

    private func waitForTracks(limit: Int) async -> [Track] {
        for _ in 0..<limit {
            let tracks = tracksFromCaptured()
            if !tracks.isEmpty { return tracks }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
        return tracksFromCaptured()
    }

    func reload(track: Track) async throws -> String {
        let key = VKWebMusic.reloadKey(for: track)
        let text = try await fetchOnPage(
            url: "https://m.vk.ru/audio",
            params: ["act": "reload_audio", "ids": key, "al": "1"]
        )
        if let json = VKWebMusic.parseAjax(text) {
            return VKWebMusic.tracks(in: json).first?.url ?? ""
        }
        return ""
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let raw = body["body"] as? String else { return }
        if let json = VKWebMusic.parseAjax(raw) {
            captured.append(json)
        }
    }

    private func tracksFromCaptured() -> [Track] {
        var all: [Track] = []
        var seen = Set<String>()
        for json in captured {
            for track in VKWebMusic.tracks(in: json) where seen.insert(track.id).inserted {
                all.append(track)
            }
        }
        return all
    }

    private func pullFromPage(ownerId: Int) async throws -> [Track] {
        let script = """
        const html = document.documentElement.innerHTML;
        const token = (html.match(/"access_token"\\s*:\\s*"(vk1\\.[^"]+)"/) || [])[1] || '';
        const out = { href: location.href, title: document.title, token: token, html: html.length };
        if (token) {
          const body = new URLSearchParams({
            owner_id: String(\(ownerId)),
            need_blocks: '1'
          });
          const url = 'https://api.vk.ru/method/catalog.getAudio?v=5.282&access_token=' + encodeURIComponent(token) + '&lang=ru&client_id=6287487';
          try {
            const res = await fetch(url, { method: 'POST', body, credentials: 'include' });
            out.catalog = await res.json();
          } catch (e) {
            out.catalogError = String(e);
          }
          try {
            const res2 = await fetch('https://api.vk.ru/method/audio.get?v=5.282&access_token=' + encodeURIComponent(token) + '&lang=ru&client_id=6287487', {
              method: 'POST',
              body: new URLSearchParams({ owner_id: String(\(ownerId)), count: '200' }),
              credentials: 'include'
            });
            out.audioGet = await res2.json();
          } catch (e) {
            out.audioError = String(e);
          }
        }
        return out;
        """
        guard let result = try await webView.callAsyncJavaScript(script, arguments: [:], contentWorld: .page) as? [String: Any] else {
            return []
        }
        let catalogError = ((result["catalog"] as? [String: Any])?["error"] as? [String: Any])?["error_msg"]
        let audioError = ((result["audioGet"] as? [String: Any])?["error"] as? [String: Any])?["error_msg"]
        dumpDebug(extra: "page.href=\(result["href"] ?? "") token=\(result["token"] is String) catalog=\(catalogError ?? result["catalogError"] ?? "ok") audio=\(audioError ?? result["audioError"] ?? "ok")")
        if let catalog = result["catalog"] as? [String: Any] {
            let tracks = VKWebMusic.tracks(in: catalog)
            if !tracks.isEmpty { return tracks }
        }
        if let audioGet = result["audioGet"] as? [String: Any] {
            let tracks = VKWebMusic.tracks(in: audioGet)
            if !tracks.isEmpty { return tracks }
        }
        return []
    }

    private func fetchOnPage(url: String, params: [String: String]) async throws -> String {
        try await open("https://vk.ru/audio")
        return try await webView.callAsyncJavaScript(
            """
            const body = new URLSearchParams(params);
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
              body,
              credentials: 'include'
            });
            return await response.text();
            """,
            arguments: ["url": url, "params": params],
            contentWorld: .page
        ) as? String ?? ""
    }

    private func attach() {
        if webView.superview != nil || hostWindow != nil { return }
        if let content = NSApp.windows.first(where: { $0.title.contains("Fenura") })?.contentView {
            webView.frame = CGRect(x: 8, y: 8, width: 2, height: 2)
            webView.alphaValue = 0.02
            content.addSubview(webView)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 60, y: 80, width: 720, height: 520),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Fenura Sync"
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.orderFront(nil)
        hostWindow = window
    }

    private func resolveVKGate() async throws {
        guard let current = webView.url else { return }
        let items = URLComponents(url: current, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let to = items.first(where: { $0.name == "to" })?.value, let path = decodeVKPath(to) {
            let host = current.host?.contains("m.vk") == true ? "https://m.vk.ru" : "https://vk.ru"
            try await open(host + path)
        }
    }

    private func decodeVKPath(_ value: String) -> String? {
        var text = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while text.count % 4 != 0 { text += "=" }
        guard let data = Data(base64Encoded: text), let path = String(data: data, encoding: .utf8), path.hasPrefix("/") else {
            return nil
        }
        return path
    }

    private func open(_ url: String) async throws {
        guard let target = URL(string: url) else { return }
        if webView.url?.absoluteString == url { return }
        webView.load(URLRequest(url: target))
        let started = Date()
        while Date().timeIntervalSince(started) < 2.4 {
            if !webView.isLoading, webView.url != nil, Date().timeIntervalSince(started) > 0.25 {
                break
            }
            try await Task.sleep(nanoseconds: 80_000_000)
        }
        ready = nil
    }

    private func dumpDebug(extra: String) {
        let href = webView.url?.absoluteString ?? ""
        let text = "\(Date()) \(extra) href=\(href) captured=\(captured.count)\n"
        let url = URL(fileURLWithPath: "/tmp/fenura-vk-debug.txt")
        if let data = text.data(using: .utf8) {
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: url)
            }
        }
        if let first = captured.first,
           let data = try? JSONSerialization.data(withJSONObject: first, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: "/tmp/fenura-vk-captured.json"))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready?.resume()
        ready = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        ready?.resume(throwing: error)
        ready = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        ready?.resume(throwing: error)
        ready = nil
    }

    private static let interceptor = """
    (function() {
      const send = (url, body) => {
        try { window.webkit.messageHandlers.fenuraAudio.postMessage({ url: String(url), body: String(body).slice(0, 400000) }); } catch (e) {}
      };
      const origFetch = window.fetch;
      window.fetch = async function() {
        const res = await origFetch.apply(this, arguments);
        try {
          const url = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0]);
          if (/audio|catalog|al_audio|music/i.test(url)) {
            const copy = res.clone();
            copy.text().then(text => send(url, text));
          }
        } catch (e) {}
        return res;
      };
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__fenuraURL = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
          try {
            if (/audio|catalog|al_audio|music/i.test(String(this.__fenuraURL || ''))) {
              send(this.__fenuraURL, this.responseText || '');
            }
          } catch (e) {}
        });
        return origSend.apply(this, arguments);
      };
    })();
    """
}
