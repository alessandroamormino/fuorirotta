import XCTest

/// Regressioni del giro UAT 4 (Fase 27): il foglio di accesso aperto dai Salvati e i tocchi sulle card.
@MainActor
final class UAT4UITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Eventi"].tap()  // F7: l'app si apre sulla Mappa
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
        // L'eroe: ogni diapositiva ha i margini della pagina (Spacing.md per lato), la foto non allarga il collegamento.
        let w = app.frame.width
        let heroes = buttons(in: app) { $0.identifier == "hero" && $0.frame.maxX > 0 && $0.frame.minX < w }
        XCTAssertFalse(heroes.isEmpty, "nessun eroe nella Home")
        for hero in heroes { XCTAssertEqual(hero.frame.width, w - 2 * 16, accuracy: 1, hero.label) }
        // Porta la fila "Vicino a te" in vista, poi la scorre di ~240 pt: compaiono schede con la foto.
        let rail = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'In corso'")).firstMatch
        // Gesti lenti (senza lancio) e una pausa dopo ciascuno: uno swipe veloce lascia la pagina in corsa e la fila
        // puo' finire sopra lo schermo prima del tocco (su un'installazione nuova succedeva).
        XCTAssertTrue(rail.waitForExistence(timeout: 20))
        for _ in 0..<12 {
            let f = rail.frame
            if f.minY > 150 && f.minY < 600 { break }
            if f.minY <= 150 { app.swipeDown(velocity: .slow) } else { app.swipeUp(velocity: .slow) }
            Thread.sleep(forTimeInterval: 1)
        }
        XCTAssertTrue(rail.frame.minY > 150 && rail.frame.minY < 600, "la fila Vicino a te non e' in vista: \(rail.frame)")
        let y = rail.frame.midY
        let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 300, dy: y))
        let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 50, dy: y))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.5)
        sleep(2)

        // Fotografie prese una volta: frame ed etichette restano quelli visti prima di ogni tocco.
        let visible = buttons(in: app) {
            ($0.label.hasPrefix("In corso") || $0.label.hasPrefix("Da ")) && abs($0.frame.height - 222) < 1 && $0.frame.maxX > 0 && $0.frame.minX < 402
        }
        XCTAssertGreaterThan(visible.count, 2)
        // Ogni scheda ha la larghezza della locandina: niente foto che esce e copre le vicine.
        for c in visible { XCTAssertEqual(c.frame.width, 148, accuracy: 1, c.label) }

        // Il cuore di ogni scheda visibile salva QUELLA scheda e non apre nessun dettaglio.
        let railTop = rail.frame.minY
        // Vuoti o pieni: i salvataggi del simulatore sopravvivono ai giri, quindi il test parte da qualunque stato.
        let hearts = buttons(in: app) {
            ($0.identifier == "heart" || $0.identifier == "heart.fill") && abs($0.frame.minY - railTop - 4) < 2 && $0.frame.minX > 0 && $0.frame.maxX < 402
        }
        XCTAssertGreaterThan(hearts.count, 1)
        for h in hearts {
            let x = h.frame.minX
            let flipped = h.identifier == "heart" ? "heart.fill" : "heart"
            tap(h, in: app)
            let toggled = buttons(in: app) { $0.identifier == flipped && abs($0.frame.minX - x) < 1 && abs($0.frame.minY - h.frame.minY) < 2 }.first
            XCTAssertNotNil(toggled, "il cuore in x=\(x) non ha cambiato stato")
            XCTAssertTrue(rail.exists, "il tocco sul cuore ha aperto un dettaglio")
            if let toggled { tap(toggled, in: app) }  // lascia lo stato com'era
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
