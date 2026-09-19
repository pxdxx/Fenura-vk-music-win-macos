import SwiftUI

struct ArtworkView: View {
    @Environment(\.studioPalette) private var palette
    let url: URL?
    var corner: CGFloat = 12
    var size: CGFloat?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(palette.field)

            Image(systemName: "headphones")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(palette.inkFaint)

            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        EmptyView()
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        .shadow(color: palette.shadow.opacity(0.45), radius: 8, y: 4)
    }
}
