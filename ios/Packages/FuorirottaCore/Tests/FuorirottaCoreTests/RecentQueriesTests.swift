import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct RecentQueriesTests {
    @Test func addsTrimmedNewestFirst() {
        #expect(RecentQueries.adding("sagra", to: []) == ["sagra"])
        #expect(RecentQueries.adding("  Sagra ", to: ["sagra", "jazz"]) == ["Sagra", "jazz"])
        #expect(RecentQueries.adding("jazz", to: ["sagra"]) == ["jazz", "sagra"])
    }

    @Test func keepsEightAndDropsTheOldest() {
        let full = (1...8).map { "q\($0)" }  // q1 e' la piu' recente
        let next = RecentQueries.adding("nuova", to: full)
        #expect(next.count == RecentQueries.max)
        #expect(next.first == "nuova")
        #expect(!next.contains("q8"))
    }

    @Test func emptyOrBlankChangesNothing() {
        #expect(RecentQueries.adding("", to: ["a"]) == ["a"])
        #expect(RecentQueries.adding("   \n", to: ["a"]) == ["a"])
    }
}
