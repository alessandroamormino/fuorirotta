import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct PlaceCardTests {
    @Test func whenSaysOggiForAnEventStartingToday() {
        // Mezzanotte di Roma (UTC+1 a novembre) = 23:00 UTC del giorno prima.
        let w = placeCardWhen(dateStart: "2026-10-31T23:00:00.000Z", dateEnd: nil, today: "2026-11-01")
        #expect(w.label == "Oggi")
        #expect(w.isActive)
    }

    @Test func whenSaysInCorsoForAnEventAlreadyRunning() {
        let w = placeCardWhen(dateStart: "2026-10-30T00:00:00.000Z", dateEnd: "2026-11-03T22:59:00.000Z", today: "2026-11-01")
        #expect(w.label == "In corso")
        #expect(w.isActive)
    }

    @Test func whenShowsWeekdayAndDayForAFutureEvent() {
        // 8 novembre 2026 e' domenica.
        let w = placeCardWhen(dateStart: "2026-11-07T23:00:00.000Z", dateEnd: nil, today: "2026-11-01")
        #expect(w.label == "Dom 8 nov")
        #expect(w.isActive == false)
    }

    @Test func whenForAPastOrUnreadableEventIsNotActive() {
        #expect(placeCardWhen(dateStart: "2026-10-20T00:00:00.000Z", dateEnd: nil, today: "2026-11-01").isActive == false)
        let broken = placeCardWhen(dateStart: "rotto", dateEnd: nil, today: "2026-11-01")
        #expect(broken.label == "" && broken.isActive == false)
    }

    @Test func distanceUsesMetersUnderAKilometreThenKilometres() {
        #expect(formatDistance(meters: 250) == "250 m")
        #expect(formatDistance(meters: 253) == "250 m")
        #expect(formatDistance(meters: 998) == "1 km")
        #expect(formatDistance(meters: 1500) == "1,5 km")
        #expect(formatDistance(meters: 12_400) == "12 km")
        #expect(formatDistance(meters: 12_600) == "13 km")
    }

    @Test func travelTimeIsMinutesThenHoursAndMinutes() {
        #expect(formatTravelTime(seconds: 20) == "1 min")
        #expect(formatTravelTime(seconds: 4 * 60 + 10) == "4 min")
        #expect(formatTravelTime(seconds: 60 * 60) == "1 h")
        #expect(formatTravelTime(seconds: 65 * 60) == "1 h 5 min")
    }
}
