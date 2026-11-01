import Testing
@testable import FuorirottaCore

@Suite struct CoarseCoordinateTests {
    @Test func roundsToTwoDecimals() {
        #expect(coarseCoordinate(45.81234) == "45.81")
        #expect(coarseCoordinate(9.22789) == "9.23")
        #expect(coarseCoordinate(-0.005) == "-0.01" || coarseCoordinate(-0.005) == "-0.0")
    }

    @Test func eventsQueryNeverCarriesThePreciseCoordinate() {
        let filters = SearchFilters(near: .init(lat: 45.812345, lng: 9.227891, radiusKm: 25))
        let query = filters.queryItems(category: nil, limit: 30).map { "\($0.name)=\($0.value ?? "")" }
        #expect(query.contains("lat=45.81"))
        #expect(query.contains("lng=9.23"))
        #expect(!query.contains { $0.contains("45.8123") || $0.contains("9.2278") })
    }
}
