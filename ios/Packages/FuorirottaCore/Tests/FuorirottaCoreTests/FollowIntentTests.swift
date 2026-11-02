import Foundation
import Testing
@testable import FuorirottaCore

@Suite struct FollowIntentTests {
    private let bergamo = FollowItem(kind: "comune", key: "016024", label: "Bergamo (BG)")
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    @Test func takenOnceAfterSignIn() {
        var intent = FollowIntent()
        intent.write(bergamo, now: t0)
        #expect(intent.take(now: t0.addingTimeInterval(60)) == bergamo)
        #expect(intent.take(now: t0.addingTimeInterval(61)) == nil)  // una volta sola
    }

    @Test func fifteenMinutesAtMost() {
        var intent = FollowIntent()
        intent.write(bergamo, now: t0)
        #expect(intent.take(now: t0.addingTimeInterval(FollowIntent.maxAge)) == bergamo)
        intent.write(bergamo, now: t0)
        #expect(intent.take(now: t0.addingTimeInterval(FollowIntent.maxAge + 1)) == nil)
        // Scaduto, ma tolto lo stesso.
        #expect(intent.take(now: t0) == nil)
        // Dal futuro (orologio spostato): scartato.
        intent.write(bergamo, now: t0)
        #expect(intent.take(now: t0.addingTimeInterval(-1)) == nil)
    }

    @Test func clearedWhenSignInIsDismissed() {
        var intent = FollowIntent()
        intent.write(FollowItem(kind: "category", key: "Altro", label: "Altro"), now: t0)
        intent.clear()
        #expect(intent.take(now: t0) == nil)
        // L'ultimo tocco vince.
        intent.write(FollowItem(kind: "category", key: "Altro", label: "Altro"), now: t0)
        intent.write(bergamo, now: t0)
        #expect(intent.take(now: t0) == bergamo)
    }
}
