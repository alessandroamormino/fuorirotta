import FuorirottaCore
import MapKit
import SwiftUI

// MARK: navigazione con zoom dalla card

extension EnvironmentValues {
    /// Lo spazio dei nomi della pila: le card ne sono la sorgente, il dettaglio la destinazione dello zoom.
    @Entry var zoomNamespace: Namespace.ID? = nil
}

/// Cosa si spinge sulla pila. `slot` distingue la card toccata: lo stesso evento puo' stare nell'eroe e in una fila,
/// e due sorgenti con lo stesso id renderebbero ambiguo lo zoom.
struct EventRoute: Hashable {
    let event: Event
    let slot: String
    var sourceID: String { "\(slot)-\(event.id)" }
}

/// L'elenco "Vedi tutto" di una fila. Dev'essere un valore, non un collegamento con la destinazione inline: quello
/// non entra nel `NavigationPath`, e i dettagli aggiunti al path finiscono SOTTO di lui
/// (toccare un evento mostrava ancora l'elenco, e a ogni Indietro riapparivano i dettagli gia' visti).
struct EventListRoute: Hashable {
    enum Source: Hashable {
        case nearby(Place)
        case forYou
    }

    let title: String
    let source: Source
}

/// Una pila di navigazione che sa aprire un evento con la transizione zoom (con "Riduci movimento": quella di sistema).
struct EventStack<Root: View>: View {
    private let path: Binding<NavigationPath>?
    private let root: Root

    init(path: Binding<NavigationPath>? = nil, @ViewBuilder root: () -> Root) {
        self.path = path
        self.root = root()
    }

    @Namespace private var namespace
    @State private var ownPath = NavigationPath()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack(path: path ?? $ownPath) {
            // Tutte le destinazioni della pila stanno qui, una volta sola (gate S6): niente `navigationDestination`
            // dentro viste spinte o pigre, niente `NavigationLink` con la destinazione inline.
            root
                .navigationDestination(for: EventRoute.self) { route in
                    if reduceMotion {
                        EventDetailView(event: route.event)
                    } else {
                        EventDetailView(event: route.event)
                            .navigationTransition(.zoom(sourceID: route.sourceID, in: namespace))
                    }
                }
                .navigationDestination(for: EventListRoute.self) { EventListView(route: $0) }
        }
        .environment(\.zoomNamespace, namespace)
    }
}

/// Rende una card un collegamento al dettaglio. Il cuore NON va nell'etichetta: chi usa EventLink lo mette
/// sopra con `.overlay`, cosi' per VoiceOver sono due controlli e il tocco sul cuore non apre l'evento.
struct EventLink<Content: View>: View {
    let event: Event
    let slot: String
    @ViewBuilder let content: Content
    @Environment(\.zoomNamespace) private var namespace

    var body: some View {
        let route = EventRoute(event: event, slot: slot)
        // contentShape: senza, l'area di tocco (e il riquadro per VoiceOver) del collegamento e' l'unione di tutto cio' che
        // la scheda disegna, comprese le foto `scaledToFill` che escono dalla scheda (ritagliate solo alla vista):
        // la foto di una scheda copriva il cuore e la scheda accanto (UAT 4). Cosi' e' il riquadro della scheda.
        let link = NavigationLink(value: route) { content.contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .navigationLinkIndicatorVisibility(.hidden)
        if let namespace {
            link.matchedTransitionSource(id: route.sourceID, in: namespace)
        } else {
            link
        }
    }
}

// MARK: dettaglio

struct EventDetailView: View {
    private enum Load { case loading, loaded, gone, failed }

    @Environment(\.api) private var api
    @Environment(\.openURL) private var openURL

    @State private var event: Event
    @State private var load = Load.loading
    @State private var photo: UIImage?
    @State private var tint: Color?
    @State private var similar: [Event] = []

    // Misura di decodifica della foto: larghezza di un iPhone, 4:3.
    private static let imageSize = CGSize(width: 440, height: 330)

    /// Con `onClose` (il dettaglio dentro il foglio della mappa) la barra ha una X a sinistra.
    private let onClose: (() -> Void)?

    init(event: Event, onClose: (() -> Void)? = nil) {
        _event = State(initialValue: event)
        self.onClose = onClose
    }

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                hero
                titleBlock
                if load == .gone {
                    ContentUnavailableView {
                        Label("Evento non più disponibile", systemImage: "calendar.badge.exclamationmark")
                    } description: {
                        Text("Questo evento è stato rimosso dal calendario.")
                    }
                } else {
                    if load == .failed { failedBanner }
                    actions
                    facts
                    if let text = event.description, !text.isEmpty { about(text) }
                    if !similar.isEmpty { similarRail }
                }
            }
            .padding(.bottom, Spacing.xxxl)
        }
        // La foto sale fino al bordo alto, sotto la barra trasparente (REF Omniphile).
        .ignoresSafeArea(edges: .top)
        .background { pageBackground }
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { Image(systemName: "xmark") }
                        .accessibilityLabel("Chiudi")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                // Il vetro lo disegna la barra di sistema attorno ai due pulsanti.
                ShareLink(item: URL(string: "https://fuori-rotta.it/eventi/\(event.id)")!) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Condividi evento")
                HeartButton(event: event, style: .plain)
            }
        }
        .task(id: event.id) { await fetch() }
        .task(id: event.imageUrl) { await loadPhoto() }
        .task(id: event.id) { await loadSimilar() }
    }

    // MARK: sfondo e foto

    /// Il colore medio della foto tinge tutta la pagina (REF Omniphile); senza foto resta lo sfondo di sistema.
    private var pageBackground: some View {
        ZStack {
            Color.background
            if let tint {
                LinearGradient(colors: [tint.opacity(0.55), tint.opacity(0.18)], startPoint: .top, endPoint: .bottom)
            }
        }
        .ignoresSafeArea()
        .animation(Motion.spring, value: tint)
    }

    private var hero: some View {
        Color.clear
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .overlay {
                if let photo {
                    Image(uiImage: photo).resizable().scaledToFill()
                } else {
                    CategoryPlaceholder(category: category)
                }
            }
            .clipped()
            // La foto sfuma nello sfondo tinto.
            .mask(LinearGradient(stops: [.init(color: .black, location: 0.7), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
            .accessibilityHidden(true)
    }

    private func loadPhoto() async {
        photo = nil
        tint = nil
        guard let url = event.imageUrl else { return }
        guard let image = await ImageLoader.image(url: url, size: Self.imageSize) else { return }
        photo = image
        tint = averageColor(image)
    }

    // MARK: testi

    private var titleBlock: some View {
        VStack(spacing: Spacing.sm) {
            if let name = category {
                let visual = categoryVisual(name)
                Label {
                    Text(verbatim: categoryLabel(name))
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
                .font(.display)
                .foregroundStyle(Color.foreground)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            let meta = eventMeta(event)
            if !meta.isEmpty {
                Text(verbatim: meta)
                    .font(.label)
                    .foregroundStyle(Color.foregroundSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, Spacing.md)
        // La foto sfuma sotto il titolo.
        .padding(.top, -Spacing.xl)
    }

    private var failedBanner: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.", systemImage: "wifi.slash")
                .font(.label)
                .foregroundStyle(Color.foregroundSecondary)
            Button("Riprova") { Task { await fetch() } }
                .font(.label.weight(.semibold))
                .foregroundStyle(Color.accentToken)
        }
        .card()
        .padding(.horizontal, Spacing.md)
    }

    // MARK: azioni

    private var sourceLink: URL? {
        guard let raw = event.sourceUrl else { return nil }
        let lower = raw.lowercased()
        // T-27-28: solo http e https; javascript:, file: e gli schemi delle app non si aprono mai.
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else { return nil }
        return URL(string: raw)
    }

    private var coordinate: CLLocationCoordinate2D? {
        guard let lat = event.resolvedLatitude ?? event.latitude, let lng = event.resolvedLongitude ?? event.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    @ViewBuilder private var actions: some View {
        let link = sourceLink
        let spot = coordinate
        if link != nil || spot != nil {
            HStack(spacing: Spacing.sm) {
                if let link {
                    Button {
                        openURL(link)
                    } label: {
                        Label("Apri link", systemImage: "safari").lineLimit(1).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                if let spot {
                    Button {
                        openDirections(to: spot, name: event.locationName ?? event.title)
                    } label: {
                        Label("Indicazioni", systemImage: "arrow.triangle.turn.up.right.diamond").lineLimit(1).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .padding(.horizontal, Spacing.md)
        }
    }

    // MARK: scheda "Dettagli"

    private var facts: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Dettagli").font(.heading).foregroundStyle(Color.foreground).accessibilityAddTraits(.isHeader)
            if let days = eventDays(dateStart: event.dateStart, dateEnd: event.dateEnd) {
                let when = days.startDay == days.endDay
                    ? formatLongDay(days.startDay, locale: .app)
                    : "\(formatLongDay(days.startDay, locale: .app)) - \(formatLongDay(days.endDay, locale: .app))"
                fact("calendar", "Quando", when)
            }
            if let time = eventTime(event.dateStart) { fact("clock", "Orario", time) }
            let where_ = [event.locationName, event.address].compactMap { $0 }.filter { !$0.isEmpty }
            if !where_.isEmpty { fact("mappin", "Dove", where_.joined(separator: "\n")) }
            if let host = sourceLink?.host(percentEncoded: false) {
                fact("link", "Fonte", host.hasPrefix("www.") ? String(host.dropFirst(4)) : host)
            }
        }
        .card()
        .padding(.horizontal, Spacing.md)
    }

    private func fact(_ symbol: String, _ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: symbol)
                .foregroundStyle(Color.mutedForeground)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(.label).foregroundStyle(Color.mutedForeground)
                Text(verbatim: value).font(.body).foregroundStyle(Color.foreground)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func about(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Descrizione").font(.heading).foregroundStyle(Color.foreground).accessibilityAddTraits(.isHeader)
            // L'HTML della fonte diventa testo (paragrafi, grassetto, link); senza limite di righe, gli URL lunghi vanno a capo.
            Text(htmlToAttributed(text))
                .font(.body)
                .foregroundStyle(Color.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .card()
        .padding(.horizontal, Spacing.md)
    }

    private var similarRail: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Eventi vicini").font(.heading).foregroundStyle(Color.foreground)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, Spacing.md)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: Spacing.md) {
                    ForEach(similar) { RailCard(event: $0, slot: "similar") }
                }
                .padding(.horizontal, Spacing.md)
            }
            .scrollIndicators(.hidden)
        }
    }

    // MARK: rete

    /// Il dettaglio compare subito dai dati della card; qui arriva il resto. Mai uno spinner a schermo intero.
    private func fetch() async {
        guard let api else { return }
        do {
            switch try await api.event(id: event.id) {
            case .found(let fresh):
                event = fresh
                load = .loaded
            case .gone:
                load = .gone
            }
        } catch {
            guard !Task.isCancelled else { return }
            load = .failed
        }
    }

    /// Eventi attorno al luogo di QUESTO evento (non della persona): nessuna posizione dell'utente parte.
    private func loadSimilar() async {
        guard let api, let spot = coordinate else { return }
        guard let page = try? await api.events(lat: spot.latitude, lng: spot.longitude, radiusKm: 25, limit: 13) else { return }
        similar = Array(page.events.filter { $0.id != event.id }.prefix(12))
    }
}

/// "Indicazioni": apre Mappe con il percorso in auto verso il luogo dell'evento.
func openDirections(to spot: CLLocationCoordinate2D, name: String) {
    let item = MKMapItem(location: CLLocation(latitude: spot.latitude, longitude: spot.longitude), address: nil)
    item.name = name
    item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
}

/// Colore medio di una foto: la si disegna in un pixel solo.
private func averageColor(_ image: UIImage) -> Color? {
    guard let cg = image.cgImage else { return nil }
    var pixel = [UInt8](repeating: 0, count: 4)
    let drawn = pixel.withUnsafeMutableBytes { buffer -> Bool in
        guard let ctx = CGContext(
            data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return false }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return true
    }
    guard drawn else { return nil }
    return Color(cgColor: CGColor(
        srgbRed: CGFloat(pixel[0]) / 255, green: CGFloat(pixel[1]) / 255, blue: CGFloat(pixel[2]) / 255, alpha: 1))
}
