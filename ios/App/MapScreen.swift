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

/// Chiede alla mappa di spostarsi: cambia `id` a ogni richiesta (cambio luogo, pulsante di ricentratura).
struct MapFocus: Equatable {
    var id = 0
    /// Prima il pallino dell'utente (se la posizione e' consentita), poi il luogo.
    var userFirst = false
}

/// MKMapView vera: il clustering e' nativo. Le annotazioni si aggiungono UNA volta e si aggiornano per differenza di id
/// (mai removeAll + add: SwiftUI chiama updateUIView a ogni cambio di stato).
struct EventMapView: UIViewRepresentable {
    let pins: [FuorirottaCore.MapPin]
    let center: CLLocationCoordinate2D
    let focus: MapFocus
    let showsUser: Bool
    let mapType: MKMapType
    /// Vista inclinata (tasto 3D): pitch della camera di sistema.
    let tilted: Bool
    /// Il pin della scheda aperta: resta selezionato (animazione e titolo di sistema) finche' la scheda non si chiude.
    let selectedID: Int?
    let onSelect: (Int) -> Void
    /// Un tocco sulla mappa vuota deseleziona il pin: la scheda si chiude.
    let onDeselect: () -> Void
    /// Gli id dei pin di un gruppo che non si puo' dividere con lo zoom.
    let onCluster: ([Int]) -> Void
    let onVisibleCount: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = showsUser
        map.pointOfInterestFilter = .excludingAll
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "pin")
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "cluster")
        // Zoom massimo a 200 m: oltre non si divide piu' niente, e il gruppo si apre in un elenco.
        map.cameraZoomRange = MKMapView.CameraZoomRange(minCenterCoordinateDistance: Coordinator.maxZoomDistance - 50)
        map.setRegion(MKCoordinateRegion(center: center, latitudinalMeters: 100_000, longitudinalMeters: 100_000), animated: false)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let c = context.coordinator
        c.parent = self
        if map.showsUserLocation != showsUser { map.showsUserLocation = showsUser }
        if map.mapType != mapType { map.mapType = mapType }
        if tilted != c.tilted {
            c.tilted = tilted
            if let camera = map.camera.copy() as? MKMapCamera {
                camera.pitch = tilted ? 60 : 0
                map.setCamera(camera, animated: true)
            }
        }
        // Scheda chiusa: il pin torna normale. Selezionarlo lo fa la mappa stessa, col tocco.
        if selectedID == nil { for a in map.selectedAnnotations { map.deselectAnnotation(a, animated: true) } }
        if focus != c.focus {
            c.focus = focus
            var target = center
            if focus.userFirst, showsUser, let here = map.userLocation.location?.coordinate, CLLocationCoordinate2DIsValid(here) {
                target = here
            }
            // Raggio di 50 km attorno al punto (UI-SPEC "Mappa").
            map.setRegion(MKCoordinateRegion(center: target, latitudinalMeters: 100_000, longitudinalMeters: 100_000), animated: true)
        }
        c.apply(pins, to: map)
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {
        /// Sotto questa distanza della camera (m) la mappa e' al massimo zoom utile.
        static let maxZoomDistance: CLLocationDistance = 250
        /// Pin a meno di 10 m l'uno dall'altro sono lo stesso punto (stesso centro di comune).
        static let samePlaceMeters = 10.0

        var parent: EventMapView
        var focus: MapFocus
        var tilted = false
        private var shown: [Int: PinAnnotation] = [:]

        init(_ parent: EventMapView) {
            self.parent = parent
            focus = parent.focus
        }

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
            if !delta.add.isEmpty || !delta.remove.isEmpty { reportVisible(map) }
        }

        /// Quanti pin stanno nella vista (per il messaggio di zona vuota). Fuori dall'aggiornamento della vista.
        private func reportVisible(_ map: MKMapView) {
            let count = map.annotations(in: map.visibleMapRect).filter { $0 is PinAnnotation }.count
            let report = parent.onVisibleCount
            DispatchQueue.main.async { report(count) }
        }

        func mapView(_ map: MKMapView, regionDidChangeAnimated animated: Bool) { reportVisible(map) }

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
            // Selezionato: ingrandimento e titolo sotto il pin, quelli di sistema (come Mappe).
            v.titleVisibility = .adaptive
            v.subtitleVisibility = .hidden
            return v
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            if let cluster = view.annotation as? MKClusterAnnotation {
                map.deselectAnnotation(cluster, animated: false)
                let members = cluster.memberAnnotations.compactMap { $0 as? PinAnnotation }
                if cannotSplit(members, in: map) {
                    parent.onCluster(members.map(\.id))
                } else {
                    // ponytail: l'animazione e' quella di sistema di MapKit, non una molla nostra.
                    map.showAnnotations(cluster.memberAnnotations, animated: true)
                }
            } else if let pin = view.annotation as? PinAnnotation {
                liftAboveSheet(pin, in: map)
                parent.onSelect(pin.id)
            }
        }

        /// Un altro pin deseleziona il primo e seleziona il nuovo nello stesso giro: si guarda dopo. Se non resta
        /// nulla di selezionato (e la scheda e' ancora aperta) e' stato un tocco sulla mappa vuota.
        func mapView(_ map: MKMapView, didDeselect view: MKAnnotationView) {
            guard view.annotation is PinAnnotation else { return }
            Task { @MainActor [weak self, weak map] in
                guard let self, let map, map.selectedAnnotations.isEmpty, self.parent.selectedID != nil else { return }
                self.parent.onDeselect()
            }
        }

        /// Il foglio basso copre quasi la meta' inferiore dello schermo: un pin piu' in basso della meta' si porta in alto.
        private func liftAboveSheet(_ pin: PinAnnotation, in map: MKMapView) {
            let point = map.convert(pin.coordinate, toPointTo: map)
            guard point.y > map.bounds.height * 0.5 else { return }
            let shifted = CGPoint(x: map.bounds.midX, y: map.bounds.midY + point.y - map.bounds.height * 0.3)
            map.setCenter(map.convert(shifted, toCoordinateFrom: map), animated: true)
        }

        /// Gli eventi geocodificati sullo stesso centro di comune non si separano mai con lo zoom: restano un gruppo
        /// a ogni livello. Un tocco su un gruppo cosi' (o a zoom massimo) apre l'elenco invece di non fare nulla.
        private func cannotSplit(_ members: [PinAnnotation], in map: MKMapView) -> Bool {
            if map.camera.centerCoordinateDistance <= Self.maxZoomDistance { return true }
            guard let first = members.first else { return false }
            let points = members.map { MKMapPoint($0.coordinate) }
            let rect = points.dropFirst().reduce(MKMapRect(origin: points[0], size: MKMapSize(width: 0, height: 0))) {
                $0.union(MKMapRect(origin: $1, size: MKMapSize(width: 0, height: 0)))
            }
            let meters = hypot(rect.width, rect.height) / MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
            return meters <= Self.samePlaceMeters
        }
    }
}

/// Il foglio che si apre toccando un pin, come la scheda luogo di Mappe: in basso (380 pt, la mappa resta toccabile)
/// titolo, tre azioni, quattro informazioni e la foto; tirato su (`.large`) diventa il dettaglio dell'evento, con
/// le stesse viste di EventDetailView. Fondo di vetro di sistema.
struct PinSheet: View {
    static let compactHeight: CGFloat = 380
    static let compact = PresentationDetent.height(compactHeight)

    let onClose: () -> Void

    @Environment(\.api) private var api
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(LocationModel.self) private var location
    @Environment(SavesModel.self) private var saves
    @State private var event: Event
    @State private var detent = PresentationDetent.height(compactHeight)
    @State private var travelTime: TimeInterval?

    init(pin: FuorirottaCore.MapPin, onClose: @escaping () -> Void) {
        _event = State(initialValue: asEvent(pin))
        self.onClose = onClose
    }

    private var category: String? { event.canonicalCategory ?? event.category }

    private var spot: CLLocationCoordinate2D? {
        guard let lat = event.resolvedLatitude ?? event.latitude, let lng = event.resolvedLongitude ?? event.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    /// T-27-28: solo http e https.
    private var siteURL: URL? {
        guard let raw = event.sourceUrl, raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://") else { return nil }
        return URL(string: raw)
    }

    var body: some View {
        Group {
            if detent == .large {
                EventStack { EventDetailView(event: event, onClose: onClose) }
            } else {
                card
            }
        }
        .presentationDetents([Self.compact, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        // La mappa dietro resta toccabile finche' il foglio e' basso: un altro pin cambia il contenuto.
        .presentationBackgroundInteraction(.enabled(upThrough: Self.compact))
        .task(id: event.id) { await fetch() }
        .task(id: event.id) { await loadTravelTime() }
    }

    // MARK: scheda bassa

    private var card: some View {
        ScrollView {
            VStack(spacing: Spacing.md) {
                header
                actions
                infoRow
                if event.imageUrl != nil {
                    RemoteImage(url: event.imageUrl, category: category, size: CGSize(width: 440, height: 260))
                        .frame(maxWidth: .infinity)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.card))
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
    }

    /// Condividi a sinistra, chiudi a destra (due cerchi di vetro), titolo e categoria al centro.
    private var header: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            GlassEffectContainer(spacing: Spacing.sm) {
                ShareLink(item: URL(string: "https://fuori-rotta.it/eventi/\(event.id)")!) {
                    circleIcon("square.and.arrow.up")
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Condividi evento")
            }
            VStack(spacing: 2) {
                Text(verbatim: event.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Color.foreground)
                    .multilineTextAlignment(.center)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    .accessibilityAddTraits(.isHeader)
                if let category {
                    Text(verbatim: categoryLabel(category))
                        .font(.subheadline)
                        .foregroundStyle(Color.foregroundSecondary)
                }
            }
            .frame(maxWidth: .infinity)
            GlassEffectContainer(spacing: Spacing.sm) {
                Button(action: onClose) { circleIcon("xmark") }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Chiudi")
            }
        }
    }

    private func circleIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.label.weight(.semibold))
            .foregroundStyle(Color.primary)
            .frame(width: 44, height: 44)
            .contentShape(Circle())
    }

    /// Tre bottoni uguali, alti, icona sopra e testo sotto: Indicazioni (pieno, col tempo in auto), Sito, Salva.
    private var actions: some View {
        let saved = saves.isSaved(event.id)
        return HStack(spacing: Spacing.sm) {
            let directions = travelTime.map(formatTravelTime) ?? String(localized: "Indicazioni")
            if let spot {
                DirectionsButton(spot: spot, name: event.locationName ?? event.title) {
                    tileLabel("car.fill", directions, fill: Color.accentToken)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(travelTime.map { String(localized: "Indicazioni, \(formatTravelTime(seconds: $0)) in auto") } ?? String(localized: "Indicazioni"))
            } else {
                tile("car.fill", directions, label: String(localized: "Indicazioni"), fill: Color.accentToken, enabled: false) {}
            }
            // Senza indirizzo del sito il bottone resta, spento (il dettaglio non ha un calendario da richiamare).
            tile("safari", String(localized: "Sito"), label: String(localized: "Apri il sito dell'evento"), fill: nil, enabled: siteURL != nil) {
                if let siteURL { openURL(siteURL) }
            }
            tile(
                saved ? "heart.fill" : "heart", saved ? String(localized: "Salvato") : String(localized: "Salva"),
                label: saved ? String(localized: "Rimuovi dai salvati") : String(localized: "Salva evento"), fill: saved ? Color.heart : nil, enabled: true
            ) {
                Task { await saves.toggle(event) }
            }
            .sensoryFeedback(.impact(flexibility: .soft), trigger: saved)
        }
    }

    private func tile(
        _ symbol: String, _ title: String, label: String, fill: Color?, enabled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) { tileLabel(symbol, title, fill: fill) }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }

    private func tileLabel(_ symbol: String, _ title: String, fill: Color?) -> some View {
        VStack(spacing: 2) {
            Image(systemName: symbol).font(.title3).accessibilityHidden(true)
            Text(verbatim: title).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .foregroundStyle(fill == nil ? Color.accentToken : Color.white)
        .frame(maxWidth: .infinity, minHeight: 60)
        .background(fill ?? Color.accentToken.opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.media))
        .contentShape(RoundedRectangle(cornerRadius: Radius.media))
    }

    /// Quattro colonne: etichetta grigia sopra, valore sotto (Quando / Dove / Categoria / Distanza). Mancano quelle senza dato.
    private var infoRow: some View {
        let columns = infoColumns
        return Group {
            if typeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .center, spacing: Spacing.md) {
                    ForEach(columns, id: \.label) { column($0) }
                }
            } else {
                HStack(alignment: .top, spacing: Spacing.sm) {
                    ForEach(columns, id: \.label) { column($0) }
                }
            }
        }
    }

    private struct Info {
        let label: String
        let value: String
        var color: Color = Color.foreground
    }

    private var infoColumns: [Info] {
        var out: [Info] = []
        let when = placeCardWhen(dateStart: event.dateStart, dateEnd: event.dateEnd, today: romeToday(), locale: .app)
        if !when.label.isEmpty { out.append(Info(label: String(localized: "Quando"), value: when.label, color: when.isActive ? Color.success : Color.foreground)) }
        if let place = [event.locationName, event.address].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
            out.append(Info(label: String(localized: "Dove"), value: place))
        }
        if let category { out.append(Info(label: String(localized: "Categoria"), value: categoryLabel(category))) }
        if let here = location.userCoordinate, let spot {
            let meters = CLLocation(latitude: here.latitude, longitude: here.longitude)
                .distance(from: CLLocation(latitude: spot.latitude, longitude: spot.longitude))
            out.append(Info(label: String(localized: "Distanza"), value: formatDistance(meters: meters, locale: .app)))
        }
        return out
    }

    private func column(_ info: Info) -> some View {
        VStack(spacing: 4) {
            Text(verbatim: info.label).font(.footnote).foregroundStyle(Color.foregroundSecondary)
            Text(verbatim: info.value)
                .font(.callout.weight(.semibold))
                .foregroundStyle(info.color)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: rete

    /// Il pin porta solo i campi minimi: il resto (fine dell'evento, descrizione, sito) arriva da qui, senza spinner.
    private func fetch() async {
        guard let api, case .found(let fresh)? = try? await api.event(id: event.id) else { return }
        event = fresh
    }

    /// Tempo in auto dalla posizione del telefono, di sistema. Senza posizione o senza risposta resta "Indicazioni".
    private func loadTravelTime() async {
        travelTime = nil
        guard let here = location.userCoordinate, let spot else { return }
        let request = MKDirections.Request()
        request.source = MKMapItem(location: CLLocation(latitude: here.latitude, longitude: here.longitude), address: nil)
        request.destination = MKMapItem(location: CLLocation(latitude: spot.latitude, longitude: spot.longitude), address: nil)
        request.transportType = .automobile
        travelTime = try? await MKDirections(request: request).calculateETA().expectedTravelTime
    }
}

/// Gruppo che non si puo' dividere: gli eventi in elenco, ciascuno apre il dettaglio.
struct ClusterListSheet: View {
    let events: [Event]

    var body: some View {
        EventStack {
            List(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                .listStyle(.plain)
                .navigationTitle(Text(verbatim: events.count == 1 ? String(localized: "1 evento") : String(localized: "\(events.count) eventi")))
                .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

private func asEvent(_ pin: FuorirottaCore.MapPin) -> Event {
    Event(
        id: pin.id, title: pin.title, dateStart: pin.dateStart, imageUrl: pin.imageUrl,
        locationName: pin.locationName, category: pin.category, latitude: pin.lat, longitude: pin.lng)
}

struct MapScreen: View {
    // Fonte della mappa: raggio attorno al luogo (27-SPIKE.md, "Map source: radius"). 50 km come da UI-SPEC.
    private let radiusKm = 50

    private enum Phase { case loading, loaded, failed }
    private struct Group {
        let events: [Event]
    }
    /// Un solo foglio alla volta: un pin o un gruppo che non si divide. L'identita' e' fissa, cosi' passare da un pin
    /// all'altro cambia il contenuto senza chiudere e riaprire il foglio.
    private enum MapSheet: Identifiable {
        case pin(FuorirottaCore.MapPin)
        case group(Group)
        var id: String { "map-sheet" }
    }

    @Environment(\.api) private var api
    @Environment(LocationModel.self) private var location

    @State private var pins: [FuorirottaCore.MapPin] = []
    @State private var phase = Phase.loading
    @State private var offline = false
    @State private var filter: String?  // nil = Tutte
    @State private var sheet: MapSheet?
    @AppStorage(MapStyleChoice.key) private var mapStyle = MapStyleChoice.hybrid
    @State private var tilted = false
    @State private var focus = MapFocus()
    @State private var visibleCount: Int?

    private var selectedPinID: Int? {
        if case .pin(let pin) = sheet { pin.id } else { nil }
    }

    private var shownPins: [FuorirottaCore.MapPin] {
        guard let filter else { return pins }
        return pins.filter { ($0.category ?? "Altro") == filter }
    }

    var body: some View {
        EventStack {
            ZStack {
                EventMapView(
                    pins: shownPins,
                    center: CLLocationCoordinate2D(latitude: location.place.latitude, longitude: location.place.longitude),
                    focus: focus,
                    showsUser: location.authorised,
                    mapType: mapStyle.mapType,
                    tilted: tilted,
                    selectedID: selectedPinID,
                    onSelect: { id in sheet = pins.first { $0.id == id }.map(MapSheet.pin) },
                    onDeselect: { if case .pin = sheet { sheet = nil } },
                    onCluster: { ids in
                        let members = pins.filter { ids.contains($0.id) }.sorted { $0.dateStart < $1.dateStart }.map(asEvent)
                        sheet = .group(Group(events: members))
                    },
                    onVisibleCount: { if visibleCount != $0 { visibleCount = $0 } }
                )
                .ignoresSafeArea()
                chrome
                overlayMessage
            }
            // Mappa a tutto schermo: la barra del titolo non serve, il dettaglio la mostra da solo.
            .toolbar(.hidden, for: .navigationBar)
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .pin(let pin):
                PinSheet(pin: pin, onClose: { sheet = nil })
                    .id(pin.id)
            case .group(let group):
                ClusterListSheet(events: group.events)
            }
        }
        .task(id: location.place) { await load() }
        .onChange(of: location.place) { focus = MapFocus(id: focus.id + 1) }
        .onChange(of: filter) { sheet = nil }
        .sensoryFeedback(.selection, trigger: filter)
    }

    // MARK: vetro: chip, ricentra, avvisi

    private var chrome: some View {
        GlassEffectContainer(spacing: Spacing.sm) {
            VStack(spacing: Spacing.sm) {
                chips
                if phase == .loading {
                    ProgressView()
                        .padding(Spacing.md)
                        .glassEffect(.regular, in: .capsule)
                        .accessibilityLabel("Caricamento")
                }
                if offline {
                    Label("Sei offline. Mostriamo gli ultimi dati salvati.", systemImage: "wifi.slash")
                        .font(.label)
                        .foregroundStyle(Color.foreground)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm)
                        .glassEffect(.regular, in: .capsule)
                }
                HStack {
                    Spacer()
                    mapControls
                }
                .padding(.horizontal, Spacing.md)
                Spacer(minLength: 0)
            }
            // Sopra la barra delle schede.
            .padding(.bottom, Spacing.xxxl)
        }
    }

    /// Colonna di vetro a destra, come Mappe: 3D, stile della mappa, posizione.
    private var mapControls: some View {
        VStack(spacing: 0) {
            Button { tilted.toggle() } label: {
                Text(verbatim: tilted ? "2D" : "3D")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(tilted ? "Vista piana" : "Vista 3D")
            Menu {
                Picker("Stile della mappa", selection: $mapStyle) {
                    ForEach(MapStyleChoice.allCases) { Text($0.title).tag($0) }
                }
            } label: {
                controlIcon("globe")
            }
            .accessibilityLabel("Stile della mappa")
            Button {
                focus = MapFocus(id: focus.id + 1, userFirst: true)
            } label: {
                controlIcon("location")
            }
            .accessibilityLabel("Centra sulla mia posizione")
        }
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
    }

    private func controlIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(Color.primary)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.sm) {
                chip(String(localized: "Tutte"), value: nil)
                ForEach(ApiContract.categories, id: \.self) { chip(categoryLabel($0), value: $0) }
            }
            .padding(.horizontal, Spacing.md)
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ title: String, value: String?) -> some View {
        let selected = filter == value
        return Button { filter = value } label: {
            Text(verbatim: title)
                .font(.label.weight(.semibold))
                .foregroundStyle(selected ? Color.white : Color.foreground)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .glassEffect(selected ? .regular.tint(Color.accentToken).interactive() : .regular.interactive(), in: .capsule)
        .accessibilityLabel(selected ? Text("\(title), selezionato") : Text(verbatim: title))
    }

    /// Vuoto (nessun pin nella vista) e guasto (nessun dato, nemmeno in cache).
    @ViewBuilder private var overlayMessage: some View {
        if phase == .failed {
            ContentUnavailableView {
                Label("Mappa non disponibile", systemImage: "wifi.slash")
            } description: {
                Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
            } actions: {
                Button("Riprova") { Task { await load() } }
            }
            .padding(Spacing.md)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.card))
            .padding(Spacing.md)
        } else if phase == .loaded, visibleCount == 0 {
            ContentUnavailableView {
                Label("Nessun evento in questa zona", systemImage: "map")
            } description: {
                Text("Sposta la mappa o allarga la visuale.")
            }
            .padding(Spacing.md)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: Radius.card))
            .padding(Spacing.md)
            .allowsHitTesting(false)
        }
    }

    // MARK: dati

    private func load() async {
        guard let api else { return }
        let place = location.place
        phase = .loading
        do {
            let fresh = try await api.mapPins(lat: place.latitude, lng: place.longitude, radiusKm: radiusKm)
            guard !Task.isCancelled else { return }
            pins = fresh
            offline = false
            phase = .loaded
            Self.write(fresh, for: place)
        } catch {
            guard !Task.isCancelled else { return }
            // Senza rete si mostrano gli ultimi pin di questo luogo; senza nemmeno quelli, un messaggio con "Riprova".
            if let cached = Self.read(for: place) {
                pins = cached
                offline = true
                phase = .loaded
            } else {
                phase = .failed
            }
        }
    }

    private static func url(for place: Place) -> URL {
        let slug = place.name.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        return URL.cachesDirectory.appending(path: "fuorirotta/map-\(slug).json")
    }

    private static func write(_ pins: [FuorirottaCore.MapPin], for place: Place) {
        let target = url(for: place)
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(pins) { try? data.write(to: target, options: .atomic) }
    }

    private static func read(for place: Place) -> [FuorirottaCore.MapPin]? {
        guard let data = try? Data(contentsOf: url(for: place)) else { return nil }
        return try? JSONDecoder().decode([FuorirottaCore.MapPin].self, from: data)
    }
}
