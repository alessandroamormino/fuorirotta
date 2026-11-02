import Foundation

/// Le iniziali del nome per l'avatar senza foto: prima e ultima parola, al massimo due lettere maiuscole.
/// Senza nome vale la prima lettera dell'e-mail; senza niente "?".
public func initials(name: String, email: String) -> String {
    let words = name.split(whereSeparator: \.isWhitespace)
    let picks = words.count > 1 ? [words.first!, words.last!] : Array(words)
    let letters = picks.compactMap(\.first).map { String($0).uppercased() }.joined()
    if !letters.isEmpty { return letters }
    return email.first.map { String($0).uppercased() } ?? "?"
}

/// Un indice in 0..<count che dipende solo dal testo (djb2): `hashValue` cambia a ogni avvio, il colore dell'avatar no.
public func stableIndex(_ seed: String, count: Int) -> Int {
    guard count > 0 else { return 0 }
    let hash = seed.unicodeScalars.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1.value) }
    return Int(hash % UInt64(count))
}
