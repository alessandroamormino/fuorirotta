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

    /// B5: il tutorial compare al primo avvio, si sfoglia con Avanti fino a Inizia (Salta sempre visibile), poi la Mappa.
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
        let map = app.tabBars.buttons["Mappa"]
        XCTAssertTrue(waitHittable(map, timeout: 10), "dopo Inizia non c'e' la Mappa")
        XCTAssertTrue(map.isSelected, "dopo Inizia l'app non si apre sulla Mappa")
        app.terminate()

        let again = localApp(skipWelcome: false)
        again.launch()
        let againMap = again.tabBars.buttons["Mappa"]
        XCTAssertTrue(waitHittable(againMap, timeout: 15), "al secondo avvio la Mappa non e' raggiungibile")
        XCTAssertTrue(againMap.isSelected, "al secondo avvio l'app non si apre sulla Mappa")
        XCTAssertFalse(again.buttons["Avanti"].exists, "il tutorial e' tornato al secondo avvio")
        XCTAssertFalse(again.buttons["Salta"].exists, "il tutorial e' tornato al secondo avvio")
    }

    /// B5: "Salta" dalla prima pagina chiude il tutorial e porta alla Mappa.
    func testWelcomeSkipOpensTheMap() {
        let app = firstLaunch()
        let skip = app.buttons["Salta"]
        XCTAssertTrue(waitHittable(skip, timeout: 15), "nessun tutorial al primo avvio")
        skip.tap()
        XCTAssertTrue(skip.waitForNonExistence(timeout: 5), "Salta non chiude il tutorial")
        let map = app.tabBars.buttons["Mappa"]
        XCTAssertTrue(waitHittable(map, timeout: 10))
        XCTAssertTrue(map.isSelected, "dopo Salta l'app non si apre sulla Mappa")
    }

    /// B6 e F6: le statistiche non stanno piu' nel Profilo. Si aprono dall'icona grafico (l'unica in alto), in una
    /// schermata loro; Indietro torna al Profilo. Le impostazioni stanno nella pagina, niente ingranaggio.
    func testStatsHaveTheirOwnScreen() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Profilo"].tap()
        let stats = app.buttons["Statistiche"]
        XCTAssertTrue(waitHittable(stats, timeout: 10), "nessun pulsante Statistiche nel Profilo")
        XCTAssertFalse(app.buttons["Impostazioni"].exists, "nel Profilo c'e' ancora l'ingranaggio")
        XCTAssertTrue(app.staticTexts["Aspetto"].waitForExistence(timeout: 5), "le impostazioni non sono nel Profilo")
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

    /// D-11: con la scheda iniziale Eventi la barra legge Eventi, Mappa, Salvati, Profilo e l'app si apre su Eventi.
    /// L'argomento di avvio non si salva: niente da ripristinare.
    func testStartTabFromLaunchArgument() {
        let app = localApp()
        app.launchArguments += ["-fr.startTab", "events"]
        app.launch()
        let events = app.tabBars.buttons["Eventi"]
        XCTAssertTrue(waitHittable(events, timeout: 15), "nessuna scheda Eventi")
        let labels = (0..<4).map { app.tabBars.buttons.element(boundBy: $0).label }
        XCTAssertEqual(labels, ["Eventi", "Mappa", "Salvati", "Profilo"])
        XCTAssertTrue(events.isSelected, "l'app non si apre su Eventi")
        shot(app, "avvio-eventi")
    }
}
