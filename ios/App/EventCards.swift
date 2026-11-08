import FuorirottaCore
import SwiftUI

/// Evento senza foto: categoria al 16% come fondo, simbolo al centro nel colore della categoria.
struct CategoryPlaceholder: View {
    let category: String?

    var body: some View {
        let visual = categoryVisual(category)
        visual.color.opacity(0.16)
            .overlay {
                Image(systemName: visual.symbol)
                    .font(.largeTitle)
                    .foregroundStyle(visual.color)
            }
            .accessibilityHidden(true)
    }
}

/// "6-8 novembre · Luogo": il luogo manca senza lasciare separatori vuoti.
func eventMeta(_ event: Event) -> String {
    var parts: [String] = []
    if let days = eventDays(dateStart: event.dateStart, dateEnd: event.dateEnd) {
        parts.append(formatDayRange(from: days.startDay, to: days.endDay, locale: .app))
    }
    if let place = event.locationName, !place.isEmpty { parts.append(place) }
    return parts.joined(separator: " · ")
}

/// Eroe di Home: card stondata con foto, titolo e luogo, sotto l'intestazione "Questo weekend".
struct HeroCard: View {
    // ponytail: 240 e' la manopola se la card deve essere piu' alta o piu' bassa.
    static let height: CGFloat = 240
    // Misura di decodifica: lato lungo della card su un iPhone (la larghezza reale dipende dallo schermo).
    static let imageSize = CGSize(width: 440, height: height + 60)
    // Spazio per il cuore di vetro a destra del titolo.
    private static let heartSlot: CGFloat = 44 + Spacing.sm

    /// Lo zoom lento della foto sulla slide attiva (1.0 -> 1.05 in `zoomSeconds`, come il carosello di Omniphile).
    static let zoomScale: CGFloat = 1.05
    static let zoomSeconds: Double = 4

    let event: Event
    /// Distingue la copia che chiude il giro del carosello: lo stesso evento non puo' avere due origini dello zoom.
    var slot = "hero"
    /// Vero per la slide attiva quando il movimento e' permesso (mai con "Riduci movimento" o VoiceOver).
    var zooming = false

    @State private var zoomed = false

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        EventLink(event: event, slot: slot) { card }
            // I test UI trovano l'eroe da questo identificatore: altezza e raggio sono manopole del proprietario.
            .accessibilityIdentifier("hero")
            // Sopra il collegamento: per VoiceOver il cuore e' un controllo a parte, e il suo tocco non apre l'evento.
            // In basso a destra, accanto al titolo.
            .overlay(alignment: .bottomTrailing) {
                HeartButton(event: event, style: .glass).padding(Spacing.md)
            }
    }

    private var card: some View {
        let visual = categoryVisual(category)
        return RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
            .scaleEffect(zoomed ? Self.zoomScale : 1)
            .task(id: zooming) {
                if zooming {
                    zoomed = false
                    withAnimation(.linear(duration: Self.zoomSeconds)) { zoomed = true }
                } else {
                    // Un attimo dopo, a scorrimento finito: la foto che esce non deve scattare indietro sotto gli occhi.
                    try? await Task.sleep(for: .seconds(0.7))
                    guard !Task.isCancelled else { return }
                    var t = Transaction(animation: nil)
                    t.disablesAnimations = true
                    withTransaction(t) { zoomed = false }
                }
            }
            .overlay(alignment: .bottom) {
                // Sfumatura fissa sotto il testo: il bianco regge il contrasto su qualunque foto.
                LinearGradient(colors: [Color.scrim.opacity(0), Color.scrim], startPoint: .top, endPoint: .bottom)
                    .frame(height: Self.height * 0.6)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(verbatim: event.title)
                        .font(.heading)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .truncationMode(.tail)
                    Text(verbatim: eventMeta(event))
                        .font(.label)
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(1)
                    if let name = category {
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
                }
                .padding(Spacing.md)
                .padding(.trailing, Self.heartSlot)
            }
            .frame(height: Self.height)
            .clipShape(RoundedRectangle(cornerRadius: Radius.hero, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: [event.title, eventMeta(event), category.map(categoryLabel)].compactMap { $0 }.joined(separator: ", ")))
    }
}

/// Scheda di una fila (Vicino a te, Per te): 176 di larghezza, foto 4:3 (132). L'altezza e' libera: con i testi
/// accessibili i titoli vanno a capo e la scheda cresce, senza tagli.
struct RailCard: View {
    static let width: CGFloat = 176
    static let imageHeight: CGFloat = 132
    static let imageSize = CGSize(width: width, height: imageHeight)

    let event: Event
    /// Distingue la fila di provenienza per lo zoom: lo stesso evento puo' stare in piu' file.
    var slot = "rail"
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        EventLink(event: event, slot: slot) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
                    .frame(width: Self.width, height: Self.imageHeight)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                Text(verbatim: event.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                    .truncationMode(.tail)
                Text(verbatim: eventMeta(event))
                    .font(.label)
                    .foregroundStyle(Color.mutedForeground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
            }
            .frame(width: Self.width, alignment: .topLeading)
        }
        .frame(width: Self.width, alignment: .topLeading)
        .overlay(alignment: .topTrailing) {
            // Vetro e non "plain": sta sopra una foto qualunque e deve restare leggibile.
            HeartButton(event: event, style: .glass).padding(Spacing.xs)
        }
        .accessibilityElement(children: .contain)
    }
}

/// Scheda verticale (REF Omniphile "Releases"): locandina 2:3 con il titolo sulla foto e la data del primo giorno SOPRA.
/// Se l'evento inizia oggi la data e' in accento; nessun bordo. Il cuore di vetro sta in alto a destra.
struct PosterCard: View {
    static let width: CGFloat = 148
    static let height: CGFloat = 222
    static let imageSize = CGSize(width: width, height: height)

    let event: Event
    var slot = "poster"
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        let date = railDate(dateStart: event.dateStart, dateEnd: event.dateEnd, today: romeToday(), locale: .app)
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(verbatim: date.label)
                .font(.label.weight(.semibold))
                .foregroundStyle(date.isToday ? Color.accentToken : Color.foreground)
                .lineLimit(1)
                .frame(minHeight: 20, alignment: .leading)
                .accessibilityHidden(true)
            EventLink(event: event, slot: slot) { card(date: date.label) }
                .overlay(alignment: .topTrailing) {
                    HeartButton(event: event, style: .glass).padding(Spacing.xs)
                }
        }
        .frame(width: Self.width, alignment: .topLeading)
        .accessibilityElement(children: .contain)
    }

    private func card(date: String) -> some View {
        Text(verbatim: event.title)
            .font(.label.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
            .truncationMode(.tail)
            .multilineTextAlignment(.leading)
            .padding(Spacing.sm)
            .frame(width: Self.width, alignment: .leading)
            // L'altezza minima e' quella della locandina; con i testi accessibili la scheda cresce, senza tagli.
            .frame(minHeight: Self.height, alignment: .bottomLeading)
            .background {
                ZStack {
                    RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
                    LinearGradient(
                        stops: [.init(color: Color.scrim.opacity(0), location: 0.45), .init(color: Color.scrim, location: 1)],
                        startPoint: .top, endPoint: .bottom)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.media))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: [date, event.title, eventMeta(event), category.map(categoryLabel)].compactMap { $0 }.joined(separator: ", ")))
    }
}

/// Scheda larga (REF Omniphile "Haven't Watched"): foto 16:9, in basso a sinistra la categoria con chevron e il titolo,
/// in basso a destra il cuore di vetro.
struct WideCard: View {
    static let width: CGFloat = 280
    static let height: CGFloat = 158
    static let imageSize = CGSize(width: width, height: height)
    private static let heartSlot: CGFloat = 44 + Spacing.sm

    let event: Event
    var slot = "wide"
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        EventLink(event: event, slot: slot) { card }
            .overlay(alignment: .bottomTrailing) {
                HeartButton(event: event, style: .glass).padding(Spacing.sm)
            }
            .frame(width: Self.width, alignment: .topLeading)
            .accessibilityElement(children: .contain)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let name = category {
                HStack(spacing: Spacing.xs) {
                    Text(verbatim: categoryLabel(name)).lineLimit(1)
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).accessibilityHidden(true)
                }
                .font(.label)
                .foregroundStyle(.white.opacity(0.75))
            }
            Text(verbatim: event.title)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                .truncationMode(.tail)
        }
        .padding(Spacing.md)
        .padding(.trailing, Self.heartSlot)
        .frame(width: Self.width, alignment: .leading)
        .frame(minHeight: Self.height, alignment: .bottomLeading)
        .background {
            ZStack {
                RemoteImage(url: event.imageUrl, category: category, size: Self.imageSize)
                LinearGradient(
                    stops: [.init(color: Color.scrim.opacity(0), location: 0.35), .init(color: Color.scrim, location: 1)],
                    startPoint: .top, endPoint: .bottom)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.media))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: [event.title, eventMeta(event), category.map(categoryLabel)].compactMap { $0 }.joined(separator: ", ")))
    }
}

/// Cuore dei salvati (come SaveHeart del sito): contorno/pieno con rimbalzo (fermo con "Riduci movimento") e tocco leggero.
/// Rosso solo da pieno.
struct HeartButton: View {
    enum Style { case glass, plain }

    let event: Event
    let style: Style

    @Environment(SavesModel.self) private var saves
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let saved = saves.isSaved(event.id)
        let button = Button {
            Task { await saves.toggle(event) }
        } label: {
            Image(systemName: saved ? "heart.fill" : "heart")
                .font(.title3)
                .foregroundStyle(saved ? Color.heart : Color.primary)
                .symbolEffect(.bounce, value: reduceMotion ? false : saved)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .sensoryFeedback(.impact(flexibility: .soft), trigger: saved)
        .accessibilityLabel(saved ? "Rimuovi dai salvati" : "Salva evento")
        switch style {
        case .glass: button.glassEffect(.regular.interactive(), in: .circle)
        case .plain: button.buttonStyle(.plain)
        }
    }
}

/// Riga dell'elenco "Vedi tutto": miniatura 72, titolo (2 righe, tutte con i testi accessibili), data e luogo, cuore.
struct EventRow: View {
    let event: Event
    @Environment(\.dynamicTypeSize) private var typeSize

    private var category: String? { event.canonicalCategory ?? event.category }

    var body: some View {
        EventLink(event: event, slot: "row") { content }
            .overlay(alignment: .topTrailing) { HeartButton(event: event, style: .plain) }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            RemoteImage(url: event.imageUrl, category: category, size: CGSize(width: 72, height: 72))
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: event.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.foreground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                Text(verbatim: eventMeta(event))
                    .font(.label)
                    .foregroundStyle(Color.mutedForeground)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                if let name = category {
                    HStack(spacing: Spacing.xs) {
                        Circle().fill(categoryVisual(name).color).frame(width: 8, height: 8)
                        Text(verbatim: categoryLabel(name)).font(.label).foregroundStyle(Color.mutedForeground)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Spacer(minLength: 0)
            // Il posto del cuore, che sta sopra il collegamento (vedi body).
            Color.clear.frame(width: 44, height: 44)
        }
    }
}

/// Elenco di una fila ("Vedi tutto"): fino a 100 eventi della stessa fonte. Carica, mostra lo scheletro, l'errore con Riprova o il vuoto.
struct EventListView: View {
    let route: EventListRoute

    @Environment(\.api) private var api

    private enum Phase { case loading, loaded([Event]), failed }
    @State private var phase = Phase.loading

    var body: some View {
        List {
            switch phase {
            case .loading:
                ForEach(0..<6, id: \.self) { _ in
                    HStack(spacing: Spacing.md) {
                        RoundedRectangle(cornerRadius: Radius.md).fill(Color.surface).frame(width: 72, height: 72)
                        VStack(alignment: .leading) {
                            Text(verbatim: "Titolo dell'evento in due righe").font(.body.weight(.semibold))
                            Text(verbatim: "6-8 novembre · Luogo").font(.label)
                        }
                    }
                    .redacted(reason: .placeholder)
                    .listRowSeparator(.hidden)
                    .accessibilityHidden(true)
                }
            case .loaded(let events):
                if events.isEmpty {
                    ContentUnavailableView {
                        Label("Nessun evento", systemImage: "calendar")
                    } description: {
                        Text("Non c'è ancora niente qui. Riprova più tardi.")
                    }
                    .listRowSeparator(.hidden)
                } else {
                    ForEach(events) { EventRow(event: $0).listRowSeparator(.hidden) }
                }
            case .failed:
                ContentUnavailableView {
                    Label("Eventi non disponibili", systemImage: "wifi.slash")
                } description: {
                    Text("Non riusciamo a caricare gli eventi. Controlla la connessione e riprova.")
                } actions: {
                    Button("Riprova") { Task { await load() } }
                }
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .navigationTitle(Text(verbatim: route.title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    /// Stessa fonte e stesse date della fila, fino a 100.
    private func fetch() async throws -> [Event] {
        guard let api else { throw APIError.network }
        switch route.source {
        case .nearby(let place, let when):
            let range = when.range
            return try await api.events(
                lat: place.latitude, lng: place.longitude, radiusKm: 50, dateFrom: range?.from, dateTo: range?.to, limit: 100
            ).events
        case .forYou:
            return try await api.feed(limit: 100, offset: 0).items
        }
    }

    private func load() async {
        do {
            phase = .loaded(try await fetch())
        } catch {
            // Un aggiornamento che fallisce lascia l'elenco com'e'.
            guard !Task.isCancelled else { return }
            if case .loaded = phase { return }
            phase = .failed
        }
    }
}
