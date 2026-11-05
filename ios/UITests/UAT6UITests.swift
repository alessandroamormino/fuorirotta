import XCTest

/// Regressioni del giro UAT 6 (Fase 27): niente fasce fisse con fondo, riepilogo e chip scorrono via con la lista.
@MainActor
final class UAT6UITests: LocalTestCase {
    /// Salva alcuni eventi della Home, apre Salvati, scorre: il titolo di sistema resta, riepilogo e chip se ne vanno.
    func testSavedSummaryAndChipsScrollAwayWithTheList() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Eventi"].tap()  // F7: l'app si apre sulla Mappa
        let first = app.buttons.matching(identifier: "heart").firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20))
        var saved = 0
        // Cuori fuori schermo non si toccano: si scorre finche' ce n'e' uno raggiungibile.
        for _ in 0..<20 where saved < 6 {
            if let heart = onScreen("heart", in: app) {
                tap(heart, in: app)
                saved += 1
            } else {
                app.swipeUp()
            }
        }
        defer {
            // Lo scorrimento riduce la barra delle schede: risalire la fa tornare intera.
            for _ in 0..<3 { app.swipeDown() }
            app.tabBars.buttons["Eventi"].tap()
            for _ in 0..<14 {
                if let filled = onScreen("heart.fill", in: app) { tap(filled, in: app) } else { app.swipeDown(velocity: .slow) }
            }
        }
        // Lo scorrimento ha ridotto la barra (resta la scheda attiva) e in cima alla lista un altro swipeDown non la
        // riapre: un tocco sulla scheda ridotta la riapre; se serve si scende un poco e si risale piano.
        if !app.tabBars.buttons["Salvati"].exists { app.tabBars.buttons["Eventi"].tap() }
        for _ in 0..<5 where !app.tabBars.buttons["Salvati"].waitForExistence(timeout: 1) {
            app.swipeUp(velocity: .slow)
            app.swipeDown(velocity: .slow)
        }
        app.tabBars.buttons["Salvati"].tap()
        let chip = app.buttons["Prossimi"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        let summary = app.staticTexts.matching(NSPredicate(format: "label MATCHES '[0-9]+ event[oi].*'")).firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        // Servono almeno 3 salvati perche' la lista scorra (quelli gia' presenti piu' quelli appena messi).
        XCTAssertGreaterThanOrEqual(Int(summary.label.prefix { $0.isNumber }) ?? 0, 3, "pochi eventi salvati per scorrere: \(summary.label)")
        shot(app, "salvati-before")
        let startY = chip.frame.minY
        for _ in 0..<3 { app.swipeUp() }
        shot(app, "salvati-after")
        // Il riepilogo e le chip sono contenuto: salgono con la lista (prima restavano fissi).
        XCTAssertFalse(chip.isHittable && chip.frame.minY >= startY - 1, "le chip sono rimaste ferme: sono ancora una fascia fissa")
        // La barra di sistema col titolo (inline) c'e' ancora.
        XCTAssertTrue(app.navigationBars["Salvati"].exists)
    }

    /// Bug del giro 7: Passati e poi Prossimi deve tornare su Prossimi (le due chip nella stessa riga di List si attivavano insieme).
    func testSavedChipsSwitchBothWays() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Salvati"].tap()
        let upcoming = app.buttons["Prossimi"], past = app.buttons["Passati"]
        XCTAssertTrue(upcoming.waitForExistence(timeout: 10))
        past.tap()
        XCTAssertTrue(past.isSelected)
        upcoming.tap()
        XCTAssertTrue(upcoming.isSelected, "dopo Passati, il tocco su Prossimi non ci torna")
        XCTAssertFalse(past.isSelected)
    }
}
