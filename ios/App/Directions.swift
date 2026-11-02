import MapKit
import SwiftUI

/// Le app di navigazione (UAT7 A3). Mappe c'e' sempre; Google Maps e Waze solo se installate: `canOpenURL` le vede
/// perche' i loro schemi stanno in LSApplicationQueriesSchemes (project.yml).
enum DirectionsApp: CaseIterable {
    case apple, google, waze

    var title: Text {
        switch self {
        case .apple: Text("Mappe")
        case .google: Text(verbatim: "Google Maps")
        case .waze: Text(verbatim: "Waze")
        }
    }

    /// Il percorso in auto nell'app; nil per Mappe, che si apre con MapKit.
    func url(to spot: CLLocationCoordinate2D) -> URL? {
        switch self {
        case .apple: nil
        case .google: URL(string: "comgooglemaps://?daddr=\(spot.latitude),\(spot.longitude)&directionsmode=driving")
        case .waze: URL(string: "waze://?ll=\(spot.latitude),\(spot.longitude)&navigate=yes")
        }
    }

    @MainActor static var installed: [DirectionsApp] {
        allCases.filter { app in app.url(to: CLLocationCoordinate2D()).map { UIApplication.shared.canOpenURL($0) } ?? true }
    }
}

/// L'unico punto che apre le indicazioni (dettaglio e foglio del pin): percorso in auto verso il luogo dell'evento.
@MainActor func openDirections(_ app: DirectionsApp, to spot: CLLocationCoordinate2D, name: String) {
    if let url = app.url(to: spot) {
        UIApplication.shared.open(url)
        return
    }
    let item = MKMapItem(location: CLLocation(latitude: spot.latitude, longitude: spot.longitude), address: nil)
    item.name = name
    item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
}

/// "Indicazioni": con la sola Mappe apre subito; con altre app installate, il menu di sistema per scegliere.
/// Lo stile (bordato, piastrella) lo mette chi lo usa, come su un `Button`.
// ponytail: non ricorda l'ultima scelta (facoltativo in UAT7); aggiungere un @AppStorage se il menu stanca.
struct DirectionsButton<Label: View>: View {
    let spot: CLLocationCoordinate2D
    let name: String
    @ViewBuilder let label: Label

    var body: some View {
        let apps = DirectionsApp.installed
        if apps == [.apple] {
            Button { openDirections(.apple, to: spot, name: name) } label: { label }
        } else {
            Menu {
                ForEach(apps, id: \.self) { app in
                    Button { openDirections(app, to: spot, name: name) } label: { app.title }
                }
            } label: { label }
        }
    }
}
