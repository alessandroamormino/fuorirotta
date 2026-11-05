import Foundation
import Testing
@testable import FuorirottaCore

private struct Item: SavedTimelineItem, Equatable {
    let title: String
    let dateStart: String
    let dateEnd: String?
    init(_ title: String, _ start: String, _ end: String? = nil) { self.title = title; dateStart = start; dateEnd = end }
}

// Oggi = sabato 2026-10-31 (Roma). A ottobre/novembre Roma e' UTC+1 (dal 25/10) o +2 (prima): le date di prova
// usano mezzogiorno UTC per i giorni "sicuri" e orari di confine per i test sul fuso.
private let today = "2026-10-31"
private func ids(_ days: [SavedDay<Item>]) -> [String] { days.map(\.id) }
private func titles(_ days: [SavedDay<Item>]) -> [[String]] { days.map { $0.items.map(\.title) } }

@Suite struct SavedTimelineTests {
    @Test func upcomingGroupsByStartDayAscending() {
        let items = [
            Item("C", "2026-11-08T12:00:00.000Z"),
            Item("A", "2026-10-31T12:00:00.000Z"),
            Item("B", "2026-11-02T12:00:00.000Z"),
            Item("A2", "2026-10-31T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: false, today: today)
        #expect(ids(days) == ["day-2026-10-31", "day-2026-11-02", "day-2026-11-08"])
        #expect(titles(days) == [["A", "A2"], ["B"], ["C"]])
    }

    @Test func ongoingBucketComesFirstAndSortsByEndDay() {
        let items = [
            Item("Domani", "2026-11-01T12:00:00.000Z"),
            Item("Lunga", "2026-04-17T12:00:00.000Z", "2027-01-10T12:00:00.000Z"),
            Item("Breve", "2026-10-30T12:00:00.000Z", "2026-11-03T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: false, today: today)
        #expect(ids(days) == ["ongoing", "day-2026-11-01"])
        #expect(days[0].isOngoing)
        #expect(days[0].day == nil)
        #expect(days[0].month == nil)
        #expect(titles(days)[0] == ["Breve", "Lunga"])
    }

    @Test func eventStartingTodayIsNotOngoing() {
        let days = savedTimeline([Item("Oggi", "2026-10-31T12:00:00.000Z", "2026-11-02T12:00:00.000Z")], past: false, today: today)
        #expect(ids(days) == ["day-2026-10-31"])
        #expect(days[0].isOngoing == false)
    }

    @Test func pastGroupsDescendingAndHasNoOngoing() {
        let items = [
            Item("Vecchio", "2026-09-04T12:00:00.000Z", "2026-09-06T12:00:00.000Z"),
            Item("Ieri", "2026-10-30T12:00:00.000Z"),
            Item("Futuro", "2026-11-05T12:00:00.000Z"),
            Item("Ottobre", "2026-10-10T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: true, today: today)
        #expect(ids(days) == ["day-2026-10-30", "day-2026-10-10", "day-2026-09-04"])
        #expect(days.allSatisfy { !$0.isOngoing })
        let upcoming = savedTimeline(items, past: false, today: today)
        #expect(titles(upcoming) == [["Futuro"]])
    }

    @Test func monthHeaderOnlyWhenMonthChanges() {
        let items = [
            Item("a", "2026-11-02T12:00:00.000Z"),
            Item("b", "2026-11-09T12:00:00.000Z"),
            Item("c", "2026-12-01T12:00:00.000Z"),
            Item("d", "2027-01-05T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: false, today: today)
        #expect(days.map(\.month) == ["Novembre 2026", nil, "Dicembre 2026", "Gennaio 2027"])
        #expect(days.map(\.id) == ["day-2026-11-02", "day-2026-11-09", "day-2026-12-01", "day-2027-01-05"])
    }

    @Test func monthHeaderAlsoWhenOngoingBucketPrecedes() {
        let items = [
            Item("Lunga", "2026-04-17T12:00:00.000Z", "2027-01-10T12:00:00.000Z"),
            Item("a", "2026-11-02T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: false, today: today)
        #expect(days.map(\.month) == [nil, "Novembre 2026"])
    }

    @Test func pastMonthHeadersFollowDescendingOrder() {
        let items = [
            Item("a", "2026-10-30T12:00:00.000Z"),
            Item("b", "2026-10-02T12:00:00.000Z"),
            Item("c", "2026-09-20T12:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: true, today: today)
        #expect(days.map(\.month) == ["Ottobre 2026", nil, "Settembre 2026"])
    }

    @Test func englishMonthHeader() {
        let days = savedTimeline([Item("a", "2026-11-02T12:00:00.000Z")], past: false, today: today, locale: Locale(identifier: "en_US"))
        #expect(days[0].month == "November 2026")
    }

    @Test func dayIsTheRomeDayNotTheUTCDay() {
        // 23:30 UTC del 1 novembre = 00:30 del 2 novembre a Roma (UTC+1).
        let late = Item("Notte", "2026-11-01T23:30:00.000Z")
        // 22:30 UTC del 1 novembre = 23:30 del 1 novembre a Roma.
        let early = Item("Sera", "2026-11-01T22:30:00.000Z")
        let days = savedTimeline([late, early], past: false, today: today)
        #expect(ids(days) == ["day-2026-11-01", "day-2026-11-02"])
        #expect(titles(days) == [["Sera"], ["Notte"]])
    }

    @Test func midnightRomeStoredAsLocalFormatStaysOnItsDay() {
        // Formato "Roma": mezzanotte di Roma del 3 novembre = 23:00 UTC del 2.
        let days = savedTimeline([Item("a", "2026-11-02T23:00:00.000Z")], past: false, today: today)
        #expect(ids(days) == ["day-2026-11-03"])
    }

    @Test func withinADayEarlierTimeFirstThenTitle() {
        let items = [
            Item("Zeta", "2026-11-03T17:00:00.000Z"),
            Item("Beta", "2026-11-03T19:00:00.000Z"),
            Item("Alfa", "2026-11-03T19:00:00.000Z"),
        ]
        let days = savedTimeline(items, past: false, today: today)
        #expect(titles(days) == [["Zeta", "Alfa", "Beta"]])
    }

    @Test func eventEndedYesterdayIsPastEvenIfStartedEarlier() {
        let e = Item("Finito", "2026-10-25T12:00:00.000Z", "2026-10-30T12:00:00.000Z")
        #expect(savedTimeline([e], past: false, today: today).isEmpty)
        #expect(ids(savedTimeline([e], past: true, today: today)) == ["day-2026-10-25"])
    }

    @Test func unreadableDateGoesLastInPastWithoutMonth() {
        let items = [Item("Rotto", ""), Item("Ieri", "2026-10-30T12:00:00.000Z")]
        let days = savedTimeline(items, past: true, today: today)
        #expect(ids(days) == ["day-2026-10-30", "undated"])
        #expect(days[1].day == nil)
        #expect(days[1].month == nil)
        #expect(days[1].isOngoing == false)
        #expect(savedTimeline(items, past: false, today: today).isEmpty)
    }

    @Test func emptyInputIsEmpty() {
        #expect(savedTimeline([Item](), past: false, today: today).isEmpty)
        #expect(savedTimeline([Item](), past: true, today: today).isEmpty)
    }

    // MARK: riepilogo

    @Test func summaryCountsAllAndThisWeek() {
        let items = [
            Item("Lunga", "2026-04-17T12:00:00.000Z", "2027-01-10T12:00:00.000Z"),
            Item("Oggi", "2026-10-31T12:00:00.000Z"),
            Item("Giovedi", "2026-11-05T12:00:00.000Z"),
            Item("Venerdi", "2026-11-06T12:00:00.000Z"),   // oggi + 6: dentro
            Item("Sabato", "2026-11-07T12:00:00.000Z"),    // oggi + 7: fuori
        ]
        let days = savedTimeline(items, past: false, today: today)
        let s = savedSummary(days, today: today)
        #expect(s.total == 5)
        #expect(s.thisWeek == 3)
    }

    @Test func summaryWeekCrossesMonthAndYear() {
        let s = savedSummary(
            savedTimeline([Item("a", "2027-01-02T12:00:00.000Z"), Item("b", "2027-01-06T12:00:00.000Z")], past: false, today: "2026-12-30"),
            today: "2026-12-30")
        #expect(s.total == 2)
        #expect(s.thisWeek == 1)
    }

    @Test func summaryOfPastHasNoWeek() {
        let days = savedTimeline([Item("a", "2026-10-30T12:00:00.000Z")], past: true, today: today)
        let s = savedSummary(days, today: today)
        #expect(s.total == 1)
        #expect(s.thisWeek == 0)
    }

    @Test func addingDaysUsesTheCalendar() {
        #expect(dayString("2026-10-31", plusDays: 6) == "2026-11-06")
        #expect(dayString("2026-12-30", plusDays: 6) == "2027-01-05")
        #expect(dayString("2028-02-27", plusDays: 2) == "2028-02-29")
        #expect(dayString("rotto", plusDays: 1) == nil)
    }

    // MARK: piastrina e intestazione del giorno

    @Test func dayTileNumberAndWeekday() {
        let it = timelineDayTile("2026-10-31")
        #expect(it.number == "31")
        #expect(it.weekday == "Sab")
        let en = timelineDayTile("2026-10-31", locale: Locale(identifier: "en_US"))
        #expect(en.number == "31")
        #expect(en.weekday == "Sat")
        #expect(timelineDayTile("2026-11-01").weekday == "Dom")
        #expect(timelineDayTile("rotto").number == "rotto")
    }

    @Test func dayHeadingHasWeekdayAndYear() {
        #expect(formatTimelineDay("2026-10-31") == "Sabato 31 ottobre 2026")
        #expect(formatTimelineDay("2027-01-01") == "Venerdì 1 gennaio 2027")
        #expect(formatTimelineDay("2026-10-31", locale: Locale(identifier: "en_US")) == "Saturday, October 31, 2026")
        #expect(formatTimelineDay("rotto") == "rotto")
    }
}

// Visitati (27.1-10): i blocchi sono i giorni in cui sei andato, non i giorni degli eventi.
@Suite struct VisitedTimelineTests {
    private func visited(_ rows: [(Item, String)]) -> [SavedDay<Item>] {
        visitedTimeline(rows.map { (item: $0.0, visitDay: $0.1) }, locale: .italian)
    }

    @Test func groupsByVisitDayNewestFirstWithMonthHeaders() {
        let days = visited([
            (Item("Settembre", "2026-09-10T12:00:00.000Z"), "2026-09-12"),
            (Item("B", "2026-10-29T12:00:00.000Z"), "2026-10-30"),
            (Item("Recente", "2026-11-03T12:00:00.000Z"), "2026-11-03"),
            (Item("A", "2026-10-28T12:00:00.000Z"), "2026-10-30"),
        ])
        #expect(ids(days) == ["day-2026-11-03", "day-2026-10-30", "day-2026-09-12"])
        #expect(titles(days) == [["Recente"], ["A", "B"], ["Settembre"]])
        #expect(days.map(\.month) == ["Novembre 2026", "Ottobre 2026", "Settembre 2026"])
        #expect(days.allSatisfy { !$0.isOngoing && $0.day != nil })
    }

    @Test func sameMonthHasOneHeader() {
        let days = visited([
            (Item("A", "2026-10-01T12:00:00.000Z"), "2026-10-30"),
            (Item("B", "2026-10-01T12:00:00.000Z"), "2026-10-02"),
        ])
        #expect(days.map(\.month) == ["Ottobre 2026", nil])
    }

    @Test func eventInProgressVisitedTodayIsUnderToday() {
        let days = visited([(Item("In corso", "2026-10-30T12:00:00.000Z", "2026-11-01T12:00:00.000Z"), "2026-10-31")])
        #expect(ids(days) == ["day-2026-10-31"])
        #expect(days[0].isOngoing == false)
    }

    @Test func emptyInputGivesNoBlocks() {
        #expect(visited([]).isEmpty)
    }
}
