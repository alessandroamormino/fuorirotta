import XCTest

/// Giro UAT 7, tranche B (seconda parte): il benvenuto del primo avvio (B5) e le statistiche fuori dal Profilo (B6).
/// Gli interessi e "Cosa segui" nel Profilo chiedono un account, che nel simulatore non c'e': restano alle prove sul telefono.
@MainActor
final class UAT7B2UITests: LocalTestCase {
    private let titles = ["Eventi vicino a te", "La mappa", "Salva col cuore", "Segui ciò che ti piace"]

    /// Aspetta che l'elemento sia davvero toccabile: le pagine vicine della TabView paginata stanno nell'albero anche fuori schermo.
    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        return XCTWaiter().wait(for: [done], timeout: timeout) == .completed
    }

    /// Avvio "come la prima volta": il tutorial azzerato, senza l'argomento che lo salta.
    private func firstLaunch() -> XCUIApplication {
        let app = localApp(skipWelcome: false)
        app.launchArguments.append("-fr.resetWelcome")
        app.launch()
        return app
    }

    /// B5: il tutorial compare al primo avvio, si sfoglia con Avanti fino a Inizia (Salta sempre visibile), poi la Home.
    /// Al secondo avvio, senza azzerare e senza saltare, non torna.
    func testWelcomeShowsOnFirstLaunchOnly() {
        let app = firstLaunch()
        for (i, title) in titles.enumerated() {
            XCTAssertTrue(waitHittable(app.staticTexts[title], timeout: i == 0 ? 15 : 5), "pagina \(i + 1): manca \(title)")
            XCTAssertTrue(app.buttons["Salta"].isHittable, "pagina \(i + 1): Salta non e' visibile")
            shot(app, "tutorial-\(i + 1)")
            let next = app.buttons[i == titles.count - 1 ? "Inizia" : "Avanti"]
            XCTAssertTrue(next.isHittable, "pagina \(i + 1): manca \(next.label)")
            next.tap()
        }
        XCTAssertTrue(app.buttons["Salta"].waitForNonExistence(timeout: 5), "dopo Inizia il tutorial e' ancora aperto")
        XCTAssertTrue(waitHittable(app.tabBars.buttons["Home"], timeout: 10), "dopo Inizia non c'e' la Home")
        app.terminate()

        let again = localApp(skipWelcome: false)
        again.launch()
        XCTAssertTrue(waitHittable(again.tabBars.buttons["Home"], timeout: 15), "al secondo avvio la Home non e' raggiungibile")
        XCTAssertFalse(again.buttons["Avanti"].exists, "il tutorial e' tornato al secondo avvio")
        XCTAssertFalse(again.buttons["Salta"].exists, "il tutorial e' tornato al secondo avvio")
    }

    /// B5: "Salta" dalla prima pagina chiude il tutorial e porta alla Home.
    func testWelcomeSkipGoesHome() {
        let app = firstLaunch()
        let skip = app.buttons["Salta"]
        XCTAssertTrue(waitHittable(skip, timeout: 15), "nessun tutorial al primo avvio")
        skip.tap()
        XCTAssertTrue(skip.waitForNonExistence(timeout: 5), "Salta non chiude il tutorial")
        XCTAssertTrue(waitHittable(app.tabBars.buttons["Home"], timeout: 10))
    }

    /// B6: le statistiche non stanno piu' nel Profilo. Si aprono dall'icona grafico in alto a destra, accanto
    /// all'ingranaggio (stessa capsula), in una schermata loro; Indietro torna al Profilo.
    func testStatsHaveTheirOwnScreen() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Profilo"].tap()
        let stats = app.buttons["Statistiche"], settings = app.buttons["Impostazioni"]
        XCTAssertTrue(waitHittable(stats, timeout: 10), "nessun pulsante Statistiche nel Profilo")
        XCTAssertTrue(settings.exists)
        XCTAssertEqual(stats.frame.midY, settings.frame.midY, accuracy: 1, "Statistiche e Impostazioni non sono sulla stessa riga")
        XCTAssertLessThan(stats.frame.maxX, settings.frame.minX + 1, "Statistiche deve stare a sinistra dell'ingranaggio")
        // Le schede delle statistiche (o il loro stato vuoto) non sono nel Profilo.
        let content = app.staticTexts.matching(NSPredicate(format: "label IN {'Ancora niente da mostrare', \"Attività dell'anno\"}")).firstMatch
        XCTAssertFalse(content.exists, "le statistiche sono ancora nel Profilo")
        shot(app, "profilo")
        stats.tap()
        XCTAssertTrue(app.navigationBars["Statistiche"].waitForExistence(timeout: 5), "la schermata Statistiche non si e' aperta")
        XCTAssertTrue(content.waitForExistence(timeout: 10), "la schermata Statistiche e' vuota")
        shot(app, "statistiche")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(waitHittable(stats), "Indietro non torna al Profilo")
    }
}
