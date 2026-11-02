import XCTest

/// A1 (UAT7): i test UI salvano e tolgono eventi, quindi non devono MAI girare contro fuori-rotta.it.
/// `LOCAL_API` esiste solo nella configurazione DebugLocal del target dei test (project.yml), la stessa che fa puntare
/// l'app al server del Mac (lo script DebugLocal). `xcodebuild test` costruisce app e test con UNA configurazione:
/// con lo schema o la configurazione sbagliati ogni test fallisce qui, prima di lanciare l'app.
// ponytail: guarda la configurazione della build, non l'URL dentro l'app installata; basta finche' app e test si
// costruiscono insieme (build-for-testing / test). Se un giorno si provano binari presi altrove, leggere FRAPIBaseURL.
class LocalTestCase: XCTestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()
        #if !LOCAL_API
        throw NotLocal()
        #endif
    }
}

extension LocalTestCase {
    /// L'app dei test: italiano, spiegazione della posizione gia' vista, tutorial e scelta degli interessi saltati (UAT7 B5),
    /// cosi' nessuna schermata a tutto schermo copre la Home. `skipWelcome: false` lascia decidere all'app.
    func localApp(skipWelcome: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES", "-fr.skipInterests", "YES"]
        if skipWelcome { app.launchArguments += ["-fr.welcomeSeen", "YES"] }
        return app
    }

    /// Il primo bottone con quell'identificatore dentro la finestra visibile (tra la cima e la barra delle schede).
    /// Il carosello dell'eroe avanza da solo: le sue pagine fuori schermo sono nell'albero ma non si toccano.
    func onScreen(_ id: String, in app: XCUIApplication) -> XCUIElement? {
        let w = app.frame
        return app.buttons.matching(identifier: id).allElementsBoundByIndex.first {
            $0.frame.minY > 50 && $0.frame.maxY < w.height - 140 && $0.frame.minX >= 0 && $0.frame.maxX <= w.width
        }
    }

    /// Allegato al risultato; con UAT_SHOT_DIR (passato come TEST_RUNNER_UAT_SHOT_DIR) anche il PNG su disco.
    func shot(_ app: XCUIApplication, _ name: String) {
        let s = app.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = ProcessInfo.processInfo.environment["UAT_SHOT_DIR"] {
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
    }

    /// Tocco per coordinate: la lista cambia sotto le dita (il cuore pieno prende il posto di quello vuoto), un indice di elemento no.
    func tap(_ element: XCUIElement, in app: XCUIApplication) {
        let f = element.frame
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.midX, dy: f.midY)).tap()
        Thread.sleep(forTimeInterval: 0.5)
    }
}

struct NotLocal: LocalizedError {
    var errorDescription: String? {
        "Test UI fermati: questa build non punta al server locale. Usa lo schema \"Fuorirotta Locale\" (configurazione DebugLocal)."
    }
}
