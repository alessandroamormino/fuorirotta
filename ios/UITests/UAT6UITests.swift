import XCTest

/// Regressioni del giro UAT 6 (Fase 27): niente fasce fisse con fondo, riepilogo e chip scorrono via con la lista.
@MainActor
final class UAT6UITests: LocalTestCase {
    /// Salva alcuni eventi della Home, apre Salvati, scorre: il titolo di sistema resta, riepilogo e chip se ne vanno.
    func testSavedSummaryAndChipsScrollAwayWithTheList() {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
        app.launch()
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
            app.tabBars.buttons["Home"].tap()
            for _ in 0..<14 {
                if let filled = onScreen("heart.fill", in: app) { tap(filled, in: app) } else { app.swipeDown(velocity: .slow) }
            }
        }
        for _ in 0..<3 { app.swipeDown() }
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
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
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

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = app.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        // Facoltativo: UAT_SHOT_DIR (passato come TEST_RUNNER_UAT_SHOT_DIR) salva anche i PNG su disco.
        if let dir = ProcessInfo.processInfo.environment["UAT_SHOT_DIR"] {
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
    }
}
