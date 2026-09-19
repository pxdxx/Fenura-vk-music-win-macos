import Foundation
import Combine

@MainActor
final class AppModel: ObservableObject {
    let session = SessionStore()
    let player = PlayerService()

    @Published var section: LibrarySection = .myMusic
    @Published var tracks: [Track] = []
    @Published var playlists: [Playlist] = []
    @Published var search = SearchBundle()
    @Published var query = ""
    @Published var isLoading = false
    @Published var isRefreshing = false
    @Published var notice: String?
    @Published var addedIds: Set<String> = []
    @Published var isDarkTheme: Bool

    private var sectionCache: [String: [Track]] = [:]
    private var bag = Set<AnyCancellable>()
    private var prefetchTask: Task<Void, Never>?

    init() {
        isDarkTheme = UserDefaults.standard.object(forKey: "fenura.isDarkTheme") as? Bool ?? true
        session.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &bag)
        player.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &bag)
    }

    var palette: StudioPalette { isDarkTheme ? .dark : .light }

    func toggleTheme() {
        isDarkTheme.toggle()
        UserDefaults.standard.set(isDarkTheme, forKey: "fenura.isDarkTheme")
    }

    var title: String {
        switch section {
        case .myMusic: return "Моя музыка"
        case .recommendations: return "Для вас"
        case .popular: return "Популярное"
        case .search: return query.isEmpty ? "Поиск" : query
        case .playlist(let playlist): return playlist.title
        }
    }

    var subtitle: String {
        switch section {
        case .myMusic:
            return "\(tracks.count) треков в вашей библиотеке"
        case .recommendations:
            return "Подборка по тому, что вы слушаете"
        case .popular:
            return "Что сейчас крутят во ВКонтакте"
        case .search:
            return query.isEmpty ? "Найдите трек, исполнителя или плейлист" : "\(search.tracks.count) треков · \(search.playlists.count) плейлистов"
        case .playlist(let playlist):
            return "\(playlist.count) треков"
        }
    }

    func bootstrap() async {
        guard session.isLoggedIn else { return }
        await session.prepareAudioSession()
        if session.session?.token.hasPrefix("vk1.") == true {
            session.clearError()
        } else if let error = session.errorMessage {
            notice = error
        }
        async let music: Void = open(.myMusic)
        async let lists: Void = refreshPlaylists()
        _ = await (music, lists)
        prefetchNeighbors()
    }

    func open(_ next: LibrarySection, force: Bool = false) async {
        section = next
        notice = nil
        if !force, next != .search, let cached = sectionCache[cacheKey(next)], !cached.isEmpty {
            tracks = cached
            isLoading = false
        } else if next != .search {
            isLoading = tracks.isEmpty
        }

        guard let vk = session.session else {
            isLoading = false
            return
        }
        if next == .search {
            isLoading = false
            return
        }

        let api = session.apiClient()
        do {
            var nextTracks: [Track] = []
            switch next {
            case .myMusic:
                let owner = session.profile?.id ?? vk.userId
                nextTracks = try await api.audios(session: vk, ownerId: owner)
                addedIds = Set(nextTracks.map(\.id))
            case .recommendations:
                nextTracks = try await api.recommendations(session: vk, force: force)
            case .popular:
                nextTracks = try await api.popular(session: vk)
            case .search:
                break
            case .playlist(let playlist):
                nextTracks = try await api.audios(
                    session: vk,
                    ownerId: playlist.ownerId,
                    playlistId: playlist.playlistId,
                    accessKey: playlist.accessKey
                )
            }
            markAdded(in: &nextTracks)
            tracks = nextTracks
            if !nextTracks.isEmpty {
                sectionCache[cacheKey(next)] = nextTracks
            }
        } catch {
            if tracks.isEmpty {
                notice = error.localizedDescription
            }
        }
        isLoading = false
    }

    func refreshPlaylists() async {
        guard let vk = session.session else { return }
        let owner = session.profile?.id ?? vk.userId
        playlists = (try? await session.apiClient().playlists(session: vk, ownerId: owner)) ?? []
    }

    private func cacheKey(_ section: LibrarySection) -> String {
        switch section {
        case .myMusic: return "my"
        case .recommendations: return "rec"
        case .popular: return "pop"
        case .search: return "search"
        case .playlist(let playlist): return "pl:\(playlist.id)"
        }
    }

    private func prefetchNeighbors() {
        prefetchTask?.cancel()
        prefetchTask = Task {
            guard let vk = session.session else { return }
            let api = session.apiClient()
            async let recs = api.recommendations(session: vk)
            async let pop = api.popular(session: vk)
            if let tracks = try? await recs, !tracks.isEmpty {
                sectionCache["rec"] = tracks
            }
            if let tracks = try? await pop, !tracks.isEmpty {
                sectionCache["pop"] = tracks
            }
        }
    }

    func runSearch() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        section = .search
        guard let vk = session.session, text.count >= 2 else {
            search = SearchBundle()
            tracks = []
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let foundTracks = try await session.apiClient().searchTracks(session: vk, query: text)
            let foundPlaylists = (try? await session.apiClient().searchPlaylists(session: vk, query: text)) ?? []
            var bundle = SearchBundle(tracks: foundTracks, playlists: foundPlaylists)
            markAdded(in: &bundle.tracks)
            search = bundle
            tracks = bundle.tracks
        } catch {
            notice = error.localizedDescription
        }
    }

    func refreshRecommendations() async {
        guard session.session != nil else { return }
        isRefreshing = true
        notice = nil
        sectionCache.removeValue(forKey: "rec")
        session.apiClient().dropTrackCache("rec")
        defer { isRefreshing = false }
        await open(.recommendations, force: true)
        if tracks.isEmpty {
            notice = "Не удалось обновить подборку. Попробуйте ещё раз."
        }
    }

    func play(_ track: Track, in list: [Track]? = nil) {
        guard let vk = session.session else { return }
        player.play(track, in: list ?? tracks, api: session.apiClient(), session: vk)
    }

    func toggleCurrent() {
        guard let vk = session.session else { return }
        player.toggle(api: session.apiClient(), session: vk)
    }

    func toggleLike(_ track: Track) async {
        guard let vk = session.session else { return }
        do {
            if addedIds.contains(track.id) {
                try await session.apiClient().delete(session: vk, track: track)
                addedIds.remove(track.id)
            } else {
                try await session.apiClient().add(session: vk, track: track)
                addedIds.insert(track.id)
            }
            if let index = tracks.firstIndex(of: track) {
                tracks[index].isAdded = addedIds.contains(track.id)
            }
            var copy = track
            copy.isAdded = addedIds.contains(track.id)
            player.replaceCurrent(copy)
        } catch {
            notice = error.localizedDescription
        }
    }

    func logout() {
        player.pause()
        session.logout()
        tracks = []
        playlists = []
        search = SearchBundle()
        addedIds = []
        sectionCache = [:]
        section = .myMusic
    }

    private func markAdded(in list: inout [Track]) {
        for index in list.indices {
            list[index].isAdded = addedIds.contains(list[index].id)
        }
    }
}
