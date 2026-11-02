import Foundation

// Statistiche dei salvati per data dell'evento (D-13): niente visitato, niente check-in.
// L'ingresso e' lo stesso per ospiti (salvati sul telefono) e account (salvati sincronizzati).

public struct StatItem: Hashable, Sendable {
    public var dateStart: String
    public var dateEnd: String?
    public var category: String?
    public init(dateStart: String, dateEnd: String?, category: String?) {
        self.dateStart = dateStart; self.dateEnd = dateEnd; self.category = category
    }
}

public struct Stats: Sendable {
    public var days: [String: Int]
    public var perMonth: [Int]
    public var perCategory: [(name: String, count: Int)]
    public var years: [Int]
}

/// Un evento piu' lungo di cosi' (giorni di calendario, estremi inclusi) accende solo il giorno d'inizio (UI-SPEC, A13).
let heatmapMaxSpreadDays = 14

private let dayFormat = "%04d-%02d-%02d"

private func countedDays(_ item: StatItem) -> [String] {
    guard let d = eventDays(dateStart: item.dateStart, dateEnd: item.dateEnd) else { return [] }
    let cal = Rome.calendar
    guard var cursor = day(d.startDay), let last = day(d.endDay) else { return [] }
    var out: [String] = []
    while cursor <= last, out.count <= heatmapMaxSpreadDays {
        let c = cal.dateComponents([.year, .month, .day], from: cursor)
        out.append(String(format: dayFormat, c.year!, c.month!, c.day!))
        cursor = cal.date(byAdding: .day, value: 1, to: cursor)!
    }
    return out.count > heatmapMaxSpreadDays ? [d.startDay] : out
}

private func day(_ s: String) -> Date? {
    let p = s.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3 else { return nil }
    return Rome.calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
}

private func year(of day: String) -> Int { Int(day.prefix(4))! }
private func month(of day: String) -> Int { Int(day.dropFirst(5).prefix(2))! }

public func computeStats(_ items: [StatItem], year selected: Int) -> Stats {
    var days: [String: Int] = [:]
    var perMonth = Array(repeating: 0, count: 12)
    var perCategory: [String: Int] = [:]
    var years = Set<Int>()
    for item in items {
        let counted = countedDays(item)
        counted.forEach { years.insert(year(of: $0)) }
        let inYear = counted.filter { year(of: $0) == selected }
        guard !inYear.isEmpty else { continue }
        inYear.forEach { days[$0, default: 0] += 1 }
        Set(inYear.map(month(of:))).forEach { perMonth[$0 - 1] += 1 }
        let name = item.category.flatMap { ApiContract.categories.contains($0) ? $0 : nil } ?? "Altro"
        perCategory[name, default: 0] += 1
    }
    let order = { (n: String) in ApiContract.categories.firstIndex(of: n) ?? Int.max }
    let sorted = perCategory.map { (name: $0.key, count: $0.value) }
        .sorted { $0.count != $1.count ? $0.count > $1.count : order($0.name) < order($1.name) }
    return Stats(days: days, perMonth: perMonth, perCategory: sorted, years: years.sorted())
}

/// Anno corrente (Roma) se ha salvati, altrimenti l'ultimo anno che ne ha; nil senza salvati.
public func defaultStatsYear(_ items: [StatItem], now: Date) -> Int? {
    let years = computeStats(items, year: 0).years
    let current = Rome.calendar.component(.year, from: now)
    return years.contains(current) ? current : years.last
}

/// Intensita' della cella: 0, 1, 2, 3, 4 (4 o piu').
public func heatLevel(_ count: Int) -> Int { min(max(count, 0), 4) }
