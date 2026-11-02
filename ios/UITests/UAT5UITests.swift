import XCTest

/// Regressioni del giro UAT 5 (Fase 27): la pagina Salvati.
@MainActor
final class UAT5UITests: LocalTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // Lingua e spiegazione della posizione fissate: nessun dialogo di sistema in mezzo.
        app.launchArguments += ["-AppleLanguages", "(it)", "-AppleLocale", "it_IT", "-fr.locationExplained", "YES"]
        app.launch()
        return app
    }

    /// Quanti pixel dell'area si staccano dal colore del suo angolo (lo sfondo) per luminosita': il testo scritto.
    private func inkPixels(of screenshot: XCUIScreenshot, in frame: CGRect) -> Int {
        guard let cg = screenshot.image.cgImage else { return 0 }
        let scale = CGFloat(cg.width) / screenshot.image.size.width
        let rect = CGRect(x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale).integral
        guard let crop = cg.cropping(to: rect) else { return 0 }
        var data = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
        let ctx = CGContext(
            data: &data, width: crop.width, height: crop.height, bitsPerComponent: 8, bytesPerRow: crop.width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
        func luma(_ i: Int) -> Double { 0.299 * Double(data[i]) + 0.587 * Double(data[i + 1]) + 0.114 * Double(data[i + 2]) }
        let background = luma(0)
        return stride(from: 0, to: data.count, by: 4).filter { abs(luma($0) - background) > 100 }.count
    }

    /// Bug 1: lo spazio del titolo grande c'era ma era vuoto, coperto dal fondo delle chip (steso anche sotto la barra).
    func testSavedLargeTitleIsActuallyDrawn() {
        let app = launch()
        app.tabBars.buttons["Salvati"].tap()
        XCTAssertTrue(app.buttons["Prossimi"].waitForExistence(timeout: 10))
        let title = app.navigationBars["Salvati"].staticTexts["Salvati"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(title.frame.height, 30, "il titolo grande ha l'altezza di un titolo grande")
        // Il titolo e' dentro lo spazio sopra le chip, che esistono sotto di lui.
        XCTAssertLessThan(title.frame.maxY, app.buttons["Prossimi"].frame.minY)
        XCTAssertGreaterThan(inkPixels(of: app.screenshot(), in: title.frame), 300, "nel riquadro del titolo non c'e' scritto nulla")
    }

    /// Salva il primo evento della Home e lo ritrova in Salvati sotto l'intestazione di un giorno.
    func testSavedGroupsByDayWithTheDayTile() {
        let app = launch()
        XCTAssertTrue(app.buttons.matching(identifier: "heart").firstMatch.waitForExistence(timeout: 20))
        // Il primo cuore dell'albero puo' stare su una pagina dell'eroe fuori schermo (x = -60 o 744): si tocca uno in vista.
        guard let heart = onScreen("heart", in: app) else { return XCTFail("nessun cuore in vista nella Home") }
        tap(heart, in: app)
        defer {
            // Lascia la lista com'era: toglie il cuore dalla Home. Se l'eroe lo ha portato fuori schermo, si aspetta che torni.
            app.tabBars.buttons["Home"].tap()
            for _ in 0..<40 {
                if let filled = onScreen("heart.fill", in: app) { tap(filled, in: app); break }
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
        app.tabBars.buttons["Salvati"].tap()
        XCTAssertTrue(app.buttons["Prossimi"].waitForExistence(timeout: 10))
        // Intestazione del giorno: "Sabato 31 ottobre 2026", oppure "In corso" se l'evento e' gia' iniziato.
        let heading = app.staticTexts.matching(NSPredicate(format: "label MATCHES '.* [0-9]{4}$' OR label == 'In corso'")).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 15), "nessuna intestazione di giorno")
        // Riepilogo sotto il titolo.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '1 evento' OR label MATCHES '[0-9]+ eventi.*'")).firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
