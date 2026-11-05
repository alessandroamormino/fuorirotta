import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct UniversalLinkTests {
    private func parse(_ s: String) -> UniversalLink? { URL(string: s).flatMap(parseUniversalLink) }

    @Test func acceptsEventAndList() {
        #expect(parse("https://fuori-rotta.it/eventi/123") == .event(123))
        #expect(parse("https://fuori-rotta.it/eventi/123456789") == .event(123456789))
        #expect(parse("https://fuori-rotta.it/l/Ab_-9") == .list("Ab_-9"))
    }

    @Test func rejectsEverythingElse() {
        let bad = [
            "http://fuori-rotta.it/eventi/123",
            "https://fuori-rotta.it.evil.com/eventi/123",
            "https://www.example.com/eventi/123",
            "https://fuori-rotta.it/eventi/12a",
            "https://fuori-rotta.it/eventi/",
            "https://fuori-rotta.it/eventi/\u{0661}\u{0662}\u{0663}",  // cifre arabo-indiane
            "https://fuori-rotta.it/eventi/123/extra",
            "https://fuori-rotta.it/eventi/1234567890",  // 10 cifre
            "https://fuori-rotta.it/l/bad%20token",
            "https://fuori-rotta.it/l/bad.token",
            "https://fuori-rotta.it/altro/123",
            "https://fuori-rotta.it/",
        ]
        for s in bad { #expect(parse(s) == nil, "\(s)") }
    }
}
