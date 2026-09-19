import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 860

            ZStack {
                AtmosphereBackground(accent: model.player.ambient?.color)
                    .id(model.isDarkTheme ? "dark" : "light")
                    .transition(.opacity)

                if model.session.isLoggedIn {
                    playerShell
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                } else {
                    LoginView(session: model.session, isDarkTheme: model.isDarkTheme) {
                        withAnimation(FenuraMotion.theme) { model.toggleTheme() }
                    }
                    .transition(.opacity)
                }
            }
            .environment(\.fenuraCompact, compact)
            .animation(FenuraMotion.page, value: model.session.isLoggedIn)
        }
        .task {
            await model.bootstrap()
        }
        .onChange(of: model.session.isLoggedIn) { _, loggedIn in
            if loggedIn {
                Task { await model.bootstrap() }
            }
        }
    }

    private var playerShell: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                SidebarView(model: model)
                LibraryView(model: model)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            PlayerBar(model: model)
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
        }
    }
}
