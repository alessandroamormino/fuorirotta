import Foundation

// Le righe della scheda del pin (giro 2b, 10-bis): quando, distanza, tempo di viaggio.
// "Oggi" e "In corso" stanno nel catalogo delle stringhe dell'app (bundle principale): senza catalogo, nei test, restano italiani.

/// "Oggi" / "In corso" (isActive: verdi) oppure "Sab 8 nov". Passato o illeggibile: isActive false, illeggibile = "".
public func placeCardWhen(dateStart: String, dateEnd: String?, today: String, locale: Locale = .italian) -> (label: String, isActive: Bool) {
    guard let days = eventDays(dateStart: dateStart, dateEnd: dateEnd) else { return ("", false) }
    if days.startDay == today { return (String(localized: "Oggi", bundle: .main), true) }
    if days.startDay < today {
        return days.endDay >= today
            ? (String(localized: "In corso", bundle: .main), true) : (weekdayAndShortDay(days.startDay, locale), false)
    }
    return (weekdayAndShortDay(days.startDay, locale), false)
}

private func weekdayAndShortDay(_ day: String, _ locale: Locale) -> String {
    let p = day.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, let noon = Rome.calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return day }
    var names = Calendar(identifier: .gregorian)
    names.locale = locale
    let weekday = names.shortWeekdaySymbols[Rome.calendar.component(.weekday, from: noon) - 1]
    return "\(weekday.prefix(1).uppercased() + weekday.dropFirst()) \(formatShortDay(day, locale: locale))"
}

/// "250 m" (al decina), "1,5 km" ("1.5 km") sotto i 10 km, poi chilometri interi. Sopra 995 m e' gia' "1 km".
public func formatDistance(meters: Double, locale: Locale = .italian) -> String {
    if meters < 995 { return "\(Int((meters / 10).rounded()) * 10) m" }
    let km = meters / 1000
    if km < 9.95 {
        let tenths = (km * 10).rounded() / 10
        return (tenths == tenths.rounded() ? "\(Int(tenths))" : String(format: "%.1f", tenths).replacingOccurrences(of: ".", with: locale.decimalSeparator ?? ",")) + " km"
    }
    return "\(Int(km.rounded())) km"
}

/// "4 min", "1 h", "1 h 5 min". Mai meno di un minuto.
public func formatTravelTime(seconds: TimeInterval) -> String {
    let minutes = max(1, Int((seconds / 60).rounded()))
    let h = minutes / 60, m = minutes % 60
    if h == 0 { return "\(m) min" }
    return m == 0 ? "\(h) h" : "\(h) h \(m) min"
}
