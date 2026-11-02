import Foundation

/// Le ricerche recenti: al massimo 8, la piu' nuova prima, senza doppioni (maiuscole ignorate).
public enum RecentQueries {
    public static let max = 8

    /// Una ricerca vuota o di soli spazi lascia l'elenco com'e'.
    public static func adding(_ q: String, to list: [String]) -> [String] {
        let term = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return list }
        let rest = list.filter { $0.caseInsensitiveCompare(term) != .orderedSame }
        return Array(([term] + rest).prefix(max))
    }
}
