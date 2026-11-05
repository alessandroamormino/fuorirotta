import Foundation

// Statistiche dei salvati per data dell'evento (D-13) e dei visitati per giorno di visita (27.1, D-05).
// Copia fedele di lib/stats/compute.ts: la fixture Fixtures/stats.json (StatsParityTests) tiene i due lati uguali (D-12).
// L'ingresso e' lo stesso per ospiti (salvati sul telefono) e account (salvati sincronizzati).

public struct StatItem: Hashable, Sendable {
    public var dateStart: String
    public var dateEnd: String?
    public var category: String?
    public init(dateStart: String, dateEnd: String?, category: String?) {
        self.dateStart = dateStart; self.dateEnd = dateEnd; self.category = category
    }
}

/// Un visitato: il giorno di visita salvato (D-05) e la categoria dell'evento.
public struct VisitedStatItem: Hashable, Sendable {
    public var visitDay: String
    public var category: String?
    public init(visitDay: String, category: String?) {
        self.visitDay = visitDay; self.category = category
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
        perCategory[categoryName(item.category), default: 0] += 1
    }
    return Stats(days: days, perMonth: perMonth, perCategory: sortedCategories(perCategory), years: years.sorted())
}

private func categoryName(_ category: String?) -> String {
    category.flatMap { ApiContract.categories.contains($0) ? $0 : nil } ?? "Altro"
}

/// Per conteggio decrescente, a pari conteggio nell'ordine della tassonomia.
private func sortedCategories(_ counts: [String: Int]) -> [(name: String, count: Int)] {
    let order = { (n: String) in ApiContract.categories.firstIndex(of: n) ?? Int.max }
    return counts.map { (name: $0.key, count: $0.value) }
        .sorted { $0.count != $1.count ? $0.count > $1.count : order($0.name) < order($1.name) }
}

/// Visitati (D-05): una cella per evento, nel suo giorno di visita; il mese e' quello del giorno di visita.
public func computeVisitedStats(_ items: [VisitedStatItem], year selected: Int) -> Stats {
    var days: [String: Int] = [:]
    var perMonth = Array(repeating: 0, count: 12)
    var perCategory: [String: Int] = [:]
    var years = Set<Int>()
    for item in items {
        years.insert(year(of: item.visitDay))
        guard year(of: item.visitDay) == selected else { continue }
        days[item.visitDay, default: 0] += 1
        perMonth[month(of: item.visitDay) - 1] += 1
        perCategory[categoryName(item.category), default: 0] += 1
    }
    return Stats(days: days, perMonth: perMonth, perCategory: sortedCategories(perCategory), years: years.sorted())
}

/// Le tre tessere (D-09, D-11): Giorni fuori, Visitati, Salvati.
public struct StatsTiles: Equatable, Sendable {
    public var daysOut: Int
    public var visited: Int
    public var saved: Int
}

/// `year` nil = "Sempre". Salvati in un anno = gli eventi con almeno un giorno contato in quell'anno.
public func statsTiles(visited: [VisitedStatItem], saved: [StatItem], year selected: Int?) -> StatsTiles {
    guard let selected else {
        return StatsTiles(daysOut: Set(visited.map(\.visitDay)).count, visited: visited.count, saved: saved.count)
    }
    let inYear = visited.filter { year(of: $0.visitDay) == selected }
    return StatsTiles(
        daysOut: Set(inYear.map(\.visitDay)).count,
        visited: inYear.count,
        saved: computeStats(saved, year: selected).perCategory.reduce(0) { $0 + $1.count }
    )
}

/// Anno corrente (Roma) se ha salvati, altrimenti l'ultimo anno che ne ha; nil senza salvati.
public func defaultStatsYear(_ items: [StatItem], now: Date) -> Int? {
    let years = computeStats(items, year: 0).years
    let current = Rome.calendar.component(.year, from: now)
    return years.contains(current) ? current : years.last
}

/// Intensita' della cella: 0, 1, 2, 3, 4 (4 o piu').
public func heatLevel(_ count: Int) -> Int { min(max(count, 0), 4) }
