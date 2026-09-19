import AppKit
import Foundation
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("usage: generate-icon.swift SOURCE.png OUT_DIR\n", stderr)
    exit(1)
}

let source = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

guard let image = NSImage(contentsOf: source),
      let tiff = image.tiffRepresentation,
      let sourceRep = NSBitmapImageRep(data: tiff),
      let sourceCG = sourceRep.cgImage else {
    fputs("cannot read \(source.path)\n", stderr)
    exit(1)
}

let size = 1024
let bytesPerPixel = 4
let bytesPerRow = size * bytesPerPixel
var pixels = [UInt8](repeating: 0, count: size * size * bytesPerPixel)
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
    data: &pixels,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("cannot create context\n", stderr)
    exit(1)
}
ctx.interpolationQuality = .high
ctx.draw(sourceCG, in: CGRect(x: 0, y: 0, width: size, height: size))

func offset(_ x: Int, _ y: Int) -> Int { (y * size + x) * bytesPerPixel }

func luma(_ x: Int, _ y: Int) -> Int {
    let o = offset(x, y)
    return Int(pixels[o]) + Int(pixels[o + 1]) + Int(pixels[o + 2])
}

let darkCut = 65
var marked = [UInt8](repeating: 0, count: size * size)
var queue = [Int]()
queue.reserveCapacity(size * 8)

func enqueue(_ x: Int, _ y: Int) {
    guard x >= 0, y >= 0, x < size, y < size else { return }
    let i = y * size + x
    guard marked[i] == 0, luma(x, y) < darkCut else { return }
    marked[i] = 1
    queue.append(i)
}

for i in 0..<size {
    enqueue(i, 0)
    enqueue(i, size - 1)
    enqueue(0, i)
    enqueue(size - 1, i)
}

var head = 0
while head < queue.count {
    let i = queue[head]
    head += 1
    let x = i % size
    let y = i / size
    enqueue(x + 1, y)
    enqueue(x - 1, y)
    enqueue(x, y + 1)
    enqueue(x, y - 1)
}

func touchesBackdrop(_ x: Int, _ y: Int) -> Bool {
    for dy in -1...1 {
        for dx in -1...1 {
            let nx = x + dx
            let ny = y + dy
            guard nx >= 0, ny >= 0, nx < size, ny < size else { continue }
            if marked[ny * size + nx] == 1 { return true }
        }
    }
    return false
}

var minX = size, minY = size, maxX = 0, maxY = 0
for y in 0..<size {
    for x in 0..<size {
        let i = y * size + x
        let o = offset(x, y)
        if marked[i] == 1 {
            pixels[o] = 0
            pixels[o + 1] = 0
            pixels[o + 2] = 0
            pixels[o + 3] = 0
            continue
        }
        let light = luma(x, y)
        if light < 110, touchesBackdrop(x, y) {
            let alpha = UInt8(max(0, min(255, (light - darkCut) * 255 / 45)))
            if alpha < 16 {
                pixels[o] = 0
                pixels[o + 1] = 0
                pixels[o + 2] = 0
                pixels[o + 3] = 0
                continue
            }
            let scale = Double(alpha) / 255.0
            pixels[o] = UInt8(Double(pixels[o]) * scale)
            pixels[o + 1] = UInt8(Double(pixels[o + 1]) * scale)
            pixels[o + 2] = UInt8(Double(pixels[o + 2]) * scale)
            pixels[o + 3] = alpha
        }
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
    }
}

let width = maxX - minX + 1
let height = maxY - minY + 1
let side = max(width, height)
let pad = Int(Double(side) * 0.02)
var boxX = min(minX, max(0, (minX + maxX + 1 - side) / 2)) - pad
var boxY = min(minY, max(0, (minY + maxY + 1 - side) / 2)) - pad
var boxS = side + pad * 2
if boxX < 0 { boxS += boxX; boxX = 0 }
if boxY < 0 { boxS += boxY; boxY = 0 }
if boxX + boxS > size { boxS = size - boxX }
if boxY + boxS > size { boxS = size - boxY }

guard let knocked = ctx.makeImage()?.cropping(to: CGRect(x: boxX, y: boxY, width: boxS, height: boxS)) else {
    fputs("cannot crop icon\n", stderr)
    exit(1)
}

func writePNG(to url: URL, pixel: Int) {
    let out = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixel,
        pixelsHigh: pixel,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
    NSGraphicsContext.current?.imageInterpolation = .high
    NSColor.clear.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: pixel, height: pixel)).fill()
    NSGraphicsContext.current?.cgContext.interpolationQuality = .high
    NSGraphicsContext.current?.cgContext.draw(knocked, in: CGRect(x: 0, y: 0, width: pixel, height: pixel))
    NSGraphicsContext.restoreGraphicsState()
    if let data = out.representation(using: .png, properties: [:]) {
        try? data.write(to: url)
    }
}

let names: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024)
]

for (name, pixel) in names {
    writePNG(to: outDir.appendingPathComponent(name), pixel: pixel)
}

print("transparent icons at \(outDir.path) crop=\(boxS)x\(boxS)")
