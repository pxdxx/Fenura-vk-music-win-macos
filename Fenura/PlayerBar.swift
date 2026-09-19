import SwiftUI

struct PlayerBar: View {
    @ObservedObject var model: AppModel
    @Environment(\.studioPalette) private var palette
    @Environment(\.fenuraCompact) private var compact

    var body: some View {
        HStack(spacing: compact ? 10 : 20) {
            nowPlaying
                .frame(maxWidth: .infinity, alignment: .leading)

            transport
                .frame(maxWidth: compact ? 280 : 420)

            if !compact {
                extras
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, compact ? 10 : 16)
        .padding(.vertical, compact ? 8 : 12)
        .softCard(padding: 0, radius: 22)
    }

    private var nowPlaying: some View {
        HStack(spacing: 12) {
            ArtworkView(url: model.player.current?.artworkURL, corner: compact ? 10 : 12, size: compact ? 42 : 52)
                .scaleEffect(model.player.isPlaying ? 1 : 0.96)
                .animation(FenuraMotion.snap, value: model.player.isPlaying)

            VStack(alignment: .leading, spacing: 3) {
                Text(model.player.current?.title ?? "Ничего не играет")
                    .font(.fenura(13.5, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                Text(model.player.current?.artist ?? "Выберите трек")
                    .font(.fenura(12, weight: .medium))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
            }

            if let track = model.player.current {
                Button {
                    Task { await model.toggleLike(track) }
                } label: {
                    Image(systemName: model.addedIds.contains(track.id) ? "heart.fill" : "heart")
                        .foregroundStyle(model.addedIds.contains(track.id) ? palette.peachDeep : palette.inkFaint)
                        .symbolEffect(.bounce, value: model.addedIds.contains(track.id))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var transport: some View {
        VStack(spacing: 8) {
            HStack(spacing: 18) {
                iconButton("shuffle", active: model.player.shuffle) {
                    model.player.toggleShuffle()
                }

                iconButton("backward.fill") {
                    model.player.previous()
                }

                Button(action: model.toggleCurrent) {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [palette.peach, palette.peachDeep],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 40, height: 40)
                            .shadow(color: palette.peachDeep.opacity(0.4), radius: 10, y: 5)
                        if model.player.isBuffering {
                            ProgressView()
                                .controlSize(.small)
                                .tint(palette.accentOn)
                        } else {
                            Image(systemName: model.player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(palette.accentOn)
                                .offset(x: model.player.isPlaying ? 0 : 1)
                                .symbolEffect(.bounce, value: model.player.isPlaying)
                        }
                    }
                    .scaleEffect(model.player.isPlaying ? 1.04 : 1)
                }
                .buttonStyle(.plain)
                .animation(FenuraMotion.snap, value: model.player.isPlaying)

                iconButton("forward.fill") {
                    model.player.next()
                }

                iconButton(repeatSymbol, active: model.player.repeatMode != .off) {
                    model.player.cycleRepeat()
                }
            }

            HStack(spacing: 8) {
                Text(Formatters.clock(model.player.currentTime))
                    .font(.fenura(11, weight: .medium))
                    .foregroundStyle(palette.inkFaint)
                    .monospacedDigit()
                    .frame(width: 36, alignment: .trailing)

                FenuraScrubber(
                    value: Binding(
                        get: { model.player.currentTime },
                        set: { model.player.seek(to: $0) }
                    ),
                    range: 0...max(model.player.duration, 1),
                    enabled: model.player.current != nil
                )

                Text(Formatters.clock(model.player.duration))
                    .font(.fenura(11, weight: .medium))
                    .foregroundStyle(palette.inkFaint)
                    .monospacedDigit()
                    .frame(width: 36, alignment: .leading)
            }
        }
    }

    private var extras: some View {
        HStack(spacing: 8) {
            Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 11))
                .foregroundStyle(palette.inkSoft)
            FenuraScrubber(
                value: Binding(
                    get: { model.player.volume },
                    set: { model.player.setVolume($0) }
                ),
                range: 0...1
            )
            .frame(width: 92)
        }
        .padding(.trailing, 6)
    }

    private var repeatSymbol: String {
        model.player.repeatMode == .one ? "repeat.1" : "repeat"
    }

    private func iconButton(_ system: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active ? palette.peachDeep : palette.inkSoft)
        }
        .buttonStyle(.plain)
    }
}
