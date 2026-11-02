import Foundation

/// Gli eventi per l'hero "Questo weekend": prima quelli con foto e brevi (<= 96 h), poi quelli con foto,
/// poi il resto (i mercati Gen-Dic non rubano il posto a una sagra del weekend). Dentro ogni gruppo vale
/// l'ordine del server; al massimo `max` (8).
public func heroPicks(_ events: [Event], max: Int = 8) -> [Event] {
    func hasImage(_ e: Event) -> Bool { e.imageUrl?.hasPrefix("https://") == true }
    func isShort(_ e: Event) -> Bool {
        guard let end = e.dateEnd else { return true }
        guard let s = parseISO(e.dateStart), let f = parseISO(end) else { return false }
        return f.timeIntervalSince(s) <= 96 * 3600
    }
    let tiers = [
        events.filter { hasImage($0) && isShort($0) },
        events.filter { hasImage($0) && !isShort($0) },
        events.filter { !hasImage($0) },
    ]
    return Array(tiers.joined().prefix(max))
}
