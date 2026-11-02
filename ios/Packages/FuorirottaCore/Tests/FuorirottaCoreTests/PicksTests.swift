import Foundation
import Testing
@testable import FuorirottaCore

private func ev(_ id: Int, image: String? = "default", days: Double = 1) -> Event {
    let start = "2026-11-06T00:00:00.000Z"
    let end = Date(timeIntervalSince1970: 1_793_923_200 + days * 86_400)
    return Event(
        id: id, title: "e\(id)", dateStart: start,
        dateEnd: ISO8601DateFormatter().string(from: end), imageUrl: image == "default" ? "https://img.example/\(id).jpg" : image, locationName: nil, address: nil,
        canonicalCategory: nil, category: nil, latitude: nil, longitude: nil,
        resolvedLatitude: nil, resolvedLongitude: nil, sourceUrl: nil, description: nil
    )
}

@Suite struct PicksTests {
    @Test func emptyStaysEmpty() {
        #expect(heroPicks([]).isEmpty)
    }

    @Test func oneEventIsOneCard() {
        #expect(heroPicks([ev(1)]).map(\.id) == [1])
    }

    @Test func atMostEightInServerOrder() {
        let events = (1...10).map { ev($0) }
        #expect(heroPicks(events).map(\.id) == Array(1...8))
    }

    @Test func longRunningWithImageAfterShortWithImage() {
        let market = ev(1, days: 300) // Gen-Dic
        let short = ev(2)
        let imageless = ev(3, image: nil)
        #expect(heroPicks([market, imageless, short]).map(\.id) == [2, 1, 3])
    }

    @Test func onlyImagelessKeepsServerOrder() {
        let events = (1...10).map { ev($0, image: nil) }
        #expect(heroPicks(events).map(\.id) == Array(1...8))
    }

    @Test func nonHttpsImageCountsAsNoImage() {
        let events = [ev(1, image: "http://img.example/1.jpg"), ev(2)]
        #expect(heroPicks(events).map(\.id) == [2, 1])
    }

    @Test func noEndDateCountsAsShort() {
        let open = Event(
            id: 9, title: "e9", dateStart: "2026-11-06T00:00:00.000Z", dateEnd: nil, imageUrl: "https://img.example/9.jpg",
            locationName: nil, address: nil, canonicalCategory: nil, category: nil, latitude: nil, longitude: nil,
            resolvedLatitude: nil, resolvedLongitude: nil, sourceUrl: nil, description: nil
        )
        #expect(heroPicks([ev(1, days: 300), open]).map(\.id) == [9, 1])
    }
}
