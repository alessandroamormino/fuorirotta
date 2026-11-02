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

struct NotLocal: LocalizedError {
    var errorDescription: String? {
        "Test UI fermati: questa build non punta al server locale. Usa lo schema \"Fuorirotta Locale\" (configurazione DebugLocal)."
    }
}
