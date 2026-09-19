import SwiftUI

struct TrackRow: View {
    @Environment(\.studioPalette) private var palette
    let track: Track
    let index: Int
    let isCurrent: Bool
    let isPlaying: Bool
    let onPlay: () -> Void
    let onLike: () -> Void

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                if hovering || isCurrent {
                    Image(systemName: isCurrent && isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(isCurrent ? palette.peachDeep : palette.ink)
                } else {
                    Text("\(index)")
                        .font(.fenura(12, weight: .medium))
                        .foregroundStyle(palette.inkFaint)
                        .monospacedDigit()
                }
            }
            .frame(width: 22)

            ArtworkView(url: track.artworkURL, corner: 10, size: 40)

            VStack(alignment: .leading, spacing: 3) {
                Text(track.title)
                    .font(.fenura(13.5, weight: isCurrent ? .bold : .medium))
                    .foregroundStyle(isCurrent ? palette.peachDeep : palette.ink)
                    .lineLimit(1)
                Text(track.artist)
                    .font(.fenura(12, weight: .medium))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            Button(action: onLike) {
                Image(systemName: track.isAdded ? "heart.fill" : "heart")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(track.isAdded ? palette.peachDeep : palette.inkFaint)
            }
            .buttonStyle(.plain)
            .opacity(hovering || track.isAdded ? 1 : 0)

            Text(Formatters.duration(track.duration))
                .font(.fenura(12, weight: .medium))
                .foregroundStyle(palette.inkFaint)
                .monospacedDigit()
                .frame(width: 42, alignment: .trailing)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isCurrent || hovering ? palette.field.opacity(palette.isDark ? 0.7 : 0.9) : Color.clear)
        )
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onHover { hovering = $0 }
        .onTapGesture(perform: onPlay)
        .contextMenu {
            Button("Слушать", action: onPlay)
            Button(track.isAdded ? "Убрать из моей музыки" : "Добавить в мою музыку", action: onLike)
        }
        .animation(FenuraMotion.snap, value: hovering)
    }
}

struct TrackListView: View {
    let tracks: [Track]
    let currentId: String?
    let isPlaying: Bool
    let onPlay: (Track) -> Void
    let onLike: (Track) -> Void

    var body: some View {
        LazyVStack(spacing: 2) {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                TrackRow(
                    track: track,
                    index: index + 1,
                    isCurrent: track.id == currentId,
                    isPlaying: isPlaying && track.id == currentId,
                    onPlay: { onPlay(track) },
                    onLike: { onLike(track) }
                )
            }
        }
    }
}
