import Foundation

// "Aggiungi al calendario" (UAT7 A2): gli stessi campi di lib/calendar/ics.ts (`calendarFields`) per precompilare
// l'evento di sistema. Titolo e luogo decodificati, dettagli = estratto della descrizione (500 caratteri, taglio su
// parola) + fonte solo http/https + pagina su Fuorirotta. I giorni vengono da eventDays (Roma), come sul sito.
// Differenza voluta: un evento di un giorno con un orario vero (eventTime) diventa un evento con orario a Roma;
// il sito fa sempre giornata intera perche' il file .ics non sa da dove arrivi l'orario.

public struct CalendarDraft: Equatable, Sendable {
    public let title: String
    /// Vuoto quando non si sa nulla del luogo.
    public let location: String
    public let notes: String
    public let url: URL?
    public let isAllDay: Bool
    /// Giornata intera: mezzogiorno del primo e dell'ultimo giorno (incluso) nel calendario dato, senza fuso
    /// (un evento del 18 resta il 18 anche su un telefono a New York). Con orario: l'istante vero.
    public let start: Date
    public let end: Date
    /// Europe/Rome per gli eventi con orario, nil per quelli di giornata intera.
    public let timeZone: TimeZone?
}

private let detailsMax = 500

/// Taglia a `max` caratteri su un confine di parola, con i puntini (cutAtWord di ics.ts).
func cutAtWord(_ text: String, max: Int) -> String {
    guard text.count > max else { return text }
    let head = String(text.prefix(max - 1))
    // Nessuno spazio utile (parola lunghissima): taglio secco.
    guard let space = head.lastIndex(where: \.isWhitespace), space > head.startIndex else { return head + "…" }
    return String(head[..<space]).replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) + "…"
}

/// I campi del calendario per un evento; nil se la data d'inizio non si legge.
/// `calendar` e' quello del telefono: serve solo a piazzare i giorni interi, che sono giorni di Roma.
public func calendarDraft(for event: Event, calendar: Calendar = .current) -> CalendarDraft? {
    guard let days = eventDays(dateStart: event.dateStart, dateEnd: event.dateEnd) else { return nil }
    let eventURL = URL(string: "https://fuori-rotta.it/eventi/\(event.id)")

    let trim = { (s: String?) in decodeHTMLEntities(s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    let venue = trim(event.locationName), address = trim(event.address)
    let location = [venue, address == venue ? "" : address].filter { !$0.isEmpty }.joined(separator: ", ")

    let plain = String(htmlToAttributed(event.description ?? "").characters).trimmingCharacters(in: .whitespacesAndNewlines)
    let snippet = cutAtWord(plain, max: detailsMax)
    var tail: [String] = []
    // Solo http(s), come sul sito: un "javascript:" non finisce nel calendario.
    if let source = event.sourceUrl, source.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil {
        tail.append(String(localized: "Fonte: \(source)", bundle: .main))
    }
    if let eventURL { tail.append(eventURL.absoluteString) }
    let notes = (snippet.isEmpty ? "" : snippet + "\n\n") + tail.joined(separator: "\n")

    let base = { (allDay: Bool, start: Date, end: Date, zone: TimeZone?) in
        CalendarDraft(
            title: trim(event.title), location: location, notes: notes, url: eventURL,
            isAllDay: allDay, start: start, end: end, timeZone: zone)
    }

    if days.startDay == days.endDay, eventTime(event.dateStart) != nil, let start = parseISO(event.dateStart) {
        // Una fine vera solo se cade dopo l'inizio, lo stesso giorno e non e' il "fine giornata" delle fonti (23:59).
        // Senza: l'evento dura zero minuti, una durata inventata finirebbe nel calendario come se fosse vera.
        var end = start
        if let raw = event.dateEnd, let e = parseISO(raw), e > start,
           Rome.calendar.isDate(e, inSameDayAs: start), Rome.calendar.component(.minute, from: e) != 59 {
            end = e
        }
        return base(false, start, end, Rome.calendar.timeZone)
    }

    func noon(_ day: String) -> Date? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
    }
    guard let first = noon(days.startDay), let last = noon(days.endDay) else { return nil }
    return base(true, first, last, nil)
}
