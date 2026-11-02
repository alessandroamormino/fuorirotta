import Foundation

// Le descrizioni di alcune fonti (in-lombardia) arrivano come HTML. Qui diventano testo con formattazione minima:
// paragrafi, a capo, elenchi, grassetto, corsivo e link http/https. Nessun motore HTML: un tokenizer di tag che
// tiene solo cio' che serve e butta il resto (script, stile, immagini; del tag ignoto resta il testo).

/// HTML (o testo semplice) -> testo da mostrare. Un testo senza tag passa com'e', con le sole entita' decodificate.
public func htmlToAttributed(_ html: String) -> AttributedString {
    var scalars: [Unicode.Scalar] = []
    scalars.reserveCapacity(html.unicodeScalars.count)
    var previousWasCR = false
    for s in html.unicodeScalars {
        defer { previousWasCR = s == "\r" }
        if s == "\r" { scalars.append("\n"); continue }
        if s == "\n", previousWasCR { continue }
        // Controlli (compreso NUL) fuori; restano a capo e tabulazione.
        if (s.value < 0x20 && s != "\n" && s != "\t") || s.value == 0x7F { continue }
        scalars.append(s)
    }

    var b = HtmlBuilder()
    if hasTag(scalars) {
        b.collapse = true
        var text = String.UnicodeScalarView()
        var skipUntil: String?
        var i = 0
        while i < scalars.count {
            guard scalars[i] == "<", let tag = parseTag(scalars, at: i) else {
                text.append(scalars[i])
                i += 1
                continue
            }
            if skipUntil == nil, !text.isEmpty { b.text(decodeHTMLEntities(String(text))) }
            text = String.UnicodeScalarView()
            i = tag.end
            if let until = skipUntil {
                if tag.closing, tag.name == until { skipUntil = nil }
                continue
            }
            b.tag(tag)
            if !tag.closing, !tag.selfClosing, skipContent.contains(tag.name) { skipUntil = tag.name }
        }
        if skipUntil == nil, !text.isEmpty { b.text(decodeHTMLEntities(String(text))) }
    } else {
        b.text(decodeHTMLEntities(String(String.UnicodeScalarView(scalars))))
    }
    return b.result()
}

// MARK: tokenizer

private struct Tag {
    var name: String
    var closing: Bool
    var selfClosing: Bool
    var attributes: [String: String]
    var end: Int  // indice del primo scalare dopo ">"
}

/// Tag di cui si butta anche il contenuto.
private let skipContent: Set<String> = ["script", "style", "head", "title", "svg", "iframe", "noscript", "template", "object", "embed"]

private func isLetter(_ s: Unicode.Scalar) -> Bool { (s >= "a" && s <= "z") || (s >= "A" && s <= "Z") }
private func isSpace(_ s: Unicode.Scalar) -> Bool { s == " " || s == "\n" || s == "\t" }

private func hasTag(_ scalars: [Unicode.Scalar]) -> Bool {
    for i in scalars.indices where scalars[i] == "<" && i + 1 < scalars.count {
        let n = scalars[i + 1]
        if isLetter(n) || n == "/" || n == "!" { return true }
    }
    return false
}

/// Il tag che comincia in `i` (dove c'e' "<"), o nil se quello non e' un tag (resta testo): nome non valido,
/// o ">" mai trovato. Commenti e `<!DOCTYPE>` tornano come tag di nome "!" e si buttano.
private func parseTag(_ s: [Unicode.Scalar], at i: Int) -> Tag? {
    var j = i + 1
    guard j < s.count else { return nil }
    if s[j] == "!" {
        let comment = j + 2 < s.count && s[j + 1] == "-" && s[j + 2] == "-"
        var k = comment ? j + 3 : j + 1
        while k < s.count {
            if comment {
                if s[k] == ">", k >= j + 4, s[k - 1] == "-", s[k - 2] == "-" { break }
            } else if s[k] == ">" {
                break
            }
            k += 1
        }
        return k < s.count ? Tag(name: "!", closing: false, selfClosing: true, attributes: [:], end: k + 1) : nil
    }
    let closing = s[j] == "/"
    if closing { j += 1 }
    var name = ""
    while j < s.count, isLetter(s[j]) || (!name.isEmpty && (s[j] == "-" || s[j] == ":" || (s[j] >= "0" && s[j] <= "9"))) {
        name.unicodeScalars.append(s[j])
        j += 1
    }
    guard !name.isEmpty, j < s.count, isSpace(s[j]) || s[j] == "/" || s[j] == ">" else { return nil }
    // Fino al ">" fuori dalle virgolette.
    var quote: Unicode.Scalar?
    var k = j
    while k < s.count {
        if let q = quote {
            if s[k] == q { quote = nil }
        } else if s[k] == "\"" || s[k] == "'" {
            quote = s[k]
        } else if s[k] == ">" {
            break
        }
        k += 1
    }
    guard k < s.count else { return nil }
    let body = Array(s[j..<k])
    return Tag(
        name: name.lowercased(), closing: closing, selfClosing: body.last == "/",
        attributes: closing ? [:] : parseAttributes(body), end: k + 1)
}

private func parseAttributes(_ s: [Unicode.Scalar]) -> [String: String] {
    var out: [String: String] = [:]
    var i = 0
    while i < s.count {
        while i < s.count, isSpace(s[i]) || s[i] == "/" { i += 1 }
        var name = ""
        while i < s.count, !isSpace(s[i]), s[i] != "=", s[i] != "/" { name.unicodeScalars.append(s[i]); i += 1 }
        while i < s.count, isSpace(s[i]) { i += 1 }
        var value = ""
        if i < s.count, s[i] == "=" {
            i += 1
            while i < s.count, isSpace(s[i]) { i += 1 }
            if i < s.count, s[i] == "\"" || s[i] == "'" {
                let q = s[i]
                i += 1
                while i < s.count, s[i] != q { value.unicodeScalars.append(s[i]); i += 1 }
                i += 1
            } else {
                while i < s.count, !isSpace(s[i]) { value.unicodeScalars.append(s[i]); i += 1 }
            }
        }
        if !name.isEmpty { out[name.lowercased()] = value }
    }
    return out
}

// MARK: costruzione

private struct Segment {
    var text: String
    var intent: InlinePresentationIntent = []
    var link: URL?
}

private struct HtmlBuilder {
    var collapse = false
    private var segments: [Segment] = []
    /// A capo in attesa: si scrivono solo prima del prossimo testo, mai in testa ne' in coda, al massimo due.
    private var pending = 0
    private var bullet = false
    private var bold = 0
    private var italic = 0
    private var link: URL?

    private static let blocks: Set<String> = ["p", "ul", "ol", "blockquote", "table", "hr", "pre"]
    private static let lineBlocks: Set<String> = ["div", "tr", "section", "article", "header", "footer", "dl", "dt", "dd"]
    private static let headings: Set<String> = ["h1", "h2", "h3", "h4", "h5", "h6"]

    mutating func tag(_ t: Tag) {
        switch t.name {
        case "br": pending += 1
        case "strong", "b": bold = max(0, bold + (t.closing ? -1 : 1))
        case "em", "i": italic = max(0, italic + (t.closing ? -1 : 1))
        case "a": link = t.closing ? nil : Self.safeURL(t.attributes["href"])
        case "li":
            pending = max(pending, 1)
            bullet = !t.closing
        case let n where Self.headings.contains(n):
            bold = max(0, bold + (t.closing ? -1 : 1))
            pending = max(pending, 2)
        case let n where Self.blocks.contains(n): pending = max(pending, 2)
        case let n where Self.lineBlocks.contains(n): pending = max(pending, 1)
        default: break  // tag ignoto: se ne va il tag, resta il testo
        }
    }

    /// Solo http/https con un host: javascript:, mailto:, tel: e i percorsi relativi non diventano link.
    private static func safeURL(_ href: String?) -> URL? {
        guard let href = href.map({ decodeHTMLEntities($0).trimmingCharacters(in: .whitespacesAndNewlines) }),
              let url = URL(string: href), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host()?.isEmpty == false
        else { return nil }
        return url
    }

    private var intent: InlinePresentationIntent {
        var i: InlinePresentationIntent = []
        if bold > 0 { i.insert(.stronglyEmphasized) }
        if italic > 0 { i.insert(.emphasized) }
        return i
    }

    mutating func text(_ raw: String) {
        var s = raw
        if collapse {
            var out = ""
            var lastSpace = false
            for c in raw {
                if c.isWhitespace {
                    if !lastSpace { out.append(" ") }
                    lastSpace = true
                } else {
                    out.append(c)
                    lastSpace = false
                }
            }
            // Niente spazio dopo un a capo, in testa o dopo un altro spazio.
            let atLineStart = pending > 0 || (segments.last.map { $0.text.hasSuffix("\n") || $0.text.hasSuffix(" ") } ?? true)
            if atLineStart, out.hasPrefix(" ") { out.removeFirst() }
            s = out
        }
        if segments.isEmpty { s = String(s.drop { $0.isWhitespace }) }
        guard !s.isEmpty else { return }
        if pending > 0 {
            if !segments.isEmpty {
                trimTrailingSpace()
                segments.append(Segment(text: String(repeating: "\n", count: min(pending, 2))))
            }
            pending = 0
        }
        if bullet {
            segments.append(Segment(text: "• "))
            bullet = false
        }
        segments.append(Segment(text: s, intent: intent, link: link))
    }

    private mutating func trimTrailingSpace() {
        while var last = segments.last {
            last.text = String(last.text.reversed().drop { $0 == " " }.reversed())
            if last.text.isEmpty {
                segments.removeLast()
            } else {
                segments[segments.count - 1] = last
                return
            }
        }
    }

    func result() -> AttributedString {
        var me = self
        // In coda niente spazi ne' a capo (anche nel testo semplice).
        while let last = me.segments.last, last.text.allSatisfy(\.isWhitespace) { me.segments.removeLast() }
        if var last = me.segments.last {
            last.text = String(last.text.reversed().drop { $0.isWhitespace }.reversed())
            me.segments[me.segments.count - 1] = last
        }
        var out = AttributedString()
        for seg in me.segments {
            var piece = AttributedString(seg.text)
            if !seg.intent.isEmpty { piece.inlinePresentationIntent = seg.intent }
            piece.link = seg.link
            out.append(piece)
        }
        linkBareURLs(&out)
        return out
    }
}

/// Gli indirizzi http/https scritti nel testo diventano link; quelli gia' dentro un <a> restano come sono.
private func linkBareURLs(_ text: inout AttributedString) {
    let plain = String(text.characters)
    guard plain.contains("http") || plain.contains("www."),
          let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    else { return }
    for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
        guard let url = match.url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let r = Range(match.range, in: plain)
        else { continue }
        let from = text.index(text.startIndex, offsetByCharacters: plain.distance(from: plain.startIndex, to: r.lowerBound))
        let to = text.index(from, offsetByCharacters: plain.distance(from: r.lowerBound, to: r.upperBound))
        if text[from..<to].runs.allSatisfy({ $0.link == nil }) { text[from..<to].link = url }
    }
}

// MARK: entita'

private let namedEntities: [String: String] = [
    "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ",
    "ndash": "–", "mdash": "—", "hellip": "…", "laquo": "«", "raquo": "»", "lsquo": "‘", "rsquo": "’",
    "ldquo": "“", "rdquo": "”", "euro": "€", "copy": "©", "reg": "®", "deg": "°", "middot": "·", "bull": "•",
    "times": "×", "sect": "§", "pound": "£",
    "agrave": "à", "aacute": "á", "egrave": "è", "eacute": "é", "igrave": "ì", "iacute": "í",
    "ograve": "ò", "oacute": "ó", "ugrave": "ù", "uacute": "ú",
    "Agrave": "À", "Aacute": "Á", "Egrave": "È", "Eacute": "É", "Igrave": "Ì", "Iacute": "Í",
    "Ograve": "Ò", "Oacute": "Ó", "Ugrave": "Ù", "Uacute": "Ú",
    "acirc": "â", "ecirc": "ê", "icirc": "î", "ocirc": "ô", "ucirc": "û", "ccedil": "ç", "Ccedil": "Ç",
    "ntilde": "ñ", "auml": "ä", "ouml": "ö", "uuml": "ü", "Auml": "Ä", "Ouml": "Ö", "Uuml": "Ü", "szlig": "ß",
]

/// Una sola passata: `&amp;lt;` diventa `&lt;`, non `<`. Un'entita' ignota o rotta resta com'e' scritta.
func decodeHTMLEntities(_ s: String) -> String {
    guard s.contains("&") else { return s }
    let chars = Array(s.unicodeScalars)
    var out = String.UnicodeScalarView()
    var i = 0
    while i < chars.count {
        guard chars[i] == "&" else { out.append(chars[i]); i += 1; continue }
        var j = i + 1
        while j < chars.count, j - i <= 10, chars[j] != ";", chars[j] != "&", chars[j] != " " { j += 1 }
        if j < chars.count, chars[j] == ";", let decoded = decodeEntity(String(String.UnicodeScalarView(chars[(i + 1)..<j]))) {
            out.append(contentsOf: decoded.unicodeScalars)
            i = j + 1
        } else {
            out.append("&")
            i += 1
        }
    }
    return String(out)
}

private func decodeEntity(_ body: String) -> String? {
    guard body.hasPrefix("#") else { return namedEntities[body] }
    let digits = body.dropFirst()
    let hex = digits.first == "x" || digits.first == "X"
    let number = hex ? digits.dropFirst() : digits
    guard !number.isEmpty, number.count <= 7, let value = UInt32(number, radix: hex ? 16 : 10),
          let scalar = Unicode.Scalar(value), value != 0
    else { return nil }
    return String(Character(scalar))
}
