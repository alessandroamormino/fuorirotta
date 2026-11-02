import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct PhoneTests {
    private func dial(_ raw: String) -> String? { phoneDialURL(raw)?.absoluteString }

    @Test func formatsFromTheSources() {
        #expect(dial("02485551") == "tel:02485551")
        #expect(dial("+39 030 2400640") == "tel:+390302400640")
        #expect(dial("+393517223957") == "tel:+393517223957")
        #expect(dial("333 8005861") == "tel:3338005861")
        #expect(dial("0346.41345") == "tel:034641345")
        #expect(dial(" +39 340 811 9192 ") == "tel:+393408119192")
        // Spazio unificatore (alcune fonti), e trattini come separatori.
        #expect(dial("+39\u{00A0}055\u{00A0}0882000") == "tel:+390550882000")
        #expect(dial("0341-286729") == "tel:0341286729")
    }

    @Test func extensionRangeKeepsTheFirstNumber() {
        #expect(dial("+39 0341 2414221-227") == "tel:+3903412414221")
    }

    @Test func notANumberHasNoLink() {
        #expect(dial("infouffizi@cultura.gov.it") == nil)
        #expect(dial("") == nil)
        #expect(dial("12345") == nil)  // troppo corto
        #expect(dial("0341 123456 / 0341 654321") == nil)  // due numeri
        #expect(dial("+39 +39 0341") == nil)
        #expect(dial("1234567890123456") == nil)  // oltre E.164
    }

    @Test func detailDecodesThePhone() throws {
        let json = #"{"id":1,"title":"T","dateStart":"2026-11-01T00:00:00.000Z","phone":"+39 030 2400640"}"#
        #expect(try JSONDecoder().decode(Event.self, from: Data(json.utf8)).phone == "+39 030 2400640")
        let none = #"{"id":1,"title":"T","dateStart":"2026-11-01T00:00:00.000Z","phone":null}"#
        #expect(try JSONDecoder().decode(Event.self, from: Data(none.utf8)).phone == nil)
    }
}
