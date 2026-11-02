import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct RailDateTests {
    @Test func shortDayUsesFixedItalianAbbreviations() {
        #expect(formatShortDay("2026-11-01") == "1 nov")
        #expect(formatShortDay("2026-03-09") == "9 mar")
        #expect(formatShortDay("rotto") == "rotto")
    }

    @Test func futureEventShowsItsFirstDay() {
        let d = railDate(dateStart: "2026-11-06T00:00:00.000Z", dateEnd: "2026-11-08T22:59:00.000Z", today: "2026-11-01")
        #expect(d.label == "6 nov")
        #expect(d.isToday == false)
    }

    @Test func eventStartingTodayIsHighlighted() {
        // Mezzanotte di Roma (UTC+1 a novembre) = 23:00 UTC del giorno prima.
        let d = railDate(dateStart: "2026-10-31T23:00:00.000Z", dateEnd: nil, today: "2026-11-01")
        #expect(d.label == "1 nov")
        #expect(d.isToday)
    }

    @Test func eventAlreadyRunningSaysInCorsoAndIsNotHighlighted() {
        // UAT 2: solo chi INIZIA oggi ha la data in accento; "In corso" (mercati annuali, mostre) non e' "oggi".
        let d = railDate(dateStart: "2026-10-30T00:00:00.000Z", dateEnd: "2026-11-03T22:59:00.000Z", today: "2026-11-01")
        #expect(d.label == "In corso")
        #expect(d.isToday == false)
    }

    @Test func unreadableDateHasNoLabel() {
        let d = railDate(dateStart: "boh", dateEnd: nil, today: "2026-11-01")
        #expect(d.label == "")
        #expect(d.isToday == false)
    }
}
