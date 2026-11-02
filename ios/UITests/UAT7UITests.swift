import XCTest

/// Regressioni del giro UAT 7 (Fase 27): azioni del dettaglio evento.
@MainActor
final class UAT7UITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
        app.launch()
        return app
    }

    /// Apre il dettaglio dell'eroe della Home (un evento vicino, quindi con le coordinate). Al centro: in alto c'e' "Questo weekend".
    private func openHeroDetail(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons.matching(identifier: "heart").firstMatch.waitForExistence(timeout: 20))
        let hero = app.buttons.allElementsBoundByIndex.first { $0.frame.height > 340 && abs($0.frame.minX) < 1 }
        XCTAssertNotNil(hero, "nessun eroe nella Home")
        guard let f = hero?.frame else { return }
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.midX, dy: f.midY)).tap()
    }

    /// A3: nel simulatore c'e' solo Mappe, quindi "Indicazioni" resta un bottone che apre subito (niente menu) e la riga
    /// "Apri link" / "Indicazioni" resta una riga di due meta'.
    func testDirectionsStaysOneTapWithOnlyMaps() {
        let app = launch()
        openHeroDetail(app)
        let directions = app.buttons["Indicazioni"]
        XCTAssertTrue(directions.waitForExistence(timeout: 10), "nessun bottone Indicazioni nel dettaglio")
        let link = app.buttons["Apri link"]
        if link.exists {
            XCTAssertEqual(link.frame.midY, directions.frame.midY, accuracy: 1, "Apri link e Indicazioni non sono sulla stessa riga")
            XCTAssertEqual(link.frame.width, directions.frame.width, accuracy: 2, "non sono a meta' larghezza ciascuno")
            XCTAssertLessThan(link.frame.maxX, directions.frame.minX)
        }
        XCTAssertLessThanOrEqual(directions.frame.maxX, app.frame.width)
        directions.tap()
        // Solo Mappe: il tocco apre Mappe e l'app va in secondo piano, senza menu in mezzo.
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10), "il tocco non ha aperto Mappe")
        app.activate()
    }
}
