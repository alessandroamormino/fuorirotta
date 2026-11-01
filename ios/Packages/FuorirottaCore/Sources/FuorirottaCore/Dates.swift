import Foundation

// Il giorno e' sempre il giorno di Roma, mai il calendario o il fuso del telefono (stessa regola di lib/eventDays.ts).

public enum Rome {
    public static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Rome")!
        return c
    }()
}

private func ymd(_ date: Date, in calendar: Calendar) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// Oggi a Roma, "YYYY-MM-DD".
public func romeToday(now: Date = .now) -> String { ymd(now, in: Rome.calendar) }

/// "2026-11-08" -> "Novembre 2026", per le intestazioni di mese.
public func monthTitle(day: String) -> String? {
    let p = day.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]) else { return nil }
    return months[p[1] - 1].capitalized + " \(p[0])"
}

/// Passato = l'ultimo giorno dell'evento (Roma) e' prima di oggi. Una data illeggibile conta come passata.
public func isPastEvent(dateStart: String, dateEnd: String?, today: String) -> Bool {
    guard let days = eventDays(dateStart: dateStart, dateEnd: dateEnd) else { return true }
    return days.endDay < today
}

/// Venerdi'-domenica: da oggi se oggi (Roma) e' ven/sab/dom, altrimenti il prossimo weekend.
public func weekendWindow(now: Date = .now) -> (from: String, to: String) {
    let cal = Rome.calendar
    let weekday = cal.component(.weekday, from: now) // 1 = domenica ... 7 = sabato
    let toSunday = (8 - weekday) % 7
    let toFrom = (weekday == 6 || weekday == 7 || weekday == 1) ? 0 : 6 - weekday
    let from = cal.date(byAdding: .day, value: toFrom, to: now)!
    let to = cal.date(byAdding: .day, value: toSunday, to: now)!
    return (ymd(from, in: cal), ymd(to, in: cal))
}

private let months = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]

private func parseDay(_ s: String) -> (m: Int, d: Int)? {
    let p = s.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]) else { return nil }
    return (p[1], p[2])
}

/// "6-8 novembre", "30 ottobre - 1 novembre", "8 novembre". Nomi dei mesi fissi: niente locale.
public func formatDayRange(from: String, to: String) -> String {
    guard let a = parseDay(from), let b = parseDay(to) else { return from }
    if a == b { return "\(a.d) \(months[a.m - 1])" }
    if a.m == b.m { return "\(a.d)-\(b.d) \(months[a.m - 1])" }
    return "\(a.d) \(months[a.m - 1]) - \(b.d) \(months[b.m - 1])"
}

/// ISO 8601 con o senza frazioni di secondo (l'API manda ".000Z").
func parseISO(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

/// Primo e ultimo giorno (Roma) di un evento: l'inizio e' il giorno di Roma; una fine alle 23:59 UTC
/// vale la sua data UTC (fine-giornata in formato UTC), altrimenti il giorno di Roma.
public func eventDays(dateStart: String, dateEnd: String?) -> (startDay: String, endDay: String)? {
    guard let start = parseISO(dateStart) else { return nil }
    let from = ymd(start, in: Rome.calendar)
    guard let endStr = dateEnd, let end = parseISO(endStr) else { return (from, from) }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let h = utc.dateComponents([.hour, .minute], from: end)
    let to = (h.hour == 23 && h.minute == 59) ? ymd(end, in: utc) : ymd(end, in: Rome.calendar)
    return (from, max(from, to))
}
