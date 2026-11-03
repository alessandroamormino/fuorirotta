import Foundation
import Testing
@testable import FuorirottaCore

// Fixture generata da lib/stats/compute.ts (npx tsx scripts/ios-stats.ts --write); il gate check:ios-stats la tiene allineata in CI.
// Qui Swift deve dare gli stessi numeri (Fase 27.1, D-12).

private struct CategoryCount: Decodable, Equatable {
    let name: String
    let count: Int
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        name = try c.decode(String.self)
        count = try c.decode(Int.self)
    }
}

private struct ExpectedStats: Decodable {
    let days: [String: Int]
    let perMonth: [Int]
    let perCategory: [CategoryCount]
    let years: [Int]
}

private struct SavedItem: Decodable {
    let dateStart: String
    let dateEnd: String?
    let category: String?
}

private struct StatsCase: Decodable {
    let name: String
    let year: Int
    let saved: [SavedItem]
    let expect: Expect
    struct Expect: Decodable { let saved: ExpectedStats }
}

private struct StatsFixture: Decodable { let cases: [StatsCase] }

private func loadFixture() throws -> StatsFixture {
    let url = Bundle.module.url(forResource: "stats", withExtension: "json", subdirectory: "Fixtures")!
    return try JSONDecoder().decode(StatsFixture.self, from: Data(contentsOf: url))
}

private func matches(_ got: Stats, _ want: ExpectedStats) -> Bool {
    got.days == want.days
        && got.perMonth == want.perMonth
        && got.years == want.years
        && got.perCategory.map { CategoryCount(name: $0.name, count: $0.count) } == want.perCategory
}

extension CategoryCount {
    fileprivate init(name: String, count: Int) { self.name = name; self.count = count }
}

@Suite struct StatsParityTests {
    @Test func savedStatsEqualTypeScript() throws {
        let fixture = try loadFixture()
        #expect(fixture.cases.count >= 10)
        for c in fixture.cases {
            let items = c.saved.map { StatItem(dateStart: $0.dateStart, dateEnd: $0.dateEnd, category: $0.category) }
            #expect(matches(computeStats(items, year: c.year), c.expect.saved), "saved: \(c.name)")
        }
    }
}
