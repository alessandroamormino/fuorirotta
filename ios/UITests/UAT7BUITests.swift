import XCTest

/// Giro UAT 7, tranche B, nel simulatore. Il simulatore non ha un account (l'accesso e' Apple o Google, a mano):
/// qui si prova solo il ramo ospite; il ramo con l'account e' nei test di FuorirottaCore e nelle prove sul telefono.
@MainActor
final class UAT7BUITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = localApp()
        app.launch()
        return app
    }

    /// B1 e C4: nel dettaglio c'e' "Segui" (sotto "Dove", nella scheda Dettagli). Da ospite apre lo stesso menu; la scelta
    /// apre il foglio di accesso (e dopo l'accesso si ripete da sola: si prova sul telefono, qui non c'e' un account).
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
        // Il menu di sistema: la categoria c'e' sempre, ed e' l'ultima voce.
        let choice = app.collectionViews.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "elementType IN {%d, %d}", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue))
        XCTAssertTrue(choice.firstMatch.waitForExistence(timeout: 5), "da ospite Segui non apre il menu")
        shot(app, "segui-ospite-menu")
        choice.element(boundBy: choice.count - 1).tap()
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
