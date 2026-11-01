import Foundation

// Le righe della scheda del pin (giro 2b, 10-bis): quando, distanza, tempo di viaggio. Nomi fissi, niente locale.

private let shortWeekdays = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]

/// "Oggi" / "In corso" (isActive: verdi) oppure "Sab 8 nov". Passato o illeggibile: isActive false, illeggibile = "".
public func placeCardWhen(dateStart: String, dateEnd: String?, today: String) -> (label: String, isActive: Bool) {
    guard let days = eventDays(dateStart: dateStart, dateEnd: dateEnd) else { return ("", false) }
    if days.startDay == today { return ("Oggi", true) }
    if days.startDay < today { return days.endDay >= today ? ("In corso", true) : (weekdayAndShortDay(days.startDay), false) }
    return (weekdayAndShortDay(days.startDay), false)
}

private func weekdayAndShortDay(_ day: String) -> String {
    let p = day.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, let noon = Rome.calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return day }
    return "\(shortWeekdays[Rome.calendar.component(.weekday, from: noon) - 1]) \(formatShortDay(day))"
}

/// "250 m" (al decina), "1,5 km" sotto i 10 km, poi chilometri interi. Sopra 995 m e' gia' "1 km".
public func formatDistance(meters: Double) -> String {
    if meters < 995 { return "\(Int((meters / 10).rounded()) * 10) m" }
    let km = meters / 1000
    if km < 9.95 {
        let tenths = (km * 10).rounded() / 10
        return (tenths == tenths.rounded() ? "\(Int(tenths))" : String(format: "%.1f", tenths).replacingOccurrences(of: ".", with: ",")) + " km"
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
