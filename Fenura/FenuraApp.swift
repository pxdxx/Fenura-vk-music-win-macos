import SwiftUI
import AppKit

final class FenuraAppDelegate: NSObject, NSApplicationDelegate {}

@main
struct FenuraApp: App {
    @NSApplicationDelegateAdaptor(FenuraAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .environment(\.studioPalette, model.palette)
                .preferredColorScheme(model.isDarkTheme ? .dark : .light)
                .animation(FenuraMotion.theme, value: model.isDarkTheme)
                .frame(minWidth: 1057, minHeight: 525)
                .onAppear {
                    DispatchQueue.main.async {
                        if let window = NSApp.windows.first(where: { $0.isVisible || $0.isMainWindow }) ?? NSApp.windows.first {
                            window.setContentSize(NSSize(width: 1057, height: 525))
                        }
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1057, height: 525)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Воспроизведение") {
                Button(model.player.isPlaying ? "Пауза" : "Играть") {
                    model.toggleCurrent()
                }
                .keyboardShortcut(.space, modifiers: [])

                Button("Следующий трек") {
                    model.player.next()
                }
                .keyboardShortcut(.rightArrow, modifiers: [.command])

                Button("Предыдущий трек") {
                    model.player.previous()
                }
                .keyboardShortcut(.leftArrow, modifiers: [.command])
            }
            CommandMenu("Вид") {
                Button(model.isDarkTheme ? "Светлая тема" : "Тёмная тема") {
                    withAnimation(FenuraMotion.theme) { model.toggleTheme() }
                }
                .keyboardShortcut("t", modifiers: [.command, .shift])
            }
        }
    }
}
