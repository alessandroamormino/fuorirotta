import XCTest

/// Giro UAT 7, tranche B (seconda parte): il benvenuto del primo avvio (B5). Gli interessi chiedono un account, che nel
/// simulatore non c'e': restano alle prove sul telefono.
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
}
