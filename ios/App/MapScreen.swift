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
    let onSelect: (Int) -> Void
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
            return v
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            defer { map.deselectAnnotation(view.annotation, animated: false) }
            if let cluster = view.annotation as? MKClusterAnnotation {
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

        /// Il foglio basso copre il terzo inferiore dello schermo: un pin piu' in basso della meta' si porta in alto.
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

/// Il foglio che si apre toccando un pin, nello stile della scheda luogo di Mappe: due altezze, la mappa resta
/// toccabile dietro la prima, fondo di vetro di sistema. Contenuto dal popup del sito: foto, categoria, titolo,
/// giorni · luogo e le azioni Salva / Indicazioni / Apri dettaglio.
struct PinSheet: View {
    static let compact = PresentationDetent.height(320)

    let onOpen: (Event) -> Void
    let onClose: () -> Void

    @Environment(\.api) private var api
    @Environment(SavesModel.self) private var saves
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var event: Event

    init(pin: FuorirottaCore.MapPin, onOpen: @escaping (Event) -> Void, onClose: @escaping () -> Void) {
        _event = State(initialValue: asEvent(pin))
        self.onOpen = onOpen
        self.onClose = onClose
    }

    private var category: String? { event.canonicalCategory ?? event.category }

    private var spot: CLLocationCoordinate2D? {
        guard let lat = event.resolvedLatitude ?? event.latitude, let lng = event.resolvedLongitude ?? event.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .top, spacing: Spacing.md) {
                    RemoteImage(url: event.imageUrl, category: category, size: CGSize(width: 96, height: 96))
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.media))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        if let name = category {
                            let visual = categoryVisual(name)
                            Label {
                                Text(verbatim: name)
                            } icon: {
                                Image(systemName: visual.symbol)
                            }
                            .font(.label)
                            .foregroundStyle(.white)
                            .padding(.horizontal, Spacing.sm)
                            .padding(.vertical, Spacing.xs)
                            .background(visual.color, in: Capsule())
                        }
                        Text(verbatim: event.title)
                            .font(.heading)
                            .foregroundStyle(Color.foreground)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
                        Text(verbatim: eventMeta(event))
                            .font(.label)
                            .foregroundStyle(Color.foregroundSecondary)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    }
                    // Il posto della X, che sta sopra (vedi overlay).
                    .padding(.trailing, Spacing.lg)
                    Spacer(minLength: 0)
                }
                actions
                if let text = event.description, !text.isEmpty {
                    // Si vede alzando il foglio.
                    Text(verbatim: text)
                        .font(.body)
                        .foregroundStyle(Color.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.label.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Chiudi")
            .padding(Spacing.md)
        }
        .presentationDetents([Self.compact, .large])
        .presentationDragIndicator(.visible)
        // La mappa dietro resta toccabile finche' il foglio e' basso: un altro pin cambia il contenuto.
        .presentationBackgroundInteraction(.enabled(upThrough: Self.compact))
        .task(id: event.id) { await fetch() }
    }

    /// Tre azioni: Salva, Indicazioni, Apri dettaglio. Quattro in una riga non stanno nei testi grandi: vanno a capo.
    private var actions: some View {
        let saved = saves.isSaved(event.id)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.sm) { buttons(saved: saved) }
            VStack(spacing: Spacing.sm) { buttons(saved: saved) }
        }
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: saved)
    }

    @ViewBuilder private func buttons(saved: Bool) -> some View {
        Button {
            Task { await saves.toggle(event) }
        } label: {
            Label {
                Text(saved ? "Salvato" : "Salva")
            } icon: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark")
                    .foregroundStyle(saved ? Color.accentToken : Color.primary)
                    .symbolEffect(.bounce, value: reduceMotion ? false : saved)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        if let spot {
            Button {
                openDirections(to: spot, name: event.locationName ?? event.title)
            } label: {
                Label("Indicazioni", systemImage: "arrow.triangle.turn.up.right.diamond").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        Button {
            onOpen(event)
        } label: {
            Label("Apri dettaglio", systemImage: "chevron.right").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
    }

    /// Il pin porta solo i campi minimi: il resto (fine dell'evento, descrizione) arriva da qui, senza spinner.
    private func fetch() async {
        guard let api, case .found(let fresh)? = try? await api.event(id: event.id) else { return }
        event = fresh
    }
}

/// Gruppo che non si puo' dividere: gli eventi in elenco, ciascuno apre il dettaglio.
struct ClusterListSheet: View {
    let events: [Event]

    var body: some View {
        EventStack {
            List(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                .listStyle(.plain)
                .navigationTitle(Text(verbatim: "\(events.count) eventi"))
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
    @State private var path = NavigationPath()
    @State private var focus = MapFocus()
    @State private var visibleCount: Int?

    private var shownPins: [FuorirottaCore.MapPin] {
        guard let filter else { return pins }
        return pins.filter { ($0.category ?? "Altro") == filter }
    }

    var body: some View {
        EventStack(path: $path) {
            ZStack {
                EventMapView(
                    pins: shownPins,
                    center: CLLocationCoordinate2D(latitude: location.place.latitude, longitude: location.place.longitude),
                    focus: focus,
                    showsUser: location.authorised,
                    onSelect: { id in sheet = pins.first { $0.id == id }.map(MapSheet.pin) },
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
                PinSheet(
                    pin: pin,
                    onOpen: { event in
                        sheet = nil
                        path.append(EventRoute(event: event, slot: "map"))
                    },
                    onClose: { sheet = nil }
                )
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
                Spacer(minLength: 0)
                HStack {
                    Spacer()
                    Button {
                        focus = MapFocus(id: focus.id + 1, userFirst: true)
                    } label: {
                        Image(systemName: "location")
                            .font(.title3)
                            .foregroundStyle(Color.primary)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Centra sulla mia posizione")
                }
                .padding(.horizontal, Spacing.md)
            }
            // Sopra la barra delle schede.
            .padding(.bottom, Spacing.xxxl)
        }
    }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Spacing.sm) {
                chip("Tutte", value: nil)
                ForEach(ApiContract.categories, id: \.self) { chip($0, value: $0) }
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
        .accessibilityLabel(selected ? "\(title), selezionato" : title)
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
