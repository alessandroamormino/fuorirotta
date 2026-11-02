import XCTest

/// Regressioni del giro UAT 4 (Fase 27): il foglio di accesso aperto dai Salvati e i tocchi sulle card.
@MainActor
final class UAT4UITests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // Lingua e spiegazione della posizione fissate: nessun dialogo di sistema in mezzo.
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
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
}
