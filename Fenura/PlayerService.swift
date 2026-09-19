import Foundation
import AVFoundation
import MediaPlayer
import Combine
import AppKit
import SwiftUI

@MainActor
final class PlayerService: ObservableObject {
    @Published var current: Track?
    @Published var queue: [Track] = []
    @Published var origin: [Track] = []
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0
    @Published var volume: Double = 0.85
    @Published var shuffle = false
    @Published var repeatMode: RepeatMode = .off
    @Published var ambient: ColorRef?
    @Published var isBuffering = false
    @Published var lastError: String?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var failObserver: NSObjectProtocol?
    private var stallObserver: NSObjectProtocol?
    private var artworkTask: Task<Void, Never>?
    private var startTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var lastAPI: VKAPI?
    private var lastSession: VKSession?
    private var playGeneration = 0
    private var isRecovering = false

    func play(_ track: Track, in tracks: [Track], api: VKAPI, session: VKSession) {
        origin = tracks
        queue = shuffle ? tracks.shuffled() : tracks
        if let index = queue.firstIndex(of: track) {
            let head = Array(queue[index...])
            let tail = Array(queue[..<index])
            queue = head + tail
        } else {
            queue.insert(track, at: 0)
        }
        remember(api: api, session: session)
        start(track, api: api, session: session)
    }

    func toggle(api: VKAPI, session: VKSession) {
        remember(api: api, session: session)
        if current == nil, let first = queue.first {
            start(first, api: api, session: session)
            return
        }
        isPlaying ? pause() : resume()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        MPNowPlayingInfoCenter.default().playbackState = .paused
    }

    func resume() {
        player?.play()
        isPlaying = true
        MPNowPlayingInfoCenter.default().playbackState = .playing
    }

    func next(api: VKAPI? = nil, session: VKSession? = nil) {
        if let api, let session { remember(api: api, session: session) }
        guard let api = lastAPI, let session = lastSession else { return }
        guard let current, let index = queue.firstIndex(where: { $0.id == current.id }) else { return }
        if index + 1 < queue.count {
            start(queue[index + 1], api: api, session: session)
        } else if repeatMode == .all, let first = queue.first {
            start(first, api: api, session: session)
        }
    }

    func previous(api: VKAPI? = nil, session: VKSession? = nil) {
        if let api, let session { remember(api: api, session: session) }
        guard let api = lastAPI, let session = lastSession else { return }
        if currentTime > 3 {
            seek(to: 0)
            return
        }
        guard let current, let index = queue.firstIndex(where: { $0.id == current.id }) else { return }
        if index > 0 {
            start(queue[index - 1], api: api, session: session)
        } else {
            seek(to: 0)
        }
    }

    func seek(to time: Double) {
        let value = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: value)
        currentTime = time
    }

    func setVolume(_ value: Double) {
        volume = min(max(value, 0), 1)
        player?.volume = Float(volume)
    }

    func toggleShuffle() {
        shuffle.toggle()
        guard let current else { return }
        if shuffle {
            var rest = origin.filter { $0 != current }.shuffled()
            queue = [current] + rest
        } else {
            queue = origin
        }
    }

    func cycleRepeat() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
    }

    func replaceCurrent(_ track: Track) {
        if current?.id == track.id {
            current = track
        }
        if let index = queue.firstIndex(where: { $0.id == track.id }) {
            queue[index] = track
        }
        if let index = origin.firstIndex(where: { $0.id == track.id }) {
            origin[index] = track
        }
    }

    private func start(_ track: Track, api: VKAPI, session: VKSession) {
        current = track
        isBuffering = true
        isPlaying = true
        lastError = nil
        isRecovering = false
        currentTime = 0
        duration = Double(track.duration)
        updateNowPlaying(track)
        extractAmbient(from: track.artworkURL)
        playGeneration += 1
        let generation = playGeneration
        startTask?.cancel()
        watchdogTask?.cancel()
        startTask = Task {
            await self.beginPlayback(track, api: api, session: session, generation: generation, attempt: 0)
            self.apiPrefetch(around: track, api: api, session: session)
        }
    }

    private func beginPlayback(_ track: Track, api: VKAPI, session: VKSession, generation: Int, attempt: Int) async {
        do {
            let url = try await api.resolveURL(session: session, track: track, force: attempt > 0)
            guard !Task.isCancelled, generation == playGeneration else { return }
            attach(urlString: url, fallbackDuration: Double(track.duration), track: track, api: api, session: session, generation: generation, attempt: attempt)
        } catch {
            if attempt < 2 {
                api.invalidateURL(track.id)
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled, generation == playGeneration else { return }
                await beginPlayback(track, api: api, session: session, generation: generation, attempt: attempt + 1)
                return
            }
            guard generation == playGeneration else { return }
            isBuffering = false
            isPlaying = false
            lastError = "Не удалось загрузить «\(track.title)». Нажмите трек ещё раз."
        }
    }

    private func apiPrefetch(around track: Track, api: VKAPI, session: VKSession) {
        guard let index = queue.firstIndex(where: { $0.id == track.id }) else { return }
        var neighbors: [Track] = []
        if index + 1 < queue.count { neighbors.append(queue[index + 1]) }
        if index + 2 < queue.count { neighbors.append(queue[index + 2]) }
        api.prefetchURLs(session: session, tracks: neighbors)
    }

    private func attach(urlString: String, fallbackDuration: Double, track: Track? = nil, api: VKAPI? = nil, session: VKSession? = nil, generation: Int = 0, attempt: Int = 0) {
        guard let url = URL(string: urlString), !urlString.isEmpty else {
            isBuffering = false
            return
        }

        teardown()
        var headers: [String: String] = [
            "User-Agent": MusicClient.userAgent,
            "Referer": "https://vk.ru/",
            "Origin": "https://vk.ru"
        ]
        if let cookies = session?.cookieHeader, !cookies.isEmpty {
            headers["Cookie"] = cookies
        }
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        let next = AVPlayer(playerItem: item)
        next.automaticallyWaitsToMinimizeStalling = true
        next.volume = Float(volume)
        player = next
        duration = fallbackDuration
        isBuffering = true
        isRecovering = false

        timeObserver = next.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor in
                self?.currentTime = time.seconds
                if let duration = self?.player?.currentItem?.duration.seconds, duration.isFinite, duration > 0 {
                    self?.duration = duration
                }
                if time.seconds > 0.15 {
                    self?.isBuffering = false
                }
            }
        }

        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.handleEnd()
            }
        }
        failObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.recoverPlayback(track: track, api: api, session: session, generation: generation, attempt: attempt)
            }
        }
        stallObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.isBuffering = true
                self?.player?.play()
            }
        }

        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            guard let self, !Task.isCancelled, generation == self.playGeneration else { return }
            if self.currentTime < 0.4 {
                self.recoverPlayback(track: track, api: api, session: session, generation: generation, attempt: attempt)
            }
        }

        next.play()
        isPlaying = true
        MPNowPlayingInfoCenter.default().playbackState = .playing
        bindRemoteCommands()
    }

    private func recoverPlayback(track: Track?, api: VKAPI?, session: VKSession?, generation: Int, attempt: Int) {
        guard generation == playGeneration, currentTime < 0.4 else { return }
        guard attempt < 2, !isRecovering, let track, let api, let session else {
            guard !isRecovering else { return }
            isBuffering = false
            isPlaying = false
            lastError = "Трек не запустился. Нажмите его ещё раз."
            return
        }
        isRecovering = true
        api.invalidateURL(track.id)
        startTask?.cancel()
        startTask = Task {
            await self.beginPlayback(track, api: api, session: session, generation: generation, attempt: attempt + 1)
        }
    }

    private func handleEnd() {
        if repeatMode == .one {
            seek(to: 0)
            resume()
            return
        }
        next()
    }

    private func remember(api: VKAPI, session: VKSession) {
        lastAPI = api
        lastSession = session
    }

    private func teardown() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        if let failObserver {
            NotificationCenter.default.removeObserver(failObserver)
        }
        if let stallObserver {
            NotificationCenter.default.removeObserver(stallObserver)
        }
        endObserver = nil
        failObserver = nil
        stallObserver = nil
        watchdogTask?.cancel()
        watchdogTask = nil
        player?.pause()
        player = nil
    }

    private func bindRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return .success
        }
    }

    private func updateNowPlaying(_ track: Track) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyPlaybackDuration: track.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1 : 0
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        guard let artworkURL = track.artworkURL else { return }
        Task.detached {
            guard let (data, _) = try? await URLSession.shared.data(from: artworkURL),
                  let image = NSImage(data: data) else { return }
            let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            await MainActor.run {
                var updated = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                updated[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = updated
            }
        }
    }

    private func extractAmbient(from url: URL?) {
        artworkTask?.cancel()
        guard let url else {
            ambient = nil
            return
        }
        artworkTask = Task {
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let image = NSImage(data: data),
                  let color = image.fenuraAverageColor else { return }
            ambient = ColorRef(color)
        }
    }
}

struct ColorRef: Equatable {
    let red: Double
    let green: Double
    let blue: Double

    init(_ color: Color) {
        let ns = NSColor(color).usingColorSpace(.sRGB)
        red = Double(ns?.redComponent ?? 0.3)
        green = Double(ns?.greenComponent ?? 0.2)
        blue = Double(ns?.blueComponent ?? 0.25)
    }

    var color: Color {
        Color(red: red, green: green, blue: blue)
    }
}
