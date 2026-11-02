import Foundation
import Testing
@testable import FuorirottaCore

// Fixture generata da lib/eventDays.ts (npx tsx scripts/ios-event-days.ts --write); il gate check:ios-event-days la tiene allineata in CI.
private struct DaysCase: Decodable {
    let dateStart: String
    let dateEnd: String?
    let startDay: String
    let endDay: String
}

private struct DaysFixture: Decodable { let cases: [DaysCase] }

@Suite struct EventDaysTests {
    @Test func swiftRuleEqualsTypeScriptRule() throws {
        let url = Bundle.module.url(forResource: "event-days", withExtension: "json", subdirectory: "Fixtures")!
        let fixture = try JSONDecoder().decode(DaysFixture.self, from: Data(contentsOf: url))
        #expect(fixture.cases.count >= 150)
        for c in fixture.cases {
            let got = eventDays(dateStart: c.dateStart, dateEnd: c.dateEnd)
            #expect(
                got?.startDay == c.startDay && got?.endDay == c.endDay,
                "\(c.dateStart) / \(c.dateEnd ?? "nil"): atteso \(c.startDay) \(c.endDay), ottenuto \(got?.startDay ?? "nil") \(got?.endDay ?? "nil")"
            )
        }
    }

    @Test func unparseableStartIsNil() {
        #expect(eventDays(dateStart: "non una data", dateEnd: nil) == nil)
    }
}
