import FuorirottaCore
import MapKit
import SwiftUI

final class PinAnnotation: NSObject, MKAnnotation {
    let id: Int
    let category: String?
    let coordinate: CLLocationCoordinate2D
    let title: String?

    init(_ pin: FuorirottaCore.MapPin) {
        id = pin.id
        category = pin.category
        coordinate = CLLocationCoordinate2D(latitude: pin.lat ?? 0, longitude: pin.lng ?? 0)
        title = pin.title
    }
}

/// MKMapView vera: il clustering e' nativo. Le annotazioni si aggiungono UNA volta e si aggiornano per differenza di id
/// (mai removeAll + add: SwiftUI chiama updateUIView a ogni cambio di stato).
struct EventMapView: UIViewRepresentable {
    let pins: [FuorirottaCore.MapPin]
    let onSelect: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSelect: onSelect) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.pointOfInterestFilter = .excludingAll
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "pin")
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "cluster")
        // Milano, 50 km di raggio (UI-SPEC "Mappa").
        map.setRegion(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 45.4642, longitude: 9.19),
                latitudinalMeters: 100_000, longitudinalMeters: 100_000
            ),
            animated: false
        )
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.onSelect = onSelect
        context.coordinator.apply(pins, to: map)
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {
        var onSelect: (Int) -> Void
        private var shown: [Int: PinAnnotation] = [:]

        init(onSelect: @escaping (Int) -> Void) { self.onSelect = onSelect }

        func apply(_ pins: [FuorirottaCore.MapPin], to map: MKMapView) {
            let delta = pinDelta(existing: Set(shown.keys), incoming: pins)
            if !delta.remove.isEmpty {
                map.removeAnnotations(delta.remove.compactMap { shown.removeValue(forKey: $0) })
            }
            if !delta.add.isEmpty {
                let fresh = delta.add.map(PinAnnotation.init)
                for a in fresh { shown[a.id] = a }
                map.addAnnotations(fresh)
            }
        }

        func mapView(_ map: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            if let cluster = annotation as? MKClusterAnnotation {
                let v = map.dequeueReusableAnnotationView(withIdentifier: "cluster", for: cluster) as! MKMarkerAnnotationView
                // Mai accent sulla mappa: bolla "foreground" con testo invertito.
                v.markerTintColor = UIColor(Color.foreground)
                v.glyphTintColor = UIColor(Color.background)
                v.glyphText = String(cluster.memberAnnotations.count)
                v.canShowCallout = false
                return v
            }
            guard let pin = annotation as? PinAnnotation else { return nil } // posizione utente: pallino di sistema
            let v = map.dequeueReusableAnnotationView(withIdentifier: "pin", for: pin) as! MKMarkerAnnotationView
            let visual = categoryVisual(pin.category)
            v.clusteringIdentifier = "event"
            v.markerTintColor = UIColor(visual.color)
            v.glyphImage = UIImage(systemName: visual.symbol)
            v.displayPriority = .defaultLow
            v.canShowCallout = false
            return v
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            defer { map.deselectAnnotation(view.annotation, animated: false) }
            if let cluster = view.annotation as? MKClusterAnnotation {
                map.showAnnotations(cluster.memberAnnotations, animated: true)
            } else if let pin = view.annotation as? PinAnnotation {
                onSelect(pin.id)
            }
        }
    }
}

struct MapScreen: View {
    @Environment(\.api) private var api

    // Raggio tarato il 2026-11-01: 32 km attorno a Milano danno circa 500 pin reali (31 km: 474, 33 km: 526).
    private let radiusKm = 32

    @State private var pins: [FuorirottaCore.MapPin] = []
    @State private var loading = true

    var body: some View {
        EventMapView(pins: pins) { _ in } // la scheda dell'evento arriva con 27-08
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                if loading {
                    ProgressView()
                        .padding(Spacing.md)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, Spacing.md)
                }
            }
            .task { await load() }
    }

    private func load() async {
        guard let api else { return }
        loading = true
        defer { loading = false }
        do {
            pins = try await api.mapPins(lat: 45.4642, lng: 9.19, radiusKm: radiusKm)
        } catch {
            // Primo piano di prova: con la mappa vuota il guasto si vede. L'errore con cache arriva con 27-08.
        }
    }
}
