import SwiftUI

struct SidebarView: View {
    @ObservedObject var model: AppModel
    @Environment(\.studioPalette) private var palette
    @Environment(\.fenuraCompact) private var compact

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: compact ? 34 : 44)

            ThemeToggleButton(isDark: model.isDarkTheme, expanded: true) {
                withAnimation(FenuraMotion.theme) { model.toggleTheme() }
            }
            .padding(.horizontal, compact ? 10 : 12)
            .padding(.bottom, compact ? 12 : 16)

            navRow("Моя музыка", icon: "music.note.list", selected: isSelected(.myMusic)) {
                Task { await model.open(.myMusic) }
            }
            navRow("Для вас", icon: "sparkles", selected: isSelected(.recommendations)) {
                Task { await model.open(.recommendations) }
            }
            navRow("Популярное", icon: "chart.line.uptrend.xyaxis", selected: isSelected(.popular)) {
                Task { await model.open(.popular) }
            }
            navRow("Поиск", icon: "magnifyingglass", selected: isSelected(.search)) {
                Task { await model.open(.search) }
            }

            if !model.playlists.isEmpty {
                Text("Плейлисты")
                    .font(.fenura(11, weight: .bold))
                    .tracking(0.8)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.inkFaint)
                    .padding(.horizontal, 22)
                    .padding(.top, 22)
                    .padding(.bottom, 8)

                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(model.playlists) { playlist in
                            navRow(playlist.title, icon: "square.stack.fill", selected: isSelected(.playlist(playlist))) {
                                Task { await model.open(.playlist(playlist)) }
                            }
                        }
                    }
                }
            }

            Spacer(minLength: 12)

            if let profile = model.session.profile {
                HStack(spacing: 10) {
                    ArtworkView(url: profile.photoURL, corner: 14, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(profile.displayName)
                            .font(.fenura(12.5, weight: .semibold))
                            .foregroundStyle(palette.ink)
                            .lineLimit(1)
                        Button("Выйти") {
                            model.logout()
                        }
                        .buttonStyle(.plain)
                        .font(.fenura(11, weight: .medium))
                        .foregroundStyle(palette.inkSoft)
                    }
                }
                .padding(12)
                .softCard(padding: 0, radius: 20)
                .padding(.horizontal, 14)
                .padding(.bottom, 16)
            }
        }
        .frame(width: compact ? FenuraTheme.sidebarCompact : FenuraTheme.sidebarWidth)
    }

    private func navRow(_ title: String, icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 16)
                Text(title)
                    .font(.fenura(13.5, weight: selected ? .bold : .medium))
                    .lineLimit(1)
                Spacer()
            }
            .foregroundStyle(selected ? palette.accentOn : palette.inkSoft)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [palette.peach, palette.peachDeep],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
            .padding(.horizontal, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(FenuraMotion.snap, value: selected)
    }

    private func isSelected(_ section: LibrarySection) -> Bool {
        model.section == section
    }
}
