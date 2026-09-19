import Foundation

enum VKAPIError: LocalizedError, Equatable {
    case invalidCredentials
    case need2FA(sid: String, type: String, message: String)
    case needCaptcha(sid: String, imageURL: URL?, redirectURL: URL?)
    case invalidCode
    case flood
    case api(String)
    case transport(String)
    case empty

    var errorDescription: String? {
        switch self {
        case .invalidCredentials:
            return "Неверный логин или пароль ВКонтакте"
        case .need2FA:
            return "Введите код из SMS или приложения"
        case .needCaptcha:
            return "Нужно подтвердить, что вы не робот"
        case .invalidCode:
            return "Неверный или устаревший код. Попробуйте ещё раз"
        case .flood:
            return "VK временно заблокировал вход после многих попыток. Подождите 15–30 минут, потом войдите через страницу ВКонтакте"
        case .api(let text):
            return Self.humanize(text)
        case .transport(let text):
            return text
        case .empty:
            return "Пустой ответ VK"
        }
    }

    static func humanize(_ text: String) -> String {
        let lower = text.lowercased()
        if lower.contains("sms sent") || lower.contains("use code param") {
            return "Код отправили в SMS. Введите его ниже"
        }
        if lower.contains("wrong") && lower.contains("code") {
            return "Неверный код"
        }
        if lower.contains("invalid") && (lower.contains("password") || lower.contains("client")) {
            return "Неверный логин или пароль ВКонтакте"
        }
        if lower.contains("unknown method") {
            return "VK не открыл музыку для этого входа. Нажмите «Выйти» и войдите ещё раз"
        }
        if lower.contains("access denied") {
            return "Нет доступа к музыке. Выйдите и войдите через страницу ВКонтакте ещё раз"
        }
        if lower.contains("unauthorized") {
            return "Сессия ВКонтакте истекла. Выйдите и войдите ещё раз"
        }
        if lower.contains("blocked") || lower.contains("authorization failed") {
            return "Профиль открылся, но VK не отдал музыку этим способом. Пробую другой доступ — если список пустой, выйдите и войдите ещё раз"
        }
        return text
    }
}

enum KateClient {
    static let userAgent = "KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown Android SDK built for x86; ru)"
    static let clientID = "2685278"
    static let clientSecret = "lxhD8OD7dMsqtXIm5IUY"
    static let version = "5.131"
}

enum MusicClient {
    static let appID = "6287487"
    static let version = "5.282"
    static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
}

struct MusicAuth {
    let token: String
    let userId: Int
    let expires: Int
    let appID: String
}

struct VKSession: Codable, Equatable {
    var token: String
    var userId: Int
    var userAgent: String
    var cookieHeader: String?
    var tokenExpires: Int?
    var clientID: String?

    var canRefreshMusic: Bool {
        (cookieHeader ?? "").contains("remixsid")
    }
}

final class VKAPI: @unchecked Sendable {
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let web = VKWebMusic()
    private let tokenLock = NSLock()
    private var cachedToken: String?
    private var cachedExpires = 0
    private var cachedCookies: String?
    private var trackCache: [String: (Date, [Track])] = [:]
    private var urlCache: [String: (Date, String)] = [:]

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpAdditionalHeaders = [
            "User-Agent": MusicClient.userAgent,
            "Accept": "application/json"
        ]
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    func remember(_ vk: VKSession) {
        tokenLock.lock()
        cachedToken = vk.token
        cachedExpires = vk.tokenExpires ?? 0
        cachedCookies = vk.cookieHeader
        tokenLock.unlock()
    }

    func resolveMusicSession(_ vk: VKSession) async throws -> VKSession {
        var next = vk
        guard let cookies = next.cookieHeader, cookies.contains("remixsid") else {
            throw VKAPIError.api("Сессия ВКонтакте без доступа к музыке. Выйдите и войдите ещё раз")
        }
        let now = Int(Date().timeIntervalSince1970)
        if next.token.hasPrefix("vk1."), next.clientID != nil, (next.tokenExpires ?? 0) - 90 > now {
            remember(next)
            return next
        }
        let music = try await fetchMusicToken(cookieHeader: cookies)
        next.token = music.token
        if music.userId != 0 { next.userId = music.userId }
        next.userAgent = MusicClient.userAgent
        next.tokenExpires = music.expires
        next.clientID = music.appID
        remember(next)
        return next
    }

    func fetchMusicToken(cookieHeader: String) async throws -> MusicAuth {
        let endpoints = [
            "https://login.vk.ru/?act=web_token",
            "https://login.vk.com/?act=web_token"
        ]
        let apps = [MusicClient.appID, "2274003"]
        var lastError: Error = VKAPIError.api("Не удалось получить доступ к VK Музыке")
        for endpoint in endpoints {
            for appID in apps {
                do {
                    return try await fetchMusicToken(url: endpoint, cookieHeader: cookieHeader, appID: appID)
                } catch {
                    lastError = error
                }
            }
        }
        throw lastError
    }

    private func fetchMusicToken(url: String, cookieHeader: String, appID: String) async throws -> MusicAuth {
        let json = try await requestJSON(
            url: url,
            method: "POST",
            params: ["version": "1", "app_id": appID],
            formBody: true,
            attachToken: false,
            extraHeaders: [
                "User-Agent": MusicClient.userAgent,
                "Origin": "https://vk.ru",
                "Referer": "https://vk.ru/",
                "Cookie": cookieHeader
            ]
        )
        if (json["type"] as? String) == "error" {
            let info = json["error_info"] as? String ?? "unauthorized"
            throw VKAPIError.api(info)
        }
        let data = json["data"] as? [String: Any] ?? json
        guard let token = data["access_token"] as? String, token.count > 20 else {
            throw VKAPIError.api("VK не выдал токен музыки")
        }
        let userId = intValue(data["user_id"]) ?? 0
        let rawExpires = intValue(data["expires"]) ?? 0
        let now = Int(Date().timeIntervalSince1970)
        let expires = rawExpires > 1_000_000_000 ? rawExpires : now + max(rawExpires, 10_800)
        return MusicAuth(token: token, userId: userId, expires: expires, appID: appID)
    }

    func login(username: String, password: String, code: String? = nil, captchaSid: String? = nil, captchaKey: String? = nil, successToken: String? = nil) async throws -> VKSession {
        var params: [String: String] = [
            "grant_type": "password",
            "client_id": KateClient.clientID,
            "client_secret": KateClient.clientSecret,
            "username": username,
            "password": password,
            "scope": "audio,offline",
            "2fa_supported": "1",
            "v": KateClient.version
        ]
        if let code, !code.isEmpty {
            params["code"] = code
        } else {
            params["force_sms"] = "1"
        }
        if let captchaSid, let captchaKey {
            params["captcha_sid"] = captchaSid
            params["captcha_key"] = captchaKey
        }
        if let successToken, !successToken.isEmpty {
            params["success_token"] = successToken
        }

        let json = try await requestJSON(url: "https://oauth.vk.com/token", method: "POST", params: params, formBody: true, attachToken: false)

        if let token = json["access_token"] as? String {
            let userId = intValue(json["user_id"]) ?? 0
            return VKSession(token: token, userId: userId, userAgent: KateClient.userAgent)
        }

        throw mapOAuthError(json)
    }

    func request2FACode(sid: String) async {
        _ = try? await requestJSON(
            url: "https://api.vk.com/method/auth.validatePhone",
            method: "POST",
            params: ["sid": sid, "v": KateClient.version],
            formBody: true,
            attachToken: false
        )
    }

    func profile(session: VKSession) async throws -> UserProfile {
        var params = ["fields": "photo_200,photo_100"]
        if session.userId != 0 {
            params["user_ids"] = "\(session.userId)"
        }
        let json = try await method("users.get", session: session, params: params)
        let list = json["response"] as? [[String: Any]] ?? []
        guard let first = list.first else { throw VKAPIError.empty }
        return UserProfile(
            id: intValue(first["id"]) ?? session.userId,
            firstName: first["first_name"] as? String ?? "",
            lastName: first["last_name"] as? String ?? "",
            photoURL: url(from: first["photo_200"] ?? first["photo_100"])
        )
    }

    func audios(session: VKSession, ownerId: Int? = nil, playlistId: Int? = nil, accessKey: String? = nil, offset: Int = 0, count: Int = 200) async throws -> [Track] {
        let key = "audios:\(ownerId ?? session.userId):\(playlistId ?? -1)"
        if let cached = cachedTracks(key) { return cached }

        var params: [String: String] = [
            "count": "\(count)",
            "offset": "\(offset)"
        ]
        if let ownerId { params["owner_id"] = "\(ownerId)" }
        if let playlistId { params["album_id"] = "\(playlistId)" }
        if let accessKey, !accessKey.isEmpty { params["access_key"] = accessKey }

        let cookies = session.cookieHeader ?? ""
        let owner = ownerId ?? session.userId
        let tracks = await firstTracks([
            {
                let json = try await self.method("audio.get", session: session, params: params)
                return self.parseTracks(from: json["response"])
            },
            {
                try await self.catalogTracks(session: session, ownerId: ownerId, matching: { title, url in
                    if let ownerId, url.contains("audios\(ownerId)") { return true }
                    return title.contains("музык") || title.contains("аудио") || url.contains("/audios")
                })
            },
            {
                guard owner != 0 else { return [] }
                return try await self.web.audios(cookies: cookies, ownerId: owner, playlistId: playlistId, accessKey: accessKey)
            }
        ])
        if tracks.isEmpty {
            throw VKAPIError.api("Сайт VK не вернул список треков")
        }
        storeTracks(key, tracks)
        return tracks
    }

    func playlists(session: VKSession, ownerId: Int, offset: Int = 0, count: Int = 100) async throws -> [Playlist] {
        if let json = try? await method("audio.getPlaylists", session: session, params: [
            "owner_id": "\(ownerId)",
            "count": "\(count)",
            "offset": "\(offset)"
        ]) {
            let list = parsePlaylists(from: json["response"])
            if !list.isEmpty { return list }
        }
        if let webPlaylists = try? await web.playlists(cookies: session.cookieHeader ?? "", ownerId: ownerId),
           !webPlaylists.isEmpty {
            return webPlaylists
        }
        return (try? await catalogPlaylists(session: session, ownerId: ownerId)) ?? []
    }

    func searchTracks(session: VKSession, query: String, offset: Int = 0, count: Int = 80) async throws -> [Track] {
        let found = await firstTracks([
            {
                let json = try await self.method("audio.search", session: session, params: [
                    "q": query,
                    "count": "\(count)",
                    "offset": "\(offset)",
                    "sort": "0",
                    "autocomplete": "1"
                ])
                return self.parseTracks(from: json["response"])
            },
            {
                try await self.web.search(cookies: session.cookieHeader ?? "", query: query, ownerId: session.userId)
            }
        ])
        return found
    }

    func searchPlaylists(session: VKSession, query: String, count: Int = 24) async throws -> [Playlist] {
        do {
            let json = try await method("audio.searchPlaylists", session: session, params: [
                "q": query,
                "count": "\(count)"
            ])
            return parsePlaylists(from: json["response"])
        } catch {
            guard isUnavailable(error) else { throw error }
            if let json = try? await method("audio.searchAlbums", session: session, params: [
                "q": query,
                "count": "\(count)"
            ]) {
                return parsePlaylists(from: json["response"])
            }
            return []
        }
    }

    func recommendations(session: VKSession, count: Int = 80, force: Bool = false) async throws -> [Track] {
        if !force, let cached = cachedTracks("rec") { return cached }
        if force { dropTrackCache("rec") }
        let cookies = session.cookieHeader ?? ""
        let tracks = await firstTracks([
            {
                let json = try await self.method("audio.getRecommendations", session: session, params: [
                    "count": "\(count)"
                ])
                return self.parseTracks(from: json["response"])
            },
            {
                try await self.catalogTracks(session: session, ownerId: session.userId, matching: { title, _ in
                    title.contains("вас") || title.contains("рекомен") || title.contains("микс")
                })
            },
            {
                try await self.web.sectionTracks(cookies: cookies, ownerId: session.userId, section: "recoms")
            }
        ])
        if !tracks.isEmpty { storeTracks("rec", tracks) }
        return tracks
    }

    func popular(session: VKSession, count: Int = 80) async throws -> [Track] {
        if let cached = cachedTracks("pop") { return cached }
        let tracks = await firstTracks([
            {
                let json = try await self.method("audio.getPopular", session: session, params: [
                    "count": "\(count)"
                ])
                return self.parseTracks(from: json["response"])
            },
            {
                try await self.catalogTracks(session: session, ownerId: nil, matching: { title, _ in
                    title.contains("чарт") || title.contains("популяр") || title.contains("хит")
                })
            },
            {
                try await self.web.sectionTracks(cookies: session.cookieHeader ?? "", ownerId: session.userId, section: "explore")
            }
        ])
        if !tracks.isEmpty { storeTracks("pop", tracks) }
        return tracks
    }

    func resolveURL(session: VKSession, track: Track, force: Bool = false) async throws -> String {
        if !force, let cached = cachedURL(track.id) {
            return cached
        }
        if force {
            invalidateURL(track.id)
        }

        let found = await withTaskGroup(of: (Int, String?).self) { group in
            group.addTask {
                (0, await self.firstURL([
                    { try await self.web.reloadURL(cookies: session.cookieHeader ?? "", track: track) },
                    { try await self.getByIdURL(session: session, track: track) }
                ]))
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 5_500_000_000)
                return (1, nil)
            }
            var result: String?
            for await (tag, value) in group {
                if tag == 0 {
                    result = value
                    group.cancelAll()
                    break
                }
                if tag == 1 {
                    group.cancelAll()
                    break
                }
            }
            return result
        }
        if let url = found, !url.isEmpty {
            storeURL(track.id, url)
            return url
        }
        let fallback = Self.normalizeURL(track.url)
        if !force, !fallback.isEmpty {
            storeURL(track.id, fallback)
            return fallback
        }
        throw VKAPIError.api("У трека нет ссылки на воспроизведение")
    }

    func invalidateURL(_ id: String) {
        tokenLock.lock()
        urlCache.removeValue(forKey: id)
        tokenLock.unlock()
    }

    func dropTrackCache(_ key: String) {
        tokenLock.lock()
        trackCache.removeValue(forKey: key)
        tokenLock.unlock()
    }

    private func getByIdURL(session: VKSession, track: Track) async throws -> String {
        let key = VKWebMusic.reloadKey(for: track)
        let json = try await method("audio.getById", session: session, params: [
            "audios": key
        ])
        let url = parseTracks(from: json["response"]).first.map { Self.normalizeURL($0.url) } ?? ""
        if url.isEmpty { throw VKAPIError.empty }
        return url
    }

    private func firstURL(_ jobs: [() async throws -> String]) async -> String? {
        await withTaskGroup(of: String.self) { group in
            for job in jobs {
                group.addTask { (try? await job()) ?? "" }
            }
            for await url in group {
                if !url.isEmpty {
                    group.cancelAll()
                    return url
                }
            }
            return nil
        }
    }

    static func normalizeURL(_ raw: String) -> String {
        VKWebMusic.cleanURL(raw)
    }

    func add(session: VKSession, track: Track) async throws {
        _ = try await method("audio.add", session: session, params: [
            "owner_id": "\(track.ownerId)",
            "audio_id": "\(track.audioId)"
        ])
    }

    func delete(session: VKSession, track: Track) async throws {
        _ = try await method("audio.delete", session: session, params: [
            "owner_id": "\(track.ownerId)",
            "audio_id": "\(track.audioId)"
        ])
    }

    private func catalogTracks(session: VKSession, ownerId: Int?, matching: (String, String) -> Bool) async throws -> [Track] {
        var params: [String: String] = ["need_blocks": "1"]
        if let ownerId { params["owner_id"] = "\(ownerId)" }
        let json = try await method("catalog.getAudio", session: session, params: params)
        let response = json["response"] as? [String: Any] ?? [:]
        let catalog = response["catalog"] as? [String: Any] ?? response
        let sections = catalog["sections"] as? [[String: Any]] ?? []
        let picked = sections.first { section in
            matching((section["title"] as? String ?? "").lowercased(), (section["url"] as? String ?? "").lowercased())
        } ?? sections.first
        if let sectionId = picked?["id"] as? String {
            return try await catalogSectionTracks(session: session, sectionId: sectionId)
        }
        let recent = parseTracks(from: response["audios"])
        if !recent.isEmpty { return recent }
        throw VKAPIError.api("VK не вернул раздел с музыкой")
    }

    private func catalogSectionTracks(session: VKSession, sectionId: String) async throws -> [Track] {
        var collected: [Track] = []
        var startFrom: String?
        for _ in 0..<2 {
            var params = ["section_id": sectionId]
            if let startFrom { params["start_from"] = startFrom }
            let json = try await method("catalog.getSection", session: session, params: params)
            let response = json["response"] as? [String: Any] ?? [:]
            collected.append(contentsOf: parseTracks(from: response["audios"] ?? response))
            let section = response["section"] as? [String: Any]
            let next = section?["next_from"] as? String
            if let next, !next.isEmpty, next != startFrom {
                startFrom = next
            } else {
                break
            }
        }
        return collected
    }

    private func catalogPlaylists(session: VKSession, ownerId: Int) async throws -> [Playlist] {
        let json = try await method("catalog.getAudio", session: session, params: [
            "owner_id": "\(ownerId)",
            "need_blocks": "1"
        ])
        let response = json["response"] as? [String: Any] ?? [:]
        return parsePlaylists(from: response["playlists"] ?? response)
    }

    private func firstTracks(_ jobs: [() async throws -> [Track]]) async -> [Track] {
        await withTaskGroup(of: [Track].self) { group in
            for job in jobs {
                group.addTask {
                    (try? await job()) ?? []
                }
            }
            for await tracks in group {
                if !tracks.isEmpty {
                    group.cancelAll()
                    return tracks
                }
            }
            return []
        }
    }

    private func cachedTracks(_ key: String) -> [Track]? {
        tokenLock.lock()
        defer { tokenLock.unlock() }
        guard let (date, tracks) = trackCache[key], Date().timeIntervalSince(date) < 180, !tracks.isEmpty else {
            return nil
        }
        return tracks
    }

    private func storeTracks(_ key: String, _ tracks: [Track]) {
        tokenLock.lock()
        defer { tokenLock.unlock() }
        trackCache[key] = (Date(), tracks)
        for track in tracks where !track.url.isEmpty {
            urlCache[track.id] = (Date(), track.url)
        }
    }

    private func cachedURL(_ id: String) -> String? {
        tokenLock.lock()
        defer { tokenLock.unlock() }
        guard let (date, url) = urlCache[id], Date().timeIntervalSince(date) < 10 * 60, !url.isEmpty else {
            return nil
        }
        return url
    }

    private func storeURL(_ id: String, _ url: String) {
        tokenLock.lock()
        defer { tokenLock.unlock() }
        urlCache[id] = (Date(), url)
    }

    func prefetchURLs(session: VKSession, tracks: [Track]) {
        Task {
            for track in tracks.prefix(3) {
                _ = try? await resolveURL(session: session, track: track)
            }
        }
    }

    private func isUnavailable(_ error: Error) -> Bool {
        let text = error.localizedDescription.lowercased()
        return text.contains("unknown method")
            || text.contains("access denied")
            || text.contains("permission")
            || text.contains("blocked")
            || text.contains("authorization failed")
            || text.contains("не открыл музыку")
            || text.contains("нет доступа")
            || text.contains("не отдал музыку")
    }

    private func method(_ name: String, session vk: VKSession, params: [String: String]) async throws -> [String: Any] {
        var live = vk
        if vk.canRefreshMusic {
            live = (try? await resolveMusicSession(vk)) ?? vk
        }
        return try await methodOnce(name, session: live, params: params, retried: false)
    }

    private func methodOnce(_ name: String, session vk: VKSession, params: [String: String], retried: Bool) async throws -> [String: Any] {
        let official = vk.token.hasPrefix("vk1.")
        var all = params
        all["access_token"] = vk.token
        all["v"] = official ? MusicClient.version : KateClient.version
        all["lang"] = "ru"
        if official {
            all["client_id"] = vk.clientID ?? MusicClient.appID
        } else if name.hasPrefix("audio.") {
            all["https"] = "1"
            all["extended"] = "1"
        }
        let host = official ? "https://api.vk.ru/method/" : "https://api.vk.com/method/"
        var headers = [
            "User-Agent": official ? MusicClient.userAgent : (vk.userAgent.isEmpty ? KateClient.userAgent : vk.userAgent),
            "Origin": "https://vk.ru",
            "Referer": "https://vk.ru/"
        ]
        if official, let cookies = vk.cookieHeader {
            headers["Cookie"] = cookies
        }
        let json = try await requestJSON(
            url: host + name,
            method: "POST",
            params: all,
            formBody: true,
            attachToken: false,
            extraHeaders: headers
        )
        if let error = json["error"] as? [String: Any] {
            let code = intValue(error["error_code"]) ?? 0
            let message = error["error_msg"] as? String ?? "Ошибка VK"
            let blocked = message.lowercased().contains("blocked")
            if !retried, !blocked, vk.canRefreshMusic, [3, 5, 15].contains(code) {
                var next = vk
                next.tokenExpires = 0
                let fresh = try await resolveMusicSession(next)
                return try await methodOnce(name, session: fresh, params: params, retried: true)
            }
            throw VKAPIError.api(message)
        }
        return json
    }

    private func requestJSON(url: String, method: String, params: [String: String], formBody: Bool = false, attachToken: Bool, extraHeaders: [String: String] = [:]) async throws -> [String: Any] {
        guard let endpoint = URL(string: url) else {
            throw VKAPIError.transport("Некорректный URL")
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue(KateClient.userAgent, forHTTPHeaderField: "User-Agent")
        for (key, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let encoded = params
            .map { key, value in
                "\(Self.formEncode(key))=\(Self.formEncode(value))"
            }
            .joined(separator: "&")
        if formBody {
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = encoded.data(using: .utf8)
        } else if var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) {
            components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
            guard let finalURL = components.url else {
                throw VKAPIError.transport("Не удалось собрать запрос")
            }
            request.url = finalURL
        }

        do {
            let (data, _) = try await session.data(for: request)
            if let object = try? JSONSerialization.jsonObject(with: data), let dict = object as? [String: Any] {
                return dict
            }
            let raw = String(data: data, encoding: .utf8) ?? ""
            if raw.contains("unauthorized") || raw.contains("error") {
                throw VKAPIError.api("unauthorized")
            }
            throw VKAPIError.empty
        } catch let error as VKAPIError {
            throw error
        } catch {
            throw VKAPIError.transport(error.localizedDescription)
        }
    }

    private func mapOAuthError(_ json: [String: Any]) -> VKAPIError {
        let error = json["error"] as? String ?? ""
        let type = json["error_type"] as? String ?? ""
        let description = json["error_description"] as? String ?? ""

        if error == "invalid_client" {
            return .invalidCredentials
        }
        if error == "invalid_request" {
            return .invalidCode
        }
        if error == "need_validation" {
            return .need2FA(
                sid: json["validation_sid"] as? String ?? "",
                type: json["validation_type"] as? String ?? "",
                message: description
            )
        }
        if error == "need_captcha" {
            return .needCaptcha(
                sid: json["captcha_sid"] as? String ?? "",
                imageURL: url(from: json["captcha_img"]),
                redirectURL: url(from: json["redirect_uri"])
            )
        }
        if error.localizedCaseInsensitiveContains("flood")
            || description.localizedCaseInsensitiveContains("flood")
            || type == "password_bruteforce_attempt" {
            return .flood
        }
        return .api(description.isEmpty ? error : description)
    }

    private func parseTracks(from raw: Any?) -> [Track] {
        var items: [[String: Any]] = []
        if let dict = raw as? [String: Any], let list = dict["items"] as? [[String: Any]] {
            items = list
        } else if let list = raw as? [[String: Any]] {
            items = list
        }

        return items.compactMap { item in
            guard let audioId = intValue(item["id"]), let ownerId = intValue(item["owner_id"]) else { return nil }
            let urlString = Self.normalizeURL(item["url"] as? String ?? "")
            return Track(
                ownerId: ownerId,
                audioId: audioId,
                artist: item["artist"] as? String ?? "Unknown",
                title: item["title"] as? String ?? "Без названия",
                duration: intValue(item["duration"]) ?? 0,
                url: urlString,
                artworkURL: artwork(from: item),
                accessKey: item["access_key"] as? String,
                isAdded: false
            )
        }
    }

    private func parsePlaylists(from raw: Any?) -> [Playlist] {
        var items: [[String: Any]] = []
        if let dict = raw as? [String: Any], let list = dict["items"] as? [[String: Any]] {
            items = list
        } else if let list = raw as? [[String: Any]] {
            items = list
        }

        return items.compactMap { item in
            guard let playlistId = intValue(item["id"]), let ownerId = intValue(item["owner_id"]) else { return nil }
            let count = intValue(item["count"]) ?? 0
            let description = item["description"] as? String ?? ""
            return Playlist(
                ownerId: ownerId,
                playlistId: playlistId,
                title: item["title"] as? String ?? "Плейлист",
                subtitle: description.isEmpty ? "\(count) треков" : description,
                count: count,
                artworkURL: playlistArt(from: item),
                accessKey: item["access_key"] as? String
            )
        }
    }

    private func artwork(from item: [String: Any]) -> URL? {
        if let thumb = item["thumb"] as? [String: Any] {
            return firstURL(in: thumb, keys: ["photo_1200", "photo_600", "photo_300", "photo_270", "photo_135"])
        }
        if let album = item["album"] as? [String: Any], let thumb = album["thumb"] as? [String: Any] {
            return firstURL(in: thumb, keys: ["photo_1200", "photo_600", "photo_300", "photo_270", "photo_135"])
        }
        if let album = item["album"] as? [String: Any] {
            return url(from: album["thumb"])
        }
        return nil
    }

    private func playlistArt(from item: [String: Any]) -> URL? {
        if let photo = item["photo"] as? [String: Any] {
            return firstURL(in: photo, keys: ["photo_1200", "photo_680", "photo_600", "photo_300", "photo_270"])
        }
        if let thumbs = item["thumbs"] as? [[String: Any]], let first = thumbs.first {
            return firstURL(in: first, keys: ["photo_1200", "photo_680", "photo_600", "photo_300"])
        }
        return nil
    }

    private func firstURL(in dict: [String: Any], keys: [String]) -> URL? {
        for key in keys {
            if let value = url(from: dict[key]) { return value }
        }
        return nil
    }

    private func url(from value: Any?) -> URL? {
        if let string = value as? String, let url = URL(string: string), !string.isEmpty {
            return url
        }
        return nil
    }

    private static func formEncode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._*")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func intValue(_ value: Any?) -> Int? {
        if let number = value as? Int { return number }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }
}
