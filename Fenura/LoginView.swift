import SwiftUI

struct LoginView: View {
    @ObservedObject var session: SessionStore
    var isDarkTheme: Bool
    var onToggleTheme: () -> Void

    @Environment(\.studioPalette) private var palette
    @State private var status = "Отдельное окно ВКонтакте"
    @State private var appear = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                ThemeToggleButton(isDark: isDarkTheme, action: onToggleTheme)
            }
            .padding(.top, 20)
            .padding(.trailing, 24)

            Spacer()

            VStack(spacing: 16) {
                FenuraWordmark(iconSize: 44, fontSize: 40)
                    .opacity(appear ? 1 : 0)
                    .offset(y: appear ? 0 : 10)

                Text(status)
                    .font(.fenura(14, weight: .medium))
                    .foregroundStyle(palette.inkSoft)
                    .multilineTextAlignment(.center)

                if let error = session.errorMessage {
                    Text(error)
                        .font(.fenura(13, weight: .semibold))
                        .foregroundStyle(palette.danger)
                        .multilineTextAlignment(.center)
                }

                if session.isBusy {
                    ProgressView()
                        .tint(palette.peachDeep)
                        .padding(.top, 4)
                } else {
                    Button("Войти") {
                        openLoginWindow()
                    }
                    .buttonStyle(.plain)
                    .font(.fenura(15, weight: .bold))
                    .foregroundStyle(palette.accentOn)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            colors: [palette.peach, palette.peachDeep],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: Capsule()
                    )
                    .shadow(color: palette.peachDeep.opacity(0.35), radius: 12, y: 6)
                    .opacity(appear ? 1 : 0)
                }
            }
            .softCard(padding: 36, radius: 32)
            .frame(maxWidth: 420)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            withAnimation(.easeOut(duration: 0.55)) { appear = true }
            openLoginWindow()
        }
        .onDisappear {
            if session.isLoggedIn {
                VKLoginWindowController.shared.dismiss()
            }
        }
    }

    private func openLoginWindow() {
        let controller = VKLoginWindowController.shared
        controller.onStatus = { text in
            status = text
        }
        controller.onSession = { vk in
            status = "Открываем библиотеку"
            Task { await session.finishOAuth(vk) }
        }
        controller.present()
    }
}
