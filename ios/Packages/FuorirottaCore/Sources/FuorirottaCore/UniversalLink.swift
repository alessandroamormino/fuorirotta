import Foundation

/// Cosa un link universale puo' chiedere all'app (T-27-29).
public enum UniversalLink: Equatable, Sendable {
    case event(Int)
    case list(String)
}

/// Solo https://fuori-rotta.it/eventi/<1-9 cifre ASCII> e /l/<lettere, cifre, "-", "_">. Tutto il resto: nil.
/// Pura, cosi' i casi ostili si provano con `swift test` sul Mac.
public func parseUniversalLink(_ url: URL) -> UniversalLink? {
    guard url.scheme == "https", url.host(percentEncoded: false) == "fuori-rotta.it" else { return nil }
    let parts = url.pathComponents.filter { $0 != "/" }
    guard parts.count == 2 else { return nil }
    let token = parts[1]
    switch parts[0] {
    case "eventi":
        guard (1...9).contains(token.count), token.allSatisfy({ $0.isASCII && $0.isNumber }), let id = Int(token) else { return nil }
        return .event(id)
    case "l":
        guard token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
        return .list(token)
    default:
        return nil
    }
}
