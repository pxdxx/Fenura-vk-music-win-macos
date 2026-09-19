import SwiftUI
import AppKit

struct StudioPalette {
    var isDark: Bool
    var canvas: Color
    var canvasSoft: Color
    var peach: Color
    var peachDeep: Color
    var sky: Color
    var sage: Color
    var lilac: Color
    var ink: Color
    var inkSoft: Color
    var inkFaint: Color
    var paper: Color
    var field: Color
    var danger: Color
    var shadow: Color
    var blobPeach: Color
    var blobSky: Color
    var blobLilac: Color
    var blobSage: Color
    var accentOn: Color

    static let light = StudioPalette(
        isDark: false,
        canvas: Color(hex: 0xF6F1EA),
        canvasSoft: Color(hex: 0xE8F0F4),
        peach: Color(hex: 0xFF9B7A),
        peachDeep: Color(hex: 0xF06745),
        sky: Color(hex: 0x7EB6E8),
        sage: Color(hex: 0x4E9F7D),
        lilac: Color(hex: 0xC9B6F2),
        ink: Color(hex: 0x1A1A1A),
        inkSoft: Color(hex: 0x6B6570),
        inkFaint: Color(hex: 0xA39AA5),
        paper: Color.white,
        field: Color(hex: 0xF3EEE8),
        danger: Color(hex: 0xE5484D),
        shadow: Color(hex: 0xC4B5A5).opacity(0.45),
        blobPeach: Color(hex: 0xFF9B7A),
        blobSky: Color(hex: 0x7EB6E8),
        blobLilac: Color(hex: 0xC9B6F2),
        blobSage: Color(hex: 0x4E9F7D),
        accentOn: .white
    )

    static let dark = StudioPalette(
        isDark: true,
        canvas: Color(hex: 0x12081F),
        canvasSoft: Color(hex: 0x1A0B2E),
        peach: Color(hex: 0xFF4FD8),
        peachDeep: Color(hex: 0xFF2D9B),
        sky: Color(hex: 0x8B6CFF),
        sage: Color(hex: 0x5EE2A8),
        lilac: Color(hex: 0xB388FF),
        ink: Color(hex: 0xF4ECFF),
        inkSoft: Color(hex: 0xB9A7D4),
        inkFaint: Color(hex: 0x7E6E9A),
        paper: Color(hex: 0x231438),
        field: Color(hex: 0x2C1848),
        danger: Color(hex: 0xFF5C7A),
        shadow: Color(hex: 0x000000).opacity(0.55),
        blobPeach: Color(hex: 0xFF2D9B),
        blobSky: Color(hex: 0x6B4EFF),
        blobLilac: Color(hex: 0xA855F7),
        blobSage: Color(hex: 0x3D2A6D),
        accentOn: .white
    )
}

private struct StudioPaletteKey: EnvironmentKey {
    static let defaultValue = StudioPalette.dark
}

private struct CompactKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var studioPalette: StudioPalette {
        get { self[StudioPaletteKey.self] }
        set { self[StudioPaletteKey.self] = newValue }
    }

    var fenuraCompact: Bool {
        get { self[CompactKey.self] }
        set { self[CompactKey.self] = newValue }
    }
}

enum FenuraTheme {
    static let accent = Color(hex: 0xFF4FD8)
    static let accentSoft = Color(hex: 0xFF9B7A)
    static let gold = Color(hex: 0xC9B6F2)
    static let ink = Color(hex: 0x12081F)
    static let panel = Color.white.opacity(0.08)
    static let stroke = Color.white.opacity(0.1)
    static let text = Color(hex: 0xF4ECFF)
    static let muted = Color(hex: 0xB9A7D4)
    static let faint = Color(hex: 0x7E6E9A)
    static let sidebarWidth: CGFloat = 210
    static let sidebarCompact: CGFloat = 168
    static let playerHeight: CGFloat = 96
}

enum FenuraMotion {
    static let snap = Animation.spring(response: 0.38, dampingFraction: 0.78)
    static let theme = Animation.spring(response: 0.55, dampingFraction: 0.86)
    static let page = Animation.easeOut(duration: 0.28)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension Font {
    static func fenura(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func fenuraDisplay(_ size: CGFloat, weight: Font.Weight = .black) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

extension View {
    func fenuraGlass(corner: CGFloat = 22) -> some View {
        modifier(SoftCardModifier(padding: 0, radius: corner))
    }

    func softCard(padding: CGFloat = 18, radius: CGFloat = 28) -> some View {
        modifier(SoftCardModifier(padding: padding, radius: radius))
    }
}

struct SoftCardModifier: ViewModifier {
    @Environment(\.studioPalette) private var palette
    var padding: CGFloat = 18
    var radius: CGFloat = 28

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(palette.paper.opacity(palette.isDark ? 0.92 : 0.86))
                    .overlay(
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .stroke(palette.isDark ? palette.lilac.opacity(0.18) : Color.white.opacity(0.7), lineWidth: 1)
                    )
                    .shadow(color: palette.shadow, radius: palette.isDark ? 16 : 20, y: 10)
            )
    }
}

struct AtmosphereBackground: View {
    @Environment(\.studioPalette) private var palette
    var accent: Color?
    @State private var drift = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [palette.canvasSoft, palette.canvas],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Ellipse()
                .fill((accent ?? palette.blobPeach).opacity(palette.isDark ? 0.34 : 0.42))
                .frame(width: 520, height: 360)
                .blur(radius: 90)
                .offset(x: drift ? -80 : -30, y: -180)

            Ellipse()
                .fill(palette.blobSky.opacity(palette.isDark ? 0.32 : 0.38))
                .frame(width: 420, height: 340)
                .blur(radius: 80)
                .offset(x: drift ? 220 : 160, y: 40)

            Ellipse()
                .fill(palette.blobLilac.opacity(palette.isDark ? 0.38 : 0.32))
                .frame(width: 380, height: 300)
                .blur(radius: 85)
                .offset(x: -160, y: drift ? 280 : 340)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                drift = true
            }
        }
    }
}

struct FenuraWordmark: View {
    @Environment(\.studioPalette) private var palette
    var iconSize: CGFloat = 32
    var fontSize: CGFloat = 26

    var body: some View {
        HStack(spacing: 10) {
            Image("AppMark")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: iconSize, height: iconSize)
            Text("Fenura")
                .font(.fenuraDisplay(fontSize))
                .foregroundStyle(palette.ink)
                .fixedSize(horizontal: true, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Fenura")
    }
}

struct ThemeToggleButton: View {
    @Environment(\.studioPalette) private var palette
    let isDark: Bool
    var expanded: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if expanded {
                    HStack(spacing: 10) {
                        Image(systemName: isDark ? "sun.max.fill" : "moon.stars.fill")
                            .font(.system(size: 18, weight: .bold))
                            .symbolEffect(.bounce, value: isDark)
                        Text(isDark ? "Светлая тема" : "Тёмная тема")
                            .font(.fenura(14, weight: .bold))
                        Spacer()
                    }
                    .foregroundStyle(isDark ? palette.peach : palette.ink)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(palette.paper.opacity(0.95))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(palette.isDark ? palette.lilac.opacity(0.2) : Color.white.opacity(0.7), lineWidth: 1)
                    )
                    .shadow(color: palette.shadow.opacity(0.45), radius: 10, y: 5)
                } else {
                    ZStack {
                        Circle()
                            .fill(palette.paper.opacity(0.95))
                            .shadow(color: palette.shadow.opacity(0.55), radius: 8, y: 4)
                        Image(systemName: isDark ? "sun.max.fill" : "moon.stars.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(isDark ? palette.peach : palette.ink)
                            .symbolEffect(.bounce, value: isDark)
                    }
                    .frame(width: 40, height: 40)
                }
            }
        }
        .buttonStyle(.plain)
        .help(isDark ? "Светлая тема" : "Тёмная тема")
    }
}

struct FenuraScrubber: View {
    @Environment(\.studioPalette) private var palette
    @Binding var value: Double
    var range: ClosedRange<Double>
    var enabled: Bool = true

    var body: some View {
        GeometryReader { geo in
            let span = max(range.upperBound - range.lowerBound, 0.0001)
            let progress = CGFloat((value - range.lowerBound) / span)
            let width = geo.size.width

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(palette.ink.opacity(0.12))
                    .frame(height: 5)
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [palette.peach, palette.peachDeep],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(8, width * min(max(progress, 0), 1)), height: 5)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { drag in
                    guard enabled else { return }
                    let ratio = min(max(drag.location.x / max(width, 1), 0), 1)
                    value = range.lowerBound + Double(ratio) * span
                }
            )
        }
        .frame(height: 16)
        .opacity(enabled ? 1 : 0.4)
    }
}

enum Formatters {
    static func duration(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    static func clock(_ time: Double) -> String {
        guard time.isFinite else { return "0:00" }
        return duration(Int(time.rounded(.down)))
    }
}

extension NSImage {
    var fenuraAverageColor: Color? {
        guard let tiff = tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        var r = 0.0, g = 0.0, b = 0.0
        let step = max(rep.pixelsWide / 12, 1)
        var count = 0.0
        for x in stride(from: 0, to: rep.pixelsWide, by: step) {
            for y in stride(from: 0, to: rep.pixelsHigh, by: step) {
                guard let c = rep.colorAt(x: x, y: y) else { continue }
                r += Double(c.redComponent)
                g += Double(c.greenComponent)
                b += Double(c.blueComponent)
                count += 1
            }
        }
        guard count > 0 else { return nil }
        return Color(red: r / count, green: g / count, blue: b / count)
    }
}
