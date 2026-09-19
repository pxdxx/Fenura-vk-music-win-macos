import Foundation
import Combine
import WebKit

enum VKCookieJar {
    nonisolated static func harvest() async -> String? {
        await withCheckedContinuation { continuation in
            let finish: ([HTTPCookie]) -> Void = { cookies in
                let useful = cookies.filter { cookie in
                    let domain = cookie.domain.lowercased()
                    return domain.contains("vk.com") || domain.contains("vk.ru")
                }
                guard useful.contains(where: { $0.name.contains("remixsid") && $0.value.count > 10 }) else {
                    continuation.resume(returning: nil)
                    return
                }
                let header = useful.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                continuation.resume(returning: header)
            }

            DispatchQueue.main.async {
                WKWebsiteDataStore.default().httpCookieStore.getAllCookies(finish)
            }
        }
    }

    nonisolated static func harvestWithRetry() async -> String? {
        for _ in 0..<5 {
            if let header = await harvest() { return header }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return nil
    }

    nonisolated static func clear() {
        DispatchQueue.main.async {
            let store = WKWebsiteDataStore.default()
            store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
                let vk = records.filter { record in
                    let name = record.displayName.lowercased()
                    return name.contains("vk.") || name.contains("vk.com") || name.contains("vk.ru")
                }
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: vk, completionHandler: {})
            }
        }
    }
}

struct PersistedSession: Codable {
    let session: VKSession
    let profile: UserProfile
}

@MainActor
final class SessionStore: ObservableObject {
    private let api = VKAPI()

    @Published var session: VKSession?
    @Published var profile: UserProfile?
    @Published var challenge: AuthChallenge?
    @Published var isBusy = false
    @Published var errorMessage: String?

    var isLoggedIn: Bool { session != nil }

    init() {
        restore()
    }

    func finishOAuth(_ next: VKSession) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }

        do {
            var working = next
            working.cookieHeader = await VKCookieJar.harvestWithRetry() ?? working.cookieHeader
            working = try await api.resolveMusicSession(working)
            let user = (try? await api.profile(session: working)) ?? UserProfile(
                id: working.userId,
                firstName: "VK",
                lastName: "",
                photoURL: nil
            )
            session = working
            profile = user
            challenge = nil
            persist()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func prepareAudioSession() async {
        guard var current = session else { return }
        if current.cookieHeader == nil {
            current.cookieHeader = await VKCookieJar.harvestWithRetry()
        }
        do {
            let upgraded = try await api.resolveMusicSession(current)
            if upgraded != current {
                session = upgraded
                if let user = try? await api.profile(session: upgraded) {
                    profile = user
                }
                persist()
            } else {
                session = upgraded
                api.remember(upgraded)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearError() {
        errorMessage = nil
    }

    func logout() {
        session = nil
        profile = nil
        challenge = nil
        errorMessage = nil
        KeychainStore.delete()
        VKCookieJar.clear()
    }

    func apiClient() -> VKAPI { api }

    private func persist() {
        guard let session, let profile else { return }
        if let data = try? JSONEncoder().encode(PersistedSession(session: session, profile: profile)) {
            KeychainStore.save(data)
        }
    }

    private func restore() {
        guard let data = KeychainStore.load(),
              let stored = try? JSONDecoder().decode(PersistedSession.self, from: data) else { return }
        session = stored.session
        profile = stored.profile
        api.remember(stored.session)
    }
}
