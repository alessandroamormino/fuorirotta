import ImageIO
import SwiftUI
import UIKit

/// Immagini remote per le card: scaricate con URLCache su disco, decodificate come miniature alla misura della card
/// (ImageIO) fuori dal main thread, tenute in una NSCache limitata. AsyncImage non si usa (decodifica a piena risoluzione).
enum ImageLoader {
    // ponytail: 3x fisso (iPhone Pro). Su un 2x la miniatura e' solo piu' grande del necessario; la chiave resta una per misura.
    private static let pixelScale: CGFloat = 3
    private static let maxBytes = 20_000_000

    // NSCache e' thread-safe; Swift 6 non lo sa.
    nonisolated(unsafe) private static let memory: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 60_000_000
        return c
    }()

    // Al primo uso: 50 MB in memoria, 300 MB su disco. Niente cookie verso host di terzi.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        let cache = URLCache(memoryCapacity: 50_000_000, diskCapacity: 300_000_000)
        URLCache.shared = cache
        config.urlCache = cache
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }()

    private static func key(_ url: String, _ size: CGSize) -> NSString {
        "\(url)|\(Int(size.width))x\(Int(size.height))" as NSString
    }

    /// Solo https (nessuna eccezione ATS, T-27-11). nil se non scaricabile o non decodificabile.
    static func image(url: String, size: CGSize) async -> UIImage? {
        guard url.hasPrefix("https://"), let u = URL(string: url) else { return nil }
        let k = key(url, size)
        if let hit = memory.object(forKey: k) { return hit }
        guard let (data, response) = try? await session.data(from: u),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              data.count <= maxBytes else { return nil }
        let maxPixel = max(size.width, size.height) * pixelScale
        let image = await Task.detached(priority: .userInitiated) { thumbnail(data, maxPixel: maxPixel) }.value
        if let image { memory.setObject(image, forKey: k, cost: Int(image.size.width * image.size.height * 4)) }
        return image
    }

    static func prefetch(_ urls: [String], size: CGSize) {
        for url in urls { Task(priority: .utility) { _ = await image(url: url, size: size) } }
    }

    private static func thumbnail(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// Riempie lo spazio che riceve (scaledToFill, ritagliato). Segnaposto di categoria mentre carica, se fallisce e senza URL.
struct RemoteImage: View {
    let url: String?
    let category: String?
    let size: CGSize

    @State private var loaded: UIImage?

    var body: some View {
        Color.clear
            .overlay {
                if let loaded {
                    Image(uiImage: loaded).resizable().scaledToFill()
                } else {
                    CategoryPlaceholder(category: category)
                }
            }
            .clipped()
            .task(id: url) {
                loaded = nil
                guard let url else { return }
                loaded = await ImageLoader.image(url: url, size: size)
            }
    }
}
