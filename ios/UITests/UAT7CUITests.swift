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
}
