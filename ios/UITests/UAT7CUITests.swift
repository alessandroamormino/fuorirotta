import XCTest

/// Giro UAT 7, tranche C, da ospite: telefono e mappa nel dettaglio, un comune qualsiasi come zona.
@MainActor
final class UAT7CUITests: LocalTestCase {
    /// Nel DB locale: un evento con telefono ("02485551") e coordinate, aperto fino al 2029.
    private static let phoneEvent = "Gallerie Leonardo da Vinci"

    private func launch() -> XCUIApplication {
        let app = localApp()
        app.launch()
        return app
    }

    /// Cerca un evento per titolo nella scheda Cerca e ne apre il dettaglio.
    private func openFromSearch(_ title: String, in app: XCUIApplication) {
        app.tabBars.buttons.element(boundBy: app.tabBars.buttons.count - 1).tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "nessun campo di ricerca")
        field.tap()
        field.typeText(title)
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "\(title) non e' tra i risultati")
        row.tap()
        XCTAssertTrue(app.staticTexts["Dettagli"].waitForExistence(timeout: 10), "il dettaglio non si e' aperto")
    }

    /// C1: la riga "Telefono" mostra il numero com'e' nella fonte e si tocca (etichetta "Chiama ...").
    func testPhoneRowInDetails() {
        let app = launch()
        openFromSearch(Self.phoneEvent, in: app)
        let call = app.buttons["Chiama 02485551"]
        XCTAssertTrue(call.waitForExistence(timeout: 10), "nessuna riga Telefono nel dettaglio")
        for _ in 0..<4 where !call.isHittable { app.swipeUp() }
        XCTAssertTrue(call.isHittable)
        shot(app, "telefono")
    }

    /// C2: nel dettaglio c'e' la mappa piccola; il tocco porta alla scheda Mappa, con la scheda del pin di quell'evento.
    func testMiniMapOpensTheMapTab() {
        let app = launch()
        openFromSearch(Self.phoneEvent, in: app)
        let mini = app.buttons["Mostra sulla mappa"]
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "nessuna mappa piccola nel dettaglio")
        for _ in 0..<4 where !mini.isHittable { app.swipeUp() }
        XCTAssertGreaterThan(mini.frame.height, 100)
        shot(app, "mappa-piccola")
        mini.tap()
        XCTAssertTrue(app.tabBars.buttons["Mappa"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["Mappa"].isSelected, "il tocco non ha aperto la scheda Mappa")
        let title = app.staticTexts[Self.phoneEvent]
        XCTAssertTrue(title.waitForExistence(timeout: 10), "la scheda del pin dell'evento non si e' aperta")
        Thread.sleep(forTimeInterval: 2)
        shot(app, "mappa-evento")
    }

    /// Sceglie la zona dal foglio "Quando e dove" (capsula di Eventi): cercando (`query`) oppure dalla lista dei capoluoghi.
    /// Il foglio resta aperto dopo il tocco (D-02) e si chiude col pulsante di conferma.
    private func pickZone(_ name: String, query: String? = nil, in app: XCUIApplication) {
        app.tabBars.buttons["Eventi"].tap()
        let change = app.buttons["Quando e dove"]
        XCTAssertTrue(change.waitForExistence(timeout: 20))
        change.tap()
        let bar = app.navigationBars["Quando e dove"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        if let query {
            let field = app.searchFields.firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 5), "nessun campo per cercare un comune")
            field.tap()
            field.typeText(query)
        }
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(name) non e' nel foglio della zona")
        if query != nil { shot(app, "zona-ricerca") }
        row.tap()
        XCTAssertTrue(bar.exists, "il foglio si e' chiuso dopo il tocco sulla zona")
        // Con la ricerca attiva la barra e' tutta della ricerca: resta solo la X (chiudi). Altrimenti c'e' il pulsante di conferma.
        if query != nil {
            app.buttons["Chiudi"].tap()
            if !bar.waitForNonExistence(timeout: 3) { app.buttons["when-where-done"].tap() }  // la X ha chiuso solo la ricerca
        } else {
            app.buttons["when-where-done"].tap()
        }
        XCTAssertTrue(bar.waitForNonExistence(timeout: 5))
    }

    /// 27.2: "Quando e dove" cambia la data di tutta l'app; in Eventi l'intestazione la segue.
    func testDateSheetDrivesHome() {
        let app = launch()
        app.tabBars.buttons["Eventi"].tap()
        let weekend = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Questo weekend'")).firstMatch
        XCTAssertTrue(weekend.waitForExistence(timeout: 20), "l'intestazione di Eventi non parte da Questo weekend")
        app.buttons["Quando e dove"].tap()
        XCTAssertTrue(app.navigationBars["Quando e dove"].waitForExistence(timeout: 5))
        let today = app.collectionViews.buttons["Oggi"]
        XCTAssertTrue(today.waitForExistence(timeout: 5), "nessuna riga Oggi nel foglio")
        today.tap()
        app.buttons["when-where-done"].tap()
        let header = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Oggi' AND label CONTAINS '· '")).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 20), "l'intestazione di Eventi non segue la data scelta")
        shot(app, "data-oggi")
    }

    /// 27.2: Cerca parte da Questo weekend (schermata d'attesa piu' chip) e legge e scrive la data dell'app (D-08, D-09).
    func testSearchSharesTheDate() {
        let app = launch()
        app.tabBars.buttons.element(boundBy: app.tabBars.buttons.count - 1).tap()
        let weekend = app.buttons["Questo weekend, tocca per togliere"]
        XCTAssertTrue(weekend.waitForExistence(timeout: 10), "Cerca non mostra la chip Questo weekend")
        app.buttons["Filtri"].tap()
        let today = app.buttons["Oggi"]
        XCTAssertTrue(today.waitForExistence(timeout: 5), "nessuna riga Oggi nei filtri")
        today.tap()
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(app.navigationBars["Filtri"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Oggi, tocca per togliere"].waitForExistence(timeout: 5), "la chip non segue la data scelta")
        // Dalla scheda Cerca di iOS 26 la barra e' ridotta al solo bottone della scheda di provenienza: tornare li' la riapre.
        if !app.tabBars.buttons["Eventi"].exists { app.tabBars.buttons.firstMatch.tap() }
        app.tabBars.buttons["Eventi"].tap()
        let header = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Oggi' AND label CONTAINS '· '")).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 20), "l'intestazione di Eventi non segue la data scelta in Cerca")
        shot(app, "cerca-data")
    }

    /// 27.2: la pillola della mappa mostra la data e apre "Quando e dove"; la data scelta li' e' anche quella di Eventi (D-08).
    func testMapPillChangesTheDate() {
        let app = launch()
        let pill = app.buttons["date-pill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 20), "la mappa non ha la pillola della data")
        XCTAssertEqual(pill.label, "Questo weekend")
        pill.tap()
        let bar = app.navigationBars["Quando e dove"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        app.collectionViews.buttons["Oggi"].tap()
        app.buttons["when-where-done"].tap()
        XCTAssertTrue(bar.waitForNonExistence(timeout: 5))
        XCTAssertEqual(pill.label, "Oggi")
        app.tabBars.buttons["Eventi"].tap()
        let header = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Oggi' AND label CONTAINS '· '")).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 20), "l'intestazione di Eventi non segue la data scelta sulla mappa")
        shot(app, "mappa-pillola")
    }

    /// 27.2: il tasto posizione della mappa apre "Quando e dove"; "Usa la mia posizione" ricentra senza chiudere il foglio.
    func testMapLocationButtonOpensTheSheet() {
        let app = launch()
        let button = app.buttons["Quando e dove"]
        XCTAssertTrue(button.waitForExistence(timeout: 20), "la mappa non ha il tasto posizione")
        button.tap()
        let bar = app.navigationBars["Quando e dove"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        let here = app.collectionViews.buttons["Usa la mia posizione"]
        XCTAssertTrue(here.waitForExistence(timeout: 5))
        here.tap()
        XCTAssertTrue(bar.exists, "il foglio si e' chiuso dopo il tocco su Usa la mia posizione")
        app.buttons["when-where-done"].tap()
        XCTAssertTrue(bar.waitForNonExistence(timeout: 5))
        shot(app, "mappa-posizione")
    }

    /// C3: un comune qualsiasi (fuori dai capoluoghi lombardi) diventa la zona della Home e il "Dove" dei filtri di Cerca.
    func testAnyComuneBecomesTheZone() {
        let app = launch()
        pickZone("Firenze", query: "Firen", in: app)
        defer { pickZone("Milano", in: app) }  // il simulatore torna alla zona di partenza degli altri test
        // La riga della data dell'intestazione ("<giorni> · Firenze") sta nell'etichetta del pulsante della zona.
        let place = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS '· Firenze'")).firstMatch
        XCTAssertTrue(place.waitForExistence(timeout: 20), "la Home non e' passata a Firenze")
        shot(app, "zona-home")
        // Cerca > Filtri > Dove: la zona e' la stessa.
        app.tabBars.buttons.element(boundBy: app.tabBars.buttons.count - 1).tap()
        let filters = app.buttons["Filtri"]
        XCTAssertTrue(filters.waitForExistence(timeout: 10))
        filters.tap()
        let near = app.buttons["Vicino a Firenze"]
        XCTAssertTrue(near.waitForExistence(timeout: 5), "il Dove dei filtri non e' Firenze")
        near.tap()
        shot(app, "zona-filtri")
        // Il foglio della zona si apre anche da qui, con il comune scelto in cima e la spunta.
        app.buttons["Cambia zona o usa la mia posizione"].tap()
        let chosen = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Firenze'")).firstMatch
        XCTAssertTrue(chosen.waitForExistence(timeout: 5))
        XCTAssertTrue(chosen.isSelected, "il comune scelto non ha la spunta")
        // Chiude i due fogli (zona, filtri) per la pulizia in Home.
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(app.navigationBars["Scegli la zona"].waitForNonExistence(timeout: 5))
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(app.navigationBars["Filtri"].waitForNonExistence(timeout: 5))
    }
}
