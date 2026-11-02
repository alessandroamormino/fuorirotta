import Foundation

/// Il numero da comporre per la riga "Telefono" del dettaglio (UAT7 C1). Il sito mostra il testo della fonte com'e' e lo
/// passa a `tel:`; un URL con spazi in Swift non nasce, quindi qui restano le cifre e il "+" iniziale.
/// Un intervallo d'interni in coda ("+39 0341 2414221-227") vale il primo numero. Un testo che non e' un numero (un'e-mail,
/// due numeri con "/") da' nil: la riga non compare.
// ponytail: niente libreria di numeri telefonici; i formati delle fonti sono quelli visti nel DB (spazi, punti, +39).
public func phoneDialURL(_ raw: String) -> URL? {
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if let tail = text.range(of: #"-\d{1,3}$"#, options: .regularExpression) { text.removeSubrange(tail) }
    let allowed = CharacterSet(charactersIn: "+0123456789.-()").union(.whitespaces)
    guard text.unicodeScalars.allSatisfy(allowed.contains), !text.dropFirst().contains("+") else { return nil }
    let digits = text.filter { $0.isASCII && $0.isNumber }
    guard (6...15).contains(digits.count) else { return nil }
    return URL(string: "tel:\(text.hasPrefix("+") ? "+" : "")\(digits)")
}
