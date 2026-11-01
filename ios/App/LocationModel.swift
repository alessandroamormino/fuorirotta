import CoreLocation
import MapKit
import Observation
import SwiftUI

/// Un luogo di partenza per Home. Le coordinate dei capoluoghi vengono dalla tabella `comuni` (Lombardia, DB locale):
/// `select name, latitude, longitude from comuni where region_name='Lombardia' and name in (...)`.
struct Place: Codable, Hashable {
    let name: String
    let latitude: Double
    let longitude: Double

    /// Milano e' il valore predefinito e il ripiego; poi gli altri capoluoghi lombardi in ordine alfabetico.
    static let curated: [Place] = [
        Place(name: "Milano", latitude: 45.4642, longitude: 9.19),
        Place(name: "Bergamo", latitude: 45.6983, longitude: 9.6773),
        Place(name: "Brescia", latitude: 45.5389, longitude: 10.2203),
        Place(name: "Como", latitude: 45.8103, longitude: 9.0861),
        Place(name: "Cremona", latitude: 45.1333, longitude: 10.0247),
        Place(name: "Lecco", latitude: 45.8533, longitude: 9.3905),
        Place(name: "Lodi", latitude: 45.3167, longitude: 9.5),
        Place(name: "Mantova", latitude: 45.1564, longitude: 10.7911),
        Place(name: "Monza", latitude: 45.5836, longitude: 9.2736),
        Place(name: "Pavia", latitude: 45.1853, longitude: 9.155),
        Place(name: "Sondrio", latitude: 46.1697, longitude: 9.87),
        Place(name: "Varese", latitude: 45.8167, longitude: 8.8333),
    ]
    static var milano: Place { curated[0] }
}

/// Dove si trova l'utente. Solo "quando l'app e' in uso", precisione ridotta (basta il chilometro).
/// Su disco vanno solo il NOME del luogo scelto e due flag: la coordinata del telefono resta in memoria (T-27-25).
@MainActor @Observable
final class LocationModel {
    private enum Key {
        static let explained = "fr.locationExplained"
        static let useDevice = "fr.useDeviceLocation"
        static let place = "fr.place"
    }

    /// Il luogo con cui si interroga il server: telefono (se attivo e noto), poi quello scelto, poi Milano.
    private(set) var place = Place.milano
    /// Il sistema ha negato (o limitato) la posizione.
    private(set) var denied = false
    /// Il sistema consente la posizione (la mappa mostra il pallino dell'utente).
    private(set) var authorised = false
    /// La spiegazione di primo avvio e' stata vista (una volta sola).
    private(set) var explained: Bool

    private var wantsDevice: Bool
    private var chosen: String?
    private var coordinate: CLLocationCoordinate2D?  // solo memoria
    private var deviceName: String?
    private let manager = CLLocationManager()
    private let bridge = Bridge()
    private let defaults = UserDefaults.standard

    init() {
        explained = defaults.bool(forKey: Key.explained)
        wantsDevice = defaults.bool(forKey: Key.useDevice)
        chosen = defaults.string(forKey: Key.place)
        // Precisa sul telefono (nome del comune, distanze, tempo di percorrenza); al server va arrotondata (coarseCoordinate).
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        bridge.onChange = { [weak self] in self?.authorizationChanged() }
        bridge.onLocation = { [weak self] coordinate in self?.received(coordinate) }
        manager.delegate = bridge
        denied = Self.isDenied(manager.authorizationStatus)
        authorised = Self.isAllowed(manager.authorizationStatus)
        refresh()
        if wantsDevice, Self.isAllowed(manager.authorizationStatus) { manager.requestLocation() }
    }

    /// Il luogo e' Milano per ripiego (non per scelta): Home spiega "Posizione non attiva...".
    var showsInactiveNotice: Bool {
        explained && (wantsDevice ? denied : chosen == nil)
    }

    var isUsingDevice: Bool { wantsDevice && !denied }

    /// Dove e' il telefono, solo se la posizione e' in uso e nota (distanza e tempo di viaggio della scheda del pin).
    var userCoordinate: CLLocationCoordinate2D? { isUsingDevice ? coordinate : nil }

    func markExplained() {
        explained = true
        defaults.set(true, forKey: Key.explained)
    }

    /// "Usa la mia posizione" / "Consenti la posizione": il sistema chiede solo la prima volta.
    func requestPermission() {
        markExplained()
        wantsDevice = true
        defaults.set(true, forKey: Key.useDevice)
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .denied, .restricted: denied = true
        default: manager.requestLocation()
        }
        refresh()
    }

    func select(_ place: Place) {
        markExplained()
        wantsDevice = false
        chosen = place.name
        defaults.set(false, forKey: Key.useDevice)
        defaults.set(place.name, forKey: Key.place)
        refresh()
    }

    /// La riga con il segno di spunta nel foglio: il telefono, oppure un capoluogo (Milano di default).
    var selectedCurated: String? { isUsingDevice ? nil : (chosen ?? Place.milano.name) }

    private func refresh() {
        if wantsDevice, !denied, let coordinate {
            place = Place(name: deviceName ?? String(localized: "La tua posizione"), latitude: coordinate.latitude, longitude: coordinate.longitude)
        } else {
            place = Place.curated.first { $0.name == chosen } ?? .milano
        }
    }

    private func authorizationChanged() {
        denied = Self.isDenied(manager.authorizationStatus)
        authorised = Self.isAllowed(manager.authorizationStatus)
        if wantsDevice, Self.isAllowed(manager.authorizationStatus) { manager.requestLocation() }
        refresh()
    }

    private func received(_ new: CLLocationCoordinate2D) {
        coordinate = new
        deviceName = nil
        refresh()
        Task {
            // Nome del luogo per l'intestazione; senza risposta resta "La tua posizione". Nessun log, nessun invio.
            let request = MKReverseGeocodingRequest(location: CLLocation(latitude: new.latitude, longitude: new.longitude))
            let name = try? await request?.mapItems.first?.addressRepresentations?.cityName
            guard coordinate?.latitude == new.latitude, coordinate?.longitude == new.longitude else { return }
            deviceName = name
            refresh()
        }
    }

    private static func isDenied(_ s: CLAuthorizationStatus) -> Bool { s == .denied || s == .restricted }
    private static func isAllowed(_ s: CLAuthorizationStatus) -> Bool { s == .authorizedWhenInUse || s == .authorizedAlways }

    /// Il delegato di CoreLocation e' un NSObject non isolato: riporta gli esiti sul MainActor.
    private final class Bridge: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
        @MainActor var onChange: (() -> Void)?
        @MainActor var onLocation: ((CLLocationCoordinate2D) -> Void)?

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            Task { @MainActor in onChange?() }
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let c = locations.last?.coordinate else { return }
            Task { @MainActor in onLocation?(c) }
        }

        func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {}  // si resta sul luogo corrente
    }
}
