import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct CalendarDraftTests {
    /// Un telefono a New York: i giorni interi restano i giorni di Roma (niente slittamento di fuso).
    private static let newYork: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/New_York")!
        return c
    }()

    private func event(
        _ start: String, _ end: String?, title: String = "Sagra", locationName: String? = nil, address: String? = nil,
        sourceUrl: String? = nil, description: String? = nil
    ) -> Event {
        Event(
            id: 7, title: title, dateStart: start, dateEnd: end, imageUrl: nil, locationName: locationName, address: address,
            canonicalCategory: nil, category: nil, latitude: nil, longitude: nil, resolvedLatitude: nil, resolvedLongitude: nil,
            sourceUrl: sourceUrl, description: description)
    }

    private func day(_ d: Date) -> String {
        let c = Self.newYork.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    @Test func oneDayIsAllDayOnThatDay() throws {
        // Formato UTC delle fonti: mezzanotte UTC - 23:59 UTC.
        let d = try #require(calendarDraft(for: event("2026-10-18T00:00:00.000Z", "2026-10-18T23:59:59.999Z"), calendar: Self.newYork))
        #expect(d.isAllDay)
        #expect(day(d.start) == "2026-10-18" && day(d.end) == "2026-10-18")
        #expect(d.timeZone == nil)
    }

    @Test func multiDayIsAllDayFromFirstToLastDay() throws {
        // Formato Roma: mezzanotte di Roma (23:00 UTC del giorno prima) - 23:59 di Roma.
        let d = try #require(calendarDraft(for: event("2026-11-05T23:00:00.000Z", "2026-11-08T22:59:59.999Z"), calendar: Self.newYork))
        #expect(d.isAllDay)
        #expect(day(d.start) == "2026-11-06" && day(d.end) == "2026-11-08")
    }

    @Test func timedEventKeepsItsInstantsInRome() throws {
        // 21:00-23:00 di Roma.
        let d = try #require(calendarDraft(for: event("2026-11-06T20:00:00.000Z", "2026-11-06T22:00:00.000Z")))
        #expect(!d.isAllDay)
        #expect(d.start == ISO8601DateFormatter().date(from: "2026-11-06T20:00:00Z"))
        #expect(d.end == ISO8601DateFormatter().date(from: "2026-11-06T22:00:00Z"))
        #expect(d.timeZone?.identifier == "Europe/Rome")
    }

    @Test func timedEventWithoutARealEndDoesNotInventOne() throws {
        // Fine assente o "fine giornata" (23:59 di Roma): dura zero, nessuna durata inventata.
        for end in [nil, "2026-11-06T22:59:59.999Z"] {
            let d = try #require(calendarDraft(for: event("2026-11-06T20:00:00.000Z", end)))
            #expect(!d.isAllDay && d.end == d.start)
        }
    }

    @Test func acrossNewYearKeepsBothYears() throws {
        let d = try #require(calendarDraft(for: event("2026-12-30T23:00:00.000Z", "2027-01-02T22:59:59.999Z"), calendar: Self.newYork))
        #expect(d.isAllDay)
        #expect(day(d.start) == "2026-12-31" && day(d.end) == "2027-01-02")
    }

    @Test func fieldsMatchTheSite() throws {
        let d = try #require(calendarDraft(for: event(
            "2026-10-18T00:00:00.000Z", nil, title: "  Sagra &amp; musica  ", locationName: "Piazza Verdi", address: "Via Roma 1",
            sourceUrl: "https://example.invalid/x", description: "<p>Breve</p>")))
        #expect(d.title == "Sagra & musica")
        #expect(d.location == "Piazza Verdi, Via Roma 1")
        #expect(d.notes == "Breve\n\nFonte: https://example.invalid/x\nhttps://fuori-rotta.it/eventi/7")
        #expect(d.url?.absoluteString == "https://fuori-rotta.it/eventi/7")
        // Indirizzo uguale al luogo saltato; luogo ignoto vuoto; javascript: fuori.
        #expect(calendarDraft(for: event("2026-10-18T00:00:00.000Z", nil, locationName: "Piazza", address: "Piazza"))?.location == "Piazza")
        #expect(calendarDraft(for: event("2026-10-18T00:00:00.000Z", nil))?.location == "")
        #expect(calendarDraft(for: event("2026-10-18T00:00:00.000Z", nil, sourceUrl: "javascript:alert(1)"))?.notes == "https://fuori-rotta.it/eventi/7")
    }

    @Test func longDescriptionIsCutOnAWord() throws {
        let d = try #require(calendarDraft(for: event("2026-10-18T00:00:00.000Z", nil, description: String(repeating: "parola ", count: 200))))
        let snippet = d.notes.components(separatedBy: "\n\n")[0]
        #expect(snippet.count <= 500)
        #expect(snippet.hasSuffix("parola…"))
    }

    @Test func unreadableDateHasNoDraft() {
        #expect(calendarDraft(for: event("rotto", nil)) == nil)
    }
}
