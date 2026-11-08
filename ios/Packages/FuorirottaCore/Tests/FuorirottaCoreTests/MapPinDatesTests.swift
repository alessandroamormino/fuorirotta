import Foundation
import Testing
@testable import FuorirottaCore

@Suite(.serialized) struct MapPinDatesTests {
    private func pin(_ start: String, _ end: String?) -> MapPin {
        MapPin(id: 1, title: "t", category: nil, imageUrl: nil, dateStart: start, locationName: nil,
               lat: 45, lng: 9, dateEnd: end)
    }

    @Test func fixtureCarriesDays() throws {
        let url = Bundle.module.url(forResource: "clusters-production-shape", withExtension: "json", subdirectory: "Fixtures")!
        let set = ClusterSet(try JSONDecoder().decode(ClusterEnvelope.self, from: Data(contentsOf: url)))
        #expect(set.pins.map(\.id) == [2001, 2002])
        #expect(set.pins[0].dateEnd == "2026-11-15T23:59:59.999Z")
        #expect(set.pins[0].startDay == "2026-11-08" && set.pins[0].endDay == "2026-11-15")
        #expect(set.pins[1].dateEnd == nil)
    }

    @Test func overlapIsTheEventsApiRule() {
        let p = pin("2026-12-09T23:00:00.000Z", "2026-12-15T23:59:59.999Z")
        #expect(p.startDay == "2026-12-10" && p.endDay == "2026-12-15")
        #expect(p.overlaps(from: "2026-12-12", to: "2026-12-12"))
        #expect(p.overlaps(from: "2026-12-15", to: "2026-12-20"))
        #expect(!p.overlaps(from: "2026-12-16", to: "2026-12-16"))
        #expect(!p.overlaps(from: "2026-12-01", to: "2026-12-09"))
    }

    @Test func endedBeforeWindowDoesNotMatch() {
        let p = pin("2026-11-02T00:00:00.000Z", "2026-11-04T23:59:59.999Z")
        #expect(!p.overlaps(from: "2026-11-06", to: "2026-11-08"))
    }

    @Test func futureWithoutEndIsOneDay() {
        let p = pin("2099-06-01T10:00:00.000Z", nil)
        #expect(p.startDay == "2099-06-01" && p.endDay == "2099-06-01")
    }

    @Test func staleStartedWithoutEndStaysVisible() {
        let p = pin("2020-01-01T10:00:00.000Z", nil)
        #expect(p.endDay == "9999-12-31")
        #expect(p.overlaps(from: "2099-01-01", to: "2099-01-02"))
    }

    @Test func unreadableStartNeverMatches() {
        let p = pin("non una data", nil)
        #expect(p.startDay == "")
        #expect(!p.overlaps(from: "2026-01-01", to: "9999-12-31"))
    }

    @Test func roundTripKeepsDaysAndOldDiskCopyDecodes() throws {
        let p = pin("2026-12-09T23:00:00.000Z", "2026-12-15T23:59:59.999Z")
        let back = try JSONDecoder().decode(MapPin.self, from: JSONEncoder().encode(p))
        #expect(back.dateEnd == p.dateEnd && back.startDay == p.startDay && back.endDay == p.endDay)
        let old = #"{"id":7,"title":"t","dateStart":"2026-12-09T23:00:00.000Z"}"#
        let o = try JSONDecoder().decode(MapPin.self, from: Data(old.utf8))
        #expect(o.dateEnd == nil && o.startDay == "2026-12-10")
    }
}
