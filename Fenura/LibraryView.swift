import SwiftUI

struct LibraryView: View {
    @ObservedObject var model: AppModel
    @Environment(\.studioPalette) private var palette
    @Environment(\.fenuraCompact) private var compact

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: compact ? 14 : 22) {
                header
                    .id(model.title)
                    .transition(.opacity.combined(with: .offset(y: 8)))

                if let notice = model.notice ?? model.player.lastError {
                    Text(notice)
                        .font(.fenura(13, weight: .semibold))
                        .foregroundStyle(palette.danger)
                        .padding(.horizontal, 24)
                }

                if model.section == .search {
                    SearchView(model: model)
                } else if case .playlist(let playlist) = model.section {
                    playlistHero(playlist)
                } else if model.section == .myMusic, !model.playlists.isEmpty {
                    playlistStrip
                }

                if model.isLoading && model.tracks.isEmpty {
                    ProgressView()
                        .controlSize(.regular)
                        .tint(palette.peachDeep)
                        .padding(.top, 50)
                        .frame(maxWidth: .infinity)
                } else if model.tracks.isEmpty && model.section != .search {
                    emptyState
                } else if !model.tracks.isEmpty {
                    TrackListView(
                        tracks: model.tracks,
                        currentId: model.player.current?.id,
                        isPlaying: model.player.isPlaying,
                        onPlay: { model.play($0) },
                        onLike: { track in
                            Task { await model.toggleLike(track) }
                        }
                    )
                    .softCard(padding: compact ? 4 : 8, radius: 22)
                    .padding(.horizontal, compact ? 12 : 20)
                }
            }
            .padding(.top, 28)
            .padding(.bottom, 12)
            .animation(FenuraMotion.page, value: model.title)
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 10) {
                FenuraWordmark(iconSize: compact ? 28 : 34, fontSize: compact ? 22 : 26)
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.title)
                        .font(.fenuraDisplay(compact ? 22 : 28))
                        .foregroundStyle(palette.ink)
                    Text(model.subtitle)
                        .font(.fenura(13, weight: .medium))
                        .foregroundStyle(palette.inkSoft)
                }
            }
            Spacer(minLength: 12)
            HStack(spacing: 8) {
                if model.section == .recommendations {
                    Button {
                        Task { await model.refreshRecommendations() }
                    } label: {
                        HStack(spacing: 8) {
                            if model.isRefreshing {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                            Text("Обновить")
                        }
                        .font(.fenura(13, weight: .bold))
                        .foregroundStyle(palette.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(palette.paper.opacity(0.95), in: Capsule())
                        .overlay(Capsule().stroke(palette.ink.opacity(0.08), lineWidth: 1))
                        .shadow(color: palette.shadow.opacity(0.35), radius: 8, y: 4)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isRefreshing)
                }

                if !model.tracks.isEmpty {
                    Button {
                        if let first = model.tracks.first {
                            model.play(first)
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "play.fill")
                            Text("Слушать")
                        }
                        .font(.fenura(13, weight: .bold))
                        .foregroundStyle(palette.accentOn)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            LinearGradient(
                                colors: [palette.peach, palette.peachDeep],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            in: Capsule()
                        )
                        .shadow(color: palette.peachDeep.opacity(0.35), radius: 10, y: 5)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 24)
    }

    private var playlistStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Плейлисты")
                .font(.fenura(16, weight: .bold))
                .foregroundStyle(palette.ink)
                .padding(.horizontal, 24)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(model.playlists) { playlist in
                        PlaylistCard(playlist: playlist) {
                            Task { await model.open(.playlist(playlist)) }
                        }
                    }
                }
                .padding(.horizontal, 24)
            }
        }
    }

    private func playlistHero(_ playlist: Playlist) -> some View {
        HStack(alignment: .center, spacing: 18) {
            ArtworkView(url: playlist.artworkURL, corner: 18, size: 120)
            VStack(alignment: .leading, spacing: 8) {
                Text("Плейлист")
                    .font(.fenura(11, weight: .bold))
                    .foregroundStyle(palette.peachDeep)
                Text(playlist.title)
                    .font(.fenuraDisplay(26))
                    .foregroundStyle(palette.ink)
                Text(playlist.subtitle)
                    .font(.fenura(13, weight: .medium))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(3)
            }
            Spacer()
        }
        .softCard(padding: 16, radius: 26)
        .padding(.horizontal, 20)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "headphones")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(palette.peach)
            Text("Пока тихо")
                .font(.fenura(18, weight: .bold))
                .foregroundStyle(palette.ink)
            Text("Выберите раздел или обновите библиотеку.")
                .font(.fenura(13, weight: .medium))
                .foregroundStyle(palette.inkSoft)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 70)
    }
}

struct PlaylistCard: View {
    @Environment(\.studioPalette) private var palette
    let playlist: Playlist
    let onOpen: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 10) {
                ArtworkView(url: playlist.artworkURL, corner: 16, size: 132)
                    .scaleEffect(hovering ? 1.03 : 1)
                Text(playlist.title)
                    .font(.fenura(13, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .frame(width: 132, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(FenuraMotion.snap, value: hovering)
    }
}

struct SearchView: View {
    @ObservedObject var model: AppModel
    @Environment(\.studioPalette) private var palette
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(palette.inkFaint)
                TextField("Треки, плейлисты, исполнители", text: $model.query)
                    .textFieldStyle(.plain)
                    .font(.fenura(14, weight: .medium))
                    .foregroundStyle(palette.ink)
                    .onChange(of: model.query) { _, _ in
                        task?.cancel()
                        task = Task {
                            try? await Task.sleep(for: .milliseconds(380))
                            guard !Task.isCancelled else { return }
                            await model.runSearch()
                        }
                    }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .softCard(padding: 0, radius: 18)
            .padding(.horizontal, 20)

            if !model.search.playlists.isEmpty {
                Text("Плейлисты")
                    .font(.fenura(16, weight: .bold))
                    .foregroundStyle(palette.ink)
                    .padding(.horizontal, 24)
                PlaylistGrid(playlists: model.search.playlists) { playlist in
                    Task { await model.open(.playlist(playlist)) }
                }
            }

            if !model.search.tracks.isEmpty {
                Text("Треки")
                    .font(.fenura(16, weight: .bold))
                    .foregroundStyle(palette.ink)
                    .padding(.horizontal, 24)
            }
        }
    }
}

struct PlaylistGrid: View {
    let playlists: [Playlist]
    let onOpen: (Playlist) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 16)], spacing: 16) {
            ForEach(playlists) { playlist in
                PlaylistCard(playlist: playlist) {
                    onOpen(playlist)
                }
            }
        }
        .padding(.horizontal, 24)
    }
}
