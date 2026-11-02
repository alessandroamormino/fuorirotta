import Foundation

// La pagina Salvati come timeline: un blocco per giorno di inizio (Roma), "In corso" in cima ai Prossimi.
// Logica pura: la vista disegna cio' che questo file decide.

public protocol SavedTimelineItem {
    var title: String { get }
    var dateStart: String { get }
    var dateEnd: String? { get }
}

public struct SavedDay<Item>: Identifiable {
    /// "ongoing", "undated" o "day-YYYY-MM-DD": stabile fra un ricalcolo e l'altro.
    public let id: String
    /// Il giorno di inizio ("YYYY-MM-DD"); nil per "In corso" e per le righe senza data.
    public let day: String?
    public let isOngoing: Bool
    /// "Novembre 2026" quando il mese cambia rispetto al blocco datato precedente (e sul primo); altrimenti nil.
    public let month: String?
    public let items: [Item]
}

private struct TimelineKeyed<Item> { let item: Item; let days: (startDay: String, endDay: String)?; let start: Date }

/// Prossimi (`past: false`): "In corso" (iniziati prima di oggi, non ancora finiti, per giorno di fine crescente),
/// poi i giorni dal piu' vicino. Passati (`past: true`): dal giorno piu' recente. Dentro un giorno: orario, poi titolo.
/// Le righe senza data leggibile contano come passate e chiudono la lista, in un blocco "undated".
public func savedTimeline<Item: SavedTimelineItem>(
    _ items: [Item], past: Bool, today: String, locale: Locale = .italian
) -> [SavedDay<Item>] {
    typealias Keyed = TimelineKeyed<Item>
    let picked = items
        .filter { isPastEvent(dateStart: $0.dateStart, dateEnd: $0.dateEnd, today: today) == past }
        .map { Keyed(item: $0, days: eventDays(dateStart: $0.dateStart, dateEnd: $0.dateEnd), start: parseISO($0.dateStart) ?? .distantPast) }
    func within(_ a: Keyed, _ b: Keyed) -> Bool {
        a.start != b.start ? a.start < b.start : a.item.title < b.item.title
    }

    var out: [SavedDay<Item>] = []
    var lastMonth: String?
    func append(id: String, day: String?, ongoing: Bool, _ rows: [Keyed]) {
        let title = day.flatMap { monthTitle(day: $0, locale: locale) }
        let month = (title != nil && title != lastMonth) ? title : nil
        if let title { lastMonth = title }
        out.append(SavedDay(id: id, day: day, isOngoing: ongoing, month: month, items: rows.map(\.item)))
    }

    let dated = picked.filter { $0.days != nil }
    let ongoing = past ? [] : dated.filter { $0.days!.startDay < today }
        .sorted { a, b in a.days!.endDay != b.days!.endDay ? a.days!.endDay < b.days!.endDay : within(a, b) }
    if !ongoing.isEmpty { append(id: "ongoing", day: nil, ongoing: true, ongoing) }

    let byDay = Dictionary(grouping: dated.filter { past || $0.days!.startDay >= today }, by: { $0.days!.startDay })
    for day in byDay.keys.sorted(by: past ? (>) : (<)) {
        append(id: "day-\(day)", day: day, ongoing: false, byDay[day]!.sorted(by: within))
    }

    let undated = picked.filter { $0.days == nil }.sorted(by: within)
    if !undated.isEmpty { append(id: "undated", day: nil, ongoing: false, undated) }
    return out
}

/// "12 eventi · 3 questa settimana": quanti salvati ci sono e quanti INIZIANO nei 7 giorni da oggi (oggi compreso).
public func savedSummary<Item>(_ days: [SavedDay<Item>], today: String) -> (total: Int, thisWeek: Int) {
    let last = dayString(today, plusDays: 6) ?? today
    var total = 0, week = 0
    for d in days {
        total += d.items.count
        if let day = d.day, day >= today, day <= last { week += d.items.count }
    }
    return (total, week)
}
