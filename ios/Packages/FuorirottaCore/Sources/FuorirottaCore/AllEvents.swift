import Foundation

// "Tutti gli eventi" di Home (D-13, D-15): tutta l'Italia nelle date scelte (D-01), nell'ordine del sito, 30 alla volta.

extension Event: SavedTimelineItem {}

extension APIClient {
    /// Una pagina della lista nazionale. Solo limit, offset, category, dateFrom/dateTo (giorni di Roma, se la data e' scelta)
    /// e mapEvents=0 (niente pin: la lista non li usa).
    /// `categories` viaggia ripetuto, un parametro per nome (lato server 27.1-14: l'unione); vuoto = tutte.
    /// Mai coordinate, luogo o comuneId (T-27-25): comuneId e' l'unico ramo che puo' avviare uno scraping.
    public func allEvents(categories: [String], limit: Int, offset: Int, dateFrom: String? = nil, dateTo: String? = nil) async throws -> EventsPage {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/events"), resolvingAgainstBaseURL: false)!
        // Il valore si codifica a mano: URLComponents lascia "&" e "+" com'e', e "Food & Wine" si spezzerebbe.
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=#")
        func item(_ name: String, _ value: String) -> URLQueryItem {
            URLQueryItem(name: name, value: value.addingPercentEncoding(withAllowedCharacters: allowed))
        }
        var items = [item("limit", String(limit)), item("offset", String(offset))]
        items += categories.map { item("category", $0) }
        if let dateFrom { items.append(item("dateFrom", dateFrom)) }
        if let dateTo { items.append(item("dateTo", dateTo)) }
        items.append(item("mapEvents", "0"))
        comps.percentEncodedQueryItems = items
        return try await get(comps.url!, as: EventsPage.self)
    }
}

/// Raggruppa per giorno (Roma) restando nell'ordine del server: un evento in corso conta come oggi.
/// Un blocco per giorno, nell'ordine della prima comparsa; `month` sul primo blocco e quando il mese cambia.
public func allEventsTimeline(_ events: [Event], today: String, locale: Locale = .italian) -> [SavedDay<Event>] {
    var order: [String] = []
    var byDay: [String: [Event]] = [:]
    for e in events {
        let start = eventDays(dateStart: e.dateStart, dateEnd: e.dateEnd)?.startDay ?? today
        let day = max(start, today)
        if byDay[day] == nil { order.append(day) }
        byDay[day, default: []].append(e)
    }
    var lastMonth: String?
    return order.map { day in
        let title = monthTitle(day: day, locale: locale)
        let month = (title != nil && title != lastMonth) ? title : nil
        if let title { lastMonth = title }
        return SavedDay(id: "day-\(day)", day: day, isOngoing: false, month: month, items: byDay[day]!)
    }
}

/// Aggiunge in coda gli eventi che non ci sono gia': l'ordine esistente non cambia, mai duplicati.
public func appendingNew(_ incoming: [Event], to existing: [Event]) -> [Event] {
    var seen = Set(existing.map(\.id))
    return existing + incoming.filter { seen.insert($0.id).inserted }
}
