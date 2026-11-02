import XCTest

/// Giro UAT 7, tranche B, nel simulatore. Il simulatore non ha un account (l'accesso e' Apple o Google, a mano):
/// qui si prova solo il ramo ospite; il ramo con l'account e' nei test di FuorirottaCore e nelle prove sul telefono.
@MainActor
final class UAT7BUITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
        app.launch()
        return app
    }

    /// B1: nel dettaglio c'e' "Segui" (sotto "Dove", nella scheda Dettagli); da ospite apre il foglio di accesso, come il sito.
    func testGuestFollowOpensSignIn() {
        let app = launch()
        XCTAssertTrue(app.buttons.matching(identifier: "heart").firstMatch.waitForExistence(timeout: 20))
        let hero = app.buttons.allElementsBoundByIndex.first { $0.frame.height > 340 && abs($0.frame.minX) < 1 }
        guard let hero else { return XCTFail("nessun eroe nella Home") }
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: hero.frame.midX, dy: hero.frame.midY)).tap()
        let follow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Segui'")).firstMatch
        XCTAssertTrue(follow.waitForExistence(timeout: 10), "nessuna riga Segui nel dettaglio")
        for _ in 0..<4 where !follow.isHittable { app.swipeUp() }
        follow.tap()
        XCTAssertTrue(app.buttons["Continua con Google"].waitForExistence(timeout: 5), "da ospite Segui non apre l'accesso")
    }

    /// B2: il menu di Salvati (condividi la lista, iscriviti nel calendario) c'e' solo con l'account.
    func testGuestSavedHasNoSharingMenu() {
        let app = launch()
        app.tabBars.buttons["Salvati"].tap()
        XCTAssertTrue(app.buttons["Prossimi"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Altre azioni"].exists, "da ospite Salvati non deve avere il menu di condivisione")
    }
}
