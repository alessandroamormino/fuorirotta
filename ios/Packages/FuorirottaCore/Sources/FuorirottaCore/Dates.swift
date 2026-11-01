import Foundation

// Il giorno e' sempre il giorno di Roma, mai il calendario o il fuso del telefono (stessa regola di lib/eventDays.ts).

public extension Locale {
    /// La lingua di partenza di ogni funzione che scrive una data: l'app passa quella corrente, i test restano in italiano.
    static let italian = Locale(identifier: "it_IT")
}

/// Nomi di mesi e giorni nella lingua data (italiano o inglese), dal calendario di sistema.
private func names(_ locale: Locale) -> Calendar {
    var c = Calendar(identifier: .gregorian)
    c.locale = locale
    return c
}

/// In inglese il mese viene prima del giorno ("November 8"), in italiano dopo ("8 novembre").
private func monthFirst(_ locale: Locale) -> Bool { locale.language.languageCode == .english }

private func dayMonth(_ day: Int, _ month: String, _ locale: Locale) -> String {
    monthFirst(locale) ? "\(month) \(day)" : "\(day) \(month)"
}

/// Prima lettera maiuscola ("dom" -> "Dom"), il resto com'e'.
private func capitalizedFirst(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

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

/// Il giorno di Roma `n` giorni dopo oggi, "YYYY-MM-DD".
public func romeDay(plusDays n: Int, now: Date = .now) -> String {
    ymd(Rome.calendar.date(byAdding: .day, value: n, to: now)!, in: Rome.calendar)
}

/// "2026-11-08" -> "Novembre 2026" ("November 2026"), per le intestazioni di mese.
public func monthTitle(day: String, locale: Locale = .italian) -> String? {
    let p = day.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]) else { return nil }
    return capitalizedFirst(names(locale).monthSymbols[p[1] - 1]) + " \(p[0])"
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

private func parseDay(_ s: String) -> (m: Int, d: Int)? {
    let p = s.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]) else { return nil }
    return (p[1], p[2])
}

/// "6-8 novembre", "30 ottobre - 1 novembre", "8 novembre"; in inglese "November 6-8", "October 30 - November 1".
/// Il giorno e' quello della stringa, mai del fuso del telefono: il locale sceglie solo le parole.
public func formatDayRange(from: String, to: String, locale: Locale = .italian) -> String {
    guard let a = parseDay(from), let b = parseDay(to) else { return from }
    let months = names(locale).monthSymbols
    if a == b { return dayMonth(a.d, months[a.m - 1], locale) }
    if a.m == b.m { return monthFirst(locale) ? "\(months[a.m - 1]) \(a.d)-\(b.d)" : "\(a.d)-\(b.d) \(months[a.m - 1])" }
    return "\(dayMonth(a.d, months[a.m - 1], locale)) - \(dayMonth(b.d, months[b.m - 1], locale))"
}

/// "2026-11-01" -> "1 nov" ("Nov 1"). Un giorno illeggibile torna com'e'.
public func formatShortDay(_ day: String, locale: Locale = .italian) -> String {
    guard let p = parseDay(day) else { return day }
    return dayMonth(p.d, names(locale).shortMonthSymbols[p.m - 1], locale)
}

/// La data sopra una card verticale: il primo giorno ("1 nov"), oppure "In corso" se l'evento e' gia' iniziato.
/// `isToday` = l'evento INIZIA oggi (Roma): la data va in accento. "In corso" non e' mai in accento.
public func railDate(dateStart: String, dateEnd: String?, today: String, locale: Locale = .italian) -> (label: String, isToday: Bool) {
    guard let days = eventDays(dateStart: dateStart, dateEnd: dateEnd) else { return ("", false) }
    if days.startDay < today {
        return (days.endDay >= today ? String(localized: "In corso", bundle: .main) : formatShortDay(days.startDay, locale: locale), false)
    }
    return (formatShortDay(days.startDay, locale: locale), days.startDay == today)
}

/// "2026-11-08" -> "domenica 8 novembre" ("Sunday, November 8"), giorno di Roma. Un giorno illeggibile torna com'e'.
public func formatLongDay(_ day: String, locale: Locale = .italian) -> String {
    let p = day.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]),
          let noon = Rome.calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
    else { return day }
    let n = names(locale)
    let weekday = n.weekdaySymbols[Rome.calendar.component(.weekday, from: noon) - 1]
    let month = n.monthSymbols[p[1] - 1]
    return monthFirst(locale) ? "\(weekday), \(month) \(p[2])" : "\(weekday) \(p[2]) \(month)"
}

/// "21:00" (Roma), oppure nil per gli eventi senza orario: la fonte li salva a mezzanotte di Roma o a mezzanotte UTC.
public func eventTime(_ dateStart: String) -> String? {
    guard let date = parseISO(dateStart) else { return nil }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let rome = Rome.calendar.dateComponents([.hour, .minute], from: date)
    let z = utc.dateComponents([.hour, .minute], from: date)
    if (rome.hour == 0 && rome.minute == 0) || (z.hour == 0 && z.minute == 0) { return nil }
    return String(format: "%02d:%02d", rome.hour!, rome.minute!)
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
