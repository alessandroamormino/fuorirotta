import Foundation
import Testing
@testable import FuorirottaCore

private func item(_ start: String, _ end: String? = nil, _ category: String? = nil) -> StatItem {
    StatItem(dateStart: start, dateEnd: end, category: category)
}

private func utc(_ day: String) -> String { "\(day)T00:00:00.000Z" }
private func utcEnd(_ day: String) -> String { "\(day)T23:59:59.999Z" }

@Suite struct StatsTests {
    @Test func emptyIsAllZeros() {
        let s = computeStats([], year: 2026)
        #expect(s.days.isEmpty && s.perMonth == Array(repeating: 0, count: 12) && s.perCategory.isEmpty && s.years.isEmpty)
    }

    @Test func oneDayEventBothFormats() {
        let utcFormat = computeStats([item(utc("2026-11-08"), utcEnd("2026-11-08"))], year: 2026)
        #expect(utcFormat.days == ["2026-11-08": 1] && utcFormat.perMonth[10] == 1)
        let romeFormat = computeStats([item("2026-11-07T23:00:00.000Z", "2026-11-08T22:59:59.999Z")], year: 2026)
        #expect(romeFormat.days == ["2026-11-08": 1] && romeFormat.perMonth[10] == 1)
    }

    @Test func fourteenDaysSpreadFifteenDoesNot() {
        let fourteen = computeStats([item(utc("2026-11-01"), utcEnd("2026-11-14"))], year: 2026)
        #expect(fourteen.days.count == 14)
        let fifteen = computeStats([item(utc("2026-11-01"), utcEnd("2026-11-15"))], year: 2026)
        #expect(fifteen.days == ["2026-11-01": 1])
        let longRunning = computeStats([item(utc("2019-12-09"), utcEnd("2029-12-31"))], year: 2019)
        #expect(longRunning.days == ["2019-12-09": 1] && longRunning.years == [2019])
    }

    @Test func eventAcrossMonthsCountsInBoth() {
        let s = computeStats([item(utc("2026-10-30"), utcEnd("2026-11-02"))], year: 2026)
        #expect(s.perMonth[9] == 1 && s.perMonth[10] == 1 && s.days.count == 4)
    }

    @Test func eventAcrossYearsSplitsDays() {
        let items = [item(utc("2026-12-30"), utcEnd("2027-01-02"))]
        let y26 = computeStats(items, year: 2026)
        let y27 = computeStats(items, year: 2027)
        #expect(y26.days.keys.sorted() == ["2026-12-30", "2026-12-31"] && y26.perMonth[11] == 1 && y26.perMonth[0] == 0)
        #expect(y27.days.keys.sorted() == ["2027-01-01", "2027-01-02"] && y27.perMonth[0] == 1)
        #expect(y26.years == [2026, 2027])
    }

    @Test func sameDayEventsAddUpAndHeatLevelRamps() {
        let s = computeStats([item(utc("2026-11-08")), item(utc("2026-11-08"))], year: 2026)
        #expect(s.days["2026-11-08"] == 2)
        #expect([0, 1, 2, 3, 4, 7].map(heatLevel) == [0, 1, 2, 3, 4, 4])
    }

    @Test func categoriesByCountThenTaxonomyAndUnknownIsAltro() {
        let items = [
            item(utc("2026-05-01"), nil, "Musica e spettacolo"), item(utc("2026-05-02"), nil, "Musica e spettacolo"),
            item(utc("2026-06-01"), nil, "Sagre e feste"), item(utc("2026-06-02"), nil, "Sagre e feste"),
            item(utc("2026-07-01"), nil, "Arte e cultura"),
            item(utc("2026-07-02"), nil, "Hacker"),
        ]
        let s = computeStats(items, year: 2026)
        #expect(s.perCategory.map(\.name) == ["Sagre e feste", "Musica e spettacolo", "Arte e cultura", "Altro"])
        #expect(s.perCategory.map(\.count) == [2, 2, 1, 1])
        #expect(computeStats(items, year: 2025).perCategory.isEmpty)
    }

    @Test func unparseableStartIsSkipped() {
        #expect(computeStats([item("boh")], year: 2026).years.isEmpty)
    }

    @Test func defaultYear() {
        let now = Rome.calendar.date(from: DateComponents(year: 2026, month: 11, day: 1))!
        #expect(defaultStatsYear([], now: now) == nil)
        #expect(defaultStatsYear([item(utc("2026-03-01")), item(utc("2024-03-01"))], now: now) == 2026)
        #expect(defaultStatsYear([item(utc("2025-03-01")), item(utc("2024-03-01"))], now: now) == 2025)
    }
}
