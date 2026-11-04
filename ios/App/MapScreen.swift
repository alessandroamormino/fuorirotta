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

/// Un gruppo di 2+ eventi della griglia (Core): la bolla col numero. Un evento solo e' un PinAnnotation.
final class GroupAnnotation: NSObject, MKAnnotation {
    let group: PinGroup
    let coordinate: CLLocationCoordinate2D

    init(_ group: PinGroup) {
        self.group = group
        coordinate = CLLocationCoordinate2D(latitude: group.lat, longitude: group.lng)
    }
}

/// Chiede alla mappa di spostarsi: cambia `id` a ogni richiesta (cambio luogo, pulsante di ricentratura).
struct MapFocus: Equatable {
    var id = 0
    /// Prima il pallino dell'utente (se la posizione e' consentita), poi il luogo.
    var userFirst = false
    /// Lato della regione: 100 km (raggio di 50) per un luogo, pochi km per un evento aperto dal dettaglio.
    var meters: CLLocationDistance = 100_000
}

/// MKMapView vera, senza clustering nativo: i ~9.000 pin restano in memoria e sulla mappa vanno solo i gruppi a griglia
/// della vista (Core, `gridClusters`), al massimo qualche centinaio. Si ricalcolano una volta a gesto finito e si
/// applicano per differenza di id (mai removeAll + add: SwiftUI chiama updateUIView a ogni cambio di stato).
struct EventMapView: UIViewRepresentable {
    let pins: [FuorirottaCore.MapPin]
    /// Cambia solo quando `pins` cambia davvero: SwiftUI chiama updateUIView a ogni cambio di stato, e con ~9.000 pin
    /// ricalcolare la differenza ogni volta costerebbe a vuoto.
    let revision: Int
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
            // Raggio di 50 km attorno al punto (UI-SPEC "Mappa"); attorno a un evento, la regione chiesta.
            map.setRegion(MKCoordinateRegion(center: target, latitudinalMeters: focus.meters, longitudinalMeters: focus.meters), animated: true)
        }
        c.apply(revision: revision, to: map)
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
        private var shown: [String: (annotation: any MKAnnotation, ids: [Int])] = [:]
        private var appliedRevision = -1
        private var debounce: Task<Void, Never>?

        init(_ parent: EventMapView) {
            self.parent = parent
            focus = parent.focus
        }

        func apply(revision: Int, to map: MKMapView) {
            guard revision != appliedRevision else { return }
            guard map.bounds.width > 0 else {
                // Non ancora impaginata: il primo disegno non aspetta un cambio di regione, riprova al giro dopo.
                DispatchQueue.main.async { [weak self, weak map] in
                    if let self, let map { self.apply(revision: self.parent.revision, to: map) }
                }
                return
            }
            appliedRevision = revision
            refresh(map)
        }

        /// Mette sulla mappa i gruppi della vista (Core) e toglie/aggiunge solo la differenza.
        // ponytail: con la camera 3D (pitch 60) `visibleMapRect` arriva all'orizzonte, quindi la griglia e' piu' grossa
        // della scala a schermo vicino a te; accettato.
        private func refresh(_ map: MKMapView) {
            guard map.bounds.width > 0 else { return }
            let rect = map.visibleMapRect.intersection(.world)
            let nw = MKMapPoint(x: rect.minX, y: rect.minY).coordinate
            let se = MKMapPoint(x: rect.maxX, y: rect.maxY).coordinate
            let groups = gridClusters(
                parent.pins, minLat: se.latitude, maxLat: nw.latitude, minLng: nw.longitude, maxLng: se.longitude,
                widthPoints: map.bounds.width)
            let delta = groupDelta(shown: shown.mapValues(\.ids), incoming: groups)
            // La scheda aperta sopravvive a pan e zoom: il pin selezionato non si toglie (lo toglie un giro dopo la chiusura).
            // ponytail: finche' la scheda e' aperta quel pin puo' stare accanto a un gruppo che lo conta ancora.
            let selected = map.selectedAnnotations
            let gone = delta.remove.compactMap { id -> (any MKAnnotation)? in
                guard let a = shown[id]?.annotation, !selected.contains(where: { $0 === a }) else { return nil }
                return shown.removeValue(forKey: id)?.annotation
            }
            if !gone.isEmpty { map.removeAnnotations(gone) }
            let fresh = delta.add.map { g -> (String, any MKAnnotation) in
                (g.id, g.pins.count == 1 ? PinAnnotation(g.pins[0]) : GroupAnnotation(g))
            }
            for (g, (id, a)) in zip(delta.add, fresh) { shown[id] = (a, g.pins.map(\.id)) }
            if !fresh.isEmpty { map.addAnnotations(fresh.map(\.1)) }
            // Quanti eventi stanno nella vista (messaggio di zona vuota): i gruppi con il centro dentro, poche centinaia di controlli.
            let count = groups.filter { rect.contains(MKMapPoint(CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng))) }
                .reduce(0) { $0 + $1.pins.count }
            let report = parent.onVisibleCount
            DispatchQueue.main.async { report(count) }
        }

        /// Niente calcoli mentre il dito muove la mappa: si aspetta ~150 ms dopo la fine del gesto.
        func mapView(_ map: MKMapView, regionDidChangeAnimated animated: Bool) {
            debounce?.cancel()
            debounce = Task { @MainActor [weak self, weak map] in
                try? await Task.sleep(for: .milliseconds(150))
                guard !Task.isCancelled, let self, let map else { return }
                self.refresh(map)
            }
        }

        func mapView(_ map: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            if let group = annotation as? GroupAnnotation {
                let v = map.dequeueReusableAnnotationView(withIdentifier: "cluster", for: group) as! MKMarkerAnnotationView
                // Mai accent sulla mappa: bolla "foreground" con testo invertito.
                v.markerTintColor = UIColor(Color.foreground)
                v.glyphTintColor = UIColor(Color.background)
                v.glyphText = String(group.group.pins.count)
                v.displayPriority = .required
                v.canShowCallout = false
                v.accessibilityLabel = String(localized: "\(group.group.pins.count) eventi")
                return v
            }
            guard let pin = annotation as? PinAnnotation else { return nil } // posizione utente: pallino di sistema
            let v = map.dequeueReusableAnnotationView(withIdentifier: "pin", for: pin) as! MKMarkerAnnotationView
            let visual = categoryVisual(pin.category)
            v.markerTintColor = UIColor(visual.color)
            v.glyphImage = UIImage(systemName: visual.symbol)
            // ponytail: .required = nessun evento nascosto dalle collisioni (stesso insieme del sito); due pin a pochi metri
            // ai due lati del bordo di una cella possono sovrapporsi finche' non si zooma.
            v.displayPriority = .required
            v.canShowCallout = false
            // Selezionato: ingrandimento e titolo sotto il pin, quelli di sistema (come Mappe).
            v.titleVisibility = .adaptive
            v.subtitleVisibility = .hidden
            return v
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            if let group = view.annotation as? GroupAnnotation {
                map.deselectAnnotation(group, animated: false)
                let spots = group.group.pins.map { CLLocationCoordinate2D(latitude: $0.lat ?? 0, longitude: $0.lng ?? 0) }
                if cannotSplit(spots, in: map) {
                    parent.onCluster(group.group.pins.map(\.id))
                } else {
                    // ponytail: l'animazione e' quella di sistema di MapKit, non una molla nostra.
                    map.setVisibleMapRect(
                        Self.bounds(of: spots), edgePadding: UIEdgeInsets(top: 120, left: 60, bottom: 120, right: 60), animated: true)
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
        private func cannotSplit(_ spots: [CLLocationCoordinate2D], in map: MKMapView) -> Bool {
            if map.camera.centerCoordinateDistance <= Self.maxZoomDistance { return true }
            guard let first = spots.first else { return false }
            let rect = Self.bounds(of: spots)
            let meters = hypot(rect.width, rect.height) / MKMapPointsPerMeterAtLatitude(first.latitude)
            return meters <= Self.samePlaceMeters
        }

        private static func bounds(of spots: [CLLocationCoordinate2D]) -> MKMapRect {
            spots.reduce(MKMapRect.null) { $0.union(MKMapRect(origin: MKMapPoint($1), size: MKMapSize(width: 0, height: 0))) }
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
    @Environment(Router.self) private var router

    /// Un evento aperto dalla mappa piccola del dettaglio (C2): la mappa si centra li',
    /// finche' non cambia il luogo della Home. I pin sono sempre quelli di tutta Italia.
    @State private var eventSpot: Place?
    private var origin: Place { eventSpot ?? location.place }

    @State private var pins: [FuorirottaCore.MapPin] = []
    /// `pins` dopo il filtro, calcolato solo quando cambiano i pin o il filtro (non a ogni disegno della vista).
    @State private var shownPins: [FuorirottaCore.MapPin] = []
    @State private var pinsRevision = 0
    /// ETag della copia che abbiamo: serve a chiedere al server "e' cambiato qualcosa?" senza riscaricare 2,6 MB.
    @State private var etag: String?
    @State private var phase = Phase.loading
    @State private var offline = false
    @State private var filter: Set<String> = []  // vuoto = Tutte
    @State private var sheet: MapSheet?
    @AppStorage(MapStyleChoice.key) private var mapStyle = MapStyleChoice.hybrid
    @State private var tilted = false
    @State private var focus = MapFocus()
    @State private var visibleCount: Int?

    private var selectedPinID: Int? {
        if case .pin(let pin) = sheet { pin.id } else { nil }
    }

    private func refreshShown() {
        shownPins = filter.isEmpty ? pins : pins.filter { filter.contains($0.category ?? "Altro") }
        pinsRevision += 1
    }

    var body: some View {
        EventStack {
            ZStack {
                EventMapView(
                    pins: shownPins,
                    revision: pinsRevision,
                    center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
                    focus: focus,
                    showsUser: location.authorised,
                    mapType: mapStyle.mapType,
                    tilted: tilted,
                    selectedID: selectedPinID,
                    onSelect: { id in sheet = pins.first { $0.id == id }.map(MapSheet.pin) },
                    onDeselect: { if case .pin = sheet { sheet = nil } },
                    onCluster: { ids in
                        let wanted = Set(ids)
                        let members = pins.filter { wanted.contains($0.id) }.sorted { $0.dateStart < $1.dateStart }.map(asEvent)
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
        .task { await load() }
        .onChange(of: location.place) {
            eventSpot = nil
            focus = MapFocus(id: focus.id + 1)
        }
        // La scheda puo' nascere proprio adesso (prima visita): anche onAppear.
        .onAppear(perform: showRequestedEvent)
        .onChange(of: router.mapEvent) { showRequestedEvent() }
        .onChange(of: filter) {
            sheet = nil
            refreshShown()
        }
    }

    // MARK: vetro: filtro, ricentra, avvisi

    private var chrome: some View {
        GlassEffectContainer(spacing: Spacing.sm) {
            VStack(spacing: Spacing.sm) {
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

    /// Colonna di vetro a destra, come Mappe: filtro categorie, 3D, stile della mappa, posizione.
    private var mapControls: some View {
        VStack(spacing: 0) {
            CategoryFilter(selection: $filter)
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

    /// C2: centra la mappa sull'evento chiesto dal dettaglio e ne apre la scheda del pin.
    private func showRequestedEvent() {
        guard let event = router.mapEvent else { return }
        router.mapEvent = nil
        guard let lat = event.resolvedLatitude ?? event.latitude, let lng = event.resolvedLongitude ?? event.longitude else { return }
        eventSpot = Place(name: event.title, latitude: lat, longitude: lng)
        focus = MapFocus(id: focus.id + 1, meters: 4_000)
        let pin = FuorirottaCore.MapPin(
            id: event.id, title: event.title, category: event.canonicalCategory ?? event.category, imageUrl: event.imageUrl,
            dateStart: event.dateStart, locationName: event.locationName, lat: lat, lng: lng)
        // Un filtro di categoria che lo nasconderebbe si toglie; la scheda dopo, o il cambio di filtro la chiuderebbe.
        if !filter.isEmpty, !filter.contains(pin.category ?? "Altro") {
            filter = []
            Task { sheet = .pin(pin) }
        } else {
            sheet = .pin(pin)
        }
    }

    // MARK: dati

    /// D-17: i pin di tutta Italia, una volta per vita della schermata. Cambiare luogo sposta solo la camera (`focus`).
    /// Prima la copia su disco (subito), poi una domanda al server con il suo ETag: 304 = non cambia nulla.
    private func load() async {
        guard let api, !(phase == .loaded && !offline) else { return }
        if pins.isEmpty, let disk = await Task.detached(operation: { Self.readDisk() }).value {
            guard !Task.isCancelled else { return }
            pins = disk.pins
            etag = disk.etag
            refreshShown()
            phase = .loaded
        } else if pins.isEmpty {
            phase = .loading
        }
        do {
            let fetch = try await api.clusters(ifNoneMatch: etag)
            guard !Task.isCancelled else { return }
            switch fetch {
            case .fresh(let set, let newEtag):
                pins = set.pins
                etag = newEtag
                refreshShown()
                Task.detached { Self.writeDisk(DiskCopy(computedAt: set.computedAt, etag: newEtag, pins: set.pins)) }
            case .notModified, .empty:
                break  // ponytail: .empty (file non ancora calcolato) lascia la copia che c'e'; senza copia la mappa e' vuota.
            }
            offline = false
            phase = .loaded
        } catch {
            guard !Task.isCancelled else { return }
            // Senza rete resta la copia su disco con l'avviso; senza nemmeno quella, un messaggio con "Riprova".
            if pins.isEmpty { phase = .failed } else { offline = true }
        }
    }

    private struct DiskCopy: Codable, Sendable {
        let computedAt: String
        let etag: String?
        let pins: [FuorirottaCore.MapPin]
    }

    nonisolated private static let diskURL = URL.cachesDirectory.appending(path: "fuorirotta/map-italia.json")

    nonisolated private static func writeDisk(_ copy: DiskCopy) {
        // ponytail: scrittura fallita = niente cache offline, nient'altro.
        try? FileManager.default.createDirectory(at: diskURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(copy) { try? data.write(to: diskURL, options: .atomic) }
    }

    nonisolated private static func readDisk() -> DiskCopy? {
        guard let data = try? Data(contentsOf: diskURL) else { return nil }
        return try? JSONDecoder().decode(DiskCopy.self, from: data)
    }
}
