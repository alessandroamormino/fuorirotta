import Foundation
import Testing

@testable import FuorirottaCore

/// Date e distanze in inglese (UAT3): il locale sceglie solo le parole, il giorno resta quello di Roma.
@Suite struct EnglishTests {
    private let en = Locale(identifier: "en")

    @Test func dayRangesPutTheMonthFirst() {
        #expect(formatDayRange(from: "2026-11-06", to: "2026-11-08", locale: en) == "November 6-8")
        #expect(formatDayRange(from: "2026-10-30", to: "2026-11-01", locale: en) == "October 30 - November 1")
        #expect(formatDayRange(from: "2026-11-08", to: "2026-11-08", locale: en) == "November 8")
    }

    @Test func shortAndLongDays() {
        #expect(formatShortDay("2026-11-01", locale: en) == "Nov 1")
        #expect(formatLongDay("2026-11-08", locale: en) == "Sunday, November 8")
        #expect(monthTitle(day: "2026-11-08", locale: en) == "November 2026")
    }

    @Test func placeCardAndDistance() {
        #expect(placeCardWhen(dateStart: "2026-11-07T23:00:00.000Z", dateEnd: nil, today: "2026-11-01", locale: en).label == "Sun Nov 8")
        #expect(formatDistance(meters: 1500, locale: en) == "1.5 km")
        #expect(formatDistance(meters: 1500) == "1,5 km")
    }

    @Test func italianIsTheDefault() {
        #expect(formatLongDay("2026-11-08") == formatLongDay("2026-11-08", locale: .italian))
    }
}
