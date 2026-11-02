import XCTest

/// Regressioni del giro UAT 4 (Fase 27): il foglio di accesso aperto dai Salvati e i tocchi sulle card.
@MainActor
final class UAT4UITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = localApp()
        app.launch()
        return app
    }

    /// Bug 2: "Accedi per sincronizzarli" da ospite chiudeva l'app (il foglio non vedeva la Session).
    func testSavedSignInInviteOpensSheet() {
        let app = launch()
        app.tabBars.buttons["Salvati"].tap()
        let invite = app.buttons["Accedi per sincronizzarli"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10))
        invite.tap()
        XCTAssertTrue(app.staticTexts["Accedi a Fuorirotta"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Bug 1: le aree di tocco delle schede della fila "Vicino a te" sconfinavano sulle vicine (la foto, piu' larga
    /// della scheda, allargava il collegamento): il cuore della N apriva la N+1.
    func testRailTapsLandOnTheirOwnCard() {
        let app = launch()
        let first = app.buttons.matching(identifier: "heart").firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20))
        // L'eroe: ogni diapositiva e' larga quanto lo schermo, la foto non allarga il collegamento.
        for hero in app.buttons.allElementsBoundByIndex where hero.frame.height > 340 && hero.frame.minX < 402 && hero.frame.maxX > 0 {
            XCTAssertEqual(hero.frame.width, 402, accuracy: 1, hero.label)
        }
        // Porta la fila "Vicino a te" in vista, poi la scorre di ~240 pt: compaiono schede con la foto.
        let rail = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'In corso'")).firstMatch
        for _ in 0..<4 where !rail.exists || rail.frame.maxY > 800 { app.swipeUp() }
        XCTAssertTrue(rail.waitForExistence(timeout: 20))
        let y = rail.frame.midY
        let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 300, dy: y))
        let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 50, dy: y))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.5)
        sleep(2)

        func cards() -> [XCUIElement] {
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'In corso' OR label BEGINSWITH 'Da '")).allElementsBoundByIndex
                .filter { abs($0.frame.height - 222) < 1 && $0.frame.maxX > 0 && $0.frame.minX < 402 }
        }
        let visible = cards()
        XCTAssertGreaterThan(visible.count, 2)
        // Ogni scheda ha la larghezza della locandina: niente foto che esce e copre le vicine.
        for c in visible { XCTAssertEqual(c.frame.width, 148, accuracy: 1, c.label) }

        // Il cuore di ogni scheda visibile salva QUELLA scheda e non apre nessun dettaglio.
        let hearts = app.buttons.matching(identifier: "heart").allElementsBoundByIndex
            .filter { abs($0.frame.minY - rail.frame.minY - 4) < 2 && $0.frame.minX > 0 && $0.frame.maxX < 402 }
        XCTAssertGreaterThan(hearts.count, 1)
        for h in hearts {
            let x = h.frame.minX
            h.tap()
            let saved = app.buttons.matching(identifier: "heart.fill").allElementsBoundByIndex.first { abs($0.frame.minX - x) < 1 }
            XCTAssertNotNil(saved, "il cuore in x=\(x) non si e' acceso")
            XCTAssertTrue(rail.exists, "il tocco sul cuore ha aperto un dettaglio")
            saved?.tap()  // lascia lo stato com'era
        }

        // Il tocco sulla scheda N apre il dettaglio dell'evento N (titolo = seconda parte dell'etichetta).
        for c in visible {
            let title = c.label.components(separatedBy: ", ")[1]
            // A sinistra del cuore, in basso: dentro la scheda e fuori dal cuore.
            let f = c.frame
            let x = max(f.minX + 20, 12), y = f.maxY - 20
            guard x < f.maxX - 20 else { continue }
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
            XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10), "non si e' aperto: \(title)")
            app.navigationBars.buttons.firstMatch.tap()
            XCTAssertTrue(rail.waitForExistence(timeout: 10))
        }
    }
}
