import Foundation

// Cosa segue l'utente (UAT7 B1), come lib/follows/keys.ts: una coppia (kind, key). comune = codice ISTAT,
// province = sigla, region = slug, category = nome canonico. Le etichette le costruisce il server.

/// Una voce di GET /api/v1/me/follows. `kind` resta una stringa: un tipo nuovo del server non rompe la lista.
public struct FollowItem: Codable, Hashable, Sendable, Identifiable {
    public let kind: String
    public let key: String
    public var label: String

    public init(kind: String, key: String, label: String) {
        self.kind = kind; self.key = key; self.label = label
    }

    public var id: String { "\(kind):\(key)" }
    /// Luogo (comune, provincia, regione): conta per il tetto di PLACE_CAP. Le categorie no.
    public var isPlace: Bool { kind != "category" }
}

/// GET /api/v1/me/follows: `onboarded` = la scelta degli interessi e' gia' stata vista (B5 lo usera').
public struct FollowList: Decodable, Sendable {
    public let onboarded: Bool
    public let follows: [FollowItem]
}

/// Un risultato di GET /api/places/search (pubblica), come lo usa PlacePicker.tsx: `chip` e' l'etichetta del follow.
public struct PlaceOption: Decodable, Hashable, Sendable, Identifiable {
    public let kind: String
    public let key: String
    public let label: String
    public let sublabel: String
    public let chip: String

    public var id: String { "\(kind):\(key)" }
    public var item: FollowItem { FollowItem(kind: kind, key: key, label: chip) }
}

struct PlaceResults: Decodable { let results: [PlaceOption] }

/// Lo stesso ordine di sortFollows (lib/follows/keys.ts): regioni, province, comuni (alfabetico italiano), poi le
/// categorie nell'ordine della tassonomia. Serve a inserire una voce nuova al suo posto senza rileggere la lista.
public func sortFollows(_ list: [FollowItem]) -> [FollowItem] {
    let kindOrder = ["region": 0, "province": 1, "comune": 2, "category": 3]
    let it = Locale(identifier: "it")
    func rank(_ key: String) -> Int { ApiContract.categories.firstIndex(of: key) ?? Int.max }
    return list.sorted { a, b in
        let ka = kindOrder[a.kind] ?? 4, kb = kindOrder[b.kind] ?? 4
        if ka != kb { return ka < kb }
        if a.kind == "category" {
            if rank(a.key) != rank(b.key) { return rank(a.key) < rank(b.key) }
        } else {
            let c = a.label.compare(b.label, locale: it)
            if c != .orderedSame { return c == .orderedAscending }
        }
        return a.key < b.key
    }
}

/// Cosa si puo' seguire dal dettaglio di un evento, con le chiavi del sito: il comune ("Bergamo (BG)", come
/// comuneChip), la sua provincia ("Provincia di Bergamo", come provinceChip) e la categoria.
public func followTargets(for event: Event) -> [FollowItem] {
    var out: [FollowItem] = []
    // Solo il dettaglio porta istatCode e provinceName: con i dati di una card non si offre il luogo.
    if let c = event.comune, let istat = c.istatCode {
        out.append(FollowItem(kind: "comune", key: istat, label: "\(decodeHTMLEntities(c.name)) (\(c.provinceCode))"))
        if let province = c.provinceName {
            out.append(FollowItem(kind: "province", key: c.provinceCode, label: "Provincia di \(province)"))
        }
    }
    if let category = event.canonicalCategory ?? event.category, ApiContract.categories.contains(category) {
        out.append(FollowItem(kind: "category", key: category, label: category))
    }
    return out
}
