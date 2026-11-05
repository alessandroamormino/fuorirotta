import XCTest

/// Regressioni del giro UAT 7 (Fase 27): azioni del dettaglio evento.
@MainActor
final class UAT7UITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Eventi"].tap()  // F7: l'app si apre sulla Mappa
        return app
    }

    /// Apre il dettaglio dell'eroe della Home (un evento vicino, quindi con le coordinate). Al centro: in alto c'e' "Questo weekend".
    /// Torna il titolo dell'evento (la prima parte dell'etichetta dell'eroe).
    @discardableResult
    private func openHeroDetail(_ app: XCUIApplication) -> String {
        XCTAssertTrue(app.buttons.matching(identifier: "heart").firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["hero"].firstMatch.waitForExistence(timeout: 20))
        let hero = onScreen("hero", in: app)
        XCTAssertNotNil(hero, "nessun eroe nella Home")
        guard let hero else { return "" }
        let title = hero.label.components(separatedBy: ", ")[0]
        tap(hero, in: app)
        return title
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

    /// A2: "Aggiungi al calendario" in "Dettagli" apre il foglio di sistema precompilato col titolo dell'evento;
    /// Annulla lo chiude senza salvare. Il foglio gira in un altro processo, con la lingua del telefono: si cerca per
    /// identificatore (cancel-button, title-field), non per etichetta.
    func testAddToCalendarOpensTheSystemSheet() {
        let app = launch()
        let title = openHeroDetail(app)
        let add = app.buttons["Aggiungi al calendario"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "nessuna riga Aggiungi al calendario")
        for _ in 0..<3 where !add.isHittable { app.swipeUp() }
        add.tap()
        let cancel = app.buttons["cancel-button"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10), "il foglio del calendario non si e' aperto")
        let field = app.textFields["title-field"]
        XCTAssertTrue(field.exists)
        // Il campo puo' troncare il valore con i puntini: basta l'inizio del titolo.
        let shown = (field.value as? String ?? "").replacingOccurrences(of: "...", with: "").replacingOccurrences(of: "…", with: "")
        XCTAssertTrue(!shown.isEmpty && title.hasPrefix(shown), "titolo precompilato \(shown) invece di \(title)")
        shot(app, "calendar-sheet")
        cancel.tap()
        // Annulla puo' chiedere conferma per un evento precompilato: si scartano le modifiche.
        let discard = app.buttons.matching(NSPredicate(format: "label IN {'Elimina modifiche', 'Discard Changes'}")).firstMatch
        if discard.waitForExistence(timeout: 2) { discard.tap() }
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 5), "il foglio non si e' chiuso")
        XCTAssertTrue(add.exists)
        XCTAssertEqual(app.state, .runningForeground)
    }
}
