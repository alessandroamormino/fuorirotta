import Foundation

/// I filtri della scheda Cerca. I nomi dei parametri sono quelli che il sito gia' manda a /api/events
/// (search, category, dateFrom, dateTo, lat, lng, radius): nessun campo nuovo sul server.
public struct SearchFilters: Equatable, Sendable {
    public enum When: Hashable, Sendable {
        case any, today, weekend, next7
        case custom(from: String, to: String)

        /// Le parole fisse stanno nel catalogo delle stringhe dell'app (bundle principale): senza catalogo restano italiane.
        public func title(locale: Locale = .italian) -> String {
            switch self {
            case .any: String(localized: "Qualsiasi data", bundle: .main)
            case .today: String(localized: "Oggi", bundle: .main)
            case .weekend: String(localized: "Questo weekend", bundle: .main)
            case .next7: String(localized: "Prossimi 7 giorni", bundle: .main)
            case .custom(let from, let to): formatDayRange(from: from, to: max(from, to), locale: locale)
            }
        }
    }

    /// Posizione e raggio: partono solo come lat/lng/radius di GET /api/events, solo se l'utente li accende (T-27-25).
    public struct Near: Equatable, Sendable {
        public var lat: Double
        public var lng: Double
        public var radiusKm: Int
        public init(lat: Double, lng: Double, radiusKm: Int) { self.lat = lat; self.lng = lng; self.radiusKm = radiusKm }
    }

    public var text: String
    public var when: When
    public var near: Near?
    /// Nell'ordine in cui sono state scelte.
    public var categories: [String]

    public init(text: String = "", when: When = .any, near: Near? = nil, categories: [String] = []) {
        self.text = text; self.when = when; self.near = near; self.categories = categories
    }

    public var term: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var hasFilters: Bool { when != .any || near != nil || !categories.isEmpty }
    /// Niente testo e niente filtri: non c'e' nulla da cercare.
    public var isEmpty: Bool { term.isEmpty && !hasFilters }

    /// Questo weekend e' la data predefinita dell'app (D-09): per la schermata d'attesa di Cerca (recenti, nessuna richiesta)
    /// conta come "nessuna data scelta", come Qualsiasi data.
    public var isIdle: Bool {
        term.isEmpty && near == nil && categories.isEmpty && (when == .any || when == .weekend)
    }
    /// Qualcosa di diverso dal predefinito: un'altra data (anche Qualsiasi data), una zona o una categoria. Accende l'icona dei filtri.
    public var hasActiveFilters: Bool { when != .weekend || near != nil || !categories.isEmpty }

    /// Primo e ultimo giorno (Roma) richiesti, o nil senza filtro di data.
    public func dateRange(now: Date = .now) -> (from: String, to: String)? {
        switch when {
        case .any: nil
        case .today: (romeToday(now: now), romeToday(now: now))
        case .weekend: weekendWindow(now: now)
        case .next7: (romeToday(now: now), romeDay(plusDays: 6, now: now))
        // Un "al" prima del "dal" vale il solo "dal".
        case .custom(let from, let to): (from, max(from, to))
        }
    }

    /// Una richiesta a /api/events. Il server accetta UNA categoria per richiesta: con piu' categorie
    /// ne parte una per ciascuna (vedi `APIClient.search`).
    public func queryItems(category: String?, limit: Int, now: Date = .now) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if !term.isEmpty { items.append(URLQueryItem(name: "search", value: term)) }
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if let range = dateRange(now: now) {
            items.append(URLQueryItem(name: "dateFrom", value: range.from))
            items.append(URLQueryItem(name: "dateTo", value: range.to))
        }
        if let near {
            items.append(URLQueryItem(name: "lat", value: coarseCoordinate(near.lat)))
            items.append(URLQueryItem(name: "lng", value: coarseCoordinate(near.lng)))
            items.append(URLQueryItem(name: "radius", value: String(near.radiusKm)))
        }
        items.append(URLQueryItem(name: "limit", value: String(limit)))
        return items
    }
}

/// Unisce le pagine di piu' richieste (una per categoria): senza doppioni, per primo giorno (un evento gia' iniziato
/// vale `from`, come l'ordine del server), poi per id. Al massimo `limit`.
public func mergeEvents(_ lists: [[Event]], from: String, limit: Int) -> [Event] {
    var seen = Set<Int>()
    let unique = lists.joined().filter { seen.insert($0.id).inserted }
    func day(_ e: Event) -> String { max(eventDays(dateStart: e.dateStart, dateEnd: e.dateEnd)?.startDay ?? from, from) }
    return Array(unique.sorted { (day($0), $0.dateStart, $0.id) < (day($1), $1.dateStart, $1.id) }.prefix(limit))
}
